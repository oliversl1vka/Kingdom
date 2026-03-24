import type Database from 'better-sqlite3';
import type { HeartbeatStatus } from '../types.js';

export class HeartbeatWriter {
  private intervalId: ReturnType<typeof setInterval> | null = null;

  constructor(
    private db: Database.Database,
    private jobId: string,
    private workerId: string
  ) {}

  start(): void {
    // Write initial heartbeat
    this.writeHeartbeat('healthy', null, 0);

    // Schedule every 10 seconds per internal-interfaces.md §4
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

    this.db
      .prepare(
        `INSERT INTO heartbeats (job_id, worker_id, timestamp, status, progress, tokens_generated)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(this.jobId, this.workerId, now, status, progress, tokensGenerated);

    // Also update the job's heartbeat_at
    this.db
      .prepare('UPDATE jobs SET heartbeat_at = ? WHERE id = ?')
      .run(now, this.jobId);
  }
}
