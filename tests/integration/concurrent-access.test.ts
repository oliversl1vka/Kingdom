import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { FileLockManager } from '../../packages/core/src/locks/file-lock-manager.js';

const MIGRATIONS_DIR = join(__dirname, '..', '..', 'packages', 'core', 'migrations');

function createDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(readFileSync(join(MIGRATIONS_DIR, '001_initial.sql'), 'utf-8'));
  // Seed prerequisite records for FK chain: task_graph_nodes -> jobs -> file_locks
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO projects (id, name, repository_path, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run('proj', 'Test', '/tmp/test', now, now);
  db.prepare(
    `INSERT INTO objectives (id, project_id, description, priority, status, acceptance_criteria, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run('obj', 'proj', 'Test objective', 5, 'active', '[]', now, now);
  return db;
}

/** Insert a minimal task + job row so file_locks FK constraints pass. */
function seedJob(db: Database.Database, jobId: string): void {
  const now = new Date().toISOString();
  // Check if task already exists
  const existing = db.prepare('SELECT id FROM task_graph_nodes WHERE id = ?').get('task-' + jobId);
  if (!existing) {
    db.prepare(
      `INSERT INTO task_graph_nodes (id, objective_id, level, title, type, assigned_tier, reviewer_tier, acceptance_criteria, context_refs, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run('task-' + jobId, 'obj', 'subtask', 'Test task', 'code', 'knight', 'nobility', '[]', '[]', now, now);
  }
  const existingJob = db.prepare('SELECT id FROM jobs WHERE id = ?').get(jobId);
  if (!existingJob) {
    db.prepare(
      `INSERT INTO jobs (id, task_id, model, status, token_estimate, delegating_supervisor_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(jobId, 'task-' + jobId, 'test-model', 'queued', 100, 'sup', now);
  }
}

describe('FileLockManager - Concurrent Access', () => {
  let db: Database.Database;
  let mgr: FileLockManager;

  beforeEach(() => {
    db = createDb();
    mgr = new FileLockManager(db);
  });

  describe('Exclusive locking', () => {
    it('should acquire a lock on a file', () => {
      seedJob(db, 'job-1');
      const result = mgr.acquire('src/app.ts', 'job-1', 'supervisor-1');
      expect(result).toBe(true);
      expect(mgr.isLocked('src/app.ts')).toBe(true);
    });

    it('should reject second lock on same file via PK conflict', () => {
      seedJob(db, 'job-1');
      seedJob(db, 'job-2');
      mgr.acquire('src/app.ts', 'job-1', 'supervisor-1');
      const result = mgr.acquire('src/app.ts', 'job-2', 'supervisor-2');
      expect(result).toBe(false);
      const lock = mgr.getLock('src/app.ts');
      expect(lock!.owning_job_id).toBe('job-1');
    });

    it('should release a lock by owning supervisor', () => {
      seedJob(db, 'job-1');
      mgr.acquire('src/app.ts', 'job-1', 'supervisor-1');
      const result = mgr.release('src/app.ts', 'supervisor-1');
      expect(result).toBe(true);
      expect(mgr.isLocked('src/app.ts')).toBe(false);
    });

    it('should not release a lock by non-owning supervisor', () => {
      seedJob(db, 'job-1');
      mgr.acquire('src/app.ts', 'job-1', 'supervisor-1');
      const result = mgr.release('src/app.ts', 'supervisor-2');
      expect(result).toBe(false);
      expect(mgr.isLocked('src/app.ts')).toBe(true);
    });

    it('should force-release regardless of owner', () => {
      seedJob(db, 'job-1');
      mgr.acquire('src/app.ts', 'job-1', 'supervisor-1');
      const result = mgr.forceRelease('src/app.ts');
      expect(result).toBe(true);
      expect(mgr.isLocked('src/app.ts')).toBe(false);
    });
  });

  describe('Lock expiration', () => {
    it('should detect expired locks via getExpiredLocks', () => {
      seedJob(db, 'job-1');
      // Insert a lock with a past locked_at time so it is guaranteed expired
      const pastTime = new Date(Date.now() - 3600000).toISOString(); // 1 hour ago
      db.prepare(
        `INSERT INTO file_locks (file_path, owning_job_id, owning_supervisor_id, locked_at, lock_type, max_duration_seconds)
         VALUES (?, ?, ?, ?, 'exclusive', ?)`,
      ).run('src/expired.ts', 'job-1', 'supervisor-1', pastTime, 600);

      const expired = mgr.getExpiredLocks();
      expect(expired.length).toBeGreaterThanOrEqual(1);
      expect(expired.some(l => l.file_path === 'src/expired.ts')).toBe(true);
    });

    it('should not return unexpired locks', () => {
      seedJob(db, 'job-1');
      // Acquire with 3600-second duration — far in the future
      mgr.acquire('src/fresh.ts', 'job-1', 'supervisor-1', 3600);

      const expired = mgr.getExpiredLocks();
      expect(expired.some(l => l.file_path === 'src/fresh.ts')).toBe(false);
    });
  });

  describe('isLocked / getLock', () => {
    it('should return false for unlocked file', () => {
      expect(mgr.isLocked('nonexistent.ts')).toBe(false);
    });

    it('should return null for getLock on unlocked file', () => {
      expect(mgr.getLock('nonexistent.ts')).toBeNull();
    });

    it('should return true and lock details for locked file', () => {
      seedJob(db, 'job-1');
      mgr.acquire('src/locked.ts', 'job-1', 'supervisor-1', 600);

      expect(mgr.isLocked('src/locked.ts')).toBe(true);

      const lock = mgr.getLock('src/locked.ts');
      expect(lock).not.toBeNull();
      expect(lock!.file_path).toBe('src/locked.ts');
      expect(lock!.owning_job_id).toBe('job-1');
      expect(lock!.owning_supervisor_id).toBe('supervisor-1');
      expect(lock!.lock_type).toBe('exclusive');
      expect(lock!.max_duration_seconds).toBe(600);
    });
  });

  describe('getAllLocks', () => {
    it('should return all current locks', () => {
      seedJob(db, 'job-1');
      seedJob(db, 'job-2');
      mgr.acquire('src/a.ts', 'job-1', 'supervisor-1');
      mgr.acquire('src/b.ts', 'job-2', 'supervisor-2');

      const all = mgr.getAllLocks();
      expect(all.length).toBe(2);
      expect(all.map(l => l.file_path).sort()).toEqual(['src/a.ts', 'src/b.ts']);
    });

    it('should return empty array when no locks exist', () => {
      expect(mgr.getAllLocks()).toEqual([]);
    });
  });
});
