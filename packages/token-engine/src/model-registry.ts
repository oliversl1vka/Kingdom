import type { ModelConfig } from '@kingdomos/core';
import type Database from 'better-sqlite3';

export class ModelRegistry {
  constructor(private db: Database.Database) {}

  getModelConfig(modelId: string): ModelConfig | null {
    const row = this.db
      .prepare('SELECT * FROM model_configs WHERE model_id = ?')
      .get(modelId) as Record<string, unknown> | undefined;

    if (!row) return null;

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
    };
  }

  getAllModels(): ModelConfig[] {
    const rows = this.db.prepare('SELECT * FROM model_configs').all() as Record<string, unknown>[];
    return rows.map((row) => ({
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
    }));
  }

  getSafeInputBudget(modelId: string): number {
    const config = this.getModelConfig(modelId);
    if (!config) throw new Error(`Model "${modelId}" not found in registry`);
    return config.safe_input_budget;
  }
}
