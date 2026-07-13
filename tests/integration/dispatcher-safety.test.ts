import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ContextResolver,
  JobDispatcher,
  JobPacketAssembler,
  JobRepository,
  ReviewEngine,
  TaskRepository,
  type CompletionResponse,
  type CompletionRequest,
  type Job,
  type ProviderAdapter,
  type TaskGraphNode,
} from '@kingdomos/core';

const MIGRATIONS_DIR = join(__dirname, '..', '..', 'packages', 'core', 'migrations');

const MIGRATIONS = [
  '001_initial.sql',
  '005_checkpoints.sql',
  '006_depends_on.sql',
  '007_parent_job_id.sql',
  '008_superseded_by.sql',
  '010_lessons.sql',
];

interface Harness {
  db: Database.Database;
  projectPath: string;
  dispatcher: JobDispatcher;
  taskRepo: TaskRepository;
  jobRepo: JobRepository;
}

const response = (content = '--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1,1 +1,1 @@\n-old\n+new\n'): CompletionResponse => ({
  content,
  prompt_tokens: 10,
  completion_tokens: 5,
  total_tokens: 15,
  finish_reason: 'stop',
});

function providerWithComplete(complete: ProviderAdapter['complete']): ProviderAdapter {
  return {
    provider_id: 'mock',
    complete,
    healthCheck: async () => ({ status: 'healthy' }),
  };
}

