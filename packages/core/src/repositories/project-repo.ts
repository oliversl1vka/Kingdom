import type { Project } from '../types.js';
import type Database from 'better-sqlite3';

export class ProjectRepository {
  constructor(private db: Database.Database) {}

  getById(id: string): Project | null {
    const row = this.db.prepare('SELECT * FROM projects WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    return row ? this.mapRow(row) : null;
  }

  getActive(): Project[] {
    const rows = this.db.prepare('SELECT * FROM projects WHERE active = 1 ORDER BY created_at DESC').all() as Record<string, unknown>[];
    return rows.map(this.mapRow);
  }

  private mapRow(row: Record<string, unknown>): Project {
    return {
      id: row.id as string,
      name: row.name as string,
      description: row.description as string | undefined,
      repository_path: row.repository_path as string,
      active: row.active === 1,
      created_at: row.created_at as string,
      updated_at: row.updated_at as string,
    };
  }
}
