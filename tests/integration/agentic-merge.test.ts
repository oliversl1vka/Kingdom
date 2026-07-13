/**
 * PHASE5 §12.4 — concurrency & merge: serialized merge-back, merge-conflict
 * INV-1, and post-merge validation revert.
 *
 * Reuses a temp git repo + real WorktreeManager + blacksmith applyEdit + a
 * stubbed (approving) review engine, driving executeAgenticJob directly.
 */
import { afterEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync, readdirSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  JobDispatcher, JobRepository, TaskRepository, IntegrationGate,
  type Job, type TaskGraphNode, type JobPacket, type ModelCapabilities, type ReviewDecision,
} from '@kingdomos/core';
import { WorktreeManager, applyEdit } from '@kingdomos/blacksmith';
import { createTempGitRepo, type TempGitRepo } from '../helpers/temp-git-repo.js';
import { FakeAgenticProvider, type ScriptedTurn } from '../helpers/fake-agentic-provider.js';

const MIGRATIONS_DIR = join(__dirname, '..', '..', 'packages', 'core', 'migrations');

const TOOL_CAPS = {
  strengths: [], tool_use: true, structured_output: true, multimodal: false,
  streaming: false, tier_class: 'standard', latency_class: 'standard',
} as unknown as ModelCapabilities;

const approved: ReviewDecision = {
  id: 'rev', job_id: '', reviewer_agent_id: 'judge', decision: 'approved',
  rejection_reasons: null, scope_check: 'pass', format_check: 'pass',
  security_check: 'pass', criteria_check: 'pass', feedback: null, created_at: '',
};

interface Harness {
  db: Database.Database;
  repo: TempGitRepo;
  dispatcher: JobDispatcher;
  taskRepo: TaskRepository;
  jobRepo: JobRepository;
  mgr: WorktreeManager;
  cleanup(): void;
}

function createHarness(opts: { validationCommand?: string; postMergeValidation?: boolean } = {}): Harness {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  for (const f of readdirSync(MIGRATIONS_DIR).filter((x) => /^\d+.*\.sql$/.test(x)).sort()) {
    db.exec(readFileSync(join(MIGRATIONS_DIR, f), 'utf-8'));
  }
  const repo = createTempGitRepo({ seedFile: { path: 'app.ts', content: 'export const x = 1;\n' } });
  repo.write('other.ts', 'export const y = 1;\n');
  repo.commitAll('add other');
  mkdirSync(join(repo.dir, 'results'), { recursive: true });

  const now = new Date().toISOString();
  db.prepare('INSERT INTO projects (id, name, repository_path, created_at, updated_at) VALUES (?,?,?,?,?)').run('proj', 'P', repo.dir, now, now);
  db.prepare('INSERT INTO objectives (id, project_id, description, priority, status, acceptance_criteria, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)').run('obj', 'proj', 'O', 5, 'active', '["ok"]', now, now);

  const taskRepo = new TaskRepository(db);
  const jobRepo = new JobRepository(db);
  const mgr = new WorktreeManager(repo.dir, { authorName: 'T', authorEmail: 't@t' });

  const dispatcher = new JobDispatcher(db, {
    maxConcurrentWorkers: 4,
    pollIntervalMs: 1000,
    assemblyOptions: { projectPath: repo.dir, agentTemplatesDir: join(repo.dir, 'agents'), outputDir: join(repo.dir, 'results'), kingdomDir: repo.dir },
    defaultModel: 'fake-model',
    supervisorId: 'test',
    maxRetriesPerTier: 0,
    validationCommand: opts.validationCommand,
    agenticDispatch: { enabled: true, max_iterations: 8, link_node_modules: false, post_merge_validation: opts.postMergeValidation ?? true },
    worktreeManager: mgr,
    applyEdit: (edit, workspace) => applyEdit(edit, workspace),
    capabilitiesResolver: () => TOOL_CAPS,
    integrationGate: new IntegrationGate(),
  });
  (dispatcher as unknown as { reviewEngine: unknown }).reviewEngine = { review: async () => approved };

  return { db, repo, dispatcher, taskRepo, jobRepo, mgr, cleanup: () => { db.close(); repo.cleanup(); } };
}

function createRunningJob(h: Harness, suffix: string): { task: TaskGraphNode; job: Job } {
  const task = h.taskRepo.create({
    objective_id: 'obj', level: 'task', title: `Edit ${suffix}`, description: 'd',
    type: 'code', assigned_tier: 'knight', reviewer_tier: 'judge', acceptance_criteria: ['ok'],
    context_refs: [{ file: 'app.ts', startLine: 1, endLine: 1 }], token_budget_estimate: 2048,
  });
  h.taskRepo.updateStatus(task.id, 'preparing-context');
  h.taskRepo.updateStatus(task.id, 'awaiting-budget-check');
  h.taskRepo.updateStatus(task.id, 'running');
  const job = h.jobRepo.create({ task_id: task.id, model: 'fake-model', token_estimate: 2048, delegating_supervisor_id: 'test' });
  h.jobRepo.setStarted(job.id, 'worker');
  return { task: h.taskRepo.getById(task.id)!, job: h.jobRepo.getById(job.id)! };
}

