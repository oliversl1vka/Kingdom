import { beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { OrchestrationLoop, TaskRepository, type ProviderAdapter, type TaskGraphNode } from '@kingdomos/core';

const MIGRATIONS_DIR = join(__dirname, '..', '..', 'packages', 'core', 'migrations');
// PHASE3 (P3.1): include 027 which relaxes the DB-level scope trigger to allow
// cross-subtree edges within an objective (cross-objective still rejected).
const MIGRATIONS = ['001_initial.sql', '006_depends_on.sql', '007_parent_job_id.sql', '013_task_dependencies.sql', '027_relax_dependency_scope.sql'];

function provider(): ProviderAdapter {
  return {
    provider_id: 'mock',
    complete: vi.fn(async () => ({
      content: '',
      prompt_tokens: 0,
      completion_tokens: 0,
      total_tokens: 0,
      finish_reason: 'stop',
    })),
    healthCheck: vi.fn(async () => ({ status: 'healthy' })),
  };
}

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
  ).run('obj', 'proj', 'Dependency objective', 5, 'active', JSON.stringify([]), now, now);
  // PHASE3 (P3.1): a second objective to exercise cross-objective rejection.
  db.prepare(
    `INSERT INTO objectives (id, project_id, description, priority, status, acceptance_criteria, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run('obj2', 'proj', 'Other objective', 5, 'active', JSON.stringify([]), now, now);
  return db;
}

function createTask(taskRepo: TaskRepository, title: string, parentId: string | null = null, level: 'task' | 'subtask' = 'subtask', objectiveId = 'obj'): TaskGraphNode {
  return taskRepo.create({
    parent_id: parentId,
    objective_id: objectiveId,
    level,
    title,
    description: title,
    type: 'code',
    assigned_tier: level === 'task' ? 'knight' : 'squire',
    reviewer_tier: 'judge',
    acceptance_criteria: ['done'],
    context_refs: [],
  });
}

function completeTask(taskRepo: TaskRepository, taskId: string): void {
  taskRepo.updateStatus(taskId, 'preparing-context');
  taskRepo.updateStatus(taskId, 'awaiting-budget-check');
  taskRepo.updateStatus(taskId, 'running');
  taskRepo.updateStatus(taskId, 'completed');
}

function createJobsForLeafTasks(loop: OrchestrationLoop): void {
  (loop as unknown as { createJobsForLeafTasks(): void }).createJobsForLeafTasks();
}

describe('task dependency graph', () => {
  let db: Database.Database;
  let taskRepo: TaskRepository;

  beforeEach(() => {
    db = createDb();
    taskRepo = new TaskRepository(db);
  });

  it('stores dependencies in task_dependencies and mirrors the legacy column', () => {
    const parent = createTask(taskRepo, 'Parent', null, 'task');
    const blocker = createTask(taskRepo, 'Blocker', parent.id);
    const dependent = createTask(taskRepo, 'Dependent', parent.id);

    taskRepo.updateDependsOn(dependent.id, [blocker.id]);

    expect(taskRepo.getById(dependent.id)?.depends_on).toEqual([blocker.id]);
    expect(db.prepare('SELECT depends_on_task_id FROM task_dependencies WHERE task_id = ?').get(dependent.id))
      .toEqual({ depends_on_task_id: blocker.id });
    expect(db.prepare('SELECT depends_on FROM task_graph_nodes WHERE id = ?').get(dependent.id))
      .toEqual({ depends_on: JSON.stringify([blocker.id]) });
  });

  // PHASE3 (P3.1): cross-subtree edges within the SAME objective are now a valid
  // DAG edge (previously rejected as "outside sibling scope").
  it('allows cross-subtree dependencies within the same objective', () => {
    const parentA = createTask(taskRepo, 'Parent A', null, 'task');
    const parentB = createTask(taskRepo, 'Parent B', null, 'task');
    const taskA = createTask(taskRepo, 'Task A', parentA.id);
    const taskB = createTask(taskRepo, 'Task B', parentB.id);

    expect(() => taskRepo.updateDependsOn(taskA.id, [taskB.id])).not.toThrow();
    expect(taskRepo.getById(taskA.id)?.depends_on).toEqual([taskB.id]);
  });

  // PHASE3 (P3.1): edges crossing OBJECTIVE boundaries remain rejected (both at
  // the JS validation layer and the DB trigger).
  it('rejects dependencies that cross objective boundaries', () => {
    const taskA = createTask(taskRepo, 'Task A', null, 'task', 'obj');
    const taskB = createTask(taskRepo, 'Task B', null, 'task', 'obj2');

    expect(() => taskRepo.updateDependsOn(taskA.id, [taskB.id])).toThrow(/objective/);
  });

  it('rejects dependency cycles', () => {
    const parent = createTask(taskRepo, 'Parent', null, 'task');
    const first = createTask(taskRepo, 'First', parent.id);
    const second = createTask(taskRepo, 'Second', parent.id);

    taskRepo.updateDependsOn(second.id, [first.id]);

    expect(() => taskRepo.updateDependsOn(first.id, [second.id])).toThrow(/cycle/);
  });

  it('dispatches dependent leaf tasks only after dependency tasks are terminal', () => {
    const parent = createTask(taskRepo, 'Parent', null, 'task');
    const blocker = createTask(taskRepo, 'Blocker', parent.id);
    const dependent = createTask(taskRepo, 'Dependent', parent.id);
    taskRepo.updateDependsOn(dependent.id, [blocker.id]);

    const loop = new OrchestrationLoop(db, provider(), {
      pollIntervalMs: 1000,
      defaultModel: 'mock-model',
      verbose: false,
    });

    createJobsForLeafTasks(loop);
    expect(db.prepare('SELECT COUNT(*) as n FROM jobs').get()).toEqual({ n: 1 });

    completeTask(taskRepo, blocker.id);
    createJobsForLeafTasks(loop);

    expect(db.prepare('SELECT COUNT(*) as n FROM jobs').get()).toEqual({ n: 2 });
    expect(db.prepare('SELECT COUNT(*) as n FROM jobs WHERE task_id = ?').get(dependent.id)).toEqual({ n: 1 });
  });
});