import type Database from 'better-sqlite3';
import type { Statement } from 'better-sqlite3';
import type { HeartbeatStatus } from '../types.js';

// How often to update jobs.heartbeat_at (the sentinel reads this column).
// The heartbeats table INSERT happens every tick regardless for full history.
// Keeping the job-row update at 30s means 3x fewer writes on the hot jobs table
// while the sentinel's 90s stale threshold still has plenty of margin.
const JOB_ROW_UPDATE_INTERVAL_MS = 30_000;

export class HeartbeatWriter {
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private lastJobRowUpdate = 0;
  // Pre-prepared statements to avoid re-compiling SQL on every heartbeat write
  private insertStmt: Statement;
  private updateStmt: Statement;
  // PHASE1 (P1.3): optional lease renewal — extends jobs.lease_expires_at on each
  // job-row heartbeat so the reconciler doesn't flag a live worker as orphaned.
  private leaseSeconds: number | null = null;

  constructor(
    private db: Database.Database,
    private jobId: string,
    private workerId: string,
    leaseSeconds?: number
  ) {
    this.insertStmt = db.prepare(
      `INSERT INTO heartbeats (job_id, worker_id, timestamp, status, progress, tokens_generated)
       VALUES (?, ?, ?, ?, ?, ?)`
    );
    this.updateStmt = db.prepare('UPDATE jobs SET heartbeat_at = ? WHERE id = ?');
    // Only renew leases if the lease columns exist (migration 018) AND a window was given.
    let leaseColsPresent = false;
    try {
      const cols = db.prepare('PRAGMA table_info(jobs)').all() as Array<{ name: string }>;
      leaseColsPresent = cols.some(c => c.name === 'lease_expires_at');
    } catch { leaseColsPresent = false; }
    this.leaseSeconds = leaseColsPresent && leaseSeconds && leaseSeconds > 0 ? leaseSeconds : null;
  }

  start(): void {
    this.writeHeartbeat('healthy', null, 0);
    this.intervalId = setInterval(() => {
      this.writeHeartbeat('healthy', null, 0);
    }, 10_000);
  }

  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  update(status: HeartbeatStatus, progress: string | null, tokensGenerated: number): void {
    this.writeHeartbeat(status, progress, tokensGenerated);
  }

  private writeHeartbeat(status: HeartbeatStatus, progress: string | null, tokensGenerated: number): void {
    const now = new Date().toISOString();
    const nowMs = Date.now();

    // Always record to the heartbeats table (full history)
    this.insertStmt.run(this.jobId, this.workerId, now, status, progress, tokensGenerated);

    // Update jobs.heartbeat_at lazily — sentinel only needs it within its stale threshold.
    // Reducing this write from every 10s to every 30s cuts job-row contention by 3x.
    if (nowMs - this.lastJobRowUpdate >= JOB_ROW_UPDATE_INTERVAL_MS) {
      this.updateStmt.run(now, this.jobId);
      // PHASE1 (P1.3): renew the lease alongside the throttled job-row heartbeat.
      if (this.leaseSeconds !== null) {
        const expires = new Date(nowMs + this.leaseSeconds * 1000).toISOString();
        this.db.prepare('UPDATE jobs SET lease_expires_at = ? WHERE id = ?').run(expires, this.jobId);
      }
      this.lastJobRowUpdate = nowMs;
    }
  }
}
