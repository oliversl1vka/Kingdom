import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ProviderAdapter, CompletionRequest, CompletionResponse } from '@kingdomos/core';
import { ModelRegistry, evaluateModel, deriveCapabilities, recommendTierClass } from '@kingdomos/token-engine';

const MIGRATIONS_DIR = join(__dirname, '..', '..', 'packages', 'core', 'migrations');

function setup(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  for (const f of [
    '001_initial.sql',
    '002_seed_models.sql',
    '009_model_capabilities.sql',
    '015_phase0_capabilities.sql',
    '033_model_eval_results.sql',
  ]) {
    db.exec(readFileSync(join(MIGRATIONS_DIR, f), 'utf-8'));
  }
  return db;
}

/** A mock provider that answers each probe correctly (no network). */
function goodProvider(): ProviderAdapter {
  return {
    provider_id: 'openai',
    async complete(req: CompletionRequest): Promise<CompletionResponse> {
      const prompt = req.messages.map((m) => m.content).join(' ');
      let content = '';
      if (/Decompose/.test(prompt)) {
        content = JSON.stringify({ tasks: [{ title: 'a' }, { title: 'b' }, { title: 'c' }] });
      } else if (/unified diff/.test(prompt)) {
        content = '--- a/sum.js\n+++ b/sum.js\n@@\n+function add(a,b){return a+b;}';
      } else if (/Review/.test(prompt)) {
        content = JSON.stringify({ decision: 'rejected', reason: 'hardcoded secret' });
      } else {
        content = JSON.stringify({ action: 'decompose' });
      }
      return {
        content,
        prompt_tokens: 10,
        completion_tokens: 10,
        total_tokens: 20,
        finish_reason: 'stop',
      };
    },
    async healthCheck() {
      return { status: 'healthy' as const };
    },
  };
}

describe('PHASE4 P4.3 — eval harness', () => {
  let db: Database.Database;
  beforeEach(() => (db = setup()));
  afterEach(() => db.close());

  it('runs the battery, writes verified_at + capabilities, persists results', async () => {
    const before = new ModelRegistry(db).getModelConfig('gpt-4o-mini');
    expect(before?.capabilities?.verified_at).toBeFalsy();

    const result = await evaluateModel(db, 'gpt-4o-mini', goodProvider());

    // All probes pass with the good provider.
    expect(result.probes.length).toBeGreaterThanOrEqual(4);
    expect(result.probes.every((p) => p.passed)).toBe(true);
    expect(result.capabilities.structured_output).toBe(true);
    expect(result.capabilities.verified_at).toBeTruthy();

    // Registry now carries measured capabilities + verified_at column.
    const reg = new ModelRegistry(db);
    const after = reg.getModelConfig('gpt-4o-mini');
    expect(after?.capabilities?.verified_at).toBeTruthy();
    const col = db.prepare('SELECT verified_at FROM model_configs WHERE model_id = ?').get('gpt-4o-mini') as {
      verified_at: string | null;
    };
    expect(col.verified_at).toBeTruthy();

    // Per-probe rows persisted.
    const rows = db.prepare('SELECT COUNT(*) n FROM model_eval_results WHERE model_id = ?').get('gpt-4o-mini') as {
      n: number;
    };
    expect(rows.n).toBe(result.probes.length);
  });

  it('does not persist on a dry run', async () => {
    await evaluateModel(db, 'gpt-4o-mini', goodProvider(), { persist: false });
    const rows = db.prepare('SELECT COUNT(*) n FROM model_eval_results').get() as { n: number };
    expect(rows.n).toBe(0);
    const col = db.prepare('SELECT verified_at FROM model_configs WHERE model_id = ?').get('gpt-4o-mini') as {
      verified_at: string | null;
    };
    expect(col.verified_at).toBeFalsy();
  });

  it('a failing model gets empty strengths and falls back to premium tier', () => {
    const caps = deriveCapabilities('weak', 8192, [
      { probe: 'decompose', task_kind: 'decomposition', passed: false, score: 0, latency_ms: 100, tool_use_observed: false, structured_output_observed: false, detail: '' },
    ]);
    expect(caps.strengths).toEqual([]);
    expect(recommendTierClass([
      { probe: 'decompose', task_kind: 'decomposition', passed: false, score: 0, latency_ms: 100, tool_use_observed: false, structured_output_observed: false, detail: '' },
    ])).toBe('premium');
  });

  it('can run a single probe subset', async () => {
    const result = await evaluateModel(db, 'gpt-4o-mini', goodProvider(), {
      probes: ['decompose'],
      persist: false,
    });
    expect(result.probes).toHaveLength(1);
    expect(result.probes[0].probe).toBe('decompose');
  });
});
