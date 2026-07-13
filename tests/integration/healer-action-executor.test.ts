import { beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { OrchestrationLoop, TaskRepository, type ProviderAdapter, type TaskGraphNode } from '@kingdomos/core';
import { ActionExecutor, IncidentReporter } from '@kingdomos/healer';

const MIGRATIONS_DIR = join(__dirname, '..', '..', 'packages', 'core', 'migrations');
const MIGRATIONS = ['001_initial.sql', '006_depends_on.sql'];

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
  ).run('obj', 'proj', 'Heal safely', 5, 'active', JSON.stringify([]), now, now);

  return db;
}

function createAwaitingHealerTask(taskRepo: TaskRepository): TaskGraphNode {
  const task = taskRepo.create({
    objective_id: 'obj',
    level: 'task',
    title: 'Recoverable implementation task',
    description: 'Needs healer action.',
    type: 'code',
    assigned_tier: 'knight',
    reviewer_tier: 'judge',
    acceptance_criteria: ['fixed'],
    context_refs: [],
  });

  taskRepo.updateStatus(task.id, 'preparing-context');
  taskRepo.updateStatus(task.id, 'awaiting-budget-check');
  taskRepo.updateStatus(task.id, 'running');
  taskRepo.updateStatus(task.id, 'failed-review');
  taskRepo.updateStatus(task.id, 'awaiting-healer');

  return taskRepo.getById(task.id)!;
}

function createIncident(reporter: IncidentReporter, taskId: string): string {
  return reporter.createIncident({
    task_id: taskId,
    severity: 'high',
    failure_type: 'review-rejection',
    symptoms: { reason: 'needs healer' },
    context_summary: 'test incident',
    failure_history: [],
  }).id;
}

function completeTask(taskRepo: TaskRepository, taskId: string): void {
  taskRepo.updateStatus(taskId, 'preparing-context');
  taskRepo.updateStatus(taskId, 'awaiting-budget-check');
  taskRepo.updateStatus(taskId, 'running');
  taskRepo.updateStatus(taskId, 'completed');
}

describe('healer action executor', () => {
  let db: Database.Database;
  let taskRepo: TaskRepository;
  let reporter: IncidentReporter;
  let executor: ActionExecutor;

  beforeEach(() => {
    db = createDb();
    taskRepo = new TaskRepository(db);
    reporter = new IncidentReporter(db);
    executor = new ActionExecutor(db);
  });

  it('decomposes by queueing replacement children and marking the original superseded', () => {
    const task = createAwaitingHealerTask(taskRepo);
    const incidentId = createIncident(reporter, task.id);

    executor.execute(incidentId, task.id, {
      action: 'decompose',
      new_subtasks: [{
        title: 'Replacement subtask',
        description: 'Do the smaller piece.',
        type: 'code',
        acceptance_criteria: ['done'],
        context_refs: [],
      }],
    });

    expect(taskRepo.getById(task.id)?.status).toBe('superseded');

    const children = taskRepo.getChildren(task.id);
    expect(children).toHaveLength(1);
    expect(children[0].level).toBe('subtask');
    expect(children[0].status).toBe('queued');

    const incident = db.prepare('SELECT action_taken, resolved_at FROM incidents WHERE id = ?').get(incidentId) as {
      action_taken: string;
      resolved_at: string | null;
    };
    expect(incident.action_taken).toMatch(/Decomposed into 1/);
    expect(incident.resolved_at).toBeTruthy();
  });

  it('lets completed replacement children finish the objective instead of failing it', () => {
    const task = createAwaitingHealerTask(taskRepo);
    const incidentId = createIncident(reporter, task.id);

    executor.execute(incidentId, task.id, {
      action: 'decompose',
      new_subtasks: [{
        title: 'Replacement subtask',
        description: 'Do the smaller piece.',
        type: 'code',
        acceptance_criteria: ['done'],
        context_refs: [],
      }],
    });

    const child = taskRepo.getChildren(task.id)[0];
    completeTask(taskRepo, child.id);

    const loop = new OrchestrationLoop(db, provider(), {
      pollIntervalMs: 1000,
      defaultModel: 'mock-model',
      verbose: false,
    });
    (loop as unknown as { checkObjectiveCompletion(): void }).checkObjectiveCompletion();

    const objective = db.prepare('SELECT status FROM objectives WHERE id = ?').get('obj') as { status: string };
    expect(objective.status).toBe('completed');
  });

  it('rolls back replacement children if decomposition creation fails', () => {
    const task = createAwaitingHealerTask(taskRepo);
    const incidentId = createIncident(reporter, task.id);

    expect(() => executor.execute(incidentId, task.id, {
      action: 'decompose',
      new_subtasks: [{
        title: 'Invalid replacement subtask',
        description: 'This should fail the CHECK constraint.',
        type: 'invalid-task-type',
        acceptance_criteria: ['done'],
        context_refs: [],
      }],
    })).toThrow();

    expect(taskRepo.getById(task.id)?.status).toBe('awaiting-healer');
    expect(taskRepo.getChildren(task.id)).toHaveLength(0);

    const incident = db.prepare('SELECT resolved_at FROM incidents WHERE id = ?').get(incidentId) as { resolved_at: string | null };
    expect(incident.resolved_at).toBeNull();
  });

  it('escalates by marking the task as needs-human', () => {
    const task = createAwaitingHealerTask(taskRepo);
    const incidentId = createIncident(reporter, task.id);

    executor.execute(incidentId, task.id, {
      action: 'escalate',
      message: 'operator must redesign scope',
    });

    expect(taskRepo.getById(task.id)?.status).toBe('needs-human');

    const incident = db.prepare('SELECT action_taken, resolved_at FROM incidents WHERE id = ?').get(incidentId) as {
      action_taken: string;
      resolved_at: string | null;
    };
    expect(incident.action_taken).toMatch(/operator must redesign scope/);
    expect(incident.resolved_at).toBeTruthy();
  });
});