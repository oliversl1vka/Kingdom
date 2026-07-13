import type { Job, JobStatus, FailureType } from '../types.js';
import { generateUlid } from '../ulid.js';
import { transitionStatus } from './state-transition.js';
import type Database from 'better-sqlite3';

/**
 * Terminal JobStatus for each FailureType. Most are simply `failed-<type>`, but
 * a review rejection lands on `failed-review` — there is no
 * `failed-review-rejection` status, so the naive `failed-${failureType}`
 * template produced an invalid status that violated the CHECK constraint.
 * Keyed by FailureType so adding a new failure type is a compile error until
 * it is mapped here.
 */
const FAILURE_TYPE_TO_JOB_STATUS: Record<FailureType, JobStatus> = {
  'token-overflow': 'failed-token-overflow',
  'timeout': 'failed-timeout',
  'runtime-crash': 'failed-runtime-crash',
  'invalid-output': 'failed-invalid-output',
  'review-rejection': 'failed-review',
};

export class JobRepository {
  constructor(private db: Database.Database) {}

  create(params: {
    task_id: string;
    model: string;
    token_estimate: number;
    delegating_supervisor_id: string;
    /** Job ID that spawned this retry/escalation — null for first attempts. */
    parent_job_id?: string | null;
  }): Job {
    const id = generateUlid();
    const now = new Date().toISOString();

    this.db
      .prepare(
        `INSERT INTO jobs (id, task_id, model, status, token_estimate, parent_job_id, delegating_supervisor_id, created_at)
         VALUES (?, ?, ?, 'queued', ?, ?, ?, ?)`
      )
      .run(id, params.task_id, params.model, params.token_estimate, params.parent_job_id ?? null, params.delegating_supervisor_id, now);

    return this.getById(id)!;
  }

  private stateLogPresent: boolean | null = null;
  private hasStateTransitionsTable(): boolean {
    if (this.stateLogPresent !== null) return this.stateLogPresent;
    const row = this.db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='state_transitions'")
      .get();
    this.stateLogPresent = !!row;
    return this.stateLogPresent;
  }

  // Phase 1: lease columns (migration 018) may be absent in partial-migration DBs.
  private leaseColsPresent: boolean | null = null;
  private hasLeaseColumns(): boolean {
    if (this.leaseColsPresent !== null) return this.leaseColsPresent;
    const cols = this.db.prepare('PRAGMA table_info(jobs)').all() as Array<{ name: string }>;
    this.leaseColsPresent = cols.some(c => c.name === 'lease_owner_pid');
    return this.leaseColsPresent;
  }

