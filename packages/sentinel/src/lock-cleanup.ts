import type Database from 'better-sqlite3';
import { FileLockManager } from '@kingdomos/core';

export interface StaleLock {
  file_path: string;
  owning_job_id: string;
  owning_supervisor_id: string;
  locked_at: string;
}

export class LockCleanup {
  private lockManager: FileLockManager;

  constructor(private db: Database.Database) {
    this.lockManager = new FileLockManager(db);
  }

  /**
   * Find locks where:
   * 1. Lock duration has exceeded max_duration_seconds
   * 2. The owning job's heartbeat is stale
   */
  findStaleLocks(): StaleLock[] {
    const expiredLocks = this.lockManager.getExpiredLocks();
    const staleLocks: StaleLock[] = [];

    for (const lock of expiredLocks) {
      // Check if the owning job is also stale
      const job = this.db
        .prepare("SELECT status FROM jobs WHERE id = ?")
        .get(lock.owning_job_id) as { status: string } | undefined;

      if (!job || job.status === 'stalled' || job.status === 'cancelled' || job.status.startsWith('failed-')) {
        staleLocks.push({
          file_path: lock.file_path,
          owning_job_id: lock.owning_job_id,
          owning_supervisor_id: lock.owning_supervisor_id,
          locked_at: lock.locked_at,
        });
      }
    }

    return staleLocks;
  }

  cleanupStaleLocks(): number {
    const staleLocks = this.findStaleLocks();
    let cleaned = 0;

    for (const lock of staleLocks) {
      if (this.lockManager.forceRelease(lock.file_path)) {
        cleaned++;
      }
    }

    return cleaned;
  }
}
