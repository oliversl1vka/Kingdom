import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ReviewEngine, type ReviewContext } from '@kingdomos/core';
import type { CompletionRequest, CompletionResponse, Job, TierConfig } from '@kingdomos/core';
import { ModelRegistry, makeModelResolver } from '../../packages/token-engine/src/index.js';

const MIGRATIONS_DIR = join(__dirname, '..', '..', 'packages', 'core', 'migrations');

function runMigration(db: Database.Database, name: string) {
  db.exec(readFileSync(join(MIGRATIONS_DIR, name), 'utf-8'));
}

/** Minimal job stub — only fields ReviewEngine actually reads. */
function makeJob(): Job {
  return {
    id: 'job-1',
    task_id: 'task-1',
    worker_id: null,
    model: 'placeholder',
    status: 'running',
    started_at: null,
    heartbeat_at: null,
    timeout_at: null,
    cancel_requested: false,
    cancel_reason: null,
    result_path: null,
    failure_type: null,
    token_estimate: 0,
    tokens_used: null,
    parent_job_id: null,
    superseded_by: null,
    delegating_supervisor_id: 'king',
    created_at: new Date().toISOString(),
  };
}

/** Provider stub that captures every completion request so tests can inspect the model. */
function capturingProvider(response: string) {
  const calls: CompletionRequest[] = [];
  return {
    calls,
    adapter: {
      provider_id: 'stub',
      async complete(req: CompletionRequest): Promise<CompletionResponse> {
        calls.push(req);
        return {
          content: response,
          prompt_tokens: 10,
          completion_tokens: 10,
          total_tokens: 20,
          finish_reason: 'stop',
        };
      },
      async healthCheck() {
        return { status: 'healthy' as const };
      },
    },
  };
}

const BASE_DIFF = `--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1,1 +1,1 @@\n-old\n+new\n`;

describe('ReviewEngine with capability-based resolver — Phase A chunk 2', () => {
  let db: Database.Database;
  let registry: ModelRegistry;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('journal_mode = WAL');
    // We're only verifying model selection, not DB referential integrity —
    // skip FK checks so we don't have to insert parent rows for jobs/tasks.
    db.pragma('foreign_keys = OFF');
    runMigration(db, '001_initial.sql');
    runMigration(db, '002_seed_models.sql');
    runMigration(db, '009_model_capabilities.sql');
    registry = new ModelRegistry(db);
  });

  afterEach(() => {
    db.close();
  });

  it('uses resolveModel()-picked model when a resolver is injected', async () => {
    // Tier with a review profile preferring a premium model → should pick gpt-4o.
    const tier: TierConfig = {
      model: 'gpt-4o-mini',                                    // pinned fallback
      profile: { task_kind: 'review', cost_preference: 'premium' },
      max_retries: 3,
      timeout_seconds: 60,
    };
    const resolver = makeModelResolver(tier, registry, 'review');
    const stub = capturingProvider('{"pass": true, "feedback": "ok"}');

    const engine = new ReviewEngine(db, stub.adapter, resolver);
    const ctx: ReviewContext = {
      job: makeJob(),
      diffText: BASE_DIFF,
      allowedFiles: [],
      acceptanceCriteria: ['function exists'],
    };
    await engine.review(ctx);

    expect(stub.calls).toHaveLength(1);
    expect(stub.calls[0].model).toBe('gpt-4o');                 // profile won
  });

  it('injects a default review profile when tier has none', async () => {
    // Legacy tier with no profile and no pinned model. makeModelResolver
    // injects a default review profile, and registry selection runs.
    const tier: TierConfig = {
      model: '',                                                // empty → profile fallback allowed
      max_retries: 3,
      timeout_seconds: 60,
    };
    const resolver = makeModelResolver(tier, registry, 'review');
    const stub = capturingProvider('{"pass": true}');

    const engine = new ReviewEngine(db, stub.adapter, resolver);
    await engine.review({
      job: makeJob(),
      diffText: BASE_DIFF,
      allowedFiles: [],
      acceptanceCriteria: ['x'],
    });

    // Default profile = review strength → gpt-4o or gpt-4o-mini; gpt-4o tops
    // because its strengths include 'review' AND its tier_class wins a tie.
    expect(['gpt-4o', 'gpt-4o-mini']).toContain(stub.calls[0].model);
  });

  it('still accepts a plain model string (legacy path)', async () => {
    const stub = capturingProvider('{"pass": true}');
    const engine = new ReviewEngine(db, stub.adapter, 'gpt-4o-mini');
    await engine.review({
      job: makeJob(),
      diffText: BASE_DIFF,
      allowedFiles: [],
      acceptanceCriteria: ['x'],
    });
    expect(stub.calls[0].model).toBe('gpt-4o-mini');
  });

  it('honors per-call ctx.reviewerModel override above the resolver', async () => {
    const tier: TierConfig = {
      model: 'gpt-4o-mini',
      profile: { task_kind: 'review', cost_preference: 'premium' },
      max_retries: 3,
      timeout_seconds: 60,
    };
    const resolver = makeModelResolver(tier, registry, 'review');
    const stub = capturingProvider('{"pass": true}');
    const engine = new ReviewEngine(db, stub.adapter, resolver);

    await engine.review({
      job: makeJob(),
      diffText: BASE_DIFF,
      allowedFiles: [],
      acceptanceCriteria: ['x'],
      reviewerModel: 'qwen2.5-coder-7b',
    });

    // Per-call override beats everything else.
    expect(stub.calls[0].model).toBe('qwen2.5-coder-7b');
  });

  it('falls back to the static model when resolver throws', async () => {
    const throwingResolver = () => {
      throw new Error('registry exploded');
    };
    const stub = capturingProvider('{"pass": true}');
    // Using 3-arg form: ReviewEngine(db, provider, resolver). Static fallback is hardcoded to "gpt-4.1-mini".
    const engine = new ReviewEngine(db, stub.adapter, throwingResolver);
    await engine.review({
      job: makeJob(),
      diffText: BASE_DIFF,
      allowedFiles: [],
      acceptanceCriteria: ['x'],
    });
    expect(stub.calls[0].model).toBe('gpt-4.1-mini');
  });
});
