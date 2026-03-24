import type Database from 'better-sqlite3';
import { killWorker, hardKillWorker } from '../worker/spawner.js';

export interface CancellationOptions {
  gracePeriodMs: number;
}

const DEFAULT_OPTIONS: CancellationOptions = {
  gracePeriodMs: 10_000, // 10 seconds grace period
};

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

  // Attempt soft kill
  const softKilled = killWorker(jobId);
  if (!softKilled) {
    // No active worker — just mark as cancelled
    db.prepare("UPDATE jobs SET status = 'cancelled' WHERE id = ?").run(jobId);
    return { cancelled: true, hardKilled: false };
  }

  // Wait for grace period
  await new Promise((resolve) => setTimeout(resolve, options.gracePeriodMs));

  // Check if still running
  const job = db.prepare('SELECT status FROM jobs WHERE id = ?').get(jobId) as { status: string } | undefined;
  if (job && job.status === 'cancel-requested') {
    // Hard kill
    hardKillWorker(jobId);
    db.prepare("UPDATE jobs SET status = 'cancelled' WHERE id = ?").run(jobId);
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
