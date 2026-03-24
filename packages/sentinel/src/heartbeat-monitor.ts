import type Database from 'better-sqlite3';

export interface IncidentData {
  task_id: string;
  job_id: string;
  severity: string;
  failure_type: string;
  symptoms: Record<string, unknown>;
  context_summary: string;
  failure_history: unknown[];
}

export type IncidentCallback = (data: IncidentData) => void;

export interface StaleJob {
  id: string;
  task_id: string;
  worker_id: string | null;
  started_at: string | null;
  last_heartbeat: string | null;
}

export class HeartbeatMonitor {
  private pollTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private db: Database.Database,
    private staleThresholdSeconds: number = 30,
    private pollIntervalMs: number = 5000,
    private onIncident?: IncidentCallback
  ) {}

  start(): void {
    this.pollTimer = setInterval(() => {
      this.checkForStaleJobs();
    }, this.pollIntervalMs);
  }

  stop(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  checkForStaleJobs(): StaleJob[] {
    // Query per internal-interfaces.md §4 Read Contract
    const staleJobs = this.db
      .prepare(
        `SELECT j.id, j.task_id, j.worker_id, j.started_at,
                MAX(h.timestamp) as last_heartbeat
         FROM jobs j
         LEFT JOIN heartbeats h ON j.id = h.job_id
         WHERE j.status IN ('running', 'streaming')
         GROUP BY j.id
         HAVING last_heartbeat IS NULL
            OR last_heartbeat < datetime('now', '-${this.staleThresholdSeconds} seconds')`
      )
      .all() as StaleJob[];

    for (const staleJob of staleJobs) {
      // Mark as stalled
      this.db
        .prepare("UPDATE jobs SET status = 'stalled' WHERE id = ?")
        .run(staleJob.id);

      this.db
        .prepare("UPDATE task_graph_nodes SET status = 'stalled', updated_at = ? WHERE id = ?")
        .run(new Date().toISOString(), staleJob.task_id);

      // Create incident report
      this.onIncident?.({
        task_id: staleJob.task_id,
        job_id: staleJob.id,
        severity: 'high',
        failure_type: 'stalled-worker',
        symptoms: {
          last_heartbeat: staleJob.last_heartbeat,
          worker_id: staleJob.worker_id,
          stale_threshold_seconds: this.staleThresholdSeconds,
        },
        context_summary: `Worker ${staleJob.worker_id ?? 'unknown'} missed heartbeats for job ${staleJob.id}`,
        failure_history: [],
      });
    }

    return staleJobs;
  }
}