function createHarness(validationCommand?: string, contextResolver?: ContextResolver): Harness {
  const db = new Database(':memory:');
  for (const migration of MIGRATIONS) {
    db.exec(readFileSync(join(MIGRATIONS_DIR, migration), 'utf-8'));
  }

  const projectPath = mkdtempSync(join(tmpdir(), 'kingdom-dispatcher-safety-'));
  mkdirSync(join(projectPath, 'src'), { recursive: true });
  mkdirSync(join(projectPath, 'results'), { recursive: true });

  db.prepare(
    `INSERT INTO projects (id, name, repository_path, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)`
  ).run('proj', 'Test Project', projectPath, new Date().toISOString(), new Date().toISOString());
  db.prepare(
    `INSERT INTO objectives (id, project_id, description, priority, status, acceptance_criteria, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run('obj', 'proj', 'Test objective', 5, 'active', JSON.stringify(['safe completion']), new Date().toISOString(), new Date().toISOString());

  const taskRepo = new TaskRepository(db);
  const jobRepo = new JobRepository(db);
  const dispatcher = new JobDispatcher(db, {
    maxConcurrentWorkers: 1,
    pollIntervalMs: 1000,
    assemblyOptions: {
      projectPath,
      agentTemplatesDir: join(projectPath, 'agents'),
      outputDir: join(projectPath, 'results'),
      kingdomDir: projectPath,
      contextResolver,
    },
    defaultModel: 'mock-model',
    supervisorId: 'test-supervisor',
    maxRetriesPerTier: 0,
    validationCommand,
  });

  return { db, projectPath, dispatcher, taskRepo, jobRepo };
}

function createRunningJob(harness: Harness, contextFile = 'src/a.ts'): { task: TaskGraphNode; job: Job } {
  const task = harness.taskRepo.create({
    objective_id: 'obj',
    level: 'task',
    title: 'Update source safely',
    description: 'Apply a small source change.',
    type: 'code',
    assigned_tier: 'knight',
    reviewer_tier: 'judge',
    acceptance_criteria: ['safe completion'],
    context_refs: [{ file: contextFile, startLine: 1, endLine: 1 }],
    token_budget_estimate: 2048,
  });

  harness.taskRepo.updateStatus(task.id, 'preparing-context');
  harness.taskRepo.updateStatus(task.id, 'awaiting-budget-check');
  harness.taskRepo.updateStatus(task.id, 'running');

  const job = harness.jobRepo.create({
    task_id: task.id,
    model: 'mock-model',
    token_estimate: 2048,
    delegating_supervisor_id: 'test-supervisor',
  });
  harness.jobRepo.setStarted(job.id, 'test-worker');

  return { task: harness.taskRepo.getById(task.id)!, job: harness.jobRepo.getById(job.id)! };
}

function createQueuedJob(harness: Harness, params: { file?: string; description?: string; type?: TaskGraphNode['type'] } = {}): { task: TaskGraphNode; job: Job } {
  const file = params.file ?? 'src/a.ts';
  const task = harness.taskRepo.create({
    objective_id: 'obj',
    level: 'task',
    title: 'Update source safely',
    description: params.description ?? 'Apply a small source change.',
    type: params.type ?? 'code',
    assigned_tier: 'knight',
    reviewer_tier: 'judge',
    acceptance_criteria: ['safe completion'],
    context_refs: [{ file, startLine: 1, endLine: 1 }],
    token_budget_estimate: 2048,
  });

  const job = harness.jobRepo.create({
    task_id: task.id,
    model: 'mock-model',
    token_estimate: 2048,
    delegating_supervisor_id: 'test-supervisor',
  });

  return { task: harness.taskRepo.getById(task.id)!, job: harness.jobRepo.getById(job.id)! };
}

async function executeHarnessJob(harness: Harness, job: Job, task: TaskGraphNode, provider: ProviderAdapter): Promise<void> {
  await (harness.dispatcher as unknown as {
    executeJob(job: Job, task: TaskGraphNode, provider: ProviderAdapter, lockedFiles: string[]): Promise<void>;
  }).executeJob(job, task, provider, []);
}

async function waitForJob(harness: Harness, jobId: string, predicate: (job: Job | null) => boolean): Promise<void> {
  for (let i = 0; i < 50; i++) {
    if (predicate(harness.jobRepo.getById(jobId))) return;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error(`Timed out waiting for job ${jobId}`);
}

describe('JobDispatcher safety semantics', () => {
  let harnesses: Harness[] = [];

  beforeEach(() => {
    harnesses = [];
  });

  afterEach(() => {
    for (const harness of harnesses) {
      harness.db.close();
      rmSync(harness.projectPath, { recursive: true, force: true });
    }
  });

  function track(harness: Harness): Harness {
    harnesses.push(harness);
    return harness;
  }

  it('derives planned new files into packet scope and tier timeout', () => {
    const harness = track(createHarness());
    const description = `Apply a scoped change.\n\n## Files to touch\n- src/new-feature.ts - create implementation\n`;
    const { task, job } = createQueuedJob(harness, { file: 'src/existing.ts', description });
    const assembler = new JobPacketAssembler(harness.db, harness.taskRepo, {
      projectPath: harness.projectPath,
      agentTemplatesDir: join(harness.projectPath, 'agents'),
      outputDir: join(harness.projectPath, 'results'),
      kingdomDir: harness.projectPath,
      timeoutSecondsResolver: () => 45,
    });

    const packet = assembler.assembleForJob(job, task);

    expect(packet.allowed_files).toContain('src/new-feature.ts');
    expect(packet.allowed_files).toContain('src/existing.ts');
    expect(packet.scope_mode).toBe('planned-files');
    expect(packet.timeout_seconds).toBe(45);
    expect(packet.messages.at(-1)?.content).toContain('## Allowed Files');
  });

  it('locks planned new files before provider execution', async () => {
    const harness = track(createHarness());
    const { job } = createQueuedJob(harness, { file: 'src/new.ts' });
    const observedLocks: unknown[] = [];
    let callCount = 0;

    const provider = providerWithComplete(async () => {
      callCount += 1;
      observedLocks.push(harness.db.prepare('SELECT file_path, owning_job_id FROM file_locks WHERE file_path = ?').get('src/new.ts'));
      return callCount === 1
        ? response('src/new.ts\n')
        : response('--- /dev/null\n+++ b/src/new.ts\n@@ -0,0 +1,1 @@\n+new\n');
    });

    harness.dispatcher.setProvider(provider);
    (harness.dispatcher as unknown as { dispatchJob(job: Job): void }).dispatchJob(job);

    await waitForJob(harness, job.id, (current) => current?.status === 'completed');

    expect(observedLocks.some(lock => (lock as { owning_job_id?: string } | undefined)?.owning_job_id === job.id)).toBe(true);
    expect(harness.db.prepare('SELECT file_path FROM file_locks WHERE file_path = ?').get('src/new.ts')).toBeUndefined();
  });

  it('passes configured tier timeout to provider requests and job deadlines', async () => {
    const harness = track(createHarness());
    const { task, job } = createRunningJob(harness);
    const timeouts: Array<number | undefined> = [];
    harness.dispatcher.setTierTimeout('knight', 45);

    await executeHarnessJob(harness, job, task, providerWithComplete(async (request: CompletionRequest) => {
      timeouts.push(request.timeout_ms);
      return response();
    }));

    expect(timeouts).toContain(45_000);

    const queued = createQueuedJob(harness);
    harness.jobRepo.setStarted(queued.job.id, 'timeout-worker', 45);
    const timeoutAt = Date.parse(harness.jobRepo.getById(queued.job.id)!.timeout_at!);
    expect(timeoutAt).toBeGreaterThan(Date.now() + 40_000);
  });

  it('rejects empty review scope unless explicitly greenfield', async () => {
    const harness = track(createHarness());
    writeFileSync(join(harness.projectPath, 'src/a.ts'), 'old\n', 'utf-8');
    const { job } = createQueuedJob(harness);
    const engine = new ReviewEngine(harness.db);
    const diff = '--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1,1 +1,1 @@\n-old\n+new\n';

    const strict = await engine.review({ job, diffText: diff, allowedFiles: [], acceptanceCriteria: [] });
    const greenfield = await engine.review({ job, diffText: diff, allowedFiles: [], acceptanceCriteria: [], allowEmptyScope: true });

    expect(strict.decision).toBe('rejected');
    expect(strict.scope_check).toBe('fail');
    expect(strict.rejection_reasons?.[0]).toContain('no allowed file scope');
    expect(greenfield.decision).toBe('approved');
    expect(greenfield.scope_check).toBe('pass');
  });

  it('cancels before provider execution and does not call the model', async () => {
    const harness = track(createHarness());
    writeFileSync(join(harness.projectPath, 'src/a.ts'), 'old\n', 'utf-8');
    const { task, job } = createRunningJob(harness);
    const complete = vi.fn(async () => response());
    const provider = providerWithComplete(complete);

    harness.db
      .prepare("UPDATE jobs SET cancel_requested = 1, cancel_reason = ?, status = 'cancel-requested' WHERE id = ?")
      .run('operator cancelled', job.id);

    await executeHarnessJob(harness, job, task, provider);

    expect(complete).not.toHaveBeenCalled();
    expect(harness.jobRepo.getById(job.id)?.status).toBe('cancelled');
    expect(harness.taskRepo.getById(task.id)?.status).toBe('cancelled');
  });

  it('honors cancellation after the model returns and refuses Blacksmith apply', async () => {
    const harness = track(createHarness());
    writeFileSync(join(harness.projectPath, 'src/a.ts'), 'old\n', 'utf-8');
    const { task, job } = createRunningJob(harness);
    const blacksmith = vi.fn();
    harness.dispatcher.setBlacksmith(blacksmith);

    const provider = providerWithComplete(vi.fn(async () => {
      harness.db
        .prepare("UPDATE jobs SET cancel_requested = 1, cancel_reason = ?, status = 'cancel-requested' WHERE id = ?")
        .run('operator cancelled mid-flight', job.id);
      return response();
    }));

    await executeHarnessJob(harness, job, task, provider);

    expect(blacksmith).not.toHaveBeenCalled();
    expect(harness.jobRepo.getById(job.id)?.status).toBe('cancelled');
    expect(harness.taskRepo.getById(task.id)?.status).toBe('cancelled');
    expect(harness.db.prepare('SELECT COUNT(*) as n FROM run_checkpoints').get()).toEqual({ n: 0 });
  });

  it('rolls back validation failures without writing a checkpoint', async () => {
    const harness = track(createHarness('node -e "process.exit(1)"'));
    const filePath = join(harness.projectPath, 'src/a.ts');
    writeFileSync(filePath, 'old\n', 'utf-8');
    const { task, job } = createRunningJob(harness);

    harness.dispatcher.setBlacksmith(() => {
      writeFileSync(`${filePath}.bak`, 'old\n', 'utf-8');
      writeFileSync(filePath, 'new\n', 'utf-8');
      return { success: true, appliedFiles: ['src/a.ts'], failedFiles: [], errors: [] };
    });

    await executeHarnessJob(harness, job, task, providerWithComplete(async () => response()));

    expect(readFileSync(filePath, 'utf-8')).toBe('old\n');
    expect(harness.jobRepo.getById(job.id)?.status).toBe('failed-invalid-output');
    expect(harness.taskRepo.getById(task.id)?.status).toBe('awaiting-healer');
    expect(harness.db.prepare('SELECT COUNT(*) as n FROM run_checkpoints').get()).toEqual({ n: 0 });
  });

  it('treats partial Blacksmith apply as failed and rolls back applied files', async () => {
    const harness = track(createHarness());
    const filePath = join(harness.projectPath, 'src/a.ts');
    writeFileSync(filePath, 'old\n', 'utf-8');
    const { task, job } = createRunningJob(harness);
    const incidents: Array<{ severity: string; symptoms: Record<string, unknown> }> = [];

    harness.dispatcher.setHealer((incident) => incidents.push(incident));
    harness.dispatcher.setBlacksmith(() => {
      writeFileSync(`${filePath}.bak`, 'old\n', 'utf-8');
      writeFileSync(filePath, 'new\n', 'utf-8');
      return {
        success: false,
        appliedFiles: ['src/a.ts'],
        failedFiles: ['src/b.ts'],
        errors: ['Failed to apply patch to src/b.ts'],
      };
    });

    await executeHarnessJob(harness, job, task, providerWithComplete(async () => response()));

    expect(readFileSync(filePath, 'utf-8')).toBe('old\n');
    expect(harness.jobRepo.getById(job.id)?.status).toBe('failed-invalid-output');
    expect(harness.taskRepo.getById(task.id)?.status).toBe('awaiting-healer');
    expect(harness.db.prepare('SELECT COUNT(*) as n FROM run_checkpoints').get()).toEqual({ n: 0 });
    expect(incidents[0]?.severity).toBe('high');
    expect(incidents[0]?.symptoms.failed_files).toEqual(['src/b.ts']);
  });

  it('writes a checkpoint only after apply, validation, and task completion succeed', async () => {
    const harness = track(createHarness('node -e "process.exit(0)"'));
    const filePath = join(harness.projectPath, 'src/a.ts');
    writeFileSync(filePath, 'old\n', 'utf-8');
    const { task, job } = createRunningJob(harness);

    harness.dispatcher.setBlacksmith(() => {
      writeFileSync(`${filePath}.bak`, 'old\n', 'utf-8');
      writeFileSync(filePath, 'new\n', 'utf-8');
      return { success: true, appliedFiles: ['src/a.ts'], failedFiles: [], errors: [] };
    });

    await executeHarnessJob(harness, job, task, providerWithComplete(async () => response()));

    expect(readFileSync(filePath, 'utf-8')).toBe('new\n');
    expect(harness.jobRepo.getById(job.id)?.status).toBe('completed');
    expect(harness.taskRepo.getById(task.id)?.status).toBe('completed');
    expect(harness.db.prepare('SELECT task_id, job_id, applied_files FROM run_checkpoints').get()).toEqual({
      task_id: task.id,
      job_id: job.id,
      applied_files: JSON.stringify(['src/a.ts']),
    });
    expect(existsSync(join(harness.projectPath, 'results', `${job.id}.result.json`))).toBe(true);
  });

  // PHASE2 (P2.2): the live dispatch path now calls assembleForJobAsync. With a
  // ContextResolver configured but NO healthy index (engine: null), grounding
  // degrades to raw slices and the job must still complete unchanged.
  it('completes via async grounded assembly and degrades when the index is absent', async () => {
    const resolver = new ContextResolver({ projectPath: '/nonexistent', engine: null });
    const harness = track(createHarness('node -e "process.exit(0)"', resolver));
    const filePath = join(harness.projectPath, 'src/a.ts');
    writeFileSync(filePath, 'old\n', 'utf-8');
    const { task, job } = createRunningJob(harness);

    harness.dispatcher.setBlacksmith(() => {
      writeFileSync(`${filePath}.bak`, 'old\n', 'utf-8');
      writeFileSync(filePath, 'new\n', 'utf-8');
      return { success: true, appliedFiles: ['src/a.ts'], failedFiles: [], errors: [] };
    });

    await executeHarnessJob(harness, job, task, providerWithComplete(async () => response()));

    expect(harness.jobRepo.getById(job.id)?.status).toBe('completed');
    expect(harness.taskRepo.getById(task.id)?.status).toBe('completed');
    expect(readFileSync(filePath, 'utf-8')).toBe('new\n');
  });
});
