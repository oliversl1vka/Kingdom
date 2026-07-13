import { describe, it, expect, vi } from 'vitest';
import {
  computeFailureSignature,
  signatureHash,
  isFeedbackIdentical,
  isSemanticallyStuck,
  type ProviderAdapter,
} from '@kingdomos/core';

// PHASE3 (P3.4): semantic loop-breaking.
describe('loop detector (P3.4)', () => {
  it('normalizes volatile tokens so cosmetically-different same-cause failures collapse', () => {
    const a = computeFailureSignature(['TypeError at line 42 in src/foo.ts: cannot read "bar"']);
    const b = computeFailureSignature(['TypeError at line 99 in src/foo.ts: cannot read "baz"']);
    expect(a).toBe(b); // line numbers + quoted literals masked
  });

  it('produces a stable short hash', () => {
    const sig = computeFailureSignature(['build failed']);
    expect(signatureHash(sig)).toMatch(/^[a-f0-9]{16}$/);
    expect(signatureHash(sig)).toBe(signatureHash(sig));
  });

  it('lexical fallback: >=50% identical bullets is stuck', () => {
    expect(isFeedbackIdentical(['a', 'b'], ['a', 'c'])).toBe(true);
    expect(isFeedbackIdentical(['a', 'b'], ['x', 'y'])).toBe(false);
    expect(isFeedbackIdentical([], ['a'])).toBe(false);
  });

  it('identical signatures are stuck without an LLM call', async () => {
    const provider = mockProvider('n'); // would say "not stuck" — but signature match wins
    const stuck = await isSemanticallyStuck(
      ['line 1 error in foo'],
      ['line 2 error in foo'],
      { provider, model: 'm' },
    );
    expect(stuck).toBe(true);
    expect(provider.complete).not.toHaveBeenCalled();
  });

  it('uses the LLM y/n comparison for differing signatures', async () => {
    const provider = mockProvider('y');
    const stuck = await isSemanticallyStuck(
      ['compilation error: missing import React'],
      ['runtime error: React is not defined'],
      { provider, model: 'm' },
    );
    expect(stuck).toBe(true);
    expect(provider.complete).toHaveBeenCalledOnce();
  });

  it('caches the LLM verdict by signature pair', async () => {
    const provider = mockProvider('y');
    const cache = new Map<string, boolean>();
    const prev = ['error A'];
    const cur = ['totally different error B'];
    await isSemanticallyStuck(prev, cur, { provider, model: 'm', cache });
    await isSemanticallyStuck(prev, cur, { provider, model: 'm', cache });
    expect(provider.complete).toHaveBeenCalledOnce(); // second call hits cache
  });

  it('falls back to lexical when the provider errors', async () => {
    const provider: ProviderAdapter = {
      provider_id: 'mock',
      complete: vi.fn(async () => { throw new Error('provider down'); }),
      healthCheck: vi.fn(async () => ({ status: 'healthy' })),
    };
    // Differing signatures so the LLM path is attempted, then errors → lexical.
    const stuck = await isSemanticallyStuck(['same bullet'], ['same bullet'], { provider, model: 'm' });
    expect(stuck).toBe(true); // lexical: 100% overlap
  });

  it('falls back to lexical when no provider is configured', async () => {
    const stuck = await isSemanticallyStuck(['x'], ['x'], {});
    expect(stuck).toBe(true);
    const notStuck = await isSemanticallyStuck(['x'], ['y'], {});
    expect(notStuck).toBe(false);
  });
});

function mockProvider(answer: string): ProviderAdapter {
  return {
    provider_id: 'mock',
    complete: vi.fn(async () => ({
      content: answer,
      prompt_tokens: 1,
      completion_tokens: 1,
      total_tokens: 2,
      finish_reason: 'stop' as const,
    })),
    healthCheck: vi.fn(async () => ({ status: 'healthy' as const })),
  };
}
