import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync, readdirSync, mkdtempSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import {
  TaskRepository, JobRepository, FileLockManager, reconcile,
  type TaskGraphNode,
} from '@kingdomos/core';
import { WorktreeManager, isGitRepo } from '@kingdomos/blacksmith';

const MIGRATIONS_DIR = join(__dirname, '..', '..', 'packages', 'core', 'migrations');

/** Apply ALL numbered migrations so the Phase 1 schema (016–020) is present. */
function createDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  const files = readdirSync(MIGRATIONS_DIR).filter(f => /^\d+.*\.sql$/.test(f)).sort();
  for (const f of files) db.exec(readFileSync(join(MIGRATIONS_DIR, f), 'utf-8'));

  const now = new Date().toISOString();
  db.prepare('INSERT INTO projects (id, name, repository_path, created_at, updated_at) VALUES (?,?,?,?,?)')
    .run('proj', 'Test', process.cwd(), now, now);
  db.prepare('INSERT INTO objectives (id, project_id, description, priority, status, acceptance_criteria, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)')
    .run('obj', 'proj', 'Phase 1 objective', 5, 'active', '[]', now, now);
  return db;
}

function makeTask(taskRepo: TaskRepository): TaskGraphNode {
  return taskRepo.create({
    objective_id: 'obj', level: 'task', title: 'T', type: 'code',
    assigned_tier: 'knight', reviewer_tier: 'judge', acceptance_criteria: ['a'], context_refs: [],
  });
}

function makeJob(jobRepo: JobRepository, taskId: string): string {
  return jobRepo.create({ task_id: taskId, model: 'm', token_estimate: 100, delegating_supervisor_id: 'sup' }).id;
}

