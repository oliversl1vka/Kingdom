import { describe, it, expect } from 'vitest';

/**
 * T101: Job Lifecycle Integration Tests
 * Full cycle from job creation → execution → completion.
 * Requires better-sqlite3 and mock provider at runtime.
 */

describe('Job Lifecycle Integration', () => {
  it.todo('should create a job in queued status');
  it.todo('should transition through preparing-context → awaiting-budget-check → running');
  it.todo('should write heartbeats during execution');
  it.todo('should transition to completed with result artifact');
  it.todo('should record tokens_used from provider response');
  it.todo('should handle timeout and transition to failed-timeout');
  it.todo('should handle cancelled jobs before execution starts');
  it.todo('should handle provider errors and transition to failed-runtime-crash');
});
