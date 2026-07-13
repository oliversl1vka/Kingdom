import type Database from 'better-sqlite3';
import type { ProviderAdapter, CompletionRequest, CompletionResponse } from '@kingdomos/core';
import { ProviderError } from './errors.js';
import { HealthTracker } from './health-tracker.js';
import { createLMStudioAdapter } from './lmstudio-adapter.js';
import { createLlamaCppAdapter } from './llamacpp-adapter.js';
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

    if (credentials.has('llamacpp')) {
      this.adapters.set('llamacpp', createLlamaCppAdapter({
        endpoint: endpoints?.get('llamacpp') ?? 'http://localhost:8080',
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
    // PHASE4 (P4.4): route by MODEL, not just provider. Only consider providers
    // that actually serve `request.model` (per the registry index), ordered by
    // per-(provider,model) health then provider priority. The pre-Phase-4
    // behaviour (priority-ordered failover across ALL providers) is preserved
    // as a fallback when the model is unknown to the registry.
    const providers = this.getCandidateProviders(request.model);

    for (const entry of providers) {
      if (!this.tracker.isAvailable(entry.provider_id)) continue;
      if (!this.tracker.isModelAvailable(entry.provider_id, request.model)) continue;

      const adapter = this.adapters.get(entry.provider_id);
      if (!adapter) continue;

      const startedAt = Date.now();
      try {
        const response = await adapter.complete(request);
        const latency = Date.now() - startedAt;
        this.tracker.updateAfterCall(entry.provider_id, true, response.total_tokens);
        this.tracker.updateModelAfterCall(entry.provider_id, request.model, true, latency);
        return response;
      } catch (error) {
        const latency = Date.now() - startedAt;
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
        // PHASE4: a model-level failure (e.g. model-not-served, overflow) parks
        // this (provider,model) pair so the loop re-resolves onto the next
        // provider that serves the model — wiring the fallback chain at the
        // model granularity.
        this.tracker.updateModelAfterCall(
          entry.provider_id,
          request.model,
          false,
          latency,
          provError?.message ?? String(error),
          cooldownUntil,
        );
      }
    }

    throw new ProviderError(
      providers.length === 0
        ? `No configured provider serves model "${request.model}"`
        : 'All providers exhausted — entering wait state',
      'router',
      0,
      true
    );
  }

  /**
   * PHASE4 (P4.4): providers that serve `model`, ordered by health (desc) then
   * provider priority (asc). Falls back to all configured providers (legacy
   * behaviour) when the registry has no entry for the model — so brand-new
   * models still route somewhere.
   */
  private getCandidateProviders(model: string): ProviderEntry[] {
    const ordered = this.getOrderedProviders();
    const serving = this.providersForModel(model);

    let candidates: ProviderEntry[];
    if (serving.size === 0) {
      candidates = ordered; // unknown model — legacy fanout
    } else {
      candidates = ordered.filter((p) => serving.has(p.provider_id));
      // If the registry names a provider that isn't in provider_health, still
      // allow it (synthesised at the end) so a freshly-added provider works.
      for (const pid of serving) {
        if (!candidates.some((c) => c.provider_id === pid)) {
          candidates.push({ provider_id: pid, priority_order: 999 });
        }
      }
    }

    return candidates.sort((a, b) => {
      const ha = this.tracker.modelHealthScore(a.provider_id, model);
      const hb = this.tracker.modelHealthScore(b.provider_id, model);
      if (hb !== ha) return hb - ha; // healthier first
      return a.priority_order - b.priority_order; // then provider priority
    });
  }

  /**
   * Build the model→provider(s) set from the registry. A model may be served
   * by more than one provider (e.g. an open model on both llamacpp and a cloud
   * mirror); we honour every row whose model_id OR alias matches.
   */
  private providersForModel(model: string): Set<string> {
    const out = new Set<string>();
    if (!this.hasModelConfigsTable()) return out;
    try {
      const rows = this.config.db
        .prepare('SELECT model_id, provider, aliases_json FROM model_configs')
        .all() as Array<{ model_id: string; provider: string; aliases_json: string | null }>;
      for (const r of rows) {
        if (r.model_id === model) {
          out.add(r.provider);
          continue;
        }
        if (r.aliases_json) {
          try {
            const aliases = JSON.parse(r.aliases_json) as string[];
            if (Array.isArray(aliases) && aliases.includes(model)) out.add(r.provider);
          } catch {
            /* ignore malformed aliases */
          }
        }
      }
    } catch {
      /* registry missing column — treat as unknown */
    }
    return out;
  }

  private _hasModelConfigs?: boolean;
  private hasModelConfigsTable(): boolean {
    if (this._hasModelConfigs !== undefined) return this._hasModelConfigs;
    const row = this.config.db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='model_configs'")
      .get();
    this._hasModelConfigs = !!row;
    return this._hasModelConfigs;
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
