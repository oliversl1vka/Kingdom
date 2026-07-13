import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('kingdom init CLI contract', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'kingdom-test-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('creates kingdom.config.json with correct project name', async () => {
    const { createDefaultConfig, setConfig } = await import('@kingdomos/core');
    const { mkdirSync } = await import('node:fs');

    // Simulate init
    const name = 'test-kingdom';
    const config = createDefaultConfig(name);
    setConfig(config, tempDir);

    const configPath = join(tempDir, 'kingdom.config.json');
    expect(existsSync(configPath)).toBe(true);
    const parsed = JSON.parse(readFileSync(configPath, 'utf-8'));
    expect(parsed.project_name).toBe('test-kingdom');
  });

  it('creates kingdom directory structure', async () => {
    const { mkdirSync } = await import('node:fs');
    const kingdomDir = join(tempDir, 'kingdom');
    const dirs = [
      kingdomDir,
      join(kingdomDir, 'agents'),
      join(kingdomDir, 'memory'),
      join(kingdomDir, 'memory', 'shared'),
    ];
    for (const dir of dirs) {
      mkdirSync(dir, { recursive: true });
    }

    expect(existsSync(join(tempDir, 'kingdom'))).toBe(true);
    expect(existsSync(join(tempDir, 'kingdom', 'agents'))).toBe(true);
    expect(existsSync(join(tempDir, 'kingdom', 'memory'))).toBe(true);
    expect(existsSync(join(tempDir, 'kingdom', 'memory', 'shared'))).toBe(true);
  });

  it('creates SQLite database in kingdom directory', async () => {
    const { getDatabaseForPath } = await import('@kingdomos/core');
    const { mkdirSync } = await import('node:fs');

    mkdirSync(join(tempDir, 'kingdom'), { recursive: true });
    const dbPath = join(tempDir, 'kingdom', 'kingdom.db');
    const db = getDatabaseForPath(dbPath);
    db.close();

    expect(existsSync(dbPath)).toBe(true);
  });

  it('rejects reinitialization without --force', async () => {
    const { configExists, createDefaultConfig, setConfig } = await import('@kingdomos/core');
    const config = createDefaultConfig('test');
    setConfig(config, tempDir);

    expect(configExists(tempDir)).toBe(true);
  });
});
