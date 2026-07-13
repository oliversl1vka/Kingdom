/**
 * PHASE5 §12.6 — fallbacks: the legacy one-shot in-place pipeline runs (and NO
 * worktree is ever created) when any agentic gate fails:
 *   - model lacks tool_use (flag on)
 *   - workspace is not a git repo (flag on, tool_use on)
 *   - flag off
 *
 * Routes through executeJob (the real routing gate) with a one-shot provider +
 * Blacksmith callback, asserting legacy behavior + absence of worktree artifacts.
 */
import { afterEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  JobDispatcher, JobRepository, TaskRepository, IntegrationGate,
  type CompletionResponse, type Job, type ProviderAdapter, type TaskGraphNode, type ModelCapabilities,
} from '@kingdomos/core';
import { WorktreeManager, applyEdit } from '@kingdomos/blacksmith';

const MIGRATIONS_DIR = join(__dirname, '..', '..', 'packages', 'core', 'migrations');
const DIFF = '--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1,1 +1,1 @@\n-old\n+new\n';

const toolCaps = { tool_use: true } as ModelCapabilities;
const noToolCaps = { tool_use: false } as ModelCapabilities;

function oneShotProvider(): ProviderAdapter {
  return {
    provider_id: 'mock',
    complete: async (): Promise<CompletionResponse> => ({
      content: DIFF, prompt_tokens: 10, completion_tokens: 5, total_tokens: 15, finish_reason: 'stop',
    }),
    healthCheck: async () => ({ status: 'healthy' }),
  };
}

interface Harness {
  db: Database.Database;
  projectPath: string;
  dispatcher: JobDispatcher;
  taskRepo: TaskRepository;
  jobRepo: JobRepository;
  cleanup(): void;
}

function createHarness(opts: { enabled: boolean; caps: ModelCapabilities }): Harness {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  for (const f of readdirSync(MIGRATIONS_DIR).filter((x) => /^\d+.*\.sql$/.test(x)).sort()) {
    db.exec(readFileSync(join(MIGRATIONS_DIR, f), 'utf-8'));
  }
  const projectPath = mkdtempSync(join(tmpdir(), 'kingdom-fallback-')); // NOT a git repo
  mkdirSync(join(projectPath, 'src'), { recursive: true });
  mkdirSync(join(projectPath, 'results'), { recursive: true });
  writeFileSync(join(projectPath, 'src/a.ts'), 'old\n');

  const now = new Date().toISOString();
  db.prepare('INSERT INTO projects (id, name, repository_path, created_at, updated_at) VALUES (?,?,?,?,?)').run('proj', 'P', projectPath, now, now);
  db.prepare('INSERT INTO objectives (id, project_id, description, priority, status, acceptance_criteria, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)').run('obj', 'proj', 'O', 5, 'active', '["ok"]', now, now);

  const taskRepo = new TaskRepository(db);
  const jobRepo = new JobRepository(db);
  const dispatcher = new JobDispatcher(db, {
    maxConcurrentWorkers: 1,
    pollIntervalMs: 1000,
    assemblyOptions: { projectPath, agentTemplatesDir: join(projectPath, 'agents'), outputDir: join(projectPath, 'results'), kingdomDir: projectPath },
    defaultModel: 'mock-model',
    supervisorId: 'test',
    maxRetriesPerTier: 0,
    validationCommand: 'node -e "process.exit(0)"',
    agenticDispatch: { enabled: opts.enabled, max_iterations: 8, link_node_modules: false },
    worktreeManager: new WorktreeManager(projectPath, { authorName: 'T', authorEmail: 't@t' }),
    applyEdit: (e, w) => applyEdit(e, w),
    capabilitiesResolver: () => opts.caps,
    integrationGate: new IntegrationGate(),
  });
  // Blacksmith: legacy in-place apply (writes .bak + file), like the real wiring.
  dispatcher.setBlacksmith((diffText, path) => {
    writeFileSync(join(path, 'src/a.ts.bak'), 'old\n');
    writeFileSync(join(path, 'src/a.ts'), 'new\n');
    return { success: true, appliedFiles: ['src/a.ts'], failedFiles: [], errors: [] };
  });

  return { db, projectPath, dispatcher, taskRepo, jobRepo, cleanup: () => { db.close(); rmSync(projectPath, { recursive: true, force: true }); } };
}