describe('Phase 1 — durable & isolated execution substrate', () => {
  let db: Database.Database;
  let taskRepo: TaskRepository;
  let jobRepo: JobRepository;

  beforeEach(() => {
    db = createDb();
    taskRepo = new TaskRepository(db);
    jobRepo = new JobRepository(db);
  });
  afterEach(() => db.close());

  // ── P1.1 Transactional transitions + append-only log ──────────────────────
  describe('P1.1 atomic transitions + state_transitions log', () => {
    it('tryTransition rejects an illegal from-state via changes===0 (no throw)', () => {
      const task = makeTask(taskRepo); // status: queued
      // 'running' is not a legal from-state for queued, so the guarded UPDATE matches nothing.
      const moved = taskRepo.tryTransition(task.id, ['running', 'streaming'], 'completed');
      expect(moved).toBe(false);
      expect(taskRepo.getById(task.id)!.status).toBe('queued');
    });

    it('tryTransition succeeds and leaves the status changed when from-state matches', () => {
      const task = makeTask(taskRepo);
      const moved = taskRepo.tryTransition(task.id, ['queued'], 'running');
      expect(moved).toBe(true);
      expect(taskRepo.getById(task.id)!.status).toBe('running');
    });

    it('writes a state_transitions row in the same transaction as the status change', () => {
      const task = makeTask(taskRepo);
      taskRepo.tryTransition(task.id, ['queued'], 'running', 'dispatch', 'sentinel');
      const rows = db.prepare("SELECT * FROM state_transitions WHERE entity_type='task' AND entity_id=?").all(task.id) as Array<Record<string, unknown>>;
      expect(rows).toHaveLength(1);
      expect(rows[0].from_status).toBe('queued');
      expect(rows[0].to_status).toBe('running');
      expect(rows[0].reason).toBe('dispatch');
      expect(rows[0].actor).toBe('sentinel');
    });

    it('does NOT write a transition row when nothing changed', () => {
      const task = makeTask(taskRepo);
      taskRepo.tryTransition(task.id, ['running'], 'completed'); // no-op
      const rows = db.prepare('SELECT COUNT(*) n FROM state_transitions WHERE entity_id=?').get(task.id) as { n: number };
      expect(rows.n).toBe(0);
    });

    it('logs job transitions through setStarted/setCompleted/setFailed', () => {
      const task = makeTask(taskRepo);
      const jobId = makeJob(jobRepo, task.id);
      jobRepo.setStarted(jobId, 'w1');
      jobRepo.setCompleted(jobId, '/tmp/r.json', 42);
      const rows = db.prepare("SELECT to_status FROM state_transitions WHERE entity_type='job' AND entity_id=? ORDER BY id").all(jobId) as Array<{ to_status: string }>;
      expect(rows.map(r => r.to_status)).toEqual(['running', 'completed']);
    });
  });

  // ── P1.2 Atomic batch lock acquisition ────────────────────────────────────
  describe('P1.2 atomic batch lock acquisition', () => {
    it('acquires all paths in one transaction and stamps fencing tokens', () => {
      const task = makeTask(taskRepo);
      const jobId = makeJob(jobRepo, task.id);
      const flm = new FileLockManager(db);
      const tokens = flm.acquireBatch(['a.ts', 'b.ts', 'c.ts'], jobId, 'sup');
      expect(tokens).not.toBeNull();
      expect(Object.keys(tokens!)).toEqual(['a.ts', 'b.ts', 'c.ts']);
      // Monotonic, distinct tokens
      const vals = Object.values(tokens!);
      expect(new Set(vals).size).toBe(3);
      expect(flm.getAllLocks()).toHaveLength(3);
    });

    it('is all-or-nothing: a single conflicting path takes NO locks (no partial holds)', () => {
      const t1 = makeTask(taskRepo); const j1 = makeJob(jobRepo, t1.id);
      const t2 = makeTask(taskRepo); const j2 = makeJob(jobRepo, t2.id);
      const flm = new FileLockManager(db);
      // Job 1 holds b.ts.
      expect(flm.acquire('b.ts', j1, 'sup')).toBe(true);
      // Job 2 tries [a.ts, b.ts, c.ts] — b.ts conflicts → whole batch fails.
      const tokens = flm.acquireBatch(['a.ts', 'b.ts', 'c.ts'], j2, 'sup');
      expect(tokens).toBeNull();
      // a.ts and c.ts must NOT have been taken by job 2.
      expect(flm.getLock('a.ts')).toBeNull();
      expect(flm.getLock('c.ts')).toBeNull();
      // Only job 1's b.ts lock remains.
      expect(flm.getAllLocks()).toHaveLength(1);
      expect(flm.getLock('b.ts')!.owning_job_id).toBe(j1);
    });
  });

  // ── P1.3 Fencing token rejection ──────────────────────────────────────────
  describe('P1.3 fencing token rejection', () => {
    it('rejects a stale token after the lock is released and re-granted to a newer job', () => {
      const t1 = makeTask(taskRepo); const j1 = makeJob(jobRepo, t1.id);
      const t2 = makeTask(taskRepo); const j2 = makeJob(jobRepo, t2.id);
      const flm = new FileLockManager(db);

      const granted1 = flm.acquireBatch(['hot.ts'], j1, 'sup')!;
      const token1 = granted1['hot.ts'];
      expect(flm.validateFence('hot.ts', j1, token1)).toBe(true);

      // Job 1's worker becomes a zombie; its lock is released and re-granted to j2.
      flm.release('hot.ts', 'sup');
      const granted2 = flm.acquireBatch(['hot.ts'], j2, 'sup')!;
      const token2 = granted2['hot.ts'];

      // Fencing is monotonic: the new token is strictly greater.
      expect(token2).toBeGreaterThan(token1);
      // The zombie's late write (old job + old token) is rejected.
      expect(flm.validateFence('hot.ts', j1, token1)).toBe(false);
      // The current owner with the current token is accepted.
      expect(flm.validateFence('hot.ts', j2, token2)).toBe(true);
    });
  });

  // ── P1.4 Crash-recovery reconciler ────────────────────────────────────────
  describe('P1.4 crash-recovery reconciler', () => {
    it('rolls back a running job whose lease PID is dead, re-queues the task, releases locks', () => {
      const task = makeTask(taskRepo);
      taskRepo.tryTransition(task.id, ['queued'], 'running');
      const jobId = makeJob(jobRepo, task.id);
      jobRepo.setStarted(jobId, 'w1');
      jobRepo.setLease(jobId, 999_999_999, 300); // a PID that is certainly dead
      const flm = new FileLockManager(db);
      flm.acquireBatch(['x.ts', 'y.ts'], jobId, 'sup');

      const res = reconcile(db, { isPidAlive: () => false });

      expect(res.orphanedJobs).toBe(1);
      expect(res.rolledBackTasks).toBe(1);
      expect(res.releasedLocks).toBe(2);
      expect(jobRepo.getById(jobId)!.status).toBe('retrying');
      expect(taskRepo.getById(task.id)!.status).toBe('queued');
      expect(flm.getAllLocks()).toHaveLength(0);
    });

    it('leaves a job alone when its lease PID is still alive', () => {
      const task = makeTask(taskRepo);
      taskRepo.tryTransition(task.id, ['queued'], 'running');
      const jobId = makeJob(jobRepo, task.id);
      jobRepo.setStarted(jobId, 'w1');
      jobRepo.setLease(jobId, process.pid, 300);

      const res = reconcile(db, { isPidAlive: () => true });

      expect(res.orphanedJobs).toBe(0);
      expect(jobRepo.getById(jobId)!.status).toBe('running');
    });

    it('sweeps orphan locks whose owning job is terminal', () => {
      const task = makeTask(taskRepo);
      const jobId = makeJob(jobRepo, task.id);
      jobRepo.setStarted(jobId, 'w1');
      const flm = new FileLockManager(db);
      flm.acquire('leaked.ts', jobId, 'sup');
      jobRepo.setCompleted(jobId, '/tmp/r.json', 1); // job now terminal but lock leaked

      const res = reconcile(db, { isPidAlive: () => false });
      expect(res.releasedLocks).toBeGreaterThanOrEqual(1);
      expect(flm.getLock('leaked.ts')).toBeNull();
    });
  });
});

