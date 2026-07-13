import { describe, expect, it } from 'vitest';
import { isCommandAllowed } from '@kingdomos/core';

describe('command sandbox allow/deny (P2.1 security surface)', () => {
  const policy = { validationCommand: 'pnpm run build', timeoutMs: 5000 };

  it('allows the configured validation command verbatim', () => {
    expect(isCommandAllowed('pnpm run build', policy).allowed).toBe(true);
  });

  it('allows read-only inspectors', () => {
    for (const cmd of ['ls -la', 'cat src/x.ts', 'git status', 'grep foo src', 'node --version', 'tsc --noEmit']) {
      expect(isCommandAllowed(cmd, policy).allowed, cmd).toBe(true);
    }
  });

  it('rejects destructive commands', () => {
    for (const cmd of ['rm -rf /', 'rm -rf node_modules', 'DROP TABLE jobs', 'git push origin main', 'npm install left-pad']) {
      expect(isCommandAllowed(cmd, policy).allowed, cmd).toBe(false);
    }
  });

  it('rejects network egress and shell chaining', () => {
    for (const cmd of ['curl http://evil.test', 'ls && rm -rf x', 'cat a; cat b', 'echo `whoami`', 'cat $(secrets)']) {
      expect(isCommandAllowed(cmd, policy).allowed, cmd).toBe(false);
    }
  });

  it('rejects commands not on the allow-list', () => {
    expect(isCommandAllowed('python evil.py', policy).allowed).toBe(false);
  });
});
