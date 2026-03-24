import type { Job, JobStatus, FailureType } from '../types.js';
import { generateUlid } from '../ulid.js';
import type Database from 'better-sqlite3';

export class JobRepository {
  constructor(private db: Database.Database) {}

  create(params: {
    task_id: string;
    model: string;
    token_estimate: number;
    delegating_supervisor_id: string;
  }): Job {
    const id = generateUlid();
    const now = new Date().toISOString();

    this.db
      .prepare(
        `INSERT INTO jobs (id, task_id, model, status, token_estimate, delegating_supervisor_id, created_at)
         VALUES (?, ?, ?, 'queued', ?, ?, ?)`
      )
      .run(id, params.task_id, params.model, params.token_estimate, params.delegating_supervisor_id, now);

    return this.getById(id)!;
  }

  getById(id: string): Job | null {
    const row = this.db.prepare('SELECT * FROM jobs WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    return row ? this.mapRow(row) : null;
  }

  getByTask(taskId: string): Job[] {
    const rows = this.db.prepare('SELECT * FROM jobs WHERE task_id = ? ORDER BY created_at DESC').all(taskId) as Record<string, unknown>[];
    return rows.map(this.mapRow);
  }

  getByStatus(status: JobStatus): Job[] {
    const rows = this.db.prepare('SELECT * FROM jobs WHERE status = ? ORDER BY created_at').all(status) as Record<string, unknown>[];
    return rows.map(this.mapRow);
  }

  getActiveJobs(): Job[] {
    const rows = this.db
      .prepare("SELECT * FROM jobs WHERE status IN ('running', 'streaming', 'queued', 'preparing-context', 'awaiting-budget-check') ORDER BY created_at")
      .all() as Record<string, unknown>[];
    return rows.map(this.mapRow);
  }

  updateStatus(id: string, status: JobStatus): boolean {
    const result = this.db
      .prepare('UPDATE jobs SET status = ? WHERE id = ?')
      .run(status, id);
    return result.changes > 0;
  }

  setStarted(id: string, workerId: string): boolean {
    const now = new Date().toISOString();
    const result = this.db
      .prepare('UPDATE jobs SET worker_id = ?, started_at = ?, status = ? WHERE id = ?')
      .run(workerId, now, 'running', id);
    return result.changes > 0;
  }

  setCompleted(id: string, resultPath: string, tokensUsed: number): boolean {
    const result = this.db
      .prepare('UPDATE jobs SET status = ?, result_path = ?, tokens_used = ? WHERE id = ?')
      .run('completed', resultPath, tokensUsed, id);
    return result.changes > 0;
  }

  setFailed(id: string, failureType: FailureType): boolean {
    const result = this.db
      .prepare('UPDATE jobs SET status = ?, failure_type = ? WHERE id = ?')
      .run(`failed-${failureType}` as string, failureType, id);
    return result.changes > 0;
  }

  setCancelRequested(id: string, reason: string): boolean {
    const result = this.db
      .prepare('UPDATE jobs SET cancel_requested = 1, cancel_reason = ? WHERE id = ?')
      .run(reason, id);
    return result.changes > 0;
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
      delegating_supervisor_id: row.delegating_supervisor_id as string,
      created_at: row.created_at as string,
    };
  }
}
