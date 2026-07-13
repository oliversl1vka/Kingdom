import type { TaskGraphNode, TaskStatus, TaskLevel, TaskType, AgentTier, TaskVerification } from '../types.js';
import { generateUlid } from '../ulid.js';
import { transitionStatus } from './state-transition.js';
import type Database from 'better-sqlite3';

const VALID_TRANSITIONS: Record<string, string[]> = {
  'queued': ['preparing-context', 'awaiting-healer', 'cancelled'],
  'preparing-context': ['awaiting-budget-check', 'cancelled'],
  'awaiting-budget-check': ['budget-rejected', 'running', 'cancelled'],
  'budget-rejected': ['queued', 'cancelled'],
  'running': ['streaming', 'stalled', 'cancel-requested', 'completed', 'completed-with-warnings', 'failed-token-overflow', 'failed-timeout', 'failed-runtime-crash', 'failed-invalid-output', 'failed-review'],
  'streaming': ['stalled', 'cancel-requested', 'completed', 'completed-with-warnings', 'failed-token-overflow', 'failed-timeout', 'failed-runtime-crash', 'failed-invalid-output'],
  'stalled': ['running', 'cancelled', 'failed-timeout', 'superseded', 'needs-human'],
  'cancel-requested': ['cancelled'],
  'cancelled': [],
  'completed': [],
  'completed-with-warnings': [],
  'failed-token-overflow': ['retrying', 'awaiting-healer', 'superseded', 'needs-human'],
  'failed-timeout': ['retrying', 'awaiting-healer', 'superseded', 'needs-human'],
  'failed-runtime-crash': ['retrying', 'awaiting-healer', 'superseded', 'needs-human'],
  'failed-invalid-output': ['retrying', 'awaiting-healer', 'superseded', 'needs-human'],
  'failed-review': ['retrying', 'awaiting-healer', 'superseded', 'needs-human'],
  'retrying': ['running'],
  'awaiting-healer': ['awaiting-redesign', 'retrying', 'superseded', 'needs-human'],
  'awaiting-redesign': [],
  'superseded': [],
  'needs-human': [],
};

