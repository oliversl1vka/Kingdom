import type Database from 'better-sqlite3';

export interface RetentionConfig {
  retentionDays: number;
}

const DEFAULT_RETENTION_DAYS = 7;

export class RetentionScheduler {
  private config: RetentionConfig;

  constructor(
    private db: Database.Database,
    config?: Partial<RetentionConfig>
  ) {
    this.config = { retentionDays: config?.retentionDays ?? DEFAULT_RETENTION_DAYS };
  }

  /**
   * Purge detailed log records older than retention period.
   * Ensures crypt entry exists before purging task-related logs.
   */
  purge(): { logsDeleted: number; heartbeatsDeleted: number } {
    const cutoff = new Date(Date.now() - this.config.retentionDays * 24 * 60 * 60 * 1000).toISOString();

    // Delete old event logs (only if associated task has a crypt entry or is not task-related)
    const logResult = this.db
      .prepare(
        `DELETE FROM event_log
         WHERE timestamp < ?
         AND (task_id IS NULL
              OR task_id IN (SELECT task_id FROM crypt_entries))`
      )
      .run(cutoff);

    // Delete old heartbeats
    const heartbeatResult = this.db
      .prepare('DELETE FROM heartbeats WHERE timestamp < ?')
      .run(cutoff);

    return {
      logsDeleted: logResult.changes,
      heartbeatsDeleted: heartbeatResult.changes,
    };
  }
}
