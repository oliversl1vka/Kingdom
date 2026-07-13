import type { ModelConfig, ModelCapabilities } from '@kingdomos/core';
import type Database from 'better-sqlite3';

export class ModelRegistry {
  private aliasesJsonAvailable?: boolean;

  constructor(private db: Database.Database) {}

  private rowToConfig(row: Record<string, unknown>): ModelConfig {
    return {
      model_id: row.model_id as string,
      provider: row.provider as string,
      display_name: row.display_name as string,
      context_window: row.context_window as number,
      safe_input_budget: row.safe_input_budget as number,
      output_reservation: row.output_reservation as number,
      safety_margin_percent: row.safety_margin_percent as number,
      tokenizer_type: row.tokenizer_type as ModelConfig['tokenizer_type'],
      tokenizer_config: row.tokenizer_config ? JSON.parse(row.tokenizer_config as string) : null,
      tier_assignment: (row.tier_assignment as ModelConfig['tier_assignment']) ?? null,
      capabilities: row.capabilities_json
        ? (JSON.parse(row.capabilities_json as string) as ModelConfig['capabilities'])
        : null,
      aliases: row.aliases_json ? (JSON.parse(row.aliases_json as string) as string[]) : [],
    };
  }

  getModelConfig(modelId: string): ModelConfig | null {
    // Match either by primary key or alias. We prefer the direct hit to keep
    // behavior stable when an alias collides with a future real model id.
    const direct = this.db
      .prepare('SELECT * FROM model_configs WHERE model_id = ?')
      .get(modelId) as Record<string, unknown> | undefined;
    if (direct) return this.rowToConfig(direct);
    if (!this.hasAliasesJsonColumn()) return null;

    const byAlias = this.db
      .prepare(
        `SELECT * FROM model_configs
         WHERE aliases_json IS NOT NULL
           AND EXISTS (SELECT 1 FROM json_each(aliases_json) WHERE value = ?)`,
      )
      .get(modelId) as Record<string, unknown> | undefined;
    return byAlias ? this.rowToConfig(byAlias) : null;
  }

  getAllModels(): ModelConfig[] {
    const rows = this.db.prepare('SELECT * FROM model_configs').all() as Record<string, unknown>[];
    return rows.map((row) => this.rowToConfig(row));
  }

  /**
   * Look up a resolved model's capability flags. Returns null when the model
   * is unknown OR known-but-unverified (no capabilities row). Phase 2/3 gate
   * agentic loops on `caps.tool_use` / `caps.structured_output`; callers should
   * treat null as "assume the legacy prose-and-parse path".
   */
  getModelCapabilities(modelId: string): ModelCapabilities | null {
    const config = this.getModelConfig(modelId);
    return config?.capabilities ?? null;
  }

  getSafeInputBudget(modelId: string): number {
    const config = this.getModelConfig(modelId);
    if (!config) throw new Error(`Model "${modelId}" not found in registry`);
    return config.safe_input_budget;
  }

  /**
   * PHASE4 (P4.3): write MEASURED capabilities (with a fresh `verified_at`)
   * back into the registry. Additive to the Phase 0 seed rows — we overwrite
   * `capabilities_json` for the model and mirror `verified_at` into its own
   * column (migration 033) for cheap staleness queries. No-op if the model
   * isn't in the registry. Returns true when a row was updated.
   */
  writeVerifiedCapabilities(modelId: string, capabilities: ModelCapabilities): boolean {
    const verifiedAt = capabilities.verified_at ?? new Date().toISOString();
    const withTs: ModelCapabilities = { ...capabilities, verified_at: verifiedAt };
    const hasVerifiedCol = this.hasVerifiedAtColumn();
    const sql = hasVerifiedCol
      ? 'UPDATE model_configs SET capabilities_json = ?, verified_at = ? WHERE model_id = ?'
      : 'UPDATE model_configs SET capabilities_json = ? WHERE model_id = ?';
    const stmt = this.db.prepare(sql);
    const res = hasVerifiedCol
      ? stmt.run(JSON.stringify(withTs), verifiedAt, modelId)
      : stmt.run(JSON.stringify(withTs), modelId);
    return res.changes > 0;
  }

  private verifiedAtAvailable?: boolean;
  private hasVerifiedAtColumn(): boolean {
    if (this.verifiedAtAvailable !== undefined) return this.verifiedAtAvailable;
    const columns = this.db.prepare('PRAGMA table_info(model_configs)').all() as Array<{ name: string }>;
    this.verifiedAtAvailable = columns.some((c) => c.name === 'verified_at');
    return this.verifiedAtAvailable;
  }

  private hasAliasesJsonColumn(): boolean {
    if (this.aliasesJsonAvailable !== undefined) return this.aliasesJsonAvailable;
    const columns = this.db.prepare('PRAGMA table_info(model_configs)').all() as Array<{ name: string }>;
    this.aliasesJsonAvailable = columns.some((column) => column.name === 'aliases_json');
    return this.aliasesJsonAvailable;
  }
}

