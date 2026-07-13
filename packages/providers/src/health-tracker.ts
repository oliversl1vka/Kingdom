import type Database from 'better-sqlite3';
import type { ProviderHealthStatus } from '@kingdomos/core';

export interface ProviderHealthRecord {
  provider_id: string;
  status: string;
  last_error: string | null;
  cooldown_until: string | null;
  requests_today: number;
  tokens_today: number;
  rate_limit_remaining: number | null;
  last_check: string;
}

export class HealthTracker {
  constructor(private db: Database.Database) {}

  getHealth(providerId: string): ProviderHealthRecord | null {
    return (
      (this.db
        .prepare('SELECT * FROM provider_health WHERE provider_id = ?')
        .get(providerId) as ProviderHealthRecord | undefined) ?? null
    );
  }

  updateAfterCall(
    providerId: string,
    success: boolean,
    tokensUsed: number,
    healthStatus?: ProviderHealthStatus,
    rateLimitRemaining?: number,
    cooldownUntil?: string
  ): void {
    const now = new Date().toISOString();
    const status = success ? 'healthy' : (cooldownUntil ? 'cooldown' : 'degraded');
    const error = success ? null : (healthStatus?.last_error ?? 'Request failed');

    this.db
      .prepare(
        `UPDATE provider_health
         SET status = ?,
             last_error = ?,
             cooldown_until = ?,
             requests_today = requests_today + 1,
             tokens_today = tokens_today + ?,
             rate_limit_remaining = ?,
             last_check = ?
         WHERE provider_id = ?`
      )
      .run(status, error, cooldownUntil ?? null, tokensUsed, rateLimitRemaining ?? null, now, providerId);
  }

  isAvailable(providerId: string): boolean {
    const health = this.getHealth(providerId);
    if (!health) return false;
    if (health.status === 'unavailable') return false;
    if (health.status === 'cooldown' && health.cooldown_until) {
      return new Date(health.cooldown_until) <= new Date();
    }
    return true;
  }

  // ──────────────────────────────────────────────────────────────────────
  // PHASE4 (P4.4): per-(provider,model) health. Refines provider-level health
  // so a model failing on one provider can be de-prioritised without taking
  // the whole provider offline. provider_health stays authoritative for
  // provider availability/cooldown; this adds a model-resolution lens.
  // ──────────────────────────────────────────────────────────────────────

  private _hasPerModelTable?: boolean;
  private hasPerModelTable(): boolean {
    if (this._hasPerModelTable !== undefined) return this._hasPerModelTable;
    const row = this.db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='provider_model_health'")
      .get();
    this._hasPerModelTable = !!row;
    return this._hasPerModelTable;
  }

  getModelHealth(providerId: string, model: string): ProviderModelHealthRecord | null {
    if (!this.hasPerModelTable()) return null;
    return (
      (this.db
        .prepare('SELECT * FROM provider_model_health WHERE provider_id = ? AND model = ?')
        .get(providerId, model) as ProviderModelHealthRecord | undefined) ?? null
    );
  }

  /**
   * Record the outcome of a per-model call. Upserts the row and accumulates
   * latency + error counters. `cooldownUntil` (e.g. on a 429) parks that exact
   * (provider,model) pair until the timestamp.
   */
  updateModelAfterCall(
    providerId: string,
    model: string,
    success: boolean,
    latencyMs: number,
    error?: string | null,
    cooldownUntil?: string,
  ): void {
    if (!this.hasPerModelTable()) return;
    const now = new Date().toISOString();
    const status = success ? 'healthy' : cooldownUntil ? 'cooldown' : 'degraded';
    this.db
      .prepare(
        `INSERT INTO provider_model_health (
           provider_id, model, requests, errors, total_latency_ms,
           last_latency_ms, last_error, last_status, cooldown_until, last_check
         ) VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(provider_id, model) DO UPDATE SET
           requests = requests + 1,
           errors = errors + ?,
           total_latency_ms = total_latency_ms + ?,
           last_latency_ms = ?,
           last_error = ?,
           last_status = ?,
           cooldown_until = ?,
           last_check = ?`,
      )
      .run(
        providerId,
        model,
        success ? 0 : 1,
        latencyMs,
        latencyMs,
        success ? null : (error ?? 'Request failed'),
        status,
        cooldownUntil ?? null,
        now,
        // update branch
        success ? 0 : 1,
        latencyMs,
        latencyMs,
        success ? null : (error ?? 'Request failed'),
        status,
        cooldownUntil ?? null,
        now,
      );
  }

  /** Available unless this exact (provider,model) pair is in active cooldown. */
  isModelAvailable(providerId: string, model: string): boolean {
    const h = this.getModelHealth(providerId, model);
    if (!h) return true; // unknown pair — optimistic; provider-level gate still applies
    if (h.cooldown_until) return new Date(h.cooldown_until) <= new Date();
    return true;
  }

  /**
   * Health score in [0,1] for ordering candidate providers for a model. Higher
   * is better. Unknown pairs score a neutral 0.5 so they are tried but ranked
   * below a proven-healthy pair. Error rate dominates; latency is a tiebreaker.
   */
  modelHealthScore(providerId: string, model: string): number {
    const h = this.getModelHealth(providerId, model);
    if (!h || h.requests === 0) return 0.5;
    if (h.cooldown_until && new Date(h.cooldown_until) > new Date()) return 0;
    const successRate = (h.requests - h.errors) / h.requests;
    const avgLatency = h.total_latency_ms / h.requests;
    // Latency penalty: 0 at ≤1s, up to ~0.2 at ≥10s.
    const latencyPenalty = Math.min(0.2, Math.max(0, (avgLatency - 1000) / 45_000));
    return Math.max(0, successRate - latencyPenalty);
  }
}

export interface ProviderModelHealthRecord {
  provider_id: string;
  model: string;
  requests: number;
  errors: number;
  total_latency_ms: number;
  last_latency_ms: number | null;
  last_error: string | null;
  last_status: string;
  cooldown_until: string | null;
  last_check: string;
}
