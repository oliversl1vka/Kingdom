import type Database from 'better-sqlite3';
import type { ProviderAdapter, CompletionRequest, CompletionResponse } from '@kingdomos/core';
import { ProviderError } from './errors.js';
import { HealthTracker } from './health-tracker.js';
import { createLMStudioAdapter } from './lmstudio-adapter.js';
import { createOpenAIAdapter } from './openai-adapter.js';
import { createAnthropicAdapter } from './anthropic-adapter.js';
import { createGoogleAdapter } from './google-adapter.js';

export interface ProviderRouterConfig {
  db: Database.Database;
  credentials: Map<string, string>; // provider_id → api_key (decrypted, in-memory only)
  endpoints?: Map<string, string>;  // provider_id → endpoint override
}

interface ProviderEntry {
  provider_id: string;
  priority_order: number;
}

export class ProviderRouter {
  private tracker: HealthTracker;
  private adapters = new Map<string, ProviderAdapter>();

  constructor(private config: ProviderRouterConfig) {
    this.tracker = new HealthTracker(config.db);
    this.initializeAdapters();
  }

  private initializeAdapters(): void {
    const { credentials, endpoints } = this.config;

    if (credentials.has('lmstudio')) {
      this.adapters.set('lmstudio', createLMStudioAdapter({
        endpoint: endpoints?.get('lmstudio') ?? 'http://localhost:1234',
      }));
    }

    if (credentials.has('openai')) {
      this.adapters.set('openai', createOpenAIAdapter({
        api_key: credentials.get('openai')!,
        endpoint: endpoints?.get('openai'),
      }));
    }

    if (credentials.has('anthropic')) {
      this.adapters.set('anthropic', createAnthropicAdapter({
        api_key: credentials.get('anthropic')!,
        endpoint: endpoints?.get('anthropic'),
      }));
    }

    if (credentials.has('google')) {
      this.adapters.set('google', createGoogleAdapter({
        api_key: credentials.get('google')!,
        endpoint: endpoints?.get('google'),
      }));
    }
  }

  async route(request: CompletionRequest): Promise<CompletionResponse> {
    const providers = this.getOrderedProviders();

    for (const entry of providers) {
      if (!this.tracker.isAvailable(entry.provider_id)) continue;

      const adapter = this.adapters.get(entry.provider_id);
      if (!adapter) continue;

      try {
        const response = await adapter.complete(request);
        this.tracker.updateAfterCall(entry.provider_id, true, response.total_tokens);
        return response;
      } catch (error) {
        const provError = error instanceof ProviderError ? error : null;
        const cooldownUntil =
          provError?.statusCode === 429
            ? new Date(Date.now() + 60_000).toISOString()
            : undefined;

        this.tracker.updateAfterCall(
          entry.provider_id,
          false,
          0,
          undefined,
          provError?.rateLimitRemaining,
          cooldownUntil
        );
      }
    }

    throw new ProviderError(
      'All providers exhausted — entering wait state',
      'router',
      0,
      true
    );
  }

  private getOrderedProviders(): ProviderEntry[] {
    return this.config.db
      .prepare('SELECT provider_id, priority_order FROM provider_health ORDER BY priority_order ASC')
      .all() as ProviderEntry[];
  }

  getAdapter(providerId: string): ProviderAdapter | undefined {
    return this.adapters.get(providerId);
  }
}
