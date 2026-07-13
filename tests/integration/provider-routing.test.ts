import { describe, expect, it, vi } from 'vitest';
import type { ProviderAdapter } from '@kingdomos/core';
import { resolveTierProvider, validateExplicitTierProviders, validateSummonWorkspacePath } from '../../packages/cli/src/commands/summon';

function provider(id: string, status: Awaited<ReturnType<ProviderAdapter['healthCheck']>>['status'] = 'healthy'): ProviderAdapter {
  return {
    provider_id: id,
    complete: vi.fn(async () => ({
      content: '',
      prompt_tokens: 0,
      completion_tokens: 0,
      total_tokens: 0,
      finish_reason: 'stop',
    })),
    healthCheck: vi.fn(async () => ({ status })),
  };
}

describe('summon provider routing', () => {
  it('uses an explicitly configured tier provider instead of the fallback', () => {
    const openai = provider('openai');
    const lmstudio = provider('lmstudio');

    const resolved = resolveTierProvider(
      'squire',
      { squire: { provider: 'lmstudio' } },
      { openai, lmstudio },
      openai,
    );

    expect(resolved).toBe(lmstudio);
  });

  it('throws when an explicit tier provider is disabled or missing', () => {
    const openai = provider('openai');

    expect(() => resolveTierProvider(
      'squire',
      { squire: { provider: 'lmstudio' } },
      { openai, lmstudio: null },
      openai,
    )).toThrow(/explicitly requires provider "lmstudio"/);
  });

  it('fails preflight when an explicit provider is unhealthy', async () => {
    const openai = provider('openai');
    const lmstudio = provider('lmstudio', 'unavailable');

    await expect(validateExplicitTierProviders(
      { squire: { provider: 'lmstudio' }, knight: {} },
      { openai, lmstudio },
      ['squire', 'knight'],
    )).rejects.toThrow(/Explicit tier provider preflight failed/);
  });

  it('does not health-check implicit fallback providers', async () => {
    const openai = provider('openai');

    await validateExplicitTierProviders(
      { knight: {} },
      { openai },
      ['knight'],
    );

    expect(openai.healthCheck).not.toHaveBeenCalled();
  });

  it('blocks summon when workspace_path differs from the current repo without an explicit opt-in', () => {
    const result = validateSummonWorkspacePath('C:/work/Kingdom-dev', { cwd: 'C:/work/Kingdom' });

    expect(result.ok).toBe(false);
    expect(result.error).toContain('workspace_path');
    expect(result.error).toContain('--allow-workspace-mismatch');
  });

  it('allows workspace mismatch when an explicit config path is provided', () => {
    const result = validateSummonWorkspacePath('C:/work/Kingdom-dev', {
      cwd: 'C:/work/Kingdom',
      explicitConfigPath: 'kingdom.temp-fork.config.json',
    });

    expect(result.ok).toBe(true);
    expect(result.warning).toContain('--config');
  });
});