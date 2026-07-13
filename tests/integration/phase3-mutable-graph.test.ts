import { beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { OrchestrationLoop, TaskRepository, type ProviderAdapter, type TaskGraphNode } from '@kingdomos/core';

const MIGRATIONS_DIR = join(__dirname, '..', '..', 'packages', 'core', 'migrations');
// PHASE3 (P3.1): include 027 (relaxed scope trigger) + 028 (replan budget).
const MIGRATIONS = [
  '001_initial.sql', '006_depends_on.sql', '007_parent_job_id.sql',
  '013_task_dependencies.sql', '027_relax_dependency_scope.sql', '028_objective_replan_budget.sql',
];

function createDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  for (const m of MIGRATIONS) db.exec(readFileSync(join(MIGRATIONS_DIR, m), 'utf-8'));
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO projects (id, name, repository_path, created_at, updated_at) VALUES (?,?,?,?,?)`)
    .run('proj', 'P', process.cwd(), now, now);
  db.prepare(`INSERT INTO objectives (id, project_id, description, priority, status, acceptance_criteria, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)`)
    .run('obj', 'proj', 'Build a thing', 5, 'active', '[]', now, now);
  return db;
}

function task(taskRepo: TaskRepository, title: string, parentId: string | null, level: 'epic' | 'task' | 'subtask'): TaskGraphNode {
  return taskRepo.create({
    parent_id: parentId, objective_id: 'obj', level, title, description: title, type: 'code',
    assigned_tier: level === 'subtask' ? 'squire' : 'knight', reviewer_tier: 'judge', acceptance_criteria: ['done'], context_refs: [],
  });
}

describe('PHASE3 (P3.1) supersedeSubtree', () => {
  let db: Database.Database;
  let taskRepo: TaskRepository;
  beforeEach(() => { db = createDb(); taskRepo = new TaskRepository(db); });

  it('rolls up a whole subtree to superseded, leaving terminal nodes untouched', () => {
    const root = task(taskRepo, 'Root', null, 'task');
    const a = task(taskRepo, 'A', root.id, 'subtask');
    const b = task(taskRepo, 'B', root.id, 'subtask');
    // Drive b to completed (terminal) — must be left alone.
    taskRepo.updateStatus(b.id, 'preparing-context');
    taskRepo.updateStatus(b.id, 'awaiting-budget-check');
    taskRepo.updateStatus(b.id, 'running');
    taskRepo.updateStatus(b.id, 'completed');

    const n = taskRepo.supersedeSubtree(root.id, 'replanning');

    expect(taskRepo.getById(root.id)?.status).toBe('superseded');
    expect(taskRepo.getById(a.id)?.status).toBe('superseded');
    expect(taskRepo.getById(b.id)?.status).toBe('completed'); // terminal preserved
    expect(n).toBe(2); // root + a
  });
});

describe('PHASE3 (P3.1) replan phase budget guard', () => {
  let db: Database.Database;
  let taskRepo: TaskRepository;
  beforeEach(() => { db = createDb(); taskRepo = new TaskRepository(db); });

  function stuckParentWithChild(): { parent: TaskGraphNode; child: TaskGraphNode } {
    const parent = task(taskRepo, 'Parent', null, 'task');
    const child = task(taskRepo, 'Child', parent.id, 'subtask');
    taskRepo.updateStatus(child.id, 'awaiting-healer');
    return { parent, child };
  }

  function loopWith(provider: ProviderAdapter, budget: number): OrchestrationLoop {
    return new OrchestrationLoop(db, provider, {
      pollIntervalMs: 1000, defaultModel: 'm', verbose: false, replanBudgetPerObjective: budget,
    });
  }

  const planProvider = (): ProviderAdapter => ({
    provider_id: 'mock',
    healthCheck: vi.fn(async () => ({ status: 'healthy' })),
    complete: vi.fn(async () => ({
      content: JSON.stringify({ subtasks: [{ title: 'Replan child', description: 'd', type: 'code', acceptance_criteria: ['x'], context_refs: [], depends_on_indices: [], token_budget_estimate: 100 }] }),
      prompt_tokens: 1, completion_tokens: 1, total_tokens: 2, finish_reason: 'stop',
    })),
  });

  async function replan(loop: OrchestrationLoop): Promise<void> {
    await (loop as unknown as { replanStuckSubtrees(): Promise<void> }).replanStuckSubtrees();
  }

  it('replans a stuck subtree and increments replan_count', async () => {
    const { parent } = stuckParentWithChild();
    const loop = loopWith(planProvider(), 2);
    await replan(loop);

    expect((db.prepare('SELECT replan_count FROM objectives WHERE id = ?').get('obj') as { replan_count: number }).replan_count).toBe(1);
    // Old stuck child is superseded; a fresh child exists.
    const children = taskRepo.getChildren(parent.id);
    expect(children.some(c => c.status === 'superseded')).toBe(true);
    expect(children.some(c => c.title === 'Replan child' && c.status === 'queued')).toBe(true);
  });

  it('stops replanning once the budget is exhausted and moves the stuck child to awaiting-redesign', async () => {
    const { child } = stuckParentWithChild();
    // Pre-spend the budget.
    db.prepare('UPDATE objectives SET replan_count = 2 WHERE id = ?').run('obj');
    const provider = planProvider();
    const loop = loopWith(provider, 2);
    await replan(loop);

    expect(provider.complete).not.toHaveBeenCalled(); // no decomposition attempted
    expect(taskRepo.getById(child.id)?.status).toBe('awaiting-redesign');
  });

  it('replanBudget 0 disables the phase entirely', async () => {
    const { child } = stuckParentWithChild();
    const provider = planProvider();
    const loop = loopWith(provider, 0);
    await replan(loop);
    expect(provider.complete).not.toHaveBeenCalled();
    expect(taskRepo.getById(child.id)?.status).toBe('awaiting-healer'); // untouched
  });
});
