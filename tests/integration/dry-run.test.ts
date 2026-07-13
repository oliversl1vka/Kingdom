import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  withDryRun,
  withDryRunAsync,
  withDryRunTransaction,
} from '../../packages/core/src/dry-run.js';

const MIGRATIONS_DIR = join(__dirname, '..', '..', 'packages', 'core', 'migrations');

function createDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(readFileSync(join(MIGRATIONS_DIR, '001_initial.sql'), 'utf-8'));
  return db;
}

describe('Dry-Run Mode Validation', () => {
  describe('withDryRun', () => {
    it('should skip execution and return DryRunResult', () => {
      let called = false;

      const result = withDryRun(true, 'test action', () => {
        called = true;
        return 42;
      });

      expect(called).toBe(false);
      expect(result).toMatchObject({
        actions: [{ type: 'skipped', description: 'test action', args: {} }],
        skipped: true,
      });
    });

    it('should execute normally when dry-run is false', () => {
      let called = false;

      const result = withDryRun(false, 'real action', () => {
        called = true;
        return 99;
      });

      expect(called).toBe(true);
      expect(result).toBe(99);
    });
  });

  describe('withDryRunAsync', () => {
    it('should skip async execution and return DryRunResult', async () => {
      let called = false;

      const result = await withDryRunAsync(true, 'async action', async () => {
        called = true;
        return 'output';
      });

      expect(called).toBe(false);
      expect(result).toMatchObject({
        actions: [{ type: 'skipped', description: 'async action', args: {} }],
        skipped: true,
      });
    });

    it('should execute async normally when dry-run is false', async () => {
      let called = false;

      const result = await withDryRunAsync(false, 'real async', async () => {
        called = true;
        return 'done';
      });

      expect(called).toBe(true);
      expect(result).toBe('done');
    });
  });

  describe('withDryRunTransaction', () => {
    it('should roll back DB writes in dry-run mode', () => {
      const db = createDb();

      // Insert a project in dry-run mode
      withDryRunTransaction(db, true, () => {
        const now = new Date().toISOString();
        db.prepare(
          'INSERT INTO projects (id, name, repository_path, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
        ).run('proj-1', 'Dry Project', '/tmp/dry', now, now);
      });

      // Verify nothing persisted
      const row = db.prepare('SELECT * FROM projects WHERE id = ?').get('proj-1') as Record<string, unknown> | undefined;
      expect(row).toBeUndefined();
    });

    it('should commit DB writes in non-dry-run mode', () => {
      const db = createDb();

      withDryRunTransaction(db, false, () => {
        const now = new Date().toISOString();
        db.prepare(
          'INSERT INTO projects (id, name, repository_path, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
        ).run('proj-2', 'Real Project', '/tmp/real', now, now);
      });

      const row = db.prepare('SELECT name FROM projects WHERE id = ?').get('proj-2') as { name: string } | undefined;
      expect(row!.name).toBe('Real Project');
    });
  });
});
