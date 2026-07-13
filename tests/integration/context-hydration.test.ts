import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { OrchestrationLoop, TaskRepository, type ContextRef, type ProviderAdapter, type TaskGraphNode } from '@kingdomos/core';

const MIGRATIONS_DIR = join(__dirname, '..', '..', 'packages', 'core', 'migrations');
const MIGRATIONS = ['001_initial.sql', '006_depends_on.sql', '007_parent_job_id.sql', '013_task_dependencies.sql'];

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
  ).run('obj', 'proj', 'Hydration objective', 5, 'active', JSON.stringify([]), now, now);
  return db;
}

function createLeafTask(taskRepo: TaskRepository, params: { title?: string; context_refs?: ContextRef[] } = {}): TaskGraphNode {
  return taskRepo.create({
    objective_id: 'obj',
    level: 'subtask',
    title: params.title ?? 'Implement doctor context wiring',
    description: 'Find the relevant CLI command and core orchestration files before creating a job.',
    type: 'code',
    assigned_tier: 'knight',
    reviewer_tier: 'judge',
    acceptance_criteria: ['context refs are hydrated before dispatch'],
    context_refs: params.context_refs ?? [],
    token_budget_estimate: 2048,
  });
}

async function createJobsForLeafTasks(loop: OrchestrationLoop): Promise<void> {
  await (loop as unknown as { createJobsForLeafTasks(): Promise<void> }).createJobsForLeafTasks();
}

describe('orchestration context hydration', () => {
  let db: Database.Database;
  let taskRepo: TaskRepository;

  beforeEach(() => {
    db = createDb();
    taskRepo = new TaskRepository(db);
  });

  afterEach(() => {
    db.close();
  });

  it('hydrates and persists task context refs before creating a job', async () => {
    const task = createLeafTask(taskRepo, {
      context_refs: [{ file: 'packages/cli/src/commands/doctor.ts', startLine: 10, endLine: 20 }],
    });
    const hydrateTaskContext = vi.fn(async () => [
      { file: 'packages/cli/src/commands/doctor.ts', startLine: 18, endLine: 40 },
      { file: 'packages/core/src/orchestration-loop.ts', startLine: 200, endLine: 260 },
      { file: '../escape.ts', startLine: 1, endLine: 1 },
    ]);
    const loop = new OrchestrationLoop(db, provider(), {
      pollIntervalMs: 1000,
      defaultModel: 'mock-model',
      verbose: false,
      contextHydrator: { hydrateTaskContext },
    });

    await createJobsForLeafTasks(loop);

    expect(hydrateTaskContext).toHaveBeenCalledWith(expect.objectContaining({ id: task.id, title: task.title }));
    expect(db.prepare('SELECT COUNT(*) as n FROM jobs WHERE task_id = ?').get(task.id)).toEqual({ n: 1 });
    expect(taskRepo.getById(task.id)?.context_refs).toEqual([
      { file: 'packages/cli/src/commands/doctor.ts', startLine: 10, endLine: 40 },
      { file: 'packages/core/src/orchestration-loop.ts', startLine: 200, endLine: 260 },
    ]);
  });

  it('creates the job with existing refs when hydration fails', async () => {
    const task = createLeafTask(taskRepo, {
      context_refs: [{ file: 'packages/core/src/types.ts', startLine: 1, endLine: 50 }],
    });
    const loop = new OrchestrationLoop(db, provider(), {
      pollIntervalMs: 1000,
      defaultModel: 'mock-model',
      verbose: false,
      contextHydrator: { hydrateTaskContext: vi.fn(async () => { throw new Error('context index unavailable'); }) },
    });

    await createJobsForLeafTasks(loop);

    expect(db.prepare('SELECT COUNT(*) as n FROM jobs WHERE task_id = ?').get(task.id)).toEqual({ n: 1 });
    expect(taskRepo.getById(task.id)?.context_refs).toEqual(task.context_refs);
  });
});
