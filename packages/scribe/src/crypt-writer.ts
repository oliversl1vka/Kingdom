import type Database from 'better-sqlite3';

export interface CryptEntry {
  id: number;
  task_id: string;
  title: string;
  summary: string;
  success: boolean;
  completed_at: string;
}

export class CryptWriter {
  constructor(private db: Database.Database) {}

  write(entry: Omit<CryptEntry, 'id'>): number {
    const result = this.db
      .prepare(
        `INSERT INTO crypt_entries (task_id, title, summary, success, completed_at)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(entry.task_id, entry.title, entry.summary, entry.success ? 1 : 0, entry.completed_at);
    return Number(result.lastInsertRowid);
  }

  writeFromTask(taskId: string, title: string, summary: string, success: boolean): number {
    return this.write({
      task_id: taskId,
      title,
      summary,
      success,
      completed_at: new Date().toISOString(),
    });
  }

  getAll(limit = 100): CryptEntry[] {
    return this.db
      .prepare('SELECT * FROM crypt_entries ORDER BY completed_at DESC LIMIT ?')
      .all(limit) as CryptEntry[];
  }

  getByTaskId(taskId: string): CryptEntry | null {
    return (this.db
      .prepare('SELECT * FROM crypt_entries WHERE task_id = ?')
      .get(taskId) as CryptEntry | undefined) ?? null;
  }
}
