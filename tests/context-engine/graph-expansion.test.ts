import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { indexContextProject, searchContext } from '@kingdomos/context-engine';

describe('context graph expansion', () => {
  let tempDir: string;
  let dbPath: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'kingdom-context-graph-'));
    dbPath = join(tempDir, 'context.db');
    writeProjectFile('packages/core/src/a.ts', `
import { beta } from './b.js';
export function alpha(): string {
  return beta();
}
`);
    writeProjectFile('packages/core/src/b.ts', `
export function beta(): string {
  return 'beta';
}
`);
    indexContextProject({ rootPath: tempDir, dbPath, projectId: 'fixture' });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('uses resolved high-confidence import edges but not low-confidence name-only call edges', () => {
    const response = searchContext({ dbPath, projectId: 'fixture', query: 'how does alpha flow to beta', intent: 'flow', includeNeighbors: true, limit: 3 });

    const alpha = response.results.find((result) => result.title.includes('alpha'));
    expect(alpha).toBeDefined();
    expect(alpha?.neighbors?.some((neighbor) => neighbor.file === 'packages/core/src/b.ts')).toBe(true);
    expect(alpha?.neighbors?.some((neighbor) => neighbor.edgeType === 'symbol_calls_identifier')).toBe(false);
  });

  function writeProjectFile(path: string, content: string): void {
    const absolute = join(tempDir, ...path.split('/'));
    mkdirSync(dirname(absolute), { recursive: true });
    writeFileSync(absolute, content.trimStart());
  }
});
