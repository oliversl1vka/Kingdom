import { beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  cancelJob,
  classifyWorkerFailure,
  isValidTransition,
  JobRepository,
  TaskRepository,
  type TaskGraphNode,
} from '@kingdomos/core';

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
  ).run('obj', 'proj', 'Job lifecycle objective', 5, 'active', JSON.stringify([]), now, now);

  return db;
}

function createTask(taskRepo: TaskRepository): TaskGraphNode {
  return taskRepo.create({
    objective_id: 'obj',
    level: 'subtask',
    title: 'Lifecycle task',
    description: 'Run through lifecycle.',
    type: 'code',
    assigned_tier: 'knight',
    reviewer_tier: 'judge',
    acceptance_criteria: ['done'],
    context_refs: [],
  });
}

describe('Job Lifecycle Integration', () => {
  let db: Database.Database;
  let taskRepo: TaskRepository;
  let jobRepo: JobRepository;

  beforeEach(() => {
    db = createDb();
    taskRepo = new TaskRepository(db);
    jobRepo = new JobRepository(db);
  });

  it('creates a job in queued status', () => {
    const task = createTask(taskRepo);

    const job = jobRepo.create({ task_id: task.id, model: 'mock-model', token_estimate: 100, delegating_supervisor_id: 'test' });

    expect(job.status).toBe('queued');
    expect(job.task_id).toBe(task.id);
  });

  it('transitions tasks through preparing-context, awaiting-budget-check, and running', () => {
    const task = createTask(taskRepo);

    taskRepo.updateStatus(task.id, 'preparing-context');
    taskRepo.updateStatus(task.id, 'awaiting-budget-check');
    taskRepo.updateStatus(task.id, 'running');

    expect(taskRepo.getById(task.id)?.status).toBe('running');
    expect(isValidTransition('running', 'completed')).toBe(true);
  });

  it('writes heartbeats during execution', () => {
    const task = createTask(taskRepo);
    const job = jobRepo.create({ task_id: task.id, model: 'mock-model', token_estimate: 100, delegating_supervisor_id: 'test' });
    jobRepo.setStarted(job.id, 'worker-1');

    expect(jobRepo.updateHeartbeat(job.id)).toBe(true);

    const row = db.prepare('SELECT heartbeat_at FROM jobs WHERE id = ?').get(job.id) as { heartbeat_at: string | null };
    expect(row.heartbeat_at).toBeTruthy();
  });

  it('transitions to completed with result artifact', () => {
    const task = createTask(taskRepo);
    const job = jobRepo.create({ task_id: task.id, model: 'mock-model', token_estimate: 100, delegating_supervisor_id: 'test' });

    expect(jobRepo.setCompleted(job.id, 'kingdom/results/job.result.json', 42)).toBe(true);
    taskRepo.updateStatus(task.id, 'preparing-context');
    taskRepo.updateStatus(task.id, 'awaiting-budget-check');
    taskRepo.updateStatus(task.id, 'running');
    taskRepo.updateStatus(task.id, 'completed');

    expect(jobRepo.getById(job.id)).toMatchObject({ status: 'completed', result_path: 'kingdom/results/job.result.json' });
    expect(taskRepo.getById(task.id)?.status).toBe('completed');
  });

  it('records tokens_used from provider response', () => {
    const task = createTask(taskRepo);
    const job = jobRepo.create({ task_id: task.id, model: 'mock-model', token_estimate: 100, delegating_supervisor_id: 'test' });

    jobRepo.setCompleted(job.id, 'kingdom/results/job.result.json', 1234);

    expect(jobRepo.getById(job.id)?.tokens_used).toBe(1234);
  });

  it('handles timeout and transitions to failed-timeout', () => {
    const task = createTask(taskRepo);
    const job = jobRepo.create({ task_id: task.id, model: 'mock-model', token_estimate: 100, delegating_supervisor_id: 'test' });
    taskRepo.updateStatus(task.id, 'preparing-context');
    taskRepo.updateStatus(task.id, 'awaiting-budget-check');
    taskRepo.updateStatus(task.id, 'running');

    expect(jobRepo.setFailed(job.id, 'timeout')).toBe(true);
    taskRepo.updateStatus(task.id, 'failed-timeout');

    expect(jobRepo.getById(job.id)).toMatchObject({ status: 'failed-timeout', failure_type: 'timeout' });
    expect(taskRepo.getById(task.id)?.status).toBe('failed-timeout');
  });

  it('handles cancelled jobs before execution starts', async () => {
    const task = createTask(taskRepo);
    const job = jobRepo.create({ task_id: task.id, model: 'mock-model', token_estimate: 100, delegating_supervisor_id: 'test' });

    await expect(cancelJob(db, job.id, 'cancel before run', { gracePeriodMs: 0 }))
      .resolves.toEqual({ cancelled: true, hardKilled: false });

    expect(jobRepo.getById(job.id)?.status).toBe('cancelled');
  });

  it('handles provider errors and transitions to failed-runtime-crash', () => {
    const task = createTask(taskRepo);
    const job = jobRepo.create({ task_id: task.id, model: 'mock-model', token_estimate: 100, delegating_supervisor_id: 'test' });
    taskRepo.updateStatus(task.id, 'preparing-context');
    taskRepo.updateStatus(task.id, 'awaiting-budget-check');
    taskRepo.updateStatus(task.id, 'running');

    expect(jobRepo.setFailed(job.id, 'runtime-crash')).toBe(true);
    taskRepo.updateStatus(task.id, 'failed-runtime-crash');

    expect(jobRepo.getById(job.id)).toMatchObject({ status: 'failed-runtime-crash', failure_type: 'runtime-crash' });
    expect(taskRepo.getById(task.id)?.status).toBe('failed-runtime-crash');
  });

  it('handles review rejection and transitions to failed-review (not the invalid failed-review-rejection)', () => {
    const task = createTask(taskRepo);
    const job = jobRepo.create({ task_id: task.id, model: 'mock-model', token_estimate: 100, delegating_supervisor_id: 'test' });
    taskRepo.updateStatus(task.id, 'preparing-context');
    taskRepo.updateStatus(task.id, 'awaiting-budget-check');
    taskRepo.updateStatus(task.id, 'running');

    // A Judge rejection has failure_type 'review-rejection'; the terminal job
    // status must be the valid 'failed-review' — a bad `failed-${failureType}`
    // template used to yield 'failed-review-rejection' and crash on the CHECK.
    expect(jobRepo.setFailed(job.id, 'review-rejection')).toBe(true);
    taskRepo.updateStatus(task.id, 'failed-review');

    expect(jobRepo.getById(job.id)).toMatchObject({ status: 'failed-review', failure_type: 'review-rejection' });
    expect(taskRepo.getById(task.id)?.status).toBe('failed-review');
  });

  it('classifies standalone worker failures from structured provider fields first', () => {
    expect(classifyWorkerFailure(Object.assign(new Error('The API key token is invalid'), { statusCode: 401 })))
      .toBe('runtime-crash');
    expect(classifyWorkerFailure(Object.assign(new Error('Payload exceeds context window'), { statusCode: 413 })))
      .toBe('token-overflow');
    expect(classifyWorkerFailure(Object.assign(new Error('Gateway timeout'), { statusCode: 504 })))
      .toBe('timeout');
  });

  it('uses case-insensitive fallback classification for unstructured failures', () => {
    expect(classifyWorkerFailure(Object.assign(new Error('request aborted'), { name: 'AbortError' })))
      .toBe('timeout');
    expect(classifyWorkerFailure(new Error('CONTEXT_LENGTH_EXCEEDED by model')))
      .toBe('token-overflow');
    expect(classifyWorkerFailure(new Error('socket closed unexpectedly')))
      .toBe('runtime-crash');
  });
});