import type { Objective, ObjectiveStatus } from '../types.js';
import { generateUlid } from '../ulid.js';
import type Database from 'better-sqlite3';

const VALID_TRANSITIONS: Record<ObjectiveStatus, ObjectiveStatus[]> = {
  draft: ['planning', 'cancelled'],
  planning: ['active', 'cancelled'],
  active: ['completed', 'failed', 'cancelled'],
  completed: [],
  failed: [],
  cancelled: [],
};

export class ObjectiveRepository {
  constructor(private db: Database.Database) {}

  create(params: {
    project_id: string;
    description: string;
    priority?: number;
    acceptance_criteria: string[];
  }): Objective {
    const id = generateUlid();
    const now = new Date().toISOString();

    this.db
      .prepare(
        `INSERT INTO objectives (id, project_id, description, priority, status, acceptance_criteria, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'draft', ?, ?, ?)`
      )
      .run(
        id,
        params.project_id,
        params.description,
        params.priority ?? 5,
        JSON.stringify(params.acceptance_criteria),
        now,
        now
      );

    return this.getById(id)!;
  }

  getById(id: string): Objective | null {
    const row = this.db.prepare('SELECT * FROM objectives WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    return row ? this.mapRow(row) : null;
  }

  getByProject(projectId: string): Objective[] {
    const rows = this.db
      .prepare('SELECT * FROM objectives WHERE project_id = ? ORDER BY priority DESC, created_at DESC')
      .all(projectId) as Record<string, unknown>[];
    return rows.map(this.mapRow);
  }

  updateStatus(id: string, newStatus: ObjectiveStatus): boolean {
    const current = this.getById(id);
    if (!current) return false;

    const allowed = VALID_TRANSITIONS[current.status];
    if (!allowed.includes(newStatus)) {
      throw new Error(
        `Invalid status transition: ${current.status} → ${newStatus}. Allowed: ${allowed.join(', ')}`
      );
    }

    const result = this.db
      .prepare('UPDATE objectives SET status = ?, updated_at = ? WHERE id = ?')
      .run(newStatus, new Date().toISOString(), id);
    return result.changes > 0;
  }

  private mapRow(row: Record<string, unknown>): Objective {
    return {
      id: row.id as string,
      project_id: row.project_id as string,
      description: row.description as string,
      priority: row.priority as number,
      status: row.status as ObjectiveStatus,
      assigned_king: row.assigned_king as string | undefined,
      acceptance_criteria: JSON.parse(row.acceptance_criteria as string),
      created_at: row.created_at as string,
      updated_at: row.updated_at as string,
    };
  }
}