function packet(h: Harness, job: Job, task: TaskGraphNode): JobPacket {
  return {
    job_id: job.id, task_id: task.id, agent_identity_path: '', model_id: 'fake-model',
    messages: [{ role: 'user', content: 'edit' }], allowed_files: ['app.ts', 'other.ts'],
    scope_mode: 'greenfield', output_format: 'unified-diff', acceptance_criteria: ['ok'],
    max_tokens: 100, timeout_seconds: 30, result_path: join(h.repo.dir, 'results', `${job.id}.result.json`),
  };
}

function editTurns(file: string, oldS: string, newS: string): ScriptedTurn[] {
  return [
    { toolCalls: [{ name: 'apply_edit', arguments: { path: file, old_string: oldS, new_string: newS } }] },
    { toolCalls: [{ name: 'finish', arguments: { summary: 'done' } }] },
  ];
}

function run(h: Harness, job: Job, task: TaskGraphNode, provider: FakeAgenticProvider): Promise<void> {
  return (h.dispatcher as unknown as {
    executeAgenticJob(j: Job, t: TaskGraphNode, p: FakeAgenticProvider, pk: JobPacket, c: ModelCapabilities): Promise<void>;
  }).executeAgenticJob(job, task, provider, packet(h, job, task), TOOL_CAPS);
}

describe('PHASE5 — concurrency & merge (§12.4)', () => {
  let h: Harness;
  afterEach(() => h?.cleanup());

  it('merge-conflict: integration changes the same lines during the job → fail; HEAD unchanged from the conflict commit', async () => {
    // validationCommand (worktree gate) passes BUT also commits a conflicting change
    // to the integration branch's app.ts, so the subsequent mergeBack conflicts.
    const conflictScript = `node -e "const cp=require('child_process');const fs=require('fs');const d=process.env.KINGDOM_TEST_REPO;fs.writeFileSync(d+'/app.ts','export const x = 999;\\n');cp.execFileSync('git',['-C',d,'add','app.ts']);cp.execFileSync('git',['-C',d,'commit','--no-gpg-sign','-m','integration edit']);process.exit(0)"`;
    h = createHarness({ validationCommand: conflictScript });
    const { task, job } = createRunningJob(h, 'app');
    process.env.KINGDOM_TEST_REPO = h.repo.dir;

    await run(h, job, task, new FakeAgenticProvider(editTurns('app.ts', 'export const x = 1;', 'export const x = 2;')));
    delete process.env.KINGDOM_TEST_REPO;

    // The integration branch HEAD is the conflict commit; the job did NOT land.
    const head = h.mgr.integrationHead();
    expect(readFileSync(join(h.repo.dir, 'app.ts'), 'utf-8')).toContain('export const x = 999;');
    expect(readFileSync(join(h.repo.dir, 'app.ts'), 'utf-8')).not.toContain('<<<<<<<');
    expect(h.jobRepo.getById(job.id)?.status).toBe('failed-invalid-output');
    // Integration HEAD equals the conflict-commit head (job branch not merged in).
    expect(h.repo.git(['rev-parse', 'main']).trim()).toBe(head);
    expect(existsSync(join(h.repo.dir, '.kingdom-worktrees', job.id))).toBe(false);
  });

  it('two concurrent jobs editing different files → both land (serialized); both changes present', async () => {
    h = createHarness({ validationCommand: 'node -e "process.exit(0)"', postMergeValidation: false });
    const a = createRunningJob(h, 'a');
    const b = createRunningJob(h, 'b');
    const H0 = h.mgr.integrationHead();

    await Promise.all([
      run(h, a.job, a.task, new FakeAgenticProvider(editTurns('app.ts', 'export const x = 1;', 'export const x = 2;'))),
      run(h, b.job, b.task, new FakeAgenticProvider(editTurns('other.ts', 'export const y = 1;', 'export const y = 2;'))),
    ]);

    expect(h.jobRepo.getById(a.job.id)?.status).toBe('completed');
    expect(h.jobRepo.getById(b.job.id)?.status).toBe('completed');
    // Both changes present on the integration tree; HEAD advanced past H0.
    expect(readFileSync(join(h.repo.dir, 'app.ts'), 'utf-8')).toContain('export const x = 2;');
    expect(readFileSync(join(h.repo.dir, 'other.ts'), 'utf-8')).toContain('export const y = 2;');
    expect(h.mgr.integrationHead()).not.toBe(H0);
  });

  it('post-merge validation failure → merge reverted (reset --hard); task failed; integration back at H0', async () => {
    // Passes the in-worktree gate (cwd inside .kingdom-worktrees) but FAILS the
    // post-merge run (cwd = integration root) → the merge is reverted.
    const cwdGate = `node -e "process.exit(process.cwd().includes('.kingdom-worktrees') ? 0 : 1)"`;
    h = createHarness({ validationCommand: cwdGate, postMergeValidation: true });
    const { task, job } = createRunningJob(h, 'app');
    const H0 = h.mgr.integrationHead();

    await run(h, job, task, new FakeAgenticProvider(editTurns('app.ts', 'export const x = 1;', 'export const x = 2;')));

    expect(h.mgr.integrationHead()).toBe(H0); // INV-1: merge reverted
    expect(readFileSync(join(h.repo.dir, 'app.ts'), 'utf-8')).toContain('export const x = 1;');
    expect(h.jobRepo.getById(job.id)?.status).toBe('failed-invalid-output');
    expect(existsSync(join(h.repo.dir, '.kingdom-worktrees', job.id))).toBe(false);
  });
});
