import type Database from 'better-sqlite3';
import { FileLockManager, type FileLock } from '@kingdomos/core';
import type { HeartbeatMonitorOptions } from './heartbeat-monitor.js';

export interface StaleLock {
  file_path: string;
  owning_job_id: string;
  owning_supervisor_id: string;
  locked_at: string;
  reason: 'orphaned-owner' | 'terminal-owner' | 'stale-owner';
}

export class LockCleanup {
  private lockManager: FileLockManager;
  private staleThresholdSeconds: number;
  private staleThresholdPerTier: Record<string, number>;

  constructor(private db: Database.Database, thresholdOrOptions: number | HeartbeatMonitorOptions = 90) {
    this.lockManager = new FileLockManager(db);

    if (typeof thresholdOrOptions === 'number') {
      this.staleThresholdSeconds = thresholdOrOptions;
      this.staleThresholdPerTier = {};
    } else {
      this.staleThresholdSeconds = thresholdOrOptions.staleThresholdSeconds ?? 90;
      this.staleThresholdPerTier = thresholdOrOptions.staleThresholdPerTier ?? {};
    }
  }

  /**
   * Find locks where:
   * 1. The owning job is missing or terminal
   * 2. The owning job is stale beyond its heartbeat threshold
   */
  findStaleLocks(): StaleLock[] {
    const locks = this.lockManager.getAllLocks();
    const staleLocks: StaleLock[] = [];

    for (const lock of locks) {
      const job = this.db
        .prepare(
          `SELECT j.status, j.started_at, j.heartbeat_at, t.assigned_tier,
                  MAX(h.timestamp) as last_heartbeat
           FROM jobs j
           LEFT JOIN task_graph_nodes t ON t.id = j.task_id
           LEFT JOIN heartbeats h ON h.job_id = j.id
           WHERE j.id = ?
           GROUP BY j.id`,
        )
        .get(lock.owning_job_id) as {
          status: string;
          started_at: string | null;
          heartbeat_at: string | null;
          assigned_tier: string | null;
          last_heartbeat: string | null;
        } | undefined;

      if (!job) {
        staleLocks.push(this.toStaleLock(lock, 'orphaned-owner'));
        continue;
      }

      if (this.isTerminalOwner(job.status)) {
        staleLocks.push(this.toStaleLock(lock, 'terminal-owner'));
        continue;
      }

      if (this.isOwnerStale(job, lock.locked_at)) {
        staleLocks.push(this.toStaleLock(lock, 'stale-owner'));
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

  private toStaleLock(lock: FileLock, reason: StaleLock['reason']): StaleLock {
    return {
      file_path: lock.file_path,
      owning_job_id: lock.owning_job_id,
      owning_supervisor_id: lock.owning_supervisor_id,
      locked_at: lock.locked_at,
      reason,
    };
  }

  private isTerminalOwner(status: string): boolean {
    return status === 'stalled'
      || status === 'cancelled'
      || status === 'completed'
      || status === 'completed-with-warnings'
      || status.startsWith('failed-');
  }

  private isOwnerStale(
    job: { started_at: string | null; heartbeat_at: string | null; assigned_tier: string | null; last_heartbeat: string | null },
    lockedAt: string,
  ): boolean {
    const thresholdMs = this.getThresholdForTier(job.assigned_tier) * 1000;
    const timestamp = job.last_heartbeat ?? job.heartbeat_at ?? job.started_at ?? lockedAt;
    const timestampMs = new Date(timestamp).getTime();
    if (!Number.isFinite(timestampMs)) return true;
    return Date.now() - timestampMs > thresholdMs;
  }

  private getThresholdForTier(tier: string | null | undefined): number {
    if (tier && this.staleThresholdPerTier[tier] !== undefined) {
      return this.staleThresholdPerTier[tier];
    }
    return this.staleThresholdSeconds;
  }
}
