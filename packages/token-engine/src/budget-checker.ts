import type {
  TokenBudgetCheckRequest,
  TokenBudgetCheckResult,
  ContextSegment,
  ModelConfig,
} from '@kingdomos/core';
import { ModelRegistry } from './model-registry.js';
import { countTokens as tiktokenCount } from './tiktoken-counter.js';
import { countTokens as charCount } from './char-counter.js';
import type Database from 'better-sqlite3';

type CounterFn = (text: string) => number;

function getCounter(config: ModelConfig): { counter: CounterFn; strategy: 'exact' | 'estimate' } {
  switch (config.tokenizer_type) {
    case 'tiktoken': {
      const encoding = config.tokenizer_config?.encoding as string ?? 'o200k_base';
      return {
        counter: (text: string) => tiktokenCount(text, encoding),
        strategy: 'exact',
      };
    }
    case 'huggingface': {
      // HF tokenizer is async; for budget checks we fall back to character estimation
      // unless a sync wrapper is provided. Use char estimation as safe fallback.
      return {
        counter: charCount,
        strategy: 'estimate',
      };
    }
    case 'character-estimate':
    default:
      return { counter: charCount, strategy: 'estimate' };
  }
}

export class BudgetChecker {
  private registry: ModelRegistry;

  constructor(db: Database.Database) {
    this.registry = new ModelRegistry(db);
  }

  check(request: TokenBudgetCheckRequest): TokenBudgetCheckResult {
    const config = this.registry.getModelConfig(request.model_id);
    if (!config) {
      throw new Error(`Model "${request.model_id}" not found in registry`);
    }

    const { counter, strategy } = getCounter(config);
    const safetyMultiplier = 1 + config.safety_margin_percent;

    // Count tokens for each segment with safety margin applied
    const segmentCounts: { label: string; tokens: number; rawTokens: number; included: boolean }[] = [];

    for (const segment of request.context_segments) {
      const rawTokens = counter(segment.content);
      const adjustedTokens = Math.ceil(rawTokens * safetyMultiplier);
      segmentCounts.push({
        label: segment.label,
        tokens: adjustedTokens,
        rawTokens,
        included: true,
      });
    }

    const budgetLimit = config.context_window - request.output_reservation -
      Math.ceil(config.context_window * config.safety_margin_percent);

    // Sort by priority (lower = higher priority) and try to fit within budget
    const sortedSegments = [...request.context_segments]
      .map((seg, i) => ({ ...seg, index: i }))
      .sort((a, b) => a.priority - b.priority);

    let totalTokens = 0;
    const trimmedSegments: string[] = [];

    // First pass: add all required segments
    for (const seg of sortedSegments) {
      const count = segmentCounts[seg.index];
      if (seg.required) {
        totalTokens += count.tokens;
      }
    }

    // Check if required segments alone exceed budget
    if (totalTokens > budgetLimit) {
      return {
        approved: false,
        total_tokens: totalTokens,
        budget_limit: budgetLimit,
        headroom: budgetLimit - totalTokens,
        segment_counts: segmentCounts.map((s) => ({
          label: s.label,
          tokens: s.tokens,
          included: request.context_segments[segmentCounts.indexOf(s)]?.required ?? false,
        })),
        trimmed_segments: request.context_segments
          .filter((s) => !s.required)
          .map((s) => s.label),
        counting_strategy: strategy,
      };
    }

    // Second pass: add optional segments in priority order
    for (const seg of sortedSegments) {
      const count = segmentCounts[seg.index];
      if (seg.required) continue;

      if (totalTokens + count.tokens <= budgetLimit) {
        totalTokens += count.tokens;
      } else {
        count.included = false;
        trimmedSegments.push(seg.label);
      }
    }

    return {
      approved: trimmedSegments.length === 0 || totalTokens <= budgetLimit,
      total_tokens: totalTokens,
      budget_limit: budgetLimit,
      headroom: budgetLimit - totalTokens,
      segment_counts: segmentCounts.map((s) => ({
        label: s.label,
        tokens: s.tokens,
        included: s.included,
      })),
      trimmed_segments: trimmedSegments.length > 0 ? trimmedSegments : undefined,
      counting_strategy: strategy,
    };
  }
}
