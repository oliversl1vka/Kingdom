import { describe, it, expect } from 'vitest';
import { countTokens } from '../../packages/token-engine/src/tiktoken-counter.js';

describe('tiktoken counter', () => {
  it('counts tokens for empty string with o200k_base', () => {
    expect(countTokens('', 'o200k_base')).toBe(0);
  });

  it('counts tokens for simple English text with o200k_base', () => {
    const text = 'Hello, world!';
    const count = countTokens(text, 'o200k_base');
    expect(count).toBeGreaterThan(0);
    expect(count).toBeLessThan(10);
  });

  it('counts tokens for code snippet', () => {
    const code = `function add(a: number, b: number): number {\n  return a + b;\n}`;
    const count = countTokens(code, 'o200k_base');
    expect(count).toBeGreaterThan(5);
    expect(count).toBeLessThan(50);
  });

  it('counts tokens for Unicode text', () => {
    const text = '你好世界 🌍 こんにちは';
    const count = countTokens(text, 'o200k_base');
    expect(count).toBeGreaterThan(0);
  });

  it('counts tokens for markdown content', () => {
    const md = '# Heading\n\n- Item 1\n- Item 2\n\n```typescript\nconst x = 1;\n```';
    const count = countTokens(md, 'o200k_base');
    expect(count).toBeGreaterThan(5);
  });

  it('supports cl100k_base encoding', () => {
    const text = 'Hello, world!';
    const count = countTokens(text, 'cl100k_base');
    expect(count).toBeGreaterThan(0);
  });

  it('returns consistent results for same input', () => {
    const text = 'The quick brown fox jumps over the lazy dog.';
    const count1 = countTokens(text, 'o200k_base');
    const count2 = countTokens(text, 'o200k_base');
    expect(count1).toBe(count2);
  });
});
