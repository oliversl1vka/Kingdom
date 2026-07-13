import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { selectResumeObjectives } from '../../packages/cli/src/commands/resume.js';

const MIGRATIONS_DIR = join(__dirname, '..', '..', 'packages', 'core', 'migrations');

describe('resume command helpers', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    db.exec(readFileSync(join(MIGRATIONS_DIR, '001_initial.sql'), 'utf-8'));

    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO projects (id, name, repository_path, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
    ).run('proj', 'Resume Test Project', process.cwd(), now, now);
    db.prepare(
      `INSERT INTO objectives (id, project_id, description, priority, status, acceptance_criteria, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run('obj-active', 'proj', 'Active objective', 10, 'active', JSON.stringify([]), now, now);
    db.prepare(
      `INSERT INTO objectives (id, project_id, description, priority, status, acceptance_criteria, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run('obj-failed', 'proj', 'Failed objective', 5, 'failed', JSON.stringify([]), now, now);
  });

  afterEach(() => {
    db.close();
  });

  it('selects a specific objective with a bound parameter', () => {
    expect(selectResumeObjectives(db, 'obj-active').map((objective) => objective.id)).toEqual(['obj-active']);
  });

  it('does not treat objective input as SQL', () => {
    const objectiveIds = selectResumeObjectives(db, "missing' OR 1=1 --").map((objective) => objective.id);

    expect(objectiveIds).toEqual([]);
  });
});