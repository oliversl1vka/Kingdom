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
  assigned_tier?: string | null;
}

export interface HeartbeatMonitorOptions {
  staleThresholdSeconds?: number;
  staleThresholdPerTier?: Record<string, number>;
}

export class HeartbeatMonitor {
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private staleThresholdSeconds: number;
  private staleThresholdPerTier: Record<string, number>;

  constructor(
    private db: Database.Database,
    thresholdOrOptions: number | HeartbeatMonitorOptions = 90,
    private pollIntervalMs: number = 5000,
    private onIncident?: IncidentCallback
  ) {
    if (typeof thresholdOrOptions === 'number') {
      this.staleThresholdSeconds = thresholdOrOptions;
      this.staleThresholdPerTier = {};
    } else {
      this.staleThresholdSeconds = thresholdOrOptions.staleThresholdSeconds ?? 90;
      this.staleThresholdPerTier = thresholdOrOptions.staleThresholdPerTier ?? {};
    }
  }

  /** Returns the stale threshold (seconds) for a given agent tier. */
  private getThresholdForTier(tier: string | null | undefined): number {
    if (tier && this.staleThresholdPerTier[tier] !== undefined) {
      return this.staleThresholdPerTier[tier];
    }
    return this.staleThresholdSeconds;
  }

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
    // Query all running jobs, joining task tier so we can apply per-tier thresholds.
    // We filter in JS rather than SQL since each tier can have a different threshold.
    const runningJobs = this.db
      .prepare(
        `SELECT j.id, j.task_id, j.worker_id, j.started_at,
                t.assigned_tier,
                MAX(h.timestamp) as last_heartbeat
         FROM jobs j
         LEFT JOIN task_graph_nodes t ON j.task_id = t.id
         LEFT JOIN heartbeats h ON j.id = h.job_id
         WHERE j.status IN ('running', 'streaming')
         GROUP BY j.id`
      )
      .all() as StaleJob[];

    const now = Date.now();
    const staleJobs = runningJobs.filter(job => {
      const thresholdMs = this.getThresholdForTier(job.assigned_tier) * 1000;
      if (!job.last_heartbeat) {
        // No heartbeat yet — use started_at as a grace period so a job
        // started 50 ms ago is not immediately classified as stale.
        if (!job.started_at) return true; // truly orphaned record
        const startedTime = new Date(job.started_at).getTime();
        return now - startedTime > thresholdMs;
      }
      const lastBeat = new Date(job.last_heartbeat).getTime();
      return now - lastBeat > thresholdMs;
    });

    for (const staleJob of staleJobs) {
      // Mark as stalled
      this.db
        .prepare("UPDATE jobs SET status = 'stalled' WHERE id = ?")
        .run(staleJob.id);

      this.db
        .prepare("UPDATE task_graph_nodes SET status = 'stalled', updated_at = ? WHERE id = ?")
        .run(new Date().toISOString(), staleJob.task_id);

      // Create incident report
      const threshold = this.getThresholdForTier(staleJob.assigned_tier);
      this.onIncident?.({
        task_id: staleJob.task_id,
        job_id: staleJob.id,
        severity: 'high',
        failure_type: 'stalled-worker',
        symptoms: {
          last_heartbeat: staleJob.last_heartbeat,
          worker_id: staleJob.worker_id,
          assigned_tier: staleJob.assigned_tier,
          stale_threshold_seconds: threshold,
        },
        context_summary: `Worker ${staleJob.worker_id ?? 'unknown'} missed heartbeats for job ${staleJob.id} (tier: ${staleJob.assigned_tier ?? 'unknown'}, threshold: ${threshold}s)`,
        failure_history: [],
      });
    }

    return staleJobs;
  }
}
