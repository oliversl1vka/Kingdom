import type { FileLock } from '../types.js';
import type Database from 'better-sqlite3';

export class FileLockManager {
  constructor(private db: Database.Database) {}

  // Phase 1: detect once whether the fencing schema (migration 017) is present.
  // Degrades gracefully to the legacy insert when it isn't (e.g. partial-migration
  // test DBs), so locking keeps working without fencing tokens.
  private fencingAvail: boolean | null = null;
  private hasFencing(): boolean {
    if (this.fencingAvail !== null) return this.fencingAvail;
    let counter = false;
    let column = false;
    try {
      counter = !!this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='fence_counter'").get();
    } catch { counter = false; }
    try {
      const cols = this.db.prepare("PRAGMA table_info(file_locks)").all() as Array<{ name: string }>;
      column = cols.some(c => c.name === 'fencing_token');
    } catch { column = false; }
    this.fencingAvail = counter && column;
    return this.fencingAvail;
  }

  /** Allocate the next monotonic fencing token (P1.3). Safe to call inside a transaction. */
  private nextFencingToken(): number {
    // fence_counter is a single global row; UPDATE…RETURNING guarantees a unique,
    // strictly-increasing value even across lock delete/recreate cycles. Fall back
    // to a select+update for older SQLite without RETURNING support.
    try {
      const row = this.db
        .prepare('UPDATE fence_counter SET current = current + 1 WHERE id = 1 RETURNING current')
        .get() as { current: number } | undefined;
      if (row) return row.current;
    } catch {
      // RETURNING unsupported — fall through
    }
    this.db.prepare('UPDATE fence_counter SET current = current + 1 WHERE id = 1').run();
    const row = this.db.prepare('SELECT current FROM fence_counter WHERE id = 1').get() as { current: number } | undefined;
    return row?.current ?? 0;
  }

  acquire(filePath: string, jobId: string, supervisorId: string, maxDurationSeconds = 600): boolean {
    try {
      const now = new Date().toISOString();
      if (this.hasFencing()) {
        const acquireTx = this.db.transaction(() => {
          const token = this.nextFencingToken();
          this.db
            .prepare(
              `INSERT INTO file_locks (file_path, owning_job_id, owning_supervisor_id, locked_at, lock_type, max_duration_seconds, fencing_token)
               VALUES (?, ?, ?, ?, 'exclusive', ?, ?)`
            )
            .run(filePath, jobId, supervisorId, now, maxDurationSeconds, token);
        });
        acquireTx();
      } else {
        this.db
          .prepare(
            `INSERT INTO file_locks (file_path, owning_job_id, owning_supervisor_id, locked_at, lock_type, max_duration_seconds)
             VALUES (?, ?, ?, ?, 'exclusive', ?)`
          )
          .run(filePath, jobId, supervisorId, now, maxDurationSeconds);
      }
      return true;
    } catch {
      // PK uniqueness violation — lock already held
      return false;
    }
  }

