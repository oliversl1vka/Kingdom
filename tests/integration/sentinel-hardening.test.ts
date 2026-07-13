import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { FileLockManager, JobRepository, TaskRepository } from '@kingdomos/core';
import { getSentinelState, LockCleanup, startSentinel, stopSentinel, type IncidentData } from '@kingdomos/sentinel';

const MIGRATIONS_DIR = join(__dirname, '..', '..', 'packages', 'core', 'migrations');
const MIGRATIONS = ['001_initial.sql', '006_depends_on.sql', '007_parent_job_id.sql', '014_sentinel_state.sql'];

function createDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  for (const migration of MIGRATIONS) {
    db.exec(readFileSync(join(MIGRATIONS_DIR, migration), 'utf-8'));
  }

  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO projects (id, name, repository_path, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run('proj', 'Test Project', process.cwd(), now, now);
  db.prepare(
    `INSERT INTO objectives (id, project_id, description, priority, status, acceptance_criteria, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run('obj', 'proj', 'Sentinel objective', 5, 'active', JSON.stringify([]), now, now);
  return db;
}

function createRunningJob(db: Database.Database): { taskId: string; jobId: string } {
  const taskRepo = new TaskRepository(db);
  const jobRepo = new JobRepository(db);
  const task = taskRepo.create({
    objective_id: 'obj',
    level: 'subtask',
    title: 'Watched task',
    description: 'Needs monitoring.',
    type: 'code',
    assigned_tier: 'knight',
    reviewer_tier: 'judge',
    acceptance_criteria: ['monitored'],
    context_refs: [],
  });
  taskRepo.updateStatus(task.id, 'preparing-context');
  taskRepo.updateStatus(task.id, 'awaiting-budget-check');
  taskRepo.updateStatus(task.id, 'running');
  const job = jobRepo.create({
    task_id: task.id,
    model: 'mock-model',
    token_estimate: 100,
    delegating_supervisor_id: 'sentinel-test',
  });
  jobRepo.setStarted(job.id, 'worker-1');
  return { taskId: task.id, jobId: job.id };
}

function insertHeartbeat(db: Database.Database, jobId: string, timestamp: string): void {
  db.prepare(
    `INSERT INTO heartbeats (job_id, worker_id, timestamp, status, progress, tokens_generated)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(jobId, 'worker-1', timestamp, 'healthy', 'beat', 0);
}

describe('sentinel hardening', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createDb();
  });

  afterEach(() => {
    stopSentinel(db);
    db.close();
    vi.useRealTimers();
  });

  it('releases locks immediately when the owning job is terminal before lock expiry', () => {
    const { jobId } = createRunningJob(db);
    const lockManager = new FileLockManager(db);
    lockManager.acquire('src/a.ts', jobId, 'test-supervisor', 600);
    db.prepare("UPDATE jobs SET status = 'failed-runtime-crash' WHERE id = ?").run(jobId);

    const cleanup = new LockCleanup(db, { staleThresholdSeconds: 30 });

    expect(cleanup.findStaleLocks()).toMatchObject([{ file_path: 'src/a.ts', reason: 'terminal-owner' }]);
    expect(cleanup.cleanupStaleLocks()).toBe(1);
    expect(lockManager.isLocked('src/a.ts')).toBe(false);
  });

  it('releases locks for owners with stale heartbeats before lock expiry', () => {
    const { jobId } = createRunningJob(db);
    const oldHeartbeat = new Date(Date.now() - 120_000).toISOString();
    insertHeartbeat(db, jobId, oldHeartbeat);
    const lockManager = new FileLockManager(db);
    lockManager.acquire('src/a.ts', jobId, 'test-supervisor', 600);

    const cleanup = new LockCleanup(db, { staleThresholdSeconds: 30 });

    expect(cleanup.findStaleLocks()).toMatchObject([{ file_path: 'src/a.ts', reason: 'stale-owner' }]);
    expect(cleanup.cleanupStaleLocks()).toBe(1);
    expect(lockManager.isLocked('src/a.ts')).toBe(false);
  });

  it('keeps locks for owners with recent heartbeats', () => {
    const { jobId } = createRunningJob(db);
    insertHeartbeat(db, jobId, new Date().toISOString());
    const lockManager = new FileLockManager(db);
    lockManager.acquire('src/a.ts', jobId, 'test-supervisor', 600);

    const cleanup = new LockCleanup(db, { staleThresholdSeconds: 30 });

    expect(cleanup.cleanupStaleLocks()).toBe(0);
    expect(lockManager.isLocked('src/a.ts')).toBe(true);
  });

  it('persists sentinel state and records stale detections as incidents', () => {
    vi.useFakeTimers();
    const { jobId } = createRunningJob(db);
    insertHeartbeat(db, jobId, new Date(Date.now() - 120_000).toISOString());
    new FileLockManager(db).acquire('src/a.ts', jobId, 'test-supervisor', 600);
    const incidents: IncidentData[] = [];

    startSentinel(db, 1000, { staleThresholdSeconds: 30 }, (incident) => incidents.push(incident));
    expect(getSentinelState(db)).toMatchObject({ status: 'running', polls: 0, processId: process.pid });

    vi.advanceTimersByTime(1000);

    const state = getSentinelState(db);
    expect(state).toMatchObject({ status: 'running', polls: 1, staleDetected: 1, locksReleased: 1 });
    expect(state.lastHeartbeatAt).toBeTruthy();
    expect(incidents).toHaveLength(1);
    expect(incidents[0]).toMatchObject({ job_id: jobId, failure_type: 'stalled-worker' });
  });
});