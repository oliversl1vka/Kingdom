import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applyEdit } from '@kingdomos/blacksmith';

describe('blacksmith applyEdit (P2.1 programmatic edit)', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'kos-edit-')); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it('replaces a unique snippet and writes a .bak', () => {
    writeFileSync(join(dir, 'a.ts'), 'export const x = 1;\nconst y = 2;\n');
    const res = applyEdit({ path: 'a.ts', old_string: 'const x = 1;', new_string: 'const x = 42;' }, dir);
    expect(res.success).toBe(true);
    expect(res.appliedFile).toBe('a.ts');
    expect(readFileSync(join(dir, 'a.ts'), 'utf-8')).toContain('const x = 42;');
    expect(existsSync(join(dir, 'a.ts.bak'))).toBe(true);
    expect(readFileSync(join(dir, 'a.ts.bak'), 'utf-8')).toContain('const x = 1;');
  });

  it('creates a new file when old_string is empty', () => {
    const res = applyEdit({ path: 'sub/new.ts', old_string: '', new_string: 'export const ok = true;' }, dir);
    expect(res.success).toBe(true);
    expect(res.created).toBe(true);
    expect(readFileSync(join(dir, 'sub/new.ts'), 'utf-8')).toBe('export const ok = true;');
  });

  it('fails when old_string is not unique', () => {
    writeFileSync(join(dir, 'd.ts'), 'foo\nfoo\n');
    const res = applyEdit({ path: 'd.ts', old_string: 'foo', new_string: 'bar' }, dir);
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/occurs 2 times/);
  });

  it('fails when old_string is not found', () => {
    writeFileSync(join(dir, 'e.ts'), 'hello\n');
    const res = applyEdit({ path: 'e.ts', old_string: 'goodbye', new_string: 'x' }, dir);
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/not found/);
  });

  it('refuses to overwrite an existing non-empty file via empty old_string', () => {
    writeFileSync(join(dir, 'f.ts'), 'existing content\n');
    const res = applyEdit({ path: 'f.ts', old_string: '', new_string: 'stub' }, dir);
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/already exists/);
  });

  it('rejects paths that escape the workspace', () => {
    const res = applyEdit({ path: '../escape.ts', old_string: 'a', new_string: 'b' }, dir);
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/escapes the workspace/);
  });
});
