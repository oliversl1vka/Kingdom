import Database from 'better-sqlite3';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getContextStatus, indexContextProject, repairContextIndex } from '@kingdomos/context-engine';

describe('context repair', () => {
  let tempDir: string;
  let dbPath: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'kingdom-context-repair-'));
    dbPath = join(tempDir, 'context.db');
    writeProjectFile('packages/core/src/db.ts', 'export function getDatabase() { return null; }');
    indexContextProject({ rootPath: tempDir, dbPath, projectId: 'fixture' });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('detects FTS drift and repairs FTS rows from chunks', () => {
    const db = new Database(dbPath);
    db.prepare('DELETE FROM context_chunks_fts WHERE rowid IN (SELECT rowid FROM context_chunks_fts LIMIT 1)').run();
    db.close();

    const drifted = getContextStatus({ rootPath: tempDir, dbPath, projectId: 'fixture' });
    expect(drifted.ftsReady).toBe(false);
    expect(drifted.ftsDriftCount).toBeGreaterThan(0);

    const repair = repairContextIndex({ rootPath: tempDir, dbPath, projectId: 'fixture', ftsOnly: true });
    expect(repair.ftsRowsRebuilt).toBeGreaterThan(0);

    const repaired = getContextStatus({ rootPath: tempDir, dbPath, projectId: 'fixture' });
    expect(repaired.ftsReady).toBe(true);
  });

  function writeProjectFile(path: string, content: string): void {
    const absolute = join(tempDir, ...path.split('/'));
    mkdirSync(dirname(absolute), { recursive: true });
    writeFileSync(absolute, content);
  }
});
