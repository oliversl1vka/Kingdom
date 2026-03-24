import type { Project } from '../types.js';
import { generateUlid } from '../ulid.js';
import type Database from 'better-sqlite3';

export class ProjectRepository {
  constructor(private db: Database.Database) {}

  create(params: { name: string; description?: string; repository_path: string }): Project {
    const id = generateUlid();
    const now = new Date().toISOString();

    this.db
      .prepare(
        `INSERT INTO projects (id, name, description, repository_path, active, created_at, updated_at)
         VALUES (?, ?, ?, ?, 1, ?, ?)`
      )
      .run(id, params.name, params.description ?? null, params.repository_path, now, now);

    return this.getById(id)!;
  }

  getById(id: string): Project | null {
    const row = this.db.prepare('SELECT * FROM projects WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    return row ? this.mapRow(row) : null;
  }

  getAll(): Project[] {
    const rows = this.db.prepare('SELECT * FROM projects ORDER BY created_at DESC').all() as Record<string, unknown>[];
    return rows.map(this.mapRow);
  }

  getActive(): Project[] {
    const rows = this.db.prepare('SELECT * FROM projects WHERE active = 1 ORDER BY created_at DESC').all() as Record<string, unknown>[];
    return rows.map(this.mapRow);
  }

  update(id: string, params: Partial<Pick<Project, 'name' | 'description' | 'repository_path'>>): Project | null {
    const existing = this.getById(id);
    if (!existing) return null;

    const now = new Date().toISOString();
    this.db
      .prepare(
        `UPDATE projects SET name = ?, description = ?, repository_path = ?, updated_at = ? WHERE id = ?`
      )
      .run(
        params.name ?? existing.name,
        params.description ?? existing.description ?? null,
        params.repository_path ?? existing.repository_path,
        now,
        id
      );

    return this.getById(id);
  }

  deactivate(id: string): boolean {
    const result = this.db
      .prepare('UPDATE projects SET active = 0, updated_at = ? WHERE id = ?')
      .run(new Date().toISOString(), id);
    return result.changes > 0;
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
