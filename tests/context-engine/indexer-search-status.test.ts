import { existsSync, mkdirSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getContextStatus, indexContextProject, searchContext } from '@kingdomos/context-engine';

describe('context indexer, search, and status', () => {
  let tempDir: string;
  let dbPath: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'kingdom-context-index-'));
    dbPath = join(tempDir, 'context.db');
    writeProjectFile('packages/cli/src/commands/doctor.ts', `
import { Command } from 'commander';
export function registerDoctorCommand(program: Command): void {
  program.command('doctor').description('Check KingdomOS health').action(() => console.log('ok'));
}
`);
    writeProjectFile('packages/core/src/orchestration-loop.ts', `
export class OrchestrationLoop {
  tick(): void {
    this.createJobsForLeafTasks();
  }
  private createJobsForLeafTasks(): void {}
}
`);
    writeProjectFile('docs/runbook.md', '# Doctor Command\n\nUse doctor to inspect health.');
    writeProjectFile('packages/core/migrations/001_initial.sql', 'CREATE TABLE IF NOT EXISTS file_locks (file_path TEXT PRIMARY KEY);');
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('indexes local files, extracts symbols, and finds command definitions', () => {
    const result = indexContextProject({ rootPath: tempDir, dbPath, projectId: 'fixture' });

    expect(result.status).toBe('completed');
    expect(result.filesIndexed).toBeGreaterThanOrEqual(4);
    expect(result.symbols).toBeGreaterThan(0);
    expect(result.chunks).toBeGreaterThan(0);

    const response = searchContext({ dbPath, projectId: 'fixture', query: 'where is doctor command implemented', limit: 5 });

    expect(response.results.length).toBeGreaterThan(0);
    expect(response.results[0].file).toBe('packages/cli/src/commands/doctor.ts');
    expect(response.results[0].why.length).toBeGreaterThan(0);
  });

  it('skips unchanged files incrementally and reports stale, new, and missing files', () => {
    indexContextProject({ rootPath: tempDir, dbPath, projectId: 'fixture' });
    const second = indexContextProject({ rootPath: tempDir, dbPath, projectId: 'fixture' });

    expect(second.filesSkipped).toBeGreaterThan(0);

    writeProjectFile('packages/core/src/orchestration-loop.ts', 'export const changed = true;\nexport const extra = true;');
    writeProjectFile('packages/core/src/new-file.ts', 'export const newer = true;');
    unlinkSync(join(tempDir, 'docs', 'runbook.md'));

    const status = getContextStatus({ rootPath: tempDir, dbPath, projectId: 'fixture' });

    expect(status.staleFileCount).toBeGreaterThanOrEqual(1);
    expect(status.newFileCount).toBeGreaterThanOrEqual(1);
    expect(status.missingFileCount).toBeGreaterThanOrEqual(1);
    expect(status.warnings).toContain('Index is stale');
  });

  it('keeps context DB outside the fixture source tree when requested', () => {
    indexContextProject({ rootPath: tempDir, dbPath, projectId: 'fixture' });

    expect(existsSync(dbPath)).toBe(true);
  });

  function writeProjectFile(path: string, content: string): void {
    const absolute = join(tempDir, ...path.split('/'));
    mkdirSync(dirname(absolute), { recursive: true });
    writeFileSync(absolute, content.trimStart());
  }
});