function createRunningJob(h: Harness): { task: TaskGraphNode; job: Job } {
  const task = h.taskRepo.create({
    objective_id: 'obj', level: 'task', title: 'Update', description: 'change', type: 'code',
    assigned_tier: 'knight', reviewer_tier: 'judge', acceptance_criteria: ['ok'],
    context_refs: [{ file: 'src/a.ts', startLine: 1, endLine: 1 }], token_budget_estimate: 2048,
  });
  h.taskRepo.updateStatus(task.id, 'preparing-context');
  h.taskRepo.updateStatus(task.id, 'awaiting-budget-check');
  h.taskRepo.updateStatus(task.id, 'running');
  const job = h.jobRepo.create({ task_id: task.id, model: 'mock-model', token_estimate: 2048, delegating_supervisor_id: 'test' });
  h.jobRepo.setStarted(job.id, 'worker');
  return { task: h.taskRepo.getById(task.id)!, job: h.jobRepo.getById(job.id)! };
}

function executeJob(h: Harness, job: Job, task: TaskGraphNode, provider: ProviderAdapter): Promise<void> {
  return (h.dispatcher as unknown as { executeJob(j: Job, t: TaskGraphNode, p: ProviderAdapter, l: string[]): Promise<void> }).executeJob(job, task, provider, []);
}

function assertLegacyRanNoWorktree(h: Harness, job: Job): void {
  // Legacy in-place apply happened (file mutated; .bak written).
  expect(readFileSync(join(h.projectPath, 'src/a.ts'), 'utf-8')).toBe('new\n');
  // No worktree dir, no ledger rows.
  expect(existsSync(join(h.projectPath, '.kingdom-worktrees'))).toBe(false);
  expect((h.db.prepare('SELECT COUNT(*) n FROM job_worktrees').get() as { n: number }).n).toBe(0);
  // Result file is the legacy one-shot shape (content == diff, no agentic flag).
  const resultPath = join(h.projectPath, 'results', `${job.id}.result.json`);
  expect(existsSync(resultPath)).toBe(true);
  const result = JSON.parse(readFileSync(resultPath, 'utf-8'));
  expect(result.content).toBe(DIFF);
  expect(result.agentic).toBeUndefined();
}

describe('PHASE5 — fallbacks (§12.6)', () => {
  let h: Harness;
  afterEach(() => h?.cleanup());

  it('non-tool model + flag on → legacy in-place path; no worktree created', async () => {
    h = createHarness({ enabled: true, caps: noToolCaps });
    const { task, job } = createRunningJob(h);
    await executeJob(h, job, task, oneShotProvider());
    expect(h.jobRepo.getById(job.id)?.status).toBe('completed');
    assertLegacyRanNoWorktree(h, job);
  });

  it('non-git workspace + flag on + tool_use → legacy path; no worktree created', async () => {
    h = createHarness({ enabled: true, caps: toolCaps }); // projectPath is NOT a git repo
    const { task, job } = createRunningJob(h);
    await executeJob(h, job, task, oneShotProvider());
    expect(h.jobRepo.getById(job.id)?.status).toBe('completed');
    assertLegacyRanNoWorktree(h, job);
  });

  it('flag off → legacy path; result byte-identical legacy shape', async () => {
    h = createHarness({ enabled: false, caps: toolCaps });
    const { task, job } = createRunningJob(h);
    await executeJob(h, job, task, oneShotProvider());
    expect(h.jobRepo.getById(job.id)?.status).toBe('completed');
    assertLegacyRanNoWorktree(h, job);
  });
});
