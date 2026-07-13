import type Database from 'better-sqlite3';
import { killWorker, hardKillWorker, killWorkerByPid } from '../worker/spawner.js';

export interface CancellationOptions {
  gracePeriodMs: number;
}

const DEFAULT_OPTIONS: CancellationOptions = {
  gracePeriodMs: 10_000, // 10 seconds grace period
};

/** Phase 1: lease columns (migration 018) may be absent in partial-migration DBs. */
function hasLeaseColumns(db: Database.Database): boolean {
  try {
    const cols = db.prepare('PRAGMA table_info(jobs)').all() as Array<{ name: string }>;
    return cols.some(c => c.name === 'lease_owner_pid');
  } catch {
    return false;
  }
}

/**
 * Phase 1 (P1.3): Soft-kill a job's worker. Prefers killing by the durable lease
 * PID (works across a dispatcher restart), and also signals the in-process
 * worker map as a fallback (covers in-process / same-process workers). Returns
 * true if EITHER path delivered a signal.
 */
function softKill(db: Database.Database, jobId: string, signal: NodeJS.Signals): boolean {
  let killed = false;
  if (hasLeaseColumns(db)) {
    const row = db.prepare('SELECT lease_owner_pid FROM jobs WHERE id = ?').get(jobId) as { lease_owner_pid: number | null } | undefined;
    if (row?.lease_owner_pid != null) {
      killed = killWorkerByPid(row.lease_owner_pid, signal) || killed;
    }
  }
  // Fall back / also signal an in-process worker handle if present.
  const inProc = signal === 'SIGKILL' ? hardKillWorker(jobId) : killWorker(jobId, signal);
  return killed || inProc;
}

/** Mark a job cancelled, clearing the lease too when those columns exist. */
function markCancelled(db: Database.Database, jobId: string): void {
  if (hasLeaseColumns(db)) {
    db.prepare("UPDATE jobs SET status = 'cancelled', lease_owner_pid = NULL, lease_expires_at = NULL WHERE id = ?").run(jobId);
  } else {
    db.prepare("UPDATE jobs SET status = 'cancelled' WHERE id = ?").run(jobId);
  }
}

export async function cancelJob(
  db: Database.Database,
  jobId: string,
  reason: string,
  options: CancellationOptions = DEFAULT_OPTIONS
): Promise<{ cancelled: boolean; hardKilled: boolean }> {
  // Set cancel_requested flag
  const result = db
    .prepare('UPDATE jobs SET cancel_requested = 1, cancel_reason = ?, status = ? WHERE id = ?')
    .run(reason, 'cancel-requested', jobId);

  if (result.changes === 0) {
    return { cancelled: false, hardKilled: false };
  }

  // Attempt soft kill (by lease PID, then in-process handle)
  const softKilled = softKill(db, jobId, 'SIGTERM');
  if (!softKilled) {
    // No live worker process — just mark as cancelled
    markCancelled(db, jobId);
    return { cancelled: true, hardKilled: false };
  }

  // Wait for grace period
  await new Promise((resolve) => setTimeout(resolve, options.gracePeriodMs));

  // Check if still running
  const job = db.prepare('SELECT status FROM jobs WHERE id = ?').get(jobId) as { status: string } | undefined;
  if (job && job.status === 'cancel-requested') {
    // Hard kill by PID + in-process handle
    softKill(db, jobId, 'SIGKILL');
    markCancelled(db, jobId);
    return { cancelled: true, hardKilled: true };
  }

  return { cancelled: true, hardKilled: false };
}

export function cascadeCancel(
  db: Database.Database,
  taskId: string,
  reason: string
): { cancelledJobs: number; cancelledTasks: number } {
  // Get all descendant task IDs
  const descendants = db
    .prepare(
      `WITH RECURSIVE desc AS (
        SELECT id FROM task_graph_nodes WHERE id = ?
        UNION ALL
        SELECT t.id FROM task_graph_nodes t JOIN desc d ON t.parent_id = d.id
      )
      SELECT id FROM desc`
    )
    .all(taskId) as Array<{ id: string }>;

  const taskIds = descendants.map((d) => d.id);

  let cancelledJobs = 0;
  let cancelledTasks = 0;

  for (const tid of taskIds) {
    // Cancel active jobs for this task
    const jobResult = db
      .prepare(
        "UPDATE jobs SET cancel_requested = 1, cancel_reason = ?, status = 'cancel-requested' WHERE task_id = ? AND status IN ('queued', 'running', 'streaming', 'preparing-context', 'awaiting-budget-check')"
      )
      .run(reason, tid);
    cancelledJobs += jobResult.changes;

    // Cancel the task itself
    const taskResult = db
      .prepare(
        "UPDATE task_graph_nodes SET status = 'cancelled', updated_at = ? WHERE id = ? AND status NOT IN ('completed', 'completed-with-warnings', 'cancelled')"
      )
      .run(new Date().toISOString(), tid);
    cancelledTasks += taskResult.changes;
  }

  return { cancelledJobs, cancelledTasks };
}
