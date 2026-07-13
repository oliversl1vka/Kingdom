import { execSync } from 'node:child_process';
import type { TaskVerification } from '../types.js';

/**
 * PHASE3 (P3.2) — Per-task verification contract: test-execution-as-gate.
 *
 * The Judge's criteria check is a single ungrounded LLM opinion. This gate makes
 * correctness an *executable* fact: the task carries a `test_command` (and an
 * optional secondary `probe`) that is run AFTER the diff is applied and AFTER
 * the global `validationCommand` (build) but BEFORE the global behavioural
 * probes. A non-zero exit means the change does not actually satisfy the task —
 * the dispatcher rolls it back (reusing `failAppliedDiff`) with the captured
 * output as retry feedback.
 *
 * Security/cost surface (mirrors the dispatcher's existing validation/probe
 * pattern): runs with `cwd = projectPath` (the workspace, NEVER the Kingdom
 * repo), a hard timeout, and combined stdout/stderr captured and truncated.
 */

export interface VerificationGateOptions {
  /** Absolute path to the target workspace. Commands run here. */
  projectPath: string;
  /** Default per-command timeout (ms) when the contract omits one. */
  defaultTimeoutMs?: number;
  /** Max characters of captured output to retain. */
  maxOutputChars?: number;
}

export interface VerificationGateResult {
  /** True if a contract was present and at least the test_command was executed. */
  ran: boolean;
  /** True iff every executed command exited zero. Meaningless when `ran` is false. */
  passed: boolean;
  /** The command whose result is reported (the first failing one, or the test_command). */
  command: string;
  /** Combined, truncated stdout/stderr from the executed command(s). */
  output: string;
}

const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_OUTPUT = 800;

/**
 * Run a task's verification contract as an execution gate. Returns
 * `{ ran: false }` when no contract / no `test_command` is present (caller
 * treats this as "no per-task gate" and proceeds).
 */
export function runVerificationGate(
  verification: TaskVerification | null | undefined,
  options: VerificationGateOptions,
): VerificationGateResult {
  const testCommand = verification?.test_command?.trim();
  if (!verification || !testCommand) {
    return { ran: false, passed: true, command: '', output: '' };
  }

  const maxOutput = options.maxOutputChars ?? DEFAULT_MAX_OUTPUT;
  const timeoutMs = verification.timeout_seconds
    ? Math.max(1000, verification.timeout_seconds * 1000)
    : options.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS;

  // Run the test_command first; if it passes and a probe exists, run that too.
  const commands = [testCommand];
  const probe = verification.probe?.trim();
  if (probe) commands.push(probe);

  for (const command of commands) {
    try {
      execSync(command, {
        cwd: options.projectPath,
        timeout: timeoutMs,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (err) {
      const e = err as { stdout?: Buffer; stderr?: Buffer; message?: string };
      const output = [
        `$ ${command}`,
        e.stdout?.toString('utf-8') ?? '',
        e.stderr?.toString('utf-8') ?? '',
      ].join('\n').trim().slice(0, maxOutput)
        || (e.message ?? `Command exited non-zero: ${command}`).slice(0, maxOutput);
      return { ran: true, passed: false, command, output };
    }
  }

  return { ran: true, passed: true, command: testCommand, output: '' };
}