  getById(id: string): Job | null {
    const row = this.db.prepare('SELECT * FROM jobs WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    return row ? this.mapRow(row) : null;
  }

  getByTask(taskId: string): Job[] {
    const rows = this.db.prepare('SELECT * FROM jobs WHERE task_id = ? ORDER BY created_at DESC').all(taskId) as Record<string, unknown>[];
    return rows.map(this.mapRow);
  }

  /**
   * Phase 1 (P1.1): unguarded blind UPDATE replaced by an atomic status change
   * that also records an append-only state_transitions row in the same
   * transaction. Unguarded (no allowedFrom) to preserve prior behaviour — the
   * job lifecycle is enforced at the task layer; callers needing a guarded
   * transition use tryTransition().
   */
  updateStatus(id: string, status: JobStatus, reason?: string, actor?: string): boolean {
    return this.logTransition(id, status, () =>
      this.db.prepare('UPDATE jobs SET status = ? WHERE id = ?').run(status, id),
      reason, actor,
    );
  }

  /**
   * Atomic guarded transition for the dispatcher hot path: moves the job only
   * if it currently sits in one of `allowedFrom`. Returns false (no throw) on a
   * losing race. Records the state_transitions row in the same transaction.
   */
  tryTransition(id: string, allowedFrom: JobStatus[], status: JobStatus, reason?: string, actor?: string): boolean {
    const { changed } = transitionStatus(this.db, 'job', 'jobs', id, allowedFrom, status, { reason, actor });
    return changed;
  }

  setStarted(id: string, workerId: string, timeoutSeconds?: number): boolean {
    const now = new Date().toISOString();
    const timeoutAt = timeoutSeconds && timeoutSeconds > 0
      ? new Date(Date.now() + timeoutSeconds * 1000).toISOString()
      : null;
    return this.logTransition(id, 'running', () =>
      this.db
        .prepare('UPDATE jobs SET worker_id = ?, started_at = ?, timeout_at = ?, status = ? WHERE id = ?')
        .run(workerId, now, timeoutAt, 'running', id),
      'job started', workerId,
    );
  }

  /**
   * Record the lease owner PID + expiry for a running job. Renewed by the
   * heartbeat writer; consumed by the reconciler (P1.4) and cancellation (P1.3).
   */
  setLease(id: string, pid: number, leaseSeconds: number): boolean {
    if (!this.hasLeaseColumns()) return false;
    const expires = new Date(Date.now() + leaseSeconds * 1000).toISOString();
    const result = this.db
      .prepare('UPDATE jobs SET lease_owner_pid = ?, lease_expires_at = ? WHERE id = ?')
      .run(pid, expires, id);
    return result.changes > 0;
  }

  setCompleted(id: string, resultPath: string, tokensUsed: number): boolean {
    return this.logTransition(id, 'completed', () =>
      this.db
        .prepare('UPDATE jobs SET status = ?, result_path = ?, tokens_used = ? WHERE id = ?')
        .run('completed', resultPath, tokensUsed, id),
      'job completed',
    );
  }

  setFailed(id: string, failureType: FailureType): boolean {
    const status = FAILURE_TYPE_TO_JOB_STATUS[failureType];
    return this.logTransition(id, status, () =>
      this.db
        .prepare('UPDATE jobs SET status = ?, failure_type = ? WHERE id = ?')
        .run(status as string, failureType, id),
      `failed: ${failureType}`,
    );
  }

  /**
   * Run a column-rich UPDATE and, if it changed a row, append a
   * state_transitions row capturing the prior status — all in one transaction.
   */
  private logTransition(
    id: string,
    toStatus: JobStatus,
    update: () => { changes: number },
    reason?: string,
    actor?: string,
  ): boolean {
    const hasLog = this.hasStateTransitionsTable();
    const run = this.db.transaction(() => {
      const prior = hasLog
        ? (this.db.prepare('SELECT status FROM jobs WHERE id = ?').get(id) as { status: string } | undefined)
        : undefined;
      const result = update();
      if (result.changes > 0 && hasLog) {
        this.db.prepare(
          `INSERT INTO state_transitions (entity_type, entity_id, from_status, to_status, reason, actor, ts)
           VALUES ('job', ?, ?, ?, ?, ?, ?)`,
        ).run(id, prior?.status ?? null, toStatus, reason ?? null, actor ?? null, new Date().toISOString());
      }
      return result.changes > 0;
    });
    return run();
  }

  /** Mark a job as superseded by a newer retry/escalation job (forward lineage pointer). */
  markSuperseded(id: string, supersededById: string): void {
    this.db.prepare('UPDATE jobs SET superseded_by = ? WHERE id = ?').run(supersededById, id);
  }

  /** Get queued jobs ordered by task priority (high → low), then creation time (old → new).
   *  This ensures high-priority tasks are dispatched first rather than FIFO-only ordering. */
  getQueuedByPriority(): Job[] {
    const rows = this.db.prepare(`
      SELECT j.*
      FROM jobs j
      JOIN task_graph_nodes t ON j.task_id = t.id
      WHERE j.status = 'queued'
      ORDER BY t.priority DESC, j.created_at ASC
    `).all() as Record<string, unknown>[];
    return rows.map(this.mapRow);
  }

  updateHeartbeat(id: string): boolean {
    const result = this.db
      .prepare('UPDATE jobs SET heartbeat_at = ? WHERE id = ?')
      .run(new Date().toISOString(), id);
    return result.changes > 0;
  }

  private mapRow(row: Record<string, unknown>): Job {
    return {
      id: row.id as string,
      task_id: row.task_id as string,
      worker_id: row.worker_id as string | null,
      model: row.model as string,
      status: row.status as JobStatus,
      started_at: row.started_at as string | null,
      heartbeat_at: row.heartbeat_at as string | null,
      timeout_at: row.timeout_at as string | null,
      cancel_requested: row.cancel_requested === 1,
      cancel_reason: row.cancel_reason as string | null,
      result_path: row.result_path as string | null,
      failure_type: row.failure_type as FailureType | null,
      token_estimate: row.token_estimate as number,
      tokens_used: row.tokens_used as number | null,
      parent_job_id: row.parent_job_id as string | null,
      superseded_by: row.superseded_by as string | null,
      lease_owner_pid: (row.lease_owner_pid ?? null) as number | null,
      lease_expires_at: (row.lease_expires_at ?? null) as string | null,
      delegating_supervisor_id: row.delegating_supervisor_id as string,
      created_at: row.created_at as string,
    };
  }
}
