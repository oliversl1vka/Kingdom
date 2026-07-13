import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ProviderAdapter, CompletionRequest, CompletionResponse } from '@kingdomos/core';
import { ProviderRouter, HealthTracker } from '@kingdomos/providers';

const MIGRATIONS_DIR = join(__dirname, '..', '..', 'packages', 'core', 'migrations');

function setup(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  for (const f of [
    '001_initial.sql',
    '002_seed_models.sql',
    '003_seed_providers.sql',
    '009_model_capabilities.sql',
    '012_provider_health_tokens.sql',
    '015_phase0_capabilities.sql',
    '032_per_model_health.sql',
    '033_model_eval_results.sql',
  ]) {
    db.exec(readFileSync(join(MIGRATIONS_DIR, f), 'utf-8'));
  }
  // Mark relevant providers healthy + ordered.
  db.prepare("UPDATE provider_health SET status='healthy' WHERE provider_id IN ('openai','llamacpp')").run();
  // llamacpp isn't seeded by 003; insert it.
  db.prepare(
    `INSERT OR IGNORE INTO provider_health (provider_id, display_name, status, endpoint, priority_order, requests_today)
     VALUES ('llamacpp', 'llama.cpp', 'healthy', 'http://localhost:8080', 5, 0)`,
  ).run();
  // Register a model that ONLY llamacpp serves and one ONLY openai serves.
  db.prepare(
    `INSERT INTO model_configs (model_id, provider, display_name, context_window, safe_input_budget,
       output_reservation, safety_margin_percent, tokenizer_type)
     VALUES ('local-only-model', 'llamacpp', 'Local', 8192, 6144, 2048, 0.15, 'character-estimate')`,
  ).run();
  return db;
}

function spyProvider(id: string, calls: string[]): ProviderAdapter {
  return {
    provider_id: id,
    async complete(_req: CompletionRequest): Promise<CompletionResponse> {
      calls.push(id);
      return {
        content: 'ok',
        prompt_tokens: 1,
        completion_tokens: 1,
        total_tokens: 2,
        finish_reason: 'stop',
      };
    },
    async healthCheck() {
      return { status: 'healthy' as const };
    },
  };
}

describe('PHASE4 P4.4 — model-aware provider routing', () => {
  let db: Database.Database;
  beforeEach(() => (db = setup()));
  afterEach(() => db.close());

  it('routes a llamacpp-only model to llamacpp, not the higher-priority openai', async () => {
    const calls: string[] = [];
    const router = new ProviderRouter({
      db,
      credentials: new Map([
        ['openai', 'k'],
        ['llamacpp', 'x'],
      ]),
    });
    // Swap in spies.
    const openai = spyProvider('openai', calls);
    const llama = spyProvider('llamacpp', calls);
    (router as unknown as { adapters: Map<string, ProviderAdapter> }).adapters.set('openai', openai);
    (router as unknown as { adapters: Map<string, ProviderAdapter> }).adapters.set('llamacpp', llama);

    await router.route({ model: 'local-only-model', messages: [], max_tokens: 10 });
    expect(calls).toEqual(['llamacpp']); // openai never tried
  });

  it('routes an openai model to openai', async () => {
    const calls: string[] = [];
    const router = new ProviderRouter({
      db,
      credentials: new Map([['openai', 'k'], ['llamacpp', 'x']]),
    });
    (router as unknown as { adapters: Map<string, ProviderAdapter> }).adapters.set('openai', spyProvider('openai', calls));
    (router as unknown as { adapters: Map<string, ProviderAdapter> }).adapters.set('llamacpp', spyProvider('llamacpp', calls));

    await router.route({ model: 'gpt-4o-mini', messages: [], max_tokens: 10 });
    expect(calls).toEqual(['openai']);
  });

  it('throws when no configured provider serves the model', async () => {
    const router = new ProviderRouter({ db, credentials: new Map([['openai', 'k']]) });
    await expect(
      router.route({ model: 'local-only-model', messages: [], max_tokens: 10 }),
    ).rejects.toThrow(/All providers exhausted|No configured provider/);
  });
});

