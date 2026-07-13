/**
 * PHASE5 §12.5 — worktree crash recovery (reconciler).
 *
 * - An orphan 'open' worktree row → reconcile removes the worktree + branch, marks
 *   it discarded, requeues the owning job/task; integration HEAD unchanged.
 * - A 'merging' row whose job branch already landed on integration → reconcile
 *   finalizes it as 'merged' (no double-merge) and completes the job. Idempotent.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync, readdirSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { JobRepository, TaskRepository, WorktreeRepository, reconcile } from '@kingdomos/core';
import { WorktreeManager } from '@kingdomos/blacksmith';
import { createTempGitRepo, type TempGitRepo } from '../helpers/temp-git-repo.js';

const MIGRATIONS_DIR = join(__dirname, '..', '..', 'packages', 'core', 'migrations');

function createDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  for (const f of readdirSync(MIGRATIONS_DIR).filter((x) => /^\d+.*\.sql$/.test(x)).sort()) {
    db.exec(readFileSync(join(MIGRATIONS_DIR, f), 'utf-8'));
  }
  return db;
}

function seedJob(db: Database.Database, repoDir: string): { jobId: string; taskId: string } {
  const now = new Date().toISOString();
  db.prepare('INSERT INTO projects (id, name, repository_path, created_at, updated_at) VALUES (?,?,?,?,?)').run('proj', 'P', repoDir, now, now);
  db.prepare('INSERT INTO objectives (id, project_id, description, priority, status, acceptance_criteria, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)').run('obj', 'proj', 'O', 5, 'active', '["ok"]', now, now);
  const taskRepo = new TaskRepository(db);
  const jobRepo = new JobRepository(db);
  const task = taskRepo.create({
    objective_id: 'obj', level: 'task', title: 'T', description: 'd', type: 'code',
    assigned_tier: 'knight', reviewer_tier: 'judge', acceptance_criteria: ['ok'],
    context_refs: [{ file: 'app.ts', startLine: 1, endLine: 1 }], token_budget_estimate: 2048,
  });
  taskRepo.updateStatus(task.id, 'preparing-context');
  taskRepo.updateStatus(task.id, 'awaiting-budget-check');
  taskRepo.updateStatus(task.id, 'running');
  const job = jobRepo.create({ task_id: task.id, model: 'm', token_estimate: 2048, delegating_supervisor_id: 's' });
  jobRepo.setStarted(job.id, 'worker');
  return { jobId: job.id, taskId: task.id };
}

describe('PHASE5 — worktree crash recovery (§12.5)', () => {
  let db: Database.Database;
  let repo: TempGitRepo;
  let mgr: WorktreeManager;

  beforeEach(() => {
    db = createDb();
    repo = createTempGitRepo({ seedFile: { path: 'app.ts', content: 'export const x = 1;\n' } });
    mgr = new WorktreeManager(repo.dir, { authorName: 'T', authorEmail: 't@t' });
  });
  afterEach(() => { db.close(); repo.cleanup(); });

  it('orphan open worktree → discarded; worktree+branch removed; job requeued; integration unchanged', () => {
    const { jobId, taskId } = seedJob(db, repo.dir);
    const H0 = mgr.integrationHead();

    // Simulate a crashed agentic job: an open session + ledger row, never discarded.
    const session = mgr.openSession(jobId);
    writeFileSync(join(session.path, 'app.ts'), 'export const x = 2;\n'); // un-committed edit
    new WorktreeRepository(db).open({
      jobId, branch: session.branch, worktreePath: session.path,
      integrationBranch: session.integrationBranch, baseSha: session.baseSha,
    });
    expect(existsSync(session.path)).toBe(true);

    const res = reconcile(db, {
      isPidAlive: () => false,
      projectPath: repo.dir,
      removeWorktree: (p, b) => mgr.removeWorktree(p, b),
    });

    expect(res.worktreesDiscarded).toBe(1);
    expect(mgr.integrationHead()).toBe(H0); // INV-1
    expect(existsSync(session.path)).toBe(false);
    expect(repo.git(['branch', '--list', session.branch]).trim()).toBe('');
    expect((db.prepare("SELECT status FROM job_worktrees WHERE job_id=?").get(jobId) as { status: string }).status).toBe('discarded');
    // Owning job requeued, task back to queued.
    expect(new JobRepository(db).getById(jobId)!.status).toBe('retrying');
    expect(new TaskRepository(db).getById(taskId)!.status).toBe('queued');
    expect(readFileSync(join(repo.dir, 'app.ts'), 'utf-8')).toContain('export const x = 1;');
  });

  it('merging row whose branch already landed → finalized as merged; job completed; idempotent', () => {
    const { jobId, taskId } = seedJob(db, repo.dir);

    // Simulate: the agentic job committed + merged its branch, then crashed BEFORE
    // recording 'merged' — the ledger row is still 'merging'.
    const session = mgr.openSession(jobId);
    writeFileSync(join(session.path, 'app.ts'), 'export const x = 2;\n');
    session.commit('job change');
    const merge = session.mergeBack();
    expect(merge.success).toBe(true);
    const wtRepo = new WorktreeRepository(db);
    wtRepo.open({ jobId, branch: session.branch, worktreePath: session.path, integrationBranch: session.integrationBranch, baseSha: session.baseSha });
    wtRepo.setMerging(jobId);
    const mergedHead = mgr.integrationHead();

    const res = reconcile(db, {
      isPidAlive: () => false,
      projectPath: repo.dir,
      removeWorktree: (p, b) => mgr.removeWorktree(p, b),
    });

    expect(res.worktreesFinalized).toBe(1);
    expect(res.worktreesDiscarded).toBe(0);
    expect((db.prepare("SELECT status FROM job_worktrees WHERE job_id=?").get(jobId) as { status: string }).status).toBe('merged');
    expect(mgr.integrationHead()).toBe(mergedHead); // no double-merge / no revert
    expect(new JobRepository(db).getById(jobId)!.status).toBe('completed');
    expect(new TaskRepository(db).getById(taskId)!.status).toBe('completed');

    // Idempotent: a second reconcile is a no-op (no live rows remain).
    const res2 = reconcile(db, { isPidAlive: () => false, projectPath: repo.dir, removeWorktree: (p, b) => mgr.removeWorktree(p, b) });
    expect(res2.worktreesFinalized).toBe(0);
    expect(res2.worktreesDiscarded).toBe(0);
    expect(mgr.integrationHead()).toBe(mergedHead);
  });
});