  /**
   * Phase 1 (P1.2): Atomic, all-or-nothing batch acquisition. Takes every lock in
   * `filePaths` inside ONE transaction. If ANY path is already held, the whole
   * transaction rolls back and NO locks are taken — so two jobs that share even a
   * single hotspot file never end up each holding a partial subset (the old loop's
   * livelock/deadlock). Returns the granted fencing tokens keyed by path on
   * success, or null if the batch could not be fully acquired.
   */
  acquireBatch(
    filePaths: string[],
    jobId: string,
    supervisorId: string,
    maxDurationSeconds = 600,
  ): Record<string, number> | null {
    const unique = [...new Set(filePaths)];
    if (unique.length === 0) return {};
    const fencing = this.hasFencing();
    try {
      const batchTx = this.db.transaction(() => {
        const now = new Date().toISOString();
        const tokens: Record<string, number> = {};
        // Prepare ONLY the statement for the active schema — preparing the fenced
        // INSERT against a legacy file_locks (no fencing_token column) would throw.
        const insert = fencing
          ? this.db.prepare(
              `INSERT INTO file_locks (file_path, owning_job_id, owning_supervisor_id, locked_at, lock_type, max_duration_seconds, fencing_token)
               VALUES (?, ?, ?, ?, 'exclusive', ?, ?)`,
            )
          : this.db.prepare(
              `INSERT INTO file_locks (file_path, owning_job_id, owning_supervisor_id, locked_at, lock_type, max_duration_seconds)
               VALUES (?, ?, ?, ?, 'exclusive', ?)`,
            );
        for (const file of unique) {
          // A PK violation here throws → the whole transaction rolls back → no partial holds.
          if (fencing) {
            const token = this.nextFencingToken();
            insert.run(file, jobId, supervisorId, now, maxDurationSeconds, token);
            tokens[file] = token;
          } else {
            insert.run(file, jobId, supervisorId, now, maxDurationSeconds);
            tokens[file] = 0;
          }
        }
        return tokens;
      });
      return batchTx();
    } catch {
      return null;
    }
  }

  /**
   * Phase 1 (P1.3): Validate a worker's fencing token before it is allowed to
   * commit a write. The write is permitted iff the lock still exists, is owned by
   * the same job, and carries exactly the token the worker was granted. A zombie
   * worker whose lock was released and re-granted (newer, higher token) is
   * rejected here even though its in-memory handle looks valid.
   */
  validateFence(filePath: string, jobId: string, token: number): boolean {
    if (!this.hasFencing()) {
      // No fencing schema — fall back to ownership-only check.
      const row = this.db.prepare('SELECT owning_job_id FROM file_locks WHERE file_path = ?').get(filePath) as { owning_job_id: string } | undefined;
      return !!row && row.owning_job_id === jobId;
    }
    const row = this.db
      .prepare('SELECT owning_job_id, fencing_token FROM file_locks WHERE file_path = ?')
      .get(filePath) as { owning_job_id: string; fencing_token: number } | undefined;
    if (!row) return false;
    return row.owning_job_id === jobId && row.fencing_token === token;
  }

  release(filePath: string, supervisorId: string): boolean {
    const result = this.db
      .prepare('DELETE FROM file_locks WHERE file_path = ? AND owning_supervisor_id = ?')
      .run(filePath, supervisorId);
    return result.changes > 0;
  }

  forceRelease(filePath: string): boolean {
    const result = this.db
      .prepare('DELETE FROM file_locks WHERE file_path = ?')
      .run(filePath);
    return result.changes > 0;
  }

  isLocked(filePath: string): boolean {
    const row = this.db.prepare('SELECT file_path FROM file_locks WHERE file_path = ?').get(filePath);
    return !!row;
  }

  getLock(filePath: string): FileLock | null {
    const row = this.db.prepare('SELECT * FROM file_locks WHERE file_path = ?').get(filePath) as Record<string, unknown> | undefined;
    return row ? this.mapRow(row) : null;
  }

  getExpiredLocks(): FileLock[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM file_locks
         WHERE datetime(locked_at, '+' || max_duration_seconds || ' seconds') < datetime('now')`
      )
      .all() as Record<string, unknown>[];
    return rows.map(this.mapRow);
  }

  getAllLocks(): FileLock[] {
    const rows = this.db.prepare('SELECT * FROM file_locks').all() as Record<string, unknown>[];
    return rows.map(this.mapRow);
  }

  private mapRow(row: Record<string, unknown>): FileLock {
    return {
      file_path: row.file_path as string,
      owning_job_id: row.owning_job_id as string,
      owning_supervisor_id: row.owning_supervisor_id as string,
      locked_at: row.locked_at as string,
      lock_type: 'exclusive',
      max_duration_seconds: row.max_duration_seconds as number,
      fencing_token: (row.fencing_token ?? 0) as number,
    };
  }
}
