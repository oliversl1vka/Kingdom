import { describe, it, expect } from 'vitest';

describe('Provider Fallback Integration', () => {
  it.todo('should fall back to secondary provider on 429 rate-limit');
  it.todo('should set cooldown_until on rate-limited provider');
  it.todo('should recover after cooldown expires');
  it.todo('should apply correct tokenizer for each provider');
  it.todo('should throw when all providers exhausted');
});
