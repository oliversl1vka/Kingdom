import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runVerificationGate } from '@kingdomos/core';

// PHASE3 (P3.2): the per-task verification gate runs the task-scoped command in
// the workspace and reports pass/fail by exit code.
describe('verification gate (P3.2)', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'kingdom-vgate-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('returns ran:false when no contract is present', () => {
    expect(runVerificationGate(null, { projectPath: dir })).toEqual({ ran: false, passed: true, command: '', output: '' });
    expect(runVerificationGate({ test_command: '' }, { projectPath: dir }).ran).toBe(false);
  });

  it('passes when the test_command exits 0', () => {
    const res = runVerificationGate({ test_command: 'node -e "process.exit(0)"' }, { projectPath: dir });
    expect(res.ran).toBe(true);
    expect(res.passed).toBe(true);
  });

  it('fails and captures output when the test_command exits non-zero', () => {
    const res = runVerificationGate(
      { test_command: 'node -e "console.error(\'boom-marker\'); process.exit(1)"' },
      { projectPath: dir },
    );
    expect(res.ran).toBe(true);
    expect(res.passed).toBe(false);
    expect(res.output).toContain('boom-marker');
  });

  it('runs in the workspace cwd', () => {
    writeFileSync(join(dir, 'sentinel.txt'), 'ok');
    // `node -e` checks the file exists relative to cwd.
    const res = runVerificationGate(
      { test_command: 'node -e "require(\'fs\').accessSync(\'sentinel.txt\')"' },
      { projectPath: dir },
    );
    expect(res.passed).toBe(true);
  });

  it('fails on the probe when test_command passes but probe fails', () => {
    const res = runVerificationGate(
      { test_command: 'node -e "process.exit(0)"', probe: 'node -e "process.exit(3)"' },
      { projectPath: dir },
    );
    expect(res.passed).toBe(false);
    expect(res.command).toContain('exit(3)');
  });
});
