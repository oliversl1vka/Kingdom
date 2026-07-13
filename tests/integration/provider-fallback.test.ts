import { beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CompletionRequest, CompletionResponse, ProviderAdapter } from '@kingdomos/core';
import { ProviderError, ProviderRouter } from '@kingdomos/providers';

const MIGRATIONS_DIR = join(__dirname, '..', '..', 'packages', 'core', 'migrations');
const MIGRATIONS = ['001_initial.sql', '003_seed_providers.sql', '012_provider_health_tokens.sql'];

const request: CompletionRequest = {
  model: 'mock-model',
  messages: [{ role: 'user', content: 'hello' }],
  max_tokens: 100,
  temperature: 0,
};

function response(content: string): CompletionResponse {
  return {
    content,
    prompt_tokens: 5,
    completion_tokens: 7,
    total_tokens: 12,
    finish_reason: 'stop',
  };
}

function adapter(id: string, complete: ProviderAdapter['complete']): ProviderAdapter {
  return {
    provider_id: id,
    complete,
    healthCheck: vi.fn(async () => ({ status: 'healthy' })),
  };
}

function createDb(): Database.Database {
  const db = new Database(':memory:');
  for (const migration of MIGRATIONS) {
    db.exec(readFileSync(join(MIGRATIONS_DIR, migration), 'utf-8'));
  }
  return db;
}

function markProvider(db: Database.Database, providerId: string, status: string, priority: number, cooldownUntil: string | null = null): void {
  db.prepare(
    `UPDATE provider_health
     SET status = ?, priority_order = ?, cooldown_until = ?, tokens_today = 0
     WHERE provider_id = ?`,
  ).run(status, priority, cooldownUntil, providerId);
}

function setAdapters(router: ProviderRouter, adapters: ProviderAdapter[]): void {
  const map = (router as unknown as { adapters: Map<string, ProviderAdapter> }).adapters;
  for (const provider of adapters) {
    map.set(provider.provider_id, provider);
  }
}

describe('Provider Fallback Integration', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createDb();
  });

  it('falls back to secondary provider on 429 rate-limit', async () => {
    markProvider(db, 'openai', 'healthy', 1);
    markProvider(db, 'lmstudio', 'healthy', 2);
    const openai = adapter('openai', vi.fn(async () => {
      throw new ProviderError('rate limited', 'openai', 429, true, 0);
    }));
    const lmstudio = adapter('lmstudio', vi.fn(async () => response('fallback response')));
    const router = new ProviderRouter({ db, credentials: new Map() });
    setAdapters(router, [openai, lmstudio]);

    await expect(router.route(request)).resolves.toMatchObject({ content: 'fallback response' });
    expect(openai.complete).toHaveBeenCalledOnce();
    expect(lmstudio.complete).toHaveBeenCalledOnce();
  });

  it('sets cooldown_until on rate-limited provider', async () => {
    markProvider(db, 'openai', 'healthy', 1);
    markProvider(db, 'lmstudio', 'healthy', 2);
    const router = new ProviderRouter({ db, credentials: new Map() });
    setAdapters(router, [
      adapter('openai', vi.fn(async () => { throw new ProviderError('rate limited', 'openai', 429, true, 0); })),
      adapter('lmstudio', vi.fn(async () => response('fallback response'))),
    ]);

    await router.route(request);

    const health = db.prepare('SELECT status, cooldown_until FROM provider_health WHERE provider_id = ?').get('openai') as {
      status: string;
      cooldown_until: string | null;
    };
    expect(health.status).toBe('cooldown');
    expect(health.cooldown_until).toBeTruthy();
    expect(new Date(health.cooldown_until!).getTime()).toBeGreaterThan(Date.now());
  });

  it('recovers after cooldown expires', async () => {
    markProvider(db, 'openai', 'cooldown', 1, new Date(Date.now() - 1000).toISOString());
    markProvider(db, 'lmstudio', 'healthy', 2);
    const openai = adapter('openai', vi.fn(async () => response('primary recovered')));
    const lmstudio = adapter('lmstudio', vi.fn(async () => response('fallback')));
    const router = new ProviderRouter({ db, credentials: new Map() });
    setAdapters(router, [openai, lmstudio]);

    await expect(router.route(request)).resolves.toMatchObject({ content: 'primary recovered' });
    expect(openai.complete).toHaveBeenCalledOnce();
    expect(lmstudio.complete).not.toHaveBeenCalled();
  });

  it('routes by provider priority so each provider can account for its own tokens', async () => {
    markProvider(db, 'openai', 'healthy', 2);
    markProvider(db, 'lmstudio', 'healthy', 1);
    const openai = adapter('openai', vi.fn(async () => response('openai')));
    const lmstudio = adapter('lmstudio', vi.fn(async () => response('lmstudio')));
    const router = new ProviderRouter({ db, credentials: new Map() });
    setAdapters(router, [openai, lmstudio]);

    await expect(router.route(request)).resolves.toMatchObject({ content: 'lmstudio' });

    const lmstudioHealth = db.prepare('SELECT requests_today, tokens_today FROM provider_health WHERE provider_id = ?').get('lmstudio') as {
      requests_today: number;
      tokens_today: number;
    };
    expect(lmstudioHealth).toMatchObject({ requests_today: 1, tokens_today: 12 });
    expect(openai.complete).not.toHaveBeenCalled();
  });

  it('throws when all providers are exhausted', async () => {
    markProvider(db, 'openai', 'healthy', 1);
    markProvider(db, 'lmstudio', 'healthy', 2);
    const router = new ProviderRouter({ db, credentials: new Map() });
    setAdapters(router, [
      adapter('openai', vi.fn(async () => { throw new ProviderError('openai failed', 'openai', 500, true); })),
      adapter('lmstudio', vi.fn(async () => { throw new ProviderError('lmstudio failed', 'lmstudio', 500, true); })),
    ]);

    await expect(router.route(request)).rejects.toMatchObject({
      name: 'ProviderError',
      provider_id: 'router',
    });
  });
});