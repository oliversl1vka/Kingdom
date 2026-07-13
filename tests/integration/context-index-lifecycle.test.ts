import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ContextIndexLifecycle } from '@kingdomos/core';
import { getContextStatus } from '@kingdomos/context-engine';

describe('ContextIndexLifecycle incremental update (P2.2)', () => {
  let workspace: string;
  let dbPath: string;
  beforeEach(() => {
    workspace = mkdtempSync(join(tmpdir(), 'kos-idx-'));
    // The context engine only indexes Kingdom-shaped roots (packages/, tests/, ...).
    mkdirSync(join(workspace, 'packages', 'demo'), { recursive: true });
    writeFileSync(join(workspace, 'packages', 'demo', 'a.ts'), 'export const a = 1;\n');
    dbPath = join(workspace, 'context.db');
  });
  afterEach(() => { rmSync(workspace, { recursive: true, force: true }); });

  it('indexes at start, then incrementally re-indexes a changed file after apply', async () => {
    const lifecycle = new ContextIndexLifecycle({ projectPath: workspace, contextDbPath: dbPath });

    const ok = await lifecycle.indexAtStart();
    expect(ok).toBe(true);
    expect(lifecycle.hasIndexed()).toBe(true);

    const before = getContextStatus({ rootPath: workspace, dbPath });
    expect(before.indexed).toBe(true);
    expect(before.fileCount).toBeGreaterThan(0);

    // Add a new file and re-index incrementally.
    writeFileSync(join(workspace, 'packages', 'demo', 'b.ts'), 'export const b = 2;\n');
    const reindexed = await lifecycle.reindexAfterApply();
    expect(reindexed).toBe(true);

    const after = getContextStatus({ rootPath: workspace, dbPath });
    expect(after.fileCount).toBeGreaterThan(before.fileCount);
    expect(after.newFileCount).toBe(0); // freshly indexed — no untracked new files
  });
});