// ── P1.5 Git-worktree-per-job isolation + 3-way merge-back ──────────────────
describe('Phase 1 — P1.5 worktree-per-job merge-back', () => {
  let repo: string;

  function git(args: string[]): string {
    return execFileSync('git', args, { cwd: repo, encoding: 'utf-8' }).toString();
  }

  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), 'kingdom-wt-'));
    execFileSync('git', ['init', '-b', 'main'], { cwd: repo });
    execFileSync('git', ['config', 'user.email', 't@t'], { cwd: repo });
    execFileSync('git', ['config', 'user.name', 'T'], { cwd: repo });
    execFileSync('git', ['config', 'commit.gpgsign', 'false'], { cwd: repo });
    writeFileSync(join(repo, 'file.txt'), 'line1\nline2\nline3\n');
    git(['add', '-A']);
    git(['commit', '--no-gpg-sign', '-m', 'init']);
  });
  afterEach(() => { try { rmSync(repo, { recursive: true, force: true }); } catch { /* ignore */ } });

  it('detects a git repo', () => {
    expect(isGitRepo(repo)).toBe(true);
    expect(isGitRepo(tmpdir())).toBe(false);
  });

  it('creates a worktree, applies the diff, and merges cleanly back into integration', () => {
    const mgr = new WorktreeManager(repo, { authorEmail: 't@t', authorName: 'T' });
    const diff = '--- a/file.txt\n+++ b/file.txt\n@@ -1,3 +1,3 @@\n line1\n-line2\n+LINE2\n line3\n';
    const result = mgr.applyInWorktree('job-clean', diff);

    expect(result.success).toBe(true);
    expect(result.conflict).toBe(false);
    expect(result.appliedFiles).toContain('file.txt');
    expect(result.mergedSha).toBeTruthy();
    // The integration branch now contains the change.
    expect(readFileSync(join(repo, 'file.txt'), 'utf-8')).toContain('LINE2');
    // Worktree was cleaned up.
    expect(existsSync(join(repo, '.kingdom-worktrees', 'job-clean'))).toBe(false);
  });

  it('fails the job with conflicting hunks when merge-back conflicts', () => {
    // Record the base commit (where line2 still exists).
    const baseCommit = git(['rev-parse', 'HEAD']).trim();

    // The integration branch (main) now changes the SAME line the job will touch.
    writeFileSync(join(repo, 'file.txt'), 'line1\nINTEGRATION_CHANGE\nline3\n');
    git(['add', '-A']);
    git(['commit', '--no-gpg-sign', '-m', 'integration edit']);

    // Branch the job worktree FROM the base commit (line2 present) but merge back
    // into main (which has INTEGRATION_CHANGE on the same line) → real conflict.
    const conflictMgr = new WorktreeManager(repo, {
      integrationBranch: 'main', baseRef: baseCommit, authorEmail: 't@t', authorName: 'T',
    });
    const diff = '--- a/file.txt\n+++ b/file.txt\n@@ -1,3 +1,3 @@\n line1\n-line2\n+JOB_CHANGE\n line3\n';
    const result = conflictMgr.applyInWorktree('job-conflict', diff);

    expect(result.success).toBe(false);
    expect(result.conflict).toBe(true);
    expect(result.conflictingFiles).toContain('file.txt');
    expect(result.feedback.join('\n')).toMatch(/conflict/i);
    // Integration branch must be left clean (merge aborted) — no conflict markers.
    expect(readFileSync(join(repo, 'file.txt'), 'utf-8')).not.toContain('<<<<<<<');
    expect(readFileSync(join(repo, 'file.txt'), 'utf-8')).toContain('INTEGRATION_CHANGE');
  });
});
