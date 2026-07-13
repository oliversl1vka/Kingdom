import Database from 'better-sqlite3';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { normalizeWorkspaceRelativePath, scanProjectFiles } from '@kingdomos/context-engine';

describe('context scanner', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'kingdom-context-scanner-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('indexes supported project files and skips generated, DB, and uppercase backup files', () => {
    writeProjectFile('packages/core/src/doctor.ts', 'export function doctor() { return true; }');
    writeProjectFile('packages/core/dist/doctor.js', 'generated');
    writeProjectFile('node_modules/pkg/index.ts', 'generated');
    writeProjectFile('kingdom/context.db', 'database');
    writeProjectFile('packages/core/src/old.BAK', 'backup');

    const scan = scanProjectFiles({ rootPath: tempDir });

    expect(scan.files.map((file) => file.path)).toEqual(['packages/core/src/doctor.ts']);
    expect(scan.files[0].path).not.toContain('\\');
  });

  it('normalizes mixed separators to workspace-relative POSIX paths and rejects outside paths', () => {
    const inside = normalizeWorkspaceRelativePath('packages\\core/src\\doctor.ts', tempDir);
    expect(inside).toBe('packages/core/src/doctor.ts');

    const absoluteWithDrive = normalizeWorkspaceRelativePath(join(tempDir, 'packages', 'core', 'src', 'doctor.ts'), tempDir);
    expect(absoluteWithDrive).toBe('packages/core/src/doctor.ts');
    expect(absoluteWithDrive).not.toContain(':');

    const outside = normalizeWorkspaceRelativePath(join(tempDir, '..', 'outside.ts'), tempDir);
    expect(outside).toBeNull();
  });

  it('skips files that are locked in the orchestration database', () => {
    writeProjectFile('packages/core/src/locked.ts', 'export const locked = true;');
    writeProjectFile('packages/core/src/free.ts', 'export const free = true;');
    const orchestrationDbPath = join(tempDir, 'kingdom.db');
    const db = new Database(orchestrationDbPath);
    db.exec('CREATE TABLE file_locks (file_path TEXT PRIMARY KEY)');
    db.prepare('INSERT INTO file_locks (file_path) VALUES (?)').run('packages/core/src/locked.ts');
    db.close();

    const scan = scanProjectFiles({ rootPath: tempDir, orchestrationDbPath });

    expect(scan.skippedLocked).toBe(1);
    expect(scan.files.map((file) => file.path)).toEqual(['packages/core/src/free.ts']);
  });

  function writeProjectFile(path: string, content: string): void {
    const absolute = join(tempDir, ...path.split('/'));
    mkdirSync(dirname(absolute), { recursive: true });
    writeFileSync(absolute, content);
  }
});