describe('PHASE4 P4.4 — per-(provider,model) health', () => {
  let db: Database.Database;
  beforeEach(() => (db = setup()));
  afterEach(() => db.close());

  it('tracks latency + errors per model and computes a health score', () => {
    const t = new HealthTracker(db);
    t.updateModelAfterCall('openai', 'gpt-4o-mini', true, 500);
    t.updateModelAfterCall('openai', 'gpt-4o-mini', true, 700);
    const rec = t.getModelHealth('openai', 'gpt-4o-mini')!;
    expect(rec.requests).toBe(2);
    expect(rec.errors).toBe(0);
    expect(rec.total_latency_ms).toBe(1200);
    expect(t.modelHealthScore('openai', 'gpt-4o-mini')).toBeCloseTo(1, 1);

    t.updateModelAfterCall('openai', 'gpt-4o-mini', false, 300, 'boom');
    const rec2 = t.getModelHealth('openai', 'gpt-4o-mini')!;
    expect(rec2.errors).toBe(1);
    expect(t.modelHealthScore('openai', 'gpt-4o-mini')).toBeLessThan(1);
  });

  it('an unknown pair scores neutral and is considered available', () => {
    const t = new HealthTracker(db);
    expect(t.modelHealthScore('openai', 'never-seen')).toBeCloseTo(0.5);
    expect(t.isModelAvailable('openai', 'never-seen')).toBe(true);
  });

  it('a cooled-down pair is unavailable and scores zero', () => {
    const t = new HealthTracker(db);
    const future = new Date(Date.now() + 60_000).toISOString();
    t.updateModelAfterCall('openai', 'gpt-4o-mini', false, 100, 'rate', future);
    expect(t.isModelAvailable('openai', 'gpt-4o-mini')).toBe(false);
    expect(t.modelHealthScore('openai', 'gpt-4o-mini')).toBe(0);
  });

  it('orders a healthier provider ahead of a failing one for a multi-provider model', async () => {
    // Make gpt-4o-mini servable by both openai and llamacpp via an alias trick:
    db.prepare(
      `INSERT INTO model_configs (model_id, provider, display_name, context_window, safe_input_budget,
         output_reservation, safety_margin_percent, tokenizer_type)
       VALUES ('shared-model', 'llamacpp', 'Shared L', 8192, 6144, 2048, 0.15, 'character-estimate')`,
    ).run();
    db.prepare(
      `INSERT INTO model_configs (model_id, provider, display_name, context_window, safe_input_budget,
         output_reservation, safety_margin_percent, tokenizer_type)
       VALUES ('shared-model-oa', 'openai', 'Shared O', 8192, 6144, 2048, 0.15, 'character-estimate')`,
    ).run();
    // alias both to 'shared' so providersForModel returns both.
    db.prepare("UPDATE model_configs SET aliases_json = json_array('shared') WHERE model_id IN ('shared-model','shared-model-oa')").run();

    const t = new HealthTracker(db);
    // openai is failing for 'shared'; llamacpp is healthy.
    t.updateModelAfterCall('openai', 'shared', false, 100, 'err');
    t.updateModelAfterCall('llamacpp', 'shared', true, 100);

    const calls: string[] = [];
    const router = new ProviderRouter({ db, credentials: new Map([['openai', 'k'], ['llamacpp', 'x']]) });
    (router as unknown as { adapters: Map<string, ProviderAdapter> }).adapters.set('openai', spyProvider('openai', calls));
    (router as unknown as { adapters: Map<string, ProviderAdapter> }).adapters.set('llamacpp', spyProvider('llamacpp', calls));

    await router.route({ model: 'shared', messages: [], max_tokens: 10 });
    expect(calls[0]).toBe('llamacpp'); // healthier first
  });
});
