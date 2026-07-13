import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { JobRepository, TaskRepository } from '@kingdomos/core';
import { HeartbeatMonitor, type IncidentData } from '../../packages/sentinel/src/heartbeat-monitor.js';

const MIGRATIONS_DIR = join(__dirname, '..', '..', 'packages', 'core', 'migrations');
const MIGRATIONS = ['001_initial.sql', '006_depends_on.sql', '007_parent_job_id.sql'];

function createDb(): Database.Database {
  const db = new Database(':memory:');
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
  ).run('obj', 'proj', 'Heartbeat objective', 5, 'active', JSON.stringify([]), now, now);

  return db;
}

function createRunningJob(db: Database.Database, tier = 'knight'): { taskId: string; jobId: string } {
  const taskRepo = new TaskRepository(db);
  const jobRepo = new JobRepository(db);
  const task = taskRepo.create({
    objective_id: 'obj',
    level: 'subtask',
    title: `${tier} task`,
    description: 'Needs heartbeat monitoring.',
    type: 'code',
    assigned_tier: tier as 'knight',
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
    delegating_supervisor_id: 'test',
  });
  jobRepo.setStarted(job.id, 'worker-1');
  return { taskId: task.id, jobId: job.id };
}

describe('HeartbeatMonitor - Stale Detection', () => {
  let db: Database.Database;
  let incidents: IncidentData[];

  beforeEach(() => {
    db = createDb();
    incidents = [];
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('exports HeartbeatMonitor class', () => {
    expect(typeof HeartbeatMonitor).toBe('function');
  });

  describe('checkForStaleJobs', () => {
    it('detects jobs with no heartbeat after grace period expires', () => {
      const { taskId, jobId } = createRunningJob(db);
      // Backdate started_at past the threshold so the grace period has expired.
      const oldStarted = new Date(Date.now() - 120_000).toISOString();
      db.prepare('UPDATE jobs SET started_at = ? WHERE id = ?').run(oldStarted, jobId);
      const monitor = new HeartbeatMonitor(db, 30, 1000, (incident) => incidents.push(incident));

      const stale = monitor.checkForStaleJobs();

      expect(stale.map((job) => job.id)).toEqual([jobId]);
      expect(db.prepare('SELECT status FROM jobs WHERE id = ?').get(jobId)).toMatchObject({ status: 'stalled' });
      expect(db.prepare('SELECT status FROM task_graph_nodes WHERE id = ?').get(taskId)).toMatchObject({ status: 'stalled' });
      expect(incidents).toHaveLength(1);
      expect(incidents[0]).toMatchObject({ task_id: taskId, job_id: jobId, failure_type: 'stalled-worker' });
    });

    it('detects jobs with stale heartbeats', () => {
      const { jobId } = createRunningJob(db);
      const old = new Date(Date.now() - 120_000).toISOString();
      db.prepare(
        `INSERT INTO heartbeats (job_id, worker_id, timestamp, status, progress, tokens_generated)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(jobId, 'worker-1', old, 'healthy', 'old beat', 0);

      const monitor = new HeartbeatMonitor(db, 30, 1000, (incident) => incidents.push(incident));

      expect(monitor.checkForStaleJobs().map((job) => job.id)).toEqual([jobId]);
      expect(incidents[0].symptoms).toMatchObject({ stale_threshold_seconds: 30 });
    });

    it('does not flag jobs with recent heartbeats', () => {
      const { jobId } = createRunningJob(db);
      db.prepare(
        `INSERT INTO heartbeats (job_id, worker_id, timestamp, status, progress, tokens_generated)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(jobId, 'worker-1', new Date().toISOString(), 'healthy', 'recent beat', 0);

      const monitor = new HeartbeatMonitor(db, 30, 1000, (incident) => incidents.push(incident));

      expect(monitor.checkForStaleJobs()).toEqual([]);
      expect(db.prepare('SELECT status FROM jobs WHERE id = ?').get(jobId)).toMatchObject({ status: 'running' });
      expect(incidents).toEqual([]);
    });

    it('uses per-tier thresholds when configured', () => {
      const { jobId } = createRunningJob(db, 'squire');
      const oldEnoughForDefaultOnly = new Date(Date.now() - 45_000).toISOString();
      db.prepare(
        `INSERT INTO heartbeats (job_id, worker_id, timestamp, status, progress, tokens_generated)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(jobId, 'worker-1', oldEnoughForDefaultOnly, 'healthy', 'tier beat', 0);

      const monitor = new HeartbeatMonitor(db, { staleThresholdSeconds: 30, staleThresholdPerTier: { squire: 90 } }, 1000);

      expect(monitor.checkForStaleJobs()).toEqual([]);
    });
  });

  describe('start/stop', () => {
    it('starts polling at the configured interval', () => {
      vi.useFakeTimers();
      const monitor = new HeartbeatMonitor(db, 30, 250);
      const spy = vi.spyOn(monitor, 'checkForStaleJobs').mockReturnValue([]);

      monitor.start();
      vi.advanceTimersByTime(750);
      monitor.stop();

      expect(spy).toHaveBeenCalledTimes(3);
    });

    it('stops polling on stop()', () => {
      vi.useFakeTimers();
      const monitor = new HeartbeatMonitor(db, 30, 250);
      const spy = vi.spyOn(monitor, 'checkForStaleJobs').mockReturnValue([]);

      monitor.start();
      vi.advanceTimersByTime(250);
      monitor.stop();
      vi.advanceTimersByTime(1000);

      expect(spy).toHaveBeenCalledTimes(1);
    });
  });
});