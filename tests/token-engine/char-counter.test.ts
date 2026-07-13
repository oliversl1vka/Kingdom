import { describe, it, expect } from 'vitest';
import { countTokens } from '../../packages/token-engine/src/char-counter.js';

describe('character estimation fallback', () => {
  it('returns 0 for empty string', () => {
    expect(countTokens('')).toBe(0);
  });

  it('estimates tokens using chars÷4 formula', () => {
    const text = 'abcdefgh'; // 8 chars → 2 tokens
    expect(countTokens(text)).toBe(2);
  });

  it('rounds up for non-divisible lengths', () => {
    const text = 'abcde'; // 5 chars → ceil(5/4) = 2
    expect(countTokens(text)).toBe(2);
  });

  it('handles single character', () => {
    expect(countTokens('a')).toBe(1);
  });

  it('overestimates relative to typical tokenizer counts', () => {
    // For typical English text, chars÷4 should overestimate
    const text = 'The quick brown fox jumps over the lazy dog.';
    const estimate = countTokens(text);
    // chars÷4 = ceil(44/4) = 11
    expect(estimate).toBe(11);
    // Typical tokenizer would produce fewer tokens for regular English
    expect(estimate).toBeGreaterThanOrEqual(8);
  });

  it('handles Unicode text', () => {
    const text = '你好世界';
    const count = countTokens(text);
    expect(count).toBeGreaterThan(0);
  });

  it('handles code snippets', () => {
    const code = 'function add(a, b) { return a + b; }';
    const count = countTokens(code);
    expect(count).toBe(Math.ceil(code.length / 4));
  });
});
