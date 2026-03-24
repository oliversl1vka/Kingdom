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

  getAllHealth(): ProviderHealthRecord[] {
    return this.db.prepare('SELECT * FROM provider_health').all() as ProviderHealthRecord[];
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

  resetDaily(): void {
    this.db
      .prepare('UPDATE provider_health SET requests_today = 0, tokens_today = 0')
      .run();
  }
}
