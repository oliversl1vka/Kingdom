import type { FileLock } from '../types.js';
import type Database from 'better-sqlite3';

export class FileLockManager {
  constructor(private db: Database.Database) {}

  acquire(filePath: string, jobId: string, supervisorId: string, maxDurationSeconds = 600): boolean {
    try {
      this.db
        .prepare(
          `INSERT INTO file_locks (file_path, owning_job_id, owning_supervisor_id, locked_at, lock_type, max_duration_seconds)
           VALUES (?, ?, ?, ?, 'exclusive', ?)`
        )
        .run(filePath, jobId, supervisorId, new Date().toISOString(), maxDurationSeconds);
      return true;
    } catch {
      // PK uniqueness violation — lock already held
      return false;
    }
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
    };
  }
}
