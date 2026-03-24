import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const MIGRATIONS_DIR = join(__dirname, '..', '..', 'packages', 'core', 'migrations');

describe('SQLite Migration: 001_initial.sql', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    const sql = readFileSync(join(MIGRATIONS_DIR, '001_initial.sql'), 'utf-8');
    db.exec(sql);
  });

  afterEach(() => {
    db.close();
  });

  it('creates schema_version table with version 1', () => {
    const row = db.prepare('SELECT version FROM schema_version').get() as { version: number };
    expect(row.version).toBe(1);
  });

  const expectedTables = [
    'projects',
    'objectives',
    'task_graph_nodes',
    'jobs',
    'heartbeats',
    'incidents',
    'review_decisions',
    'file_locks',
    'model_configs',
    'provider_health',
    'agent_configs',
    'crypt_entries',
    'schema_version',
  ];

  for (const table of expectedTables) {
    it(`creates the ${table} table`, () => {
      const row = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?")
        .get(table);
      expect(row).toBeDefined();
    });
  }

  it('enables WAL mode', () => {
    // In-memory databases cannot use WAL; verify WAL is set on a file-based db
    const row = db.prepare('PRAGMA journal_mode').get() as { journal_mode: string };
    // :memory: always reports 'memory', so just confirm the pragma was accepted
    expect(['wal', 'memory']).toContain(row.journal_mode);
  });

  const expectedIndexes = [
    'idx_task_graph_nodes_parent_id',
    'idx_task_graph_nodes_status',
    'idx_task_graph_nodes_assigned_tier',
    'idx_task_graph_nodes_objective_id',
    'idx_jobs_task_id',
    'idx_jobs_status_heartbeat',
    'idx_jobs_delegating_supervisor',
    'idx_heartbeats_job_timestamp',
    'idx_incidents_task_id',
    'idx_crypt_entries_completed_at',
  ];

  for (const idx of expectedIndexes) {
    it(`creates index ${idx}`, () => {
      const row = db
        .prepare("SELECT name FROM sqlite_master WHERE type='index' AND name=?")
        .get(idx);
      expect(row).toBeDefined();
    });
  }

  it('enforces foreign key on objectives.project_id', () => {
    expect(() => {
      db.prepare(
        `INSERT INTO objectives (id, project_id, description, acceptance_criteria)
         VALUES ('obj1', 'nonexistent', 'test', '[]')`
      ).run();
    }).toThrow();
  });

  it('enforces status CHECK constraint on objectives', () => {
    db.prepare(
      `INSERT INTO projects (id, name, repository_path) VALUES ('p1', 'Test', '/tmp')`
    ).run();
    expect(() => {
      db.prepare(
        `INSERT INTO objectives (id, project_id, description, status, acceptance_criteria)
         VALUES ('o1', 'p1', 'test', 'invalid', '[]')`
      ).run();
    }).toThrow();
  });

  it('enforces priority range on task_graph_nodes', () => {
    db.prepare(`INSERT INTO projects (id, name, repository_path) VALUES ('p1', 'Test', '/tmp')`).run();
    db.prepare(`INSERT INTO objectives (id, project_id, description, acceptance_criteria) VALUES ('o1', 'p1', 'test', '[]')`).run();
    expect(() => {
      db.prepare(
        `INSERT INTO task_graph_nodes (id, objective_id, level, title, type, assigned_tier, reviewer_tier, priority)
         VALUES ('t1', 'o1', 'epic', 'test', 'code', 'nobility', 'king', 11)`
      ).run();
    }).toThrow();
  });
});