export class TaskRepository {
  private dependencyTablePresent: boolean | null = null;
  // PHASE3 (P3.2): cached check for the optional `verification` column so older
  // DBs (pre-migration 025) keep working without throwing on the missing column.
  private verificationColumnPresent: boolean | null = null;

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
    /** Task IDs that must complete before this task can be dispatched. */
    depends_on?: string[];
    /** PHASE3 (P3.2): optional per-task execution-based verification contract. */
    verification?: TaskVerification | null;
    token_budget_estimate?: number;
  }): TaskGraphNode {
    const id = generateUlid();
    const now = new Date().toISOString();

    this.db
      .prepare(
        `INSERT INTO task_graph_nodes (id, parent_id, objective_id, level, title, description, priority, type, assigned_tier, reviewer_tier, acceptance_criteria, context_refs, depends_on, token_budget_estimate, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'queued', ?, ?)`
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
        JSON.stringify([]),
        params.token_budget_estimate ?? 0,
        now,
        now
      );

    if (params.depends_on?.length) {
      this.updateDependsOn(id, params.depends_on);
    }

    // PHASE3 (P3.2): persist the verification contract when supplied and the
    // column exists. Done as a separate write so the base INSERT stays valid
    // on pre-025 databases.
    if (params.verification && this.hasVerificationColumn()) {
      this.db
        .prepare('UPDATE task_graph_nodes SET verification = ?, updated_at = ? WHERE id = ?')
        .run(JSON.stringify(params.verification), new Date().toISOString(), id);
    }

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
    return rows.map((row) => this.mapRow(row));
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
    return rows.map((row) => this.mapRow(row));
  }

  /**
   * Atomically transition a task to `newStatus`. Phase 1 (P1.1): a single
   * guarded UPDATE … WHERE status IN (<allowedFrom>) plus an append-only
   * state_transitions row in the same transaction.
   *
   * Behaviour is preserved for callers that rely on a throw for a genuinely
   * illegal transition (the current status has no edge to newStatus). A *race*
   * (status legal in the abstract but the row already moved on, e.g. a
   * concurrent terminal transition) returns false instead of throwing, so
   * concurrent paths converge without crashing the process.
   */
  updateStatus(id: string, newStatus: TaskStatus, reason?: string, actor?: string): boolean {
    // Compute every legal "from" state that can transition TO newStatus.
    // We invert VALID_TRANSITIONS so the guarded UPDATE covers all valid
    // current states -- no pre-read of `current.status`, no TOCTOU window.
    const allowedFrom = Object.entries(VALID_TRANSITIONS)
      .filter(([, targets]) => targets.includes(newStatus))
      .map(([from]) => from);

    if (allowedFrom.length === 0) {
      // No valid transition to this status exists anywhere in the graph.
      throw new Error(
        `No valid transition to task status: ${newStatus}`
      );
    }

    const { changed } = transitionStatus(
      this.db, 'task', 'task_graph_nodes', id, allowedFrom, newStatus,
      { reason, actor, touchUpdatedAt: true },
    );
    return changed;
  }

  /**
   * Non-throwing atomic transition: returns true iff the row was in one of
   * `allowedFrom` and moved to `newStatus`. Use this on the dispatcher hot path
   * where a losing race must NOT throw (replaces the old swallowed try/catch).
   */
  tryTransition(id: string, allowedFrom: TaskStatus[], newStatus: TaskStatus, reason?: string, actor?: string): boolean {
    const { changed } = transitionStatus(
      this.db, 'task', 'task_graph_nodes', id, allowedFrom, newStatus,
      { reason, actor, touchUpdatedAt: true },
    );
    return changed;
  }

  updateDependsOn(id: string, dependsOn: string[]): void {
    const uniqueDependsOn = [...new Set(dependsOn)].filter(Boolean);
    this.validateDependencies(id, uniqueDependsOn);

    const now = new Date().toISOString();
    const updateLegacyColumn = () => {
      this.db
        .prepare('UPDATE task_graph_nodes SET depends_on = ?, updated_at = ? WHERE id = ?')
        .run(JSON.stringify(uniqueDependsOn), now, id);
    };

    if (!this.hasDependencyTable()) {
      updateLegacyColumn();
      return;
    }

    const replace = this.db.transaction(() => {
      this.db.prepare('DELETE FROM task_dependencies WHERE task_id = ?').run(id);
      const insert = this.db.prepare(
        'INSERT INTO task_dependencies (task_id, depends_on_task_id, created_at) VALUES (?, ?, ?)',
      );
      for (const depId of uniqueDependsOn) {
        insert.run(id, depId, now);
      }
      updateLegacyColumn();
    });

    replace();
  }

  getDependencies(id: string): string[] {
    if (this.hasDependencyTable()) {
      const rows = this.db
        .prepare('SELECT depends_on_task_id FROM task_dependencies WHERE task_id = ? ORDER BY created_at, depends_on_task_id')
        .all(id) as Array<{ depends_on_task_id: string }>;
      return rows.map((row) => row.depends_on_task_id);
    }

    const row = this.db.prepare('SELECT depends_on FROM task_graph_nodes WHERE id = ?').get(id) as { depends_on?: string } | undefined;
    return this.parseLegacyDependsOn(row?.depends_on);
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
      depends_on: this.getDependsOnForRow(row),
      verification: parseVerification(row.verification),
      token_budget_estimate: row.token_budget_estimate as number,
      status: row.status as TaskStatus,
      retry_count: row.retry_count as number,
      max_retries: row.max_retries as number,
      artifact_paths: JSON.parse(row.artifact_paths as string),
      created_at: row.created_at as string,
      updated_at: row.updated_at as string,
    };
  }

  private hasDependencyTable(): boolean {
    if (this.dependencyTablePresent !== null) return this.dependencyTablePresent;
    const row = this.db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'task_dependencies'")
      .get();
    this.dependencyTablePresent = !!row;
    return this.dependencyTablePresent;
  }

  // PHASE3 (P3.2): detect the optional `verification` column (migration 025).
  private hasVerificationColumn(): boolean {
    if (this.verificationColumnPresent !== null) return this.verificationColumnPresent;
    const cols = this.db.prepare("PRAGMA table_info('task_graph_nodes')").all() as Array<{ name: string }>;
    this.verificationColumnPresent = cols.some((c) => c.name === 'verification');
    return this.verificationColumnPresent;
  }

  private getDependsOnForRow(row: Record<string, unknown>): string[] {
    if (this.hasDependencyTable()) {
      const rows = this.db
        .prepare('SELECT depends_on_task_id FROM task_dependencies WHERE task_id = ? ORDER BY created_at, depends_on_task_id')
        .all(row.id as string) as Array<{ depends_on_task_id: string }>;
      return rows.map((dep) => dep.depends_on_task_id);
    }

    return this.parseLegacyDependsOn(row.depends_on as string | undefined);
  }

  private parseLegacyDependsOn(value: string | undefined): string[] {
    if (!value) return [];
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed.map(String) : [];
    } catch {
      return [];
    }
  }

  /**
   * PHASE3 (P3.1): mark an entire subtree (the root + all descendants) as
   * `superseded` — used by the replanner when a node is re-decomposed. This is
   * an additive roll-up: it does NOT touch `updateStatus`' transition rules for
   * other callers; it force-sets `superseded` for the whole subtree in one
   * transaction (the replacement children carry the work forward). Already-
   * terminal nodes (completed/cancelled/needs-human) are left untouched so we
   * never rewrite finished history.
   *
   * Returns the number of nodes superseded.
   */
  supersedeSubtree(rootId: string, reason?: string): number {
    const root = this.getById(rootId);
    if (!root) return 0;

    const subtree = [root, ...this.getDescendants(rootId)];
    const LEAVE_ALONE = new Set<TaskStatus>([
      'completed', 'completed-with-warnings', 'cancelled', 'superseded', 'needs-human', 'awaiting-redesign',
    ]);

    const now = new Date().toISOString();
    const note = reason ? ` [superseded: ${reason}]` : ' [superseded]';

    const run = this.db.transaction(() => {
      let changed = 0;
      const stmt = this.db.prepare('UPDATE task_graph_nodes SET status = ?, updated_at = ? WHERE id = ?');
      const noteStmt = this.db.prepare(
        "UPDATE task_graph_nodes SET description = COALESCE(description, '') || ? WHERE id = ?",
      );
      for (const node of subtree) {
        if (LEAVE_ALONE.has(node.status)) continue;
        stmt.run('superseded', now, node.id);
        if (reason) noteStmt.run(note, node.id);
        changed++;
      }
      return changed;
    });

    return run();
  }

  /**
   * PHASE3 (P3.1): dependency validation relaxed to a TRUE DAG within an
   * objective. Cross-subtree edges (different parents, same objective) are now
   * allowed — the previous "must share parent" rule made the graph strictly a
   * forest of sibling chains and threw on legitimate cross-cutting ordering.
   *
   * Still rejected:
   *   - self-dependency
   *   - dependency on a missing task
   *   - dependency that crosses objective boundaries
   *   - any edge that would introduce a CYCLE (acyclicity is no longer implied
   *     by the tree structure once cross-subtree edges are allowed, so we check
   *     it explicitly with the recursive-CTE descendant machinery).
   */
  private validateDependencies(id: string, dependsOn: string[]): void {
    const task = this.getById(id);
    if (!task) throw new Error(`Task not found: ${id}`);

    for (const depId of dependsOn) {
      if (depId === id) throw new Error('Task cannot depend on itself');
      const dep = this.getById(depId);
      if (!dep) throw new Error(`Dependency task not found: ${depId}`);
      if (dep.objective_id !== task.objective_id) {
        throw new Error(`Dependency ${depId} is outside the objective scope`);
      }
      if (this.wouldCreateCycle(id, depId)) {
        throw new Error(`Dependency ${depId} would introduce a cycle in the task graph`);
      }
    }
  }

  /**
   * PHASE3 (P3.1): would adding edge `taskId depends_on depId` create a cycle?
   * A cycle forms iff `taskId` is already (transitively) a dependency of
   * `depId` — i.e. depId can reach taskId by following depends_on edges. We
   * walk the existing dependency graph (join table when present, else the
   * legacy JSON column) with a recursive CTE / BFS.
   */
  private wouldCreateCycle(taskId: string, depId: string): boolean {
    if (taskId === depId) return true;

    if (this.hasDependencyTable()) {
      const row = this.db
        .prepare(
          `WITH RECURSIVE reach(id) AS (
             SELECT depends_on_task_id FROM task_dependencies WHERE task_id = ?
             UNION
             SELECT td.depends_on_task_id
             FROM task_dependencies td
             JOIN reach r ON td.task_id = r.id
           )
           SELECT 1 AS hit FROM reach WHERE id = ? LIMIT 1`,
        )
        .get(depId, taskId) as { hit: number } | undefined;
      return !!row;
    }

    // Legacy JSON-column fallback: BFS over depends_on arrays.
    const seen = new Set<string>();
    const queue = this.getDependencies(depId);
    while (queue.length > 0) {
      const next = queue.shift()!;
      if (next === taskId) return true;
      if (seen.has(next)) continue;
      seen.add(next);
      queue.push(...this.getDependencies(next));
    }
    return false;
  }
}

/**
 * PHASE3 (P3.2): parse the JSON `verification` column into a TaskVerification.
 * Tolerant: returns null on absent/invalid/empty values.
 */
function parseVerification(value: unknown): TaskVerification | null {
  if (value == null || value === '') return null;
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    if (parsed && typeof parsed === 'object' && typeof (parsed as TaskVerification).test_command === 'string') {
      const v = parsed as TaskVerification;
      return {
        test_command: v.test_command,
        probe: typeof v.probe === 'string' ? v.probe : undefined,
        timeout_seconds: Number.isFinite(v.timeout_seconds) ? Number(v.timeout_seconds) : undefined,
      };
    }
  } catch {
    /* ignore malformed */
  }
  return null;
}
