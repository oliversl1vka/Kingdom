import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ModelRegistry } from '../../packages/token-engine/src/model-registry.js';
import {
  resolveModel,
  selectByProfile,
  scoreCandidate,
} from '../../packages/token-engine/src/resolve-model.js';
import type { CapabilityProfile, TierConfig } from '@kingdomos/core';

const MIGRATIONS_DIR = join(__dirname, '..', '..', 'packages', 'core', 'migrations');

function runMigration(db: Database.Database, name: string) {
  db.exec(readFileSync(join(MIGRATIONS_DIR, name), 'utf-8'));
}

describe('resolveModel — Phase A chunk 1', () => {
  let db: Database.Database;
  let registry: ModelRegistry;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('journal_mode = WAL');
    runMigration(db, '001_initial.sql');
    runMigration(db, '002_seed_models.sql');
    runMigration(db, '009_model_capabilities.sql');
    registry = new ModelRegistry(db);
  });

  afterEach(() => {
    db.close();
  });

  // ─── Registry capability & alias support ──────────────────────

  it('loads capabilities_json and aliases_json from the registry', () => {
    const m = registry.getModelConfig('gpt-4o');
    expect(m).not.toBeNull();
    expect(m!.capabilities?.tier_class).toBe('premium');
    expect(m!.capabilities?.strengths).toContain('decomposition');
    expect(m!.aliases).toContain('best-reasoning');
  });

  it('resolves an alias to the canonical model_id', () => {
    const m = registry.getModelConfig('cheap-coder');
    expect(m).not.toBeNull();
    expect(m!.model_id).toBe('qwen2.5-coder-7b');
  });

  it('returns null for a wholly unknown id', () => {
    expect(registry.getModelConfig('gpt-7-magic')).toBeNull();
  });

  // ─── Scoring semantics ────────────────────────────────────────

  it('scores a strength match higher than a non-match', () => {
    const coder = registry.getModelConfig('qwen2.5-coder-7b')!;
    const flagship = registry.getModelConfig('gpt-4o')!;
    const profile: CapabilityProfile = { task_kind: 'implementation' };
    const codeScore = scoreCandidate(coder, profile)!;
    const flagshipScore = scoreCandidate(flagship, profile);
    expect(codeScore).toBeGreaterThan(flagshipScore ?? 0);
  });

  it('rejects a model whose context window is too small', () => {
    const coder = registry.getModelConfig('qwen2.5-coder-7b')!; // 32k window
    const profile: CapabilityProfile = {
      task_kind: 'implementation',
      min_context_tokens: 100_000,
    };
    expect(scoreCandidate(coder, profile)).toBeNull();
  });

  it('rejects when a required capability is missing', () => {
    const coder = registry.getModelConfig('qwen2.5-coder-7b')!;
    // qwen is seeded as tool_use=false
    const profile: CapabilityProfile = { task_kind: 'implementation', needs_tool_use: true };
    expect(scoreCandidate(coder, profile)).toBeNull();
  });

  it('returns a small baseline score for unverified models (null capabilities)', () => {
    const unverified = {
      ...registry.getModelConfig('gpt-4o')!,
      capabilities: null,
    };
    const profile: CapabilityProfile = { task_kind: 'review' };
    expect(scoreCandidate(unverified, profile)).toBe(0.5);
  });

  // ─── selectByProfile ──────────────────────────────────────────

  it('picks the best model for the "implementation" task_kind', () => {
    const result = selectByProfile({ task_kind: 'implementation' }, registry);
    expect(result).not.toBeNull();
    // Both gpt-4o-mini and qwen list 'implementation'. qwen tops because it
    // also has tool_use=false (no impact) but same base strength score (+10),
    // tiebroken by… both are 'cheap' and 'fast'. Without further preferences
    // this is effectively arbitrary — just assert we got one of the coders.
    expect(['gpt-4o-mini', 'qwen2.5-coder-7b']).toContain(result!.model.model_id);
  });

  it('picks premium model when cost_preference = premium', () => {
    const result = selectByProfile(
      { task_kind: 'review', cost_preference: 'premium' },
      registry,
    );
    expect(result!.model.model_id).toBe('gpt-4o');
  });

  // ─── resolveModel end-to-end ──────────────────────────────────

  it('honors a pinned model_id (legacy path, no profile)', () => {
    const tier: TierConfig = { model: 'gpt-4o-mini', max_retries: 3, timeout_seconds: 60 };
    const resolved = resolveModel(tier, registry);
    expect(resolved.source).toBe('pinned');
    expect(resolved.model.model_id).toBe('gpt-4o-mini');
  });

  it('resolves an alias in tier.model', () => {
    const tier: TierConfig = { model: 'best-reasoning', max_retries: 3, timeout_seconds: 60 };
    const resolved = resolveModel(tier, registry);
    expect(resolved.source).toBe('alias');
    expect(resolved.model.model_id).toBe('gpt-4o');
  });

  it('uses capability profile over pinned model when profile present', () => {
    const tier: TierConfig = {
      model: 'gpt-4o-mini', // would normally win
      profile: { task_kind: 'decomposition', cost_preference: 'premium' },
      max_retries: 3,
      timeout_seconds: 60,
    };
    const resolved = resolveModel(tier, registry);
    expect(resolved.source).toBe('profile');
    expect(resolved.model.model_id).toBe('gpt-4o');
  });

  it('falls back when pinned model is not in the registry', () => {
    const tier: TierConfig = {
      model: 'gpt-9-mythical',
      fallback_chain: ['gpt-4o-mini'],
      max_retries: 3,
      timeout_seconds: 60,
    };
    const resolved = resolveModel(tier, registry);
    expect(resolved.source).toBe('fallback');
    expect(resolved.model.model_id).toBe('gpt-4o-mini');
  });

  it('returns a synthetic config for unknown models with no fallback', () => {
    const tier: TierConfig = { model: 'gpt-9-mythical', max_retries: 3, timeout_seconds: 60 };
    const resolved = resolveModel(tier, registry);
    expect(resolved.source).toBe('default');
    expect(resolved.model.model_id).toBe('gpt-9-mythical');
    expect(resolved.model.tokenizer_type).toBe('character-estimate');
    expect(resolved.model.provider).toBe('unknown');
  });

  it('fallback profile works when fallback_chain contains a CapabilityProfile', () => {
    const tier: TierConfig = {
      model: 'gpt-9-mythical',
      fallback_chain: [{ task_kind: 'review', cost_preference: 'premium' }],
      max_retries: 3,
      timeout_seconds: 60,
    };
    const resolved = resolveModel(tier, registry);
    expect(resolved.source).toBe('fallback');
    expect(resolved.model.model_id).toBe('gpt-4o');
  });
});
