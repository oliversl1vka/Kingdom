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
import { existsSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

type CounterFn = (text: string) => number;
type CounterSelection = { counter: CounterFn; strategy: 'exact' | 'estimate'; warnings?: string[] };

const require = createRequire(import.meta.url);
const hfCounterCache = new Map<string, CounterFn>();

function getCounter(config: ModelConfig): CounterSelection {
  switch (config.tokenizer_type) {
    case 'tiktoken': {
      const encoding = config.tokenizer_config?.encoding as string ?? 'o200k_base';
      return {
        counter: (text: string) => tiktokenCount(text, encoding),
        strategy: 'exact',
      };
    }
    case 'huggingface': {
      const exactCounter = tryCreateHuggingFaceCounter(config);
      if (exactCounter) {
        return { counter: exactCounter, strategy: 'exact' };
      }
      return {
        counter: conservativeCodeAwareEstimate,
        strategy: 'estimate',
        warnings: [`HuggingFace tokenizer for ${config.model_id} is unavailable; using conservative code-aware token estimate.`],
      };
    }
    case 'character-estimate':
      if (config.tokenizer_config?.conservative_estimate === true) {
        return { counter: conservativeCodeAwareEstimate, strategy: 'estimate' };
      }
      return { counter: charCount, strategy: 'estimate' };
    default:
      return { counter: charCount, strategy: 'estimate' };
  }
}

function tryCreateHuggingFaceCounter(config: ModelConfig): CounterFn | null {
  const tokenizerPath = resolveTokenizerPath(config);
  if (!tokenizerPath || !existsSync(tokenizerPath)) return null;

  const cached = hfCounterCache.get(tokenizerPath);
  if (cached) return cached;

  try {
    const { Tokenizer } = require('@huggingface/tokenizers') as typeof import('@huggingface/tokenizers');
    const tokenizerJson = readFileSync(tokenizerPath, 'utf-8');
    const tokenizer = Tokenizer.fromString(tokenizerJson);
    const counter: CounterFn = (text: string) => tokenizer.encode(text).length;
    hfCounterCache.set(tokenizerPath, counter);
    return counter;
  } catch {
    return null;
  }
}

function resolveTokenizerPath(config: ModelConfig): string | null {
  const rawPath = config.tokenizer_config?.tokenizer_path as string | undefined;
  if (!rawPath) return null;
  if (isAbsolute(rawPath)) return rawPath;

  const moduleDir = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(process.cwd(), rawPath),
    join(process.cwd(), 'packages', 'token-engine', 'data', rawPath),
    join(moduleDir, '..', 'data', rawPath),
  ];

  return candidates.find((candidate) => existsSync(candidate)) ?? candidates[candidates.length - 1];
}

function conservativeCodeAwareEstimate(text: string): number {
  if (text.length === 0) return 0;
  const charEstimate = charCount(text);
  const compactEstimate = Math.ceil(text.length / 2);
  const wordEstimate = Math.ceil(text.split(/\s+/).filter(Boolean).length * 1.5);
  const codeSignalEstimate = Math.ceil((text.match(/[{}()[\];=<>]|=>|\b(?:import|export|const|let|function|class|return|async|await)\b/g)?.length ?? 0) * 0.75);
  return Math.max(charEstimate, compactEstimate, wordEstimate + codeSignalEstimate);
}

export class BudgetChecker {
  private registry: ModelRegistry;

  constructor(db: Database.Database) {
    this.registry = new ModelRegistry(db);
  }

  check(request: TokenBudgetCheckRequest): TokenBudgetCheckResult {
    const warnings: string[] = [];
    let config = this.registry.getModelConfig(request.model_id);
    if (!config) {
      config = createUnknownModelConfig(request.model_id);
      warnings.push(
        `Model "${request.model_id}" is not in the registry; using conservative default token budget.`,
      );
    }

    const { counter, strategy, warnings: counterWarnings } = getCounter(config);
    if (counterWarnings?.length) warnings.push(...counterWarnings);
    const resultWarnings = warnings.length > 0 ? warnings : undefined;
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

    const budgetLimit = config.context_window - request.output_reservation;

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
        warnings: resultWarnings,
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
      warnings: resultWarnings,
    };
  }
}

function createUnknownModelConfig(modelId: string): ModelConfig {
  return {
    model_id: modelId,
    provider: 'unknown',
    display_name: modelId,
    context_window: 8192,
    safe_input_budget: 4096,
    output_reservation: 2048,
    safety_margin_percent: 0.25,
    tokenizer_type: 'character-estimate',
    tokenizer_config: { conservative_estimate: true },
    tier_assignment: null,
    capabilities: null,
    aliases: [],
  };
}
