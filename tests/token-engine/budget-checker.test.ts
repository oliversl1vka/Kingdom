import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BudgetChecker } from '../../packages/token-engine/src/budget-checker.js';
import type { TokenBudgetCheckRequest } from '@kingdomos/core';

const MIGRATIONS_DIR = join(__dirname, '..', '..', 'packages', 'core', 'migrations');

describe('BudgetChecker integration', () => {
  let db: Database.Database;
  let checker: BudgetChecker;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('journal_mode = WAL');
    // Apply all migrations
    const migration1 = readFileSync(join(MIGRATIONS_DIR, '001_initial.sql'), 'utf-8');
    db.exec(migration1);
    const migration2 = readFileSync(join(MIGRATIONS_DIR, '002_seed_models.sql'), 'utf-8');
    db.exec(migration2);
    checker = new BudgetChecker(db);
  });

  afterEach(() => {
    db.close();
  });

  it('approves a small request within budget', () => {
    const request: TokenBudgetCheckRequest = {
      job_id: 'test-job-1',
      model_id: 'qwen2.5-coder-7b',
      context_segments: [
        { label: 'system-prompt', content: 'You are a helpful assistant.', required: true, priority: 1 },
        { label: 'user-input', content: 'Write hello world in TypeScript.', required: true, priority: 2 },
      ],
      output_reservation: 4096,
    };

    const result = checker.check(request);
    expect(result.approved).toBe(true);
    expect(result.total_tokens).toBeGreaterThan(0);
    expect(result.headroom).toBeGreaterThan(0);
    expect(result.segment_counts).toHaveLength(2);
  });

  it('rejects a request that exceeds budget', () => {
    // Create a very large context that exceeds 32K window
    const largeContent = 'x'.repeat(200000); // Will produce ~50000 char-estimated tokens
    const request: TokenBudgetCheckRequest = {
      job_id: 'test-job-2',
      model_id: 'qwen2.5-coder-7b',
      context_segments: [
        { label: 'huge-context', content: largeContent, required: true, priority: 1 },
      ],
      output_reservation: 4096,
    };

    const result = checker.check(request);
    expect(result.approved).toBe(false);
    expect(result.headroom).toBeLessThan(0);
  });

  it('trims low-priority optional segments', () => {
    const mediumContent = 'x'.repeat(80000); // ~20K char-estimated tokens
    const request: TokenBudgetCheckRequest = {
      job_id: 'test-job-3',
      model_id: 'qwen2.5-coder-7b',
      context_segments: [
        { label: 'system-prompt', content: 'You are a helpful assistant.', required: true, priority: 1 },
        { label: 'main-context', content: mediumContent, required: false, priority: 2 },
        { label: 'extra-context', content: mediumContent, required: false, priority: 3 },
      ],
      output_reservation: 4096,
    };

    const result = checker.check(request);
    // At least one optional segment should be trimmed
    expect(result.trimmed_segments).toBeDefined();
    expect(result.trimmed_segments!.length).toBeGreaterThan(0);
  });

  it('includes per-segment token counts', () => {
    const request: TokenBudgetCheckRequest = {
      job_id: 'test-job-4',
      model_id: 'qwen2.5-coder-7b',
      context_segments: [
        { label: 'seg-a', content: 'Hello world', required: true, priority: 1 },
        { label: 'seg-b', content: 'Another segment here', required: false, priority: 2 },
      ],
      output_reservation: 4096,
    };

    const result = checker.check(request);
    expect(result.segment_counts).toHaveLength(2);
    expect(result.segment_counts[0].label).toBe('seg-a');
    expect(result.segment_counts[0].tokens).toBeGreaterThan(0);
    expect(result.segment_counts[1].label).toBe('seg-b');
    expect(result.segment_counts[1].tokens).toBeGreaterThan(0);
  });

  it('reports counting strategy', () => {
    const request: TokenBudgetCheckRequest = {
      job_id: 'test-job-5',
      model_id: 'qwen2.5-coder-7b',
      context_segments: [
        { label: 'test', content: 'test content', required: true, priority: 1 },
      ],
      output_reservation: 4096,
    };

    const result = checker.check(request);
    expect(['exact', 'estimate']).toContain(result.counting_strategy);
  });

  it('uses a conservative warning-backed estimate when HuggingFace tokenizer data is unavailable', () => {
    const code = `import { x } from './x';\nexport function run(value: string) {\n  if (value === 'a') return value.split('').join('-');\n  return value.toUpperCase();\n}\n`;
    const request: TokenBudgetCheckRequest = {
      job_id: 'test-job-hf-warning',
      model_id: 'qwen2.5-coder-7b',
      context_segments: [
        { label: 'code', content: code, required: true, priority: 1 },
      ],
      output_reservation: 4096,
    };

    const result = checker.check(request);
    const charEstimateWithSafety = Math.ceil(Math.ceil(code.length / 4) * 1.12);

    expect(result.counting_strategy).toBe('estimate');
    expect(result.warnings?.[0]).toContain('HuggingFace tokenizer');
    expect(result.segment_counts[0].tokens).toBeGreaterThanOrEqual(charEstimateWithSafety);
  });

  it('uses a conservative default budget when a model is missing from the registry', () => {
    const request: TokenBudgetCheckRequest = {
      job_id: 'test-job-unknown-model',
      model_id: 'provider/new-model-without-config',
      context_segments: [
        { label: 'prompt', content: 'Implement a tiny helper function.', required: true, priority: 1 },
      ],
      output_reservation: 1024,
    };

    const result = checker.check(request);

    expect(result.approved).toBe(true);
    expect(result.counting_strategy).toBe('estimate');
    expect(result.budget_limit).toBe(7168);
    expect(result.warnings).toEqual([
      'Model "provider/new-model-without-config" is not in the registry; using conservative default token budget.',
    ]);
  });
});
