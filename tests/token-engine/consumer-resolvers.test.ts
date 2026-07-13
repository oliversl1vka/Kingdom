import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  TaskDecomposer,
  TaskRepository,
  ObjectiveRepository,
} from '@kingdomos/core';
import type { ProviderAdapter, TierConfig } from '@kingdomos/core';
import { Diagnostician, HealerWorker } from '@kingdomos/healer';
import { ModelRegistry, makeModelResolver } from '../../packages/token-engine/src/index.js';

const MIGRATIONS_DIR = join(__dirname, '..', '..', 'packages', 'core', 'migrations');

function setup() {
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = OFF');
  for (const f of ['001_initial.sql', '002_seed_models.sql', '009_model_capabilities.sql']) {
    db.exec(readFileSync(join(MIGRATIONS_DIR, f), 'utf-8'));
  }
  return { db, registry: new ModelRegistry(db) };
}

// Minimal ProviderAdapter stub — these tests never invoke complete().
const stubProvider: ProviderAdapter = {
  provider_id: 'stub',
  async complete() {
    throw new Error('not expected to be called in resolver tests');
  },
  async healthCheck() {
    return { status: 'healthy' as const };
  },
};

describe('ModelResolver wiring across consumers — Phase A chunk 3', () => {
  let db: Database.Database;
  let registry: ModelRegistry;

  beforeEach(() => { ({ db, registry } = setup()); });
  afterEach(() => { db.close(); });

  // ─── TaskDecomposer ────────────────────────────────────────────

  describe('TaskDecomposer', () => {
    it('defaults to static gpt-4o when no resolver given', () => {
      const dec = new TaskDecomposer(
        new TaskRepository(db),
        new ObjectiveRepository(db),
        stubProvider,
      );
      expect(dec.getEffectiveModel()).toBe('gpt-4o');
    });

    it('honors a literal model string override', () => {
      const dec = new TaskDecomposer(
        new TaskRepository(db),
        new ObjectiveRepository(db),
        stubProvider,
        undefined,
        'gpt-4o-mini',
      );
      expect(dec.getEffectiveModel()).toBe('gpt-4o-mini');
    });

    it('uses a resolver closure when one is injected', () => {
      const tier: TierConfig = {
        model: 'gpt-4o-mini',
        profile: { task_kind: 'decomposition', cost_preference: 'premium' },
        max_retries: 3,
        timeout_seconds: 120,
      };
      const dec = new TaskDecomposer(
        new TaskRepository(db),
        new ObjectiveRepository(db),
        stubProvider,
        undefined,
        makeModelResolver(tier, registry, 'decomposition'),
      );
      // profile + premium ⇒ gpt-4o wins
      expect(dec.getEffectiveModel()).toBe('gpt-4o');
    });

    it('falls back to static when resolver throws', () => {
      const dec = new TaskDecomposer(
        new TaskRepository(db),
        new ObjectiveRepository(db),
        stubProvider,
        undefined,
        () => { throw new Error('boom'); },
      );
      expect(dec.getEffectiveModel()).toBe('gpt-4o');
    });
  });

  // ─── Diagnostician ─────────────────────────────────────────────

  describe('Diagnostician', () => {
    it('defaults to gpt-4.1-mini', () => {
      const d = new Diagnostician(db, stubProvider);
      expect(d.getEffectiveModel()).toBe('gpt-4.1-mini');
    });

    it('accepts a concrete model id', () => {
      const d = new Diagnostician(db, stubProvider, 'qwen2.5-coder-7b');
      expect(d.getEffectiveModel()).toBe('qwen2.5-coder-7b');
    });

    it('uses a resolver for healing-task selection', () => {
      const tier: TierConfig = {
        model: 'gpt-4o-mini',
        profile: { task_kind: 'healing' },
        max_retries: 3,
        timeout_seconds: 120,
      };
      // gpt-4o-mini is the only model with 'healing' in its strengths seed.
      const d = new Diagnostician(db, stubProvider, makeModelResolver(tier, registry, 'healing'));
      expect(d.getEffectiveModel()).toBe('gpt-4o-mini');
    });
  });

  // ─── HealerWorker (passthrough to Diagnostician) ───────────────

  describe('HealerWorker', () => {
    it('passes a string model through to its Diagnostician', () => {
      const hw = new HealerWorker(db, stubProvider, { model: 'gpt-4o' });
      expect(hw.getEffectiveModel()).toBe('gpt-4o');
    });

    it('passes a resolver through to its Diagnostician', () => {
      const tier: TierConfig = {
        model: 'best-reasoning',  // alias → gpt-4o
        max_retries: 3,
        timeout_seconds: 120,
      };
      const hw = new HealerWorker(db, stubProvider, {
        model: makeModelResolver(tier, registry, 'healing'),
      });
      // Operator pinned an alias. Since tier.model is set, we honor it and
      // resolve the alias to gpt-4o — we do NOT inject a healing profile that
      // would silently override the operator's choice (that behavior caused
      // squire/knight jobs to silently run on capability-picked models
      // despite being pinned in kingdom.config.json).
      expect(hw.getEffectiveModel()).toBe('gpt-4o');
    });
  });
});
