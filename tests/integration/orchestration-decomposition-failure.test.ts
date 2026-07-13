import { beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { OrchestrationLoop, TaskRepository, type ProviderAdapter, type TaskGraphNode } from '@kingdomos/core';

const MIGRATIONS_DIR = join(__dirname, '..', '..', 'packages', 'core', 'migrations');
const MIGRATIONS = ['001_initial.sql', '006_depends_on.sql'];

function failingProvider(message = 'decomposer provider unavailable'): ProviderAdapter {
  return {
    provider_id: 'mock',
    complete: vi.fn(async () => {
      throw new Error(message);
    }),
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
  ).run('obj', 'proj', 'Decompose safely', 5, 'active', JSON.stringify([]), now, now);

  return db;
}

function createEpic(taskRepo: TaskRepository): TaskGraphNode {
  return taskRepo.create({
    objective_id: 'obj',
    level: 'epic',
    title: 'Epic requiring decomposition',
    description: 'Break this into work.',
    type: 'design',
    assigned_tier: 'nobility',
    reviewer_tier: 'king',
    acceptance_criteria: ['decomposed'],
    context_refs: [],
  });
}

async function decomposeQueuedTasks(loop: OrchestrationLoop): Promise<void> {
  await (loop as unknown as { decomposeQueuedTasks(): Promise<void> }).decomposeQueuedTasks();
}

describe('orchestration decomposition failures', () => {
  let db: Database.Database;
  let taskRepo: TaskRepository;

  beforeEach(() => {
    db = createDb();
    taskRepo = new TaskRepository(db);
  });

  it('records a retryable decomposition incident without hiding the queued task', async () => {
    const task = createEpic(taskRepo);
    db.prepare('UPDATE task_graph_nodes SET max_retries = ? WHERE id = ?').run(2, task.id);

    const loop = new OrchestrationLoop(db, failingProvider('temporary JSON parse failure'), {
      pollIntervalMs: 1000,
      defaultModel: 'mock-model',
      verbose: false,
    });

    await decomposeQueuedTasks(loop);

    const updated = taskRepo.getById(task.id)!;
    expect(updated.status).toBe('queued');
    expect(updated.retry_count).toBe(1);

    const incident = db.prepare('SELECT severity, failure_type, symptoms FROM incidents WHERE task_id = ?').get(task.id) as {
      severity: string;
      failure_type: string;
      symptoms: string;
    };
    expect(incident.failure_type).toBe('decomposition-failure');
    expect(incident.severity).toBe('medium');
    expect(JSON.parse(incident.symptoms).exhausted).toBe(false);
  });

  it('hands exhausted decomposition failures to healer with a high severity incident', async () => {
    const task = createEpic(taskRepo);
    db.prepare('UPDATE task_graph_nodes SET max_retries = ? WHERE id = ?').run(0, task.id);

    const loop = new OrchestrationLoop(db, failingProvider('provider timed out'), {
      pollIntervalMs: 1000,
      defaultModel: 'mock-model',
      verbose: false,
    });

    await decomposeQueuedTasks(loop);

    const updated = taskRepo.getById(task.id)!;
    expect(updated.status).toBe('awaiting-healer');
    expect(updated.retry_count).toBe(1);

    const incident = db.prepare('SELECT severity, failure_type, symptoms FROM incidents WHERE task_id = ?').get(task.id) as {
      severity: string;
      failure_type: string;
      symptoms: string;
    };
    expect(incident.failure_type).toBe('decomposition-failure');
    expect(incident.severity).toBe('high');
    expect(JSON.parse(incident.symptoms).exhausted).toBe(true);
  });
});