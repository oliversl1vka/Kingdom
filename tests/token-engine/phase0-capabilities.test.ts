import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ModelRegistry } from '../../packages/token-engine/src/model-registry.js';
import {
  resolveModel,
  makeModelResolver,
} from '../../packages/token-engine/src/resolve-model.js';
import type { TierConfig } from '@kingdomos/core';

const MIGRATIONS_DIR = join(__dirname, '..', '..', 'packages', 'core', 'migrations');

function setup() {
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  for (const f of [
    '001_initial.sql',
    '002_seed_models.sql',
    '009_model_capabilities.sql',
    '015_phase0_capabilities.sql',
  ]) {
    db.exec(readFileSync(join(MIGRATIONS_DIR, f), 'utf-8'));
  }
  return { db, registry: new ModelRegistry(db) };
}

describe('Phase 0 — capability tiering activation', () => {
  let db: Database.Database;
  let registry: ModelRegistry;

  beforeEach(() => { ({ db, registry } = setup()); });
  afterEach(() => { db.close(); });

  // ── resolver precedence ─────────────────────────────────────────────────
  it('an explicit profile ALWAYS wins over the name pin', () => {
    const tier: TierConfig = {
      model: 'gpt-4o-mini',
      profile: { task_kind: 'decomposition', cost_preference: 'premium' },
      max_retries: 3,
      timeout_seconds: 60,
    };
    const resolver = makeModelResolver(tier, registry, 'implementation');
    // premium decomposition strength ⇒ gpt-4o (not the pinned mini)
    expect(resolver()).toBe('gpt-4o');
    expect(resolveModel(tier, registry).source).toBe('profile');
  });

  it('REGRESSION: a pure name pin (no profile) resolves to that exact model', () => {
    // This is the anti-regression for the squire→gpt-4.1-mini misroute: with no
    // profile, makeModelResolver must NOT inject one and must honor the pin.
    const tier: TierConfig = { model: 'qwen2.5-coder-7b', max_retries: 3, timeout_seconds: 300 };
    const resolver = makeModelResolver(tier, registry, 'implementation');
    expect(resolver()).toBe('qwen2.5-coder-7b');
    expect(resolveModel(tier, registry).source).toBe('pinned');
  });

  it('injects a default profile only when neither profile nor pin is set', () => {
    const tier = { model: '', max_retries: 3, timeout_seconds: 60 } as TierConfig;
    const resolver = makeModelResolver(tier, registry, 'review');
    // Picks *some* model with a review strength; just assert it resolved to a real one.
    expect(['gpt-4o', 'gpt-4o-mini', 'gpt-4.1-mini', 'claude-opus-4']).toContain(resolver());
  });

  it('prefer_local + cheap implementation routes to the local llama.cpp coder', () => {
    const tier: TierConfig = {
      model: 'qwen2.5-coder-7b',
      profile: { task_kind: 'implementation', cost_preference: 'cheap', prefer_local: true },
      max_retries: 3,
      timeout_seconds: 300,
    };
    const resolved = resolveModel(tier, registry);
    expect(resolved.source).toBe('profile');
    expect(resolved.model.model_id).toBe('qwen2.5-coder-7b');
    expect(resolved.model.provider).toBe('llamacpp');
  });

  // ── capabilities lookup ─────────────────────────────────────────────────
  it('getModelCapabilities returns real flags for seeded models', () => {
    const caps = registry.getModelCapabilities('gpt-4.1-mini');
    expect(caps).not.toBeNull();
    expect(caps!.tool_use).toBe(true);
    expect(caps!.structured_output).toBe(true);
    expect(caps!.tier_class).toBe('balanced');

    const frontier = registry.getModelCapabilities('claude-opus-4');
    expect(frontier!.tier_class).toBe('premium');
    expect(frontier!.strengths).toContain('implementation');
  });

  it('getModelCapabilities returns false tool_use for the local coder (keeps prose fallback)', () => {
    const caps = registry.getModelCapabilities('qwen2.5-coder-7b');
    expect(caps!.tool_use).toBe(false);
    expect(caps!.structured_output).toBe(true);
  });

  it('getModelCapabilities returns null for an unknown model', () => {
    expect(registry.getModelCapabilities('gpt-9-mythical')).toBeNull();
  });
});
