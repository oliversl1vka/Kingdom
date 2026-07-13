import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  JobDispatcher,
  JobRepository,
  TaskRepository,
  type CompletionResponse,
  type Job,
  type ProviderAdapter,
  type TaskGraphNode,
} from '@kingdomos/core';

// PHASE3 (P3.2): dispatcher-level proof that the per-task verification gate runs
// after apply and rolls the diff back on a non-zero exit (reusing failAppliedDiff).
const MIGRATIONS_DIR = join(__dirname, '..', '..', 'packages', 'core', 'migrations');
const MIGRATIONS = [
  '001_initial.sql', '005_checkpoints.sql', '006_depends_on.sql', '007_parent_job_id.sql',
  '008_superseded_by.sql', '010_lessons.sql', '025_task_verification.sql', '026_job_failure_signature.sql',
];

interface Harness {
  db: Database.Database;
  projectPath: string;
  dispatcher: JobDispatcher;
  taskRepo: TaskRepository;
  jobRepo: JobRepository;
}

const diffResponse = (): CompletionResponse => ({
  content: '--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1,1 +1,1 @@\n-old\n+new\n',
  prompt_tokens: 10, completion_tokens: 5, total_tokens: 15, finish_reason: 'stop',
});

function provider(): ProviderAdapter {
  return { provider_id: 'mock', complete: async () => diffResponse(), healthCheck: async () => ({ status: 'healthy' }) };
}

function createHarness(): Harness {
  const db = new Database(':memory:');
  for (const m of MIGRATIONS) db.exec(readFileSync(join(MIGRATIONS_DIR, m), 'utf-8'));
  const projectPath = mkdtempSync(join(tmpdir(), 'kingdom-vgate-disp-'));
  mkdirSync(join(projectPath, 'src'), { recursive: true });
  mkdirSync(join(projectPath, 'results'), { recursive: true });
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO projects (id, name, repository_path, created_at, updated_at) VALUES (?,?,?,?,?)`).run('proj', 'P', projectPath, now, now);
  db.prepare(`INSERT INTO objectives (id, project_id, description, priority, status, acceptance_criteria, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)`)
    .run('obj', 'proj', 'O', 5, 'active', JSON.stringify(['safe completion']), now, now);

  const taskRepo = new TaskRepository(db);
  const jobRepo = new JobRepository(db);
  const dispatcher = new JobDispatcher(db, {
    maxConcurrentWorkers: 1, pollIntervalMs: 1000,
    assemblyOptions: { projectPath, agentTemplatesDir: join(projectPath, 'agents'), outputDir: join(projectPath, 'results'), kingdomDir: projectPath },
    defaultModel: 'mock-model', supervisorId: 'sup', maxRetriesPerTier: 0,
  });
  return { db, projectPath, dispatcher, taskRepo, jobRepo };
}

function runningJobWithVerification(h: Harness, testCommand: string): { task: TaskGraphNode; job: Job } {
  const task = h.taskRepo.create({
    objective_id: 'obj', level: 'task', title: 'Update', description: 'change', type: 'code',
    assigned_tier: 'knight', reviewer_tier: 'judge', acceptance_criteria: ['safe completion'],
    context_refs: [{ file: 'src/a.ts', startLine: 1, endLine: 1 }], token_budget_estimate: 2048,
    verification: { test_command: testCommand },
  });
  h.taskRepo.updateStatus(task.id, 'preparing-context');
  h.taskRepo.updateStatus(task.id, 'awaiting-budget-check');
  h.taskRepo.updateStatus(task.id, 'running');
  const job = h.jobRepo.create({ task_id: task.id, model: 'mock-model', token_estimate: 2048, delegating_supervisor_id: 'sup' });
  h.jobRepo.setStarted(job.id, 'w');
  return { task: h.taskRepo.getById(task.id)!, job: h.jobRepo.getById(job.id)! };
}

async function exec(h: Harness, job: Job, task: TaskGraphNode): Promise<void> {
  await (h.dispatcher as unknown as { executeJob(j: Job, t: TaskGraphNode, p: ProviderAdapter, l: string[]): Promise<void> })
    .executeJob(job, task, provider(), []);
}

describe('PHASE3 (P3.2) dispatcher verification gate', () => {
  let harnesses: Harness[] = [];
  beforeEach(() => { harnesses = []; });
  afterEach(() => { for (const h of harnesses) { h.db.close(); rmSync(h.projectPath, { recursive: true, force: true }); } });
  const track = (h: Harness): Harness => { harnesses.push(h); return h; };

  it('persists the verification contract on the task', () => {
    const h = track(createHarness());
    const { task } = runningJobWithVerification(h, 'node -e "process.exit(0)"');
    expect(h.taskRepo.getById(task.id)?.verification?.test_command).toBe('node -e "process.exit(0)"');
  });

  it('rolls back the applied diff and fails the task when the gate exits non-zero', async () => {
    const h = track(createHarness());
    const filePath = join(h.projectPath, 'src/a.ts');
    writeFileSync(filePath, 'old\n', 'utf-8');
    const { task, job } = runningJobWithVerification(h, 'node -e "process.exit(1)"');

    h.dispatcher.setBlacksmith(() => {
      writeFileSync(`${filePath}.bak`, 'old\n', 'utf-8');
      writeFileSync(filePath, 'new\n', 'utf-8');
      return { success: true, appliedFiles: ['src/a.ts'], failedFiles: [], errors: [] };
    });

    await exec(h, job, task);

    expect(readFileSync(filePath, 'utf-8')).toBe('old\n'); // rolled back
    expect(h.jobRepo.getById(job.id)?.status).toBe('failed-invalid-output');
    expect(h.taskRepo.getById(task.id)?.status).toBe('awaiting-healer'); // maxRetries 0 → no higher tier
    expect(h.db.prepare('SELECT COUNT(*) as n FROM run_checkpoints').get()).toEqual({ n: 0 });
  });

  it('completes when the gate exits zero', async () => {
    const h = track(createHarness());
    const filePath = join(h.projectPath, 'src/a.ts');
    writeFileSync(filePath, 'old\n', 'utf-8');
    const { task, job } = runningJobWithVerification(h, 'node -e "process.exit(0)"');

    h.dispatcher.setBlacksmith(() => {
      writeFileSync(`${filePath}.bak`, 'old\n', 'utf-8');
      writeFileSync(filePath, 'new\n', 'utf-8');
      return { success: true, appliedFiles: ['src/a.ts'], failedFiles: [], errors: [] };
    });

    await exec(h, job, task);

    expect(readFileSync(filePath, 'utf-8')).toBe('new\n');
    expect(h.jobRepo.getById(job.id)?.status).toBe('completed');
    expect(h.taskRepo.getById(task.id)?.status).toBe('completed');
  });
});
