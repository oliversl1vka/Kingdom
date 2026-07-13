/**
 * PHASE5 §12.3 — executeAgenticJob integration tests (flag enabled).
 *
 * For every case we capture H0 = integrationHead() and assert the outcome plus
 * INV-1: on EVERY non-success path the integration branch HEAD is byte-identical
 * to H0. Only the happy path advances it (to the merge sha).
 *
 * Uses the FakeAgenticProvider (scripted read/apply_edit/finish), a temp git repo,
 * the real WorktreeManager + blacksmith applyEdit, and a stubbed review engine.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync, readdirSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  JobDispatcher, JobRepository, TaskRepository,
  type Job, type TaskGraphNode, type JobPacket, type ModelCapabilities, type ReviewDecision,
} from '@kingdomos/core';
import { WorktreeManager, applyEdit, isGitRepo } from '@kingdomos/blacksmith';
import { IntegrationGate } from '@kingdomos/core';
import { createTempGitRepo, type TempGitRepo } from '../helpers/temp-git-repo.js';
import { FakeAgenticProvider, type ScriptedTurn } from '../helpers/fake-agentic-provider.js';

const MIGRATIONS_DIR = join(__dirname, '..', '..', 'packages', 'core', 'migrations');

const TOOL_CAPS: ModelCapabilities = {
  strengths: [], tool_use: true, structured_output: true, multimodal: false,
  streaming: false, tier_class: 'standard' as ModelCapabilities['tier_class'],
  latency_class: 'standard' as ModelCapabilities['latency_class'],
};

const approved: ReviewDecision = {
  id: 'rev-ok', job_id: '', reviewer_agent_id: 'judge', decision: 'approved',
  rejection_reasons: null, scope_check: 'pass', format_check: 'pass',
  security_check: 'pass', criteria_check: 'pass', feedback: null, created_at: '',
};
const rejected: ReviewDecision = {
  ...approved, decision: 'rejected', criteria_check: 'fail',
  rejection_reasons: ['The change does not satisfy the acceptance criteria.'],
};

interface Harness {
  db: Database.Database;
  repo: TempGitRepo;
  dispatcher: JobDispatcher;
  taskRepo: TaskRepository;
  jobRepo: JobRepository;
  mgr: WorktreeManager;
  setReview(decision: ReviewDecision): void;
  cleanup(): void;
}

function createHarness(opts: { validationCommand?: string; behavioralProbes?: string[] } = {}): Harness {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  for (const f of readdirSync(MIGRATIONS_DIR).filter((x) => /^\d+.*\.sql$/.test(x)).sort()) {
    db.exec(readFileSync(join(MIGRATIONS_DIR, f), 'utf-8'));
  }

  const repo = createTempGitRepo({ seedFile: { path: 'app.ts', content: 'export const x = 1;\n' } });
  mkdirSync(join(repo.dir, 'results'), { recursive: true });

  const now = new Date().toISOString();
  db.prepare('INSERT INTO projects (id, name, repository_path, created_at, updated_at) VALUES (?,?,?,?,?)')
    .run('proj', 'P', repo.dir, now, now);
  db.prepare('INSERT INTO objectives (id, project_id, description, priority, status, acceptance_criteria, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)')
    .run('obj', 'proj', 'Obj', 5, 'active', JSON.stringify(['ok']), now, now);

  const taskRepo = new TaskRepository(db);
  const jobRepo = new JobRepository(db);
  const mgr = new WorktreeManager(repo.dir, { authorName: 'T', authorEmail: 't@t' });
  const integrationGate = new IntegrationGate();

  const dispatcher = new JobDispatcher(db, {
    maxConcurrentWorkers: 1,
    pollIntervalMs: 1000,
    assemblyOptions: {
      projectPath: repo.dir,
      agentTemplatesDir: join(repo.dir, 'agents'),
      outputDir: join(repo.dir, 'results'),
      kingdomDir: repo.dir,
    },
    defaultModel: 'fake-model',
    supervisorId: 'test',
    maxRetriesPerTier: 0,
    validationCommand: opts.validationCommand,
    behavioralProbes: opts.behavioralProbes,
    agenticDispatch: { enabled: true, max_iterations: 8, link_node_modules: false },
    worktreeManager: mgr,
    applyEdit: (edit, workspace) => applyEdit(edit, workspace),
    capabilitiesResolver: () => TOOL_CAPS,
    integrationGate,
  });

  // Default: approve. Tests can override.
  let reviewDecision = approved;
  (dispatcher as unknown as { reviewEngine: unknown }).reviewEngine = {
    review: async () => reviewDecision,
  };

  return {
    db, repo, dispatcher, taskRepo, jobRepo, mgr,
    setReview: (d) => { reviewDecision = d; },
    cleanup: () => { db.close(); repo.cleanup(); },
  };
}

function createRunningJob(h: Harness): { task: TaskGraphNode; job: Job } {
  const task = h.taskRepo.create({
    objective_id: 'obj', level: 'task', title: 'Bump x', description: 'Change x to 2.',
    type: 'code', assigned_tier: 'knight', reviewer_tier: 'judge',
    acceptance_criteria: ['ok'], context_refs: [{ file: 'app.ts', startLine: 1, endLine: 1 }],
    token_budget_estimate: 2048,
  });
  h.taskRepo.updateStatus(task.id, 'preparing-context');
  h.taskRepo.updateStatus(task.id, 'awaiting-budget-check');
  h.taskRepo.updateStatus(task.id, 'running');
  const job = h.jobRepo.create({ task_id: task.id, model: 'fake-model', token_estimate: 2048, delegating_supervisor_id: 'test' });
  h.jobRepo.setStarted(job.id, 'worker');
  return { task: h.taskRepo.getById(task.id)!, job: h.jobRepo.getById(job.id)! };
}

function makePacket(h: Harness, job: Job, task: TaskGraphNode): JobPacket {
  return {
    job_id: job.id, task_id: task.id, agent_identity_path: '', model_id: 'fake-model',
    messages: [{ role: 'user', content: 'edit app.ts' }],
    allowed_files: ['app.ts'], scope_mode: 'greenfield', output_format: 'unified-diff',
    acceptance_criteria: ['ok'], max_tokens: 100, timeout_seconds: 30,
    result_path: join(h.repo.dir, 'results', `${job.id}.result.json`),
  };
}

function bumpXTurns(): ScriptedTurn[] {
  return [
    { toolCalls: [{ name: 'apply_edit', arguments: { path: 'app.ts', old_string: 'export const x = 1;', new_string: 'export const x = 2;' } }] },
    { toolCalls: [{ name: 'finish', arguments: { summary: 'bumped x' } }] },
  ];
}

async function runAgentic(h: Harness, job: Job, task: TaskGraphNode, provider: FakeAgenticProvider): Promise<void> {
  await (h.dispatcher as unknown as {
    executeAgenticJob(j: Job, t: TaskGraphNode, p: FakeAgenticProvider, packet: JobPacket, caps: ModelCapabilities): Promise<void>;
  }).executeAgenticJob(job, task, provider, makePacket(h, job, task), TOOL_CAPS);
}

describe('PHASE5 — executeAgenticJob (§12.3) — INV-1 enforced', () => {
  let h: Harness;
  afterEach(() => h?.cleanup());

  it('precondition: temp repo is a git repo', () => {
    h = createHarness();
    expect(isGitRepo(h.repo.dir)).toBe(true);
  });

  it('happy: approve + gates pass + clean merge → completed; HEAD advances to mergedSha', async () => {
    h = createHarness({ validationCommand: 'node -e "process.exit(0)"' });
    const { task, job } = createRunningJob(h);
    const H0 = h.mgr.integrationHead();

    await runAgentic(h, job, task, new FakeAgenticProvider(bumpXTurns()));

    expect(h.jobRepo.getById(job.id)?.status).toBe('completed');
    expect(h.taskRepo.getById(task.id)?.status).toBe('completed');
    // Integration HEAD advanced; file present on the integration tree.
    const head = h.mgr.integrationHead();
    expect(head).not.toBe(H0);
    expect(readFileSync(join(h.repo.dir, 'app.ts'), 'utf-8')).toContain('export const x = 2;');
    // Checkpoint row written; worktree removed; no .bak on integration; ledger merged.
    expect((h.db.prepare('SELECT COUNT(*) n FROM run_checkpoints').get() as { n: number }).n).toBe(1);
    expect(existsSync(join(h.repo.dir, '.kingdom-worktrees', job.id))).toBe(false);
    expect(existsSync(join(h.repo.dir, 'app.ts.bak'))).toBe(false);
    expect((h.db.prepare("SELECT status FROM job_worktrees WHERE job_id=?").get(job.id) as { status: string }).status).toBe('merged');
  });

  it('empty-diff: agent finishes with no edits → no-op failure; HEAD === H0; worktree removed', async () => {
    h = createHarness();
    const { task, job } = createRunningJob(h);
    const H0 = h.mgr.integrationHead();

    await runAgentic(h, job, task, new FakeAgenticProvider([
      { toolCalls: [{ name: 'finish', arguments: { summary: 'nothing to do' } }] },
    ]));

    expect(h.mgr.integrationHead()).toBe(H0); // INV-1
    expect(h.jobRepo.getById(job.id)?.status).toBe('failed-invalid-output');
    expect(existsSync(join(h.repo.dir, '.kingdom-worktrees', job.id))).toBe(false);
    expect((h.db.prepare("SELECT status FROM job_worktrees WHERE job_id=?").get(job.id) as { status: string }).status).toBe('discarded');
    // §13 exactly-once: the job branch is deleted on discard (a retry gets a NEW id ⇒ a new branch).
    expect(h.repo.git(['branch', '--list', `kingdom/job-${job.id}`]).trim()).toBe('');
  });

  it('review-reject: judge rejects → failed-review; healer incident; HEAD === H0', async () => {
    h = createHarness({ validationCommand: 'node -e "process.exit(0)"' });
    h.setReview(rejected);
    const incidents: unknown[] = [];
    h.dispatcher.setHealer((i) => incidents.push(i));
    const { task, job } = createRunningJob(h);
    const H0 = h.mgr.integrationHead();

    await runAgentic(h, job, task, new FakeAgenticProvider(bumpXTurns()));

    expect(h.mgr.integrationHead()).toBe(H0); // INV-1
    expect(h.jobRepo.getById(job.id)?.status).toBe('failed-review');
    expect(h.taskRepo.getById(task.id)?.status).toBe('awaiting-healer');
    expect(incidents.length).toBeGreaterThan(0);
    expect(readFileSync(join(h.repo.dir, 'app.ts'), 'utf-8')).toContain('export const x = 1;'); // unchanged
  });

  it('validation-fail: validationCommand non-zero in worktree → fail; HEAD === H0', async () => {
    h = createHarness({ validationCommand: 'node -e "process.exit(1)"' });
    const { task, job } = createRunningJob(h);
    const H0 = h.mgr.integrationHead();

    await runAgentic(h, job, task, new FakeAgenticProvider(bumpXTurns()));

    expect(h.mgr.integrationHead()).toBe(H0); // INV-1
    expect(h.jobRepo.getById(job.id)?.status).toBe('failed-invalid-output');
    expect(existsSync(join(h.repo.dir, '.kingdom-worktrees', job.id))).toBe(false);
  });

  it('verification-gate-fail: task test_command non-zero → fail; HEAD === H0', async () => {
    h = createHarness({ validationCommand: 'node -e "process.exit(0)"' });
    const { task, job } = createRunningJob(h);
    task.verification = { test_command: 'node -e "process.exit(1)"' } as TaskGraphNode['verification'];
    const H0 = h.mgr.integrationHead();

    await runAgentic(h, job, task, new FakeAgenticProvider(bumpXTurns()));

    expect(h.mgr.integrationHead()).toBe(H0); // INV-1
    expect(h.jobRepo.getById(job.id)?.status).toBe('failed-invalid-output');
  });

  it('probe-fail: a behavioural probe non-zero → fail; HEAD === H0', async () => {
    h = createHarness({ validationCommand: 'node -e "process.exit(0)"', behavioralProbes: ['node -e "process.exit(1)"'] });
    const { task, job } = createRunningJob(h);
    const H0 = h.mgr.integrationHead();

    await runAgentic(h, job, task, new FakeAgenticProvider(bumpXTurns()));

    expect(h.mgr.integrationHead()).toBe(H0); // INV-1
    expect(h.jobRepo.getById(job.id)?.status).toBe('failed-invalid-output');
  });

  it('cancellation: cancel_requested before land → session discarded; HEAD === H0', async () => {
    h = createHarness({ validationCommand: 'node -e "process.exit(0)"' });
    const { task, job } = createRunningJob(h);
    const H0 = h.mgr.integrationHead();

    // A provider that requests cancellation right after its first turn, before land.
    const provider = new FakeAgenticProvider(bumpXTurns());
    const origComplete = provider.complete.bind(provider);
    (provider as unknown as { complete: typeof provider.complete }).complete = async (req) => {
      h.db.prepare("UPDATE jobs SET cancel_requested = 1, status='cancel-requested' WHERE id = ?").run(job.id);
      return origComplete(req);
    };

    await runAgentic(h, job, task, provider);

    expect(h.mgr.integrationHead()).toBe(H0); // INV-1
    expect(h.jobRepo.getById(job.id)?.status).toBe('cancelled');
    expect(existsSync(join(h.repo.dir, '.kingdom-worktrees', job.id))).toBe(false);
  });
});
