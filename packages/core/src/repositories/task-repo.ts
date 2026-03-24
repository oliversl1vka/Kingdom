import type { TaskGraphNode, TaskStatus, TaskLevel, TaskType, AgentTier } from '../types.js';
import { generateUlid } from '../ulid.js';
import type Database from 'better-sqlite3';

const VALID_TRANSITIONS: Record<string, string[]> = {
  'queued': ['preparing-context', 'cancelled'],
  'preparing-context': ['awaiting-budget-check', 'cancelled'],
  'awaiting-budget-check': ['budget-rejected', 'running', 'cancelled'],
  'budget-rejected': ['queued', 'cancelled'],
  'running': ['streaming', 'stalled', 'cancel-requested', 'completed', 'completed-with-warnings', 'failed-token-overflow', 'failed-timeout', 'failed-runtime-crash', 'failed-invalid-output', 'failed-review'],
  'streaming': ['stalled', 'cancel-requested', 'completed', 'completed-with-warnings', 'failed-token-overflow', 'failed-timeout', 'failed-runtime-crash', 'failed-invalid-output'],
  'stalled': ['running', 'cancelled', 'failed-timeout'],
  'cancel-requested': ['cancelled'],
  'cancelled': [],
  'completed': [],
  'completed-with-warnings': [],
  'failed-token-overflow': ['retrying', 'awaiting-healer'],
  'failed-timeout': ['retrying', 'awaiting-healer'],
  'failed-runtime-crash': ['retrying', 'awaiting-healer'],
  'failed-invalid-output': ['retrying', 'awaiting-healer'],
  'failed-review': ['retrying', 'awaiting-healer'],
  'retrying': ['running'],
  'awaiting-healer': ['awaiting-redesign', 'retrying'],
  'awaiting-redesign': [],
};

export class TaskRepository {
  constructor(private db: Database.Database) {}

  create(params: {
    parent_id?: string | null;
    objective_id: string;
    level: TaskLevel;
    title: string;
    description?: string;
    priority?: number;
    type?: TaskType;
    assigned_tier: AgentTier;
    reviewer_tier: AgentTier;
    acceptance_criteria: string[];
    context_refs?: Array<{ file: string; startLine: number; endLine: number }>;
    token_budget_estimate?: number;
  }): TaskGraphNode {
    const id = generateUlid();
    const now = new Date().toISOString();

    this.db
      .prepare(
        `INSERT INTO task_graph_nodes (id, parent_id, objective_id, level, title, description, priority, type, assigned_tier, reviewer_tier, acceptance_criteria, context_refs, token_budget_estimate, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'queued', ?, ?)`
      )
      .run(
        id,
        params.parent_id ?? null,
        params.objective_id,
        params.level,
        params.title,
        params.description ?? null,
        params.priority ?? 5,
        params.type ?? 'code',
        params.assigned_tier,
        params.reviewer_tier,
        JSON.stringify(params.acceptance_criteria),
        JSON.stringify(params.context_refs ?? []),
        params.token_budget_estimate ?? 0,
        now,
        now
      );

    return this.getById(id)!;
  }

  getById(id: string): TaskGraphNode | null {
    const row = this.db.prepare('SELECT * FROM task_graph_nodes WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    return row ? this.mapRow(row) : null;
  }

  getChildren(parentId: string): TaskGraphNode[] {
    const rows = this.db
      .prepare('SELECT * FROM task_graph_nodes WHERE parent_id = ? ORDER BY priority DESC')
      .all(parentId) as Record<string, unknown>[];
    return rows.map(this.mapRow);
  }

  getByObjective(objectiveId: string): TaskGraphNode[] {
    const rows = this.db
      .prepare('SELECT * FROM task_graph_nodes WHERE objective_id = ? ORDER BY created_at')
      .all(objectiveId) as Record<string, unknown>[];
    return rows.map(this.mapRow);
  }

  getByStatus(status: TaskStatus): TaskGraphNode[] {
    const rows = this.db
      .prepare('SELECT * FROM task_graph_nodes WHERE status = ? ORDER BY priority DESC')
      .all(status) as Record<string, unknown>[];
    return rows.map(this.mapRow);
  }

  getDescendants(rootId: string): TaskGraphNode[] {
    const rows = this.db
      .prepare(
        `WITH RECURSIVE desc AS (
          SELECT * FROM task_graph_nodes WHERE parent_id = ?
          UNION ALL
          SELECT t.* FROM task_graph_nodes t JOIN desc d ON t.parent_id = d.id
        )
        SELECT * FROM desc ORDER BY level, priority DESC`
      )
      .all(rootId) as Record<string, unknown>[];
    return rows.map(this.mapRow);
  }

  updateStatus(id: string, newStatus: TaskStatus): boolean {
    const current = this.getById(id);
    if (!current) return false;

    const allowed = VALID_TRANSITIONS[current.status];
    if (!allowed || !allowed.includes(newStatus)) {
      throw new Error(
        `Invalid task status transition: ${current.status} → ${newStatus}`
      );
    }

    const result = this.db
      .prepare('UPDATE task_graph_nodes SET status = ?, updated_at = ? WHERE id = ?')
      .run(newStatus, new Date().toISOString(), id);
    return result.changes > 0;
  }

  incrementRetry(id: string): number {
    this.db
      .prepare('UPDATE task_graph_nodes SET retry_count = retry_count + 1, updated_at = ? WHERE id = ?')
      .run(new Date().toISOString(), id);
    const row = this.getById(id);
    return row?.retry_count ?? 0;
  }

  private mapRow(row: Record<string, unknown>): TaskGraphNode {
    return {
      id: row.id as string,
      parent_id: row.parent_id as string | null,
      objective_id: row.objective_id as string,
      level: row.level as TaskLevel,
      title: row.title as string,
      description: row.description as string | undefined,
      priority: row.priority as number,
      type: row.type as TaskType,
      assigned_tier: row.assigned_tier as AgentTier,
      reviewer_tier: row.reviewer_tier as AgentTier,
      acceptance_criteria: JSON.parse(row.acceptance_criteria as string),
      context_refs: JSON.parse(row.context_refs as string),
      token_budget_estimate: row.token_budget_estimate as number,
      status: row.status as TaskStatus,
      retry_count: row.retry_count as number,
      max_retries: row.max_retries as number,
      artifact_paths: JSON.parse(row.artifact_paths as string),
      created_at: row.created_at as string,
      updated_at: row.updated_at as string,
    };
  }
}
