import { beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { OrchestrationLoop, TaskRepository, type MilestoneEvent, type ProviderAdapter } from '@kingdomos/core';

const MIGRATIONS_DIR = join(__dirname, '..', '..', 'packages', 'core', 'migrations');
const MIGRATIONS = ['001_initial.sql', '006_depends_on.sql', '011_objective_warning_status.sql'];

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

  return db;
}

function createObjective(db: Database.Database, id: string, status = 'active'): void {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO objectives (id, project_id, description, priority, status, acceptance_criteria, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, 'proj', `Objective ${id}`, 5, status, JSON.stringify([]), now, now);
}

function addTask(db: Database.Database, objectiveId: string, title: string, status: string): void {
  const task = new TaskRepository(db).create({
    objective_id: objectiveId,
    level: 'subtask',
    title,
    description: title,
    type: 'code',
    assigned_tier: 'knight',
    reviewer_tier: 'judge',
    acceptance_criteria: ['done'],
    context_refs: [],
  });
  db.prepare('UPDATE task_graph_nodes SET status = ? WHERE id = ?').run(status, task.id);
}

function checkObjectiveCompletion(loop: OrchestrationLoop): void {
  (loop as unknown as { checkObjectiveCompletion(): void }).checkObjectiveCompletion();
}

function checkCancelledObjectives(loop: OrchestrationLoop): void {
  (loop as unknown as { checkCancelledObjectives(): void }).checkCancelledObjectives();
}

describe('objective terminal semantics', () => {
  let db: Database.Database;
  let milestones: MilestoneEvent[];

  beforeEach(() => {
    db = createDb();
    milestones = [];
  });

  it('marks cleanly completed objectives as completed and emits objective_complete', () => {
    createObjective(db, 'obj-clean');
    addTask(db, 'obj-clean', 'Task 1', 'completed');
    addTask(db, 'obj-clean', 'Task 2', 'completed');
    const terminal = vi.fn();
    const legacyComplete = vi.fn();
    const loop = new OrchestrationLoop(db, provider(), {
      pollIntervalMs: 1000,
      defaultModel: 'mock-model',
      verbose: false,
      onObjectiveTerminal: terminal,
      onObjectiveComplete: legacyComplete,
      onMilestone: (event) => milestones.push(event),
    });

    checkObjectiveCompletion(loop);

    expect(db.prepare('SELECT status FROM objectives WHERE id = ?').get('obj-clean')).toMatchObject({ status: 'completed' });
    expect(terminal).toHaveBeenCalledOnce();
    expect(terminal.mock.calls[0][2]).toBe('completed');
    expect(terminal.mock.calls[0][3]).toMatchObject({ total: 2, succeeded: 2, warnings: 0, cancelled: 0, failed: 0 });
    expect(legacyComplete).not.toHaveBeenCalled();
    expect(milestones.map((event) => event.type)).toEqual(['objective_terminal', 'objective_complete']);
  });

  it('marks mixed success and cancelled work as completed-with-warnings', () => {
    createObjective(db, 'obj-partial');
    addTask(db, 'obj-partial', 'Completed task', 'completed');
    addTask(db, 'obj-partial', 'Cancelled task', 'cancelled');
    const terminal = vi.fn();
    const loop = new OrchestrationLoop(db, provider(), {
      pollIntervalMs: 1000,
      defaultModel: 'mock-model',
      verbose: false,
      onObjectiveTerminal: terminal,
      onMilestone: (event) => milestones.push(event),
    });

    checkObjectiveCompletion(loop);

    expect(db.prepare('SELECT status FROM objectives WHERE id = ?').get('obj-partial')).toMatchObject({ status: 'completed-with-warnings' });
    expect(terminal.mock.calls[0][2]).toBe('completed-with-warnings');
    expect(terminal.mock.calls[0][3]).toMatchObject({ total: 2, succeeded: 1, cancelled: 1 });
    expect(milestones.map((event) => event.type)).toEqual(['objective_terminal']);
  });

  it('marks terminal human-needed work as failed', () => {
    createObjective(db, 'obj-failed');
    addTask(db, 'obj-failed', 'Completed task', 'completed');
    addTask(db, 'obj-failed', 'Human task', 'needs-human');
    const terminal = vi.fn();
    const loop = new OrchestrationLoop(db, provider(), {
      pollIntervalMs: 1000,
      defaultModel: 'mock-model',
      verbose: false,
      onObjectiveTerminal: terminal,
      onMilestone: (event) => milestones.push(event),
    });

    checkObjectiveCompletion(loop);

    expect(db.prepare('SELECT status FROM objectives WHERE id = ?').get('obj-failed')).toMatchObject({ status: 'failed' });
    expect(terminal.mock.calls[0][2]).toBe('failed');
    expect(terminal.mock.calls[0][3]).toMatchObject({ succeeded: 1, failed: 1 });
    expect(milestones.map((event) => event.type)).toEqual(['objective_terminal', 'run_failed']);
  });

  it('fires cancelled terminal hooks only once per objective and final status', () => {
    createObjective(db, 'obj-cancelled', 'cancelled');
    addTask(db, 'obj-cancelled', 'Cancelled task', 'cancelled');
    const terminal = vi.fn();
    const loop = new OrchestrationLoop(db, provider(), {
      pollIntervalMs: 1000,
      defaultModel: 'mock-model',
      verbose: false,
      onObjectiveTerminal: terminal,
      onMilestone: (event) => milestones.push(event),
    });

    checkCancelledObjectives(loop);
    checkCancelledObjectives(loop);

    expect(terminal).toHaveBeenCalledOnce();
    expect(terminal.mock.calls[0][2]).toBe('cancelled');
    expect(milestones.map((event) => event.type)).toEqual(['objective_terminal']);
  });
});