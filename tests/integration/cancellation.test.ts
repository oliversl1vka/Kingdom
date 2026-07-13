import { beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cancelJob, cascadeCancel, JobRepository, TaskRepository, type TaskGraphNode } from '@kingdomos/core';

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
  ).run('obj', 'proj', 'Cancelable objective', 5, 'active', JSON.stringify([]), now, now);

  return db;
}

function createTask(taskRepo: TaskRepository, title: string, parentId?: string | null): TaskGraphNode {
  return taskRepo.create({
    parent_id: parentId ?? null,
    objective_id: 'obj',
    level: parentId ? 'subtask' : 'task',
    title,
    description: title,
    type: 'code',
    assigned_tier: 'knight',
    reviewer_tier: 'judge',
    acceptance_criteria: ['safe cancellation'],
    context_refs: [],
  });
}

function completeTask(taskRepo: TaskRepository, taskId: string): void {
  taskRepo.updateStatus(taskId, 'preparing-context');
  taskRepo.updateStatus(taskId, 'awaiting-budget-check');
  taskRepo.updateStatus(taskId, 'running');
  taskRepo.updateStatus(taskId, 'completed');
}

describe('Cancellation Flow', () => {
  let db: Database.Database;
  let taskRepo: TaskRepository;
  let jobRepo: JobRepository;

  beforeEach(() => {
    db = createDb();
    taskRepo = new TaskRepository(db);
    jobRepo = new JobRepository(db);
  });

  describe('cancelJob', () => {
    it('sets cancel_requested and cancels a queued job with no active worker', async () => {
      const task = createTask(taskRepo, 'Queued task');
      const job = jobRepo.create({
        task_id: task.id,
        model: 'mock-model',
        token_estimate: 100,
        delegating_supervisor_id: 'test',
      });

      const result = await cancelJob(db, job.id, 'operator requested cancellation', { gracePeriodMs: 0 });

      expect(result).toEqual({ cancelled: true, hardKilled: false });
      const row = db.prepare('SELECT status, cancel_requested, cancel_reason FROM jobs WHERE id = ?').get(job.id) as {
        status: string;
        cancel_requested: number;
        cancel_reason: string;
      };
      expect(row.status).toBe('cancelled');
      expect(row.cancel_requested).toBe(1);
      expect(row.cancel_reason).toBe('operator requested cancellation');
    });

    it('returns cancelled=false if job does not exist', async () => {
      await expect(cancelJob(db, 'missing-job', 'nothing to cancel', { gracePeriodMs: 0 }))
        .resolves.toEqual({ cancelled: false, hardKilled: false });
    });
  });

  describe('cascadeCancel', () => {
    it('cancels the selected task, descendants, and active jobs', () => {
      const parent = createTask(taskRepo, 'Parent task');
      const activeChild = createTask(taskRepo, 'Active child', parent.id);
      const queuedGrandchild = createTask(taskRepo, 'Queued grandchild', activeChild.id);

      jobRepo.create({ task_id: parent.id, model: 'mock', token_estimate: 100, delegating_supervisor_id: 'test' });
      jobRepo.create({ task_id: activeChild.id, model: 'mock', token_estimate: 100, delegating_supervisor_id: 'test' });
      jobRepo.create({ task_id: queuedGrandchild.id, model: 'mock', token_estimate: 100, delegating_supervisor_id: 'test' });

      const result = cascadeCancel(db, parent.id, 'objective cancelled');

      expect(result).toEqual({ cancelledJobs: 3, cancelledTasks: 3 });
      const statuses = db.prepare('SELECT status FROM task_graph_nodes ORDER BY title').all() as Array<{ status: string }>;
      expect(statuses.map((row) => row.status)).toEqual(['cancelled', 'cancelled', 'cancelled']);
    });

    it('does not cancel already-completed tasks', () => {
      const parent = createTask(taskRepo, 'Parent task');
      const completedChild = createTask(taskRepo, 'Completed child', parent.id);
      const queuedChild = createTask(taskRepo, 'Queued child', parent.id);
      completeTask(taskRepo, completedChild.id);
      jobRepo.create({ task_id: completedChild.id, model: 'mock', token_estimate: 100, delegating_supervisor_id: 'test' });
      jobRepo.create({ task_id: queuedChild.id, model: 'mock', token_estimate: 100, delegating_supervisor_id: 'test' });

      const result = cascadeCancel(db, parent.id, 'objective cancelled');

      expect(result).toEqual({ cancelledJobs: 2, cancelledTasks: 2 });
      expect(taskRepo.getById(completedChild.id)?.status).toBe('completed');
      expect(taskRepo.getById(queuedChild.id)?.status).toBe('cancelled');
      expect(taskRepo.getById(parent.id)?.status).toBe('cancelled');
    });

    it('returns zero counts when the task is missing', () => {
      expect(cascadeCancel(db, 'missing-task', 'nothing to cancel')).toEqual({ cancelledJobs: 0, cancelledTasks: 0 });
    });
  });
});