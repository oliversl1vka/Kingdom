// PHASE2 (P2.1): whitelisted, sandboxed command runner for the agentic Knight loop.
//
// Security surface. A model-requested `run_command` is only executed when:
//  - it matches the configured validation_command, OR
//  - it starts with a read-only inspector prefix on the allow-list, AND
//  - it contains none of the destructive/security shapes (deny-list, reused from the
//    reviewer's pattern philosophy), AND
//  - cwd is forced to the workspace (never the Kingdom repo), with a hard timeout.

import { execSync } from 'node:child_process';

/** Read-only inspector commands the agent may run to ground itself. */
const READONLY_ALLOW_PREFIXES = [
  'ls', 'dir', 'cat', 'type', 'head', 'tail', 'pwd', 'echo',
  'node --version', 'npm --version', 'pnpm --version', 'tsc --noEmit', 'tsc --version',
  'git status', 'git diff', 'git log', 'git show', 'git ls-files',
  'grep', 'rg', 'find', 'wc', 'stat', 'file',
];

/**
 * Destructive / dangerous shapes — mirrors the reviewer's DESTRUCTIVE/MALEVOLENT
 * pattern philosophy. Any match is a hard reject regardless of allow-list.
 */
const DENY_PATTERNS: RegExp[] = [
  /rm\s+-rf?\b/i,
  /\bdel\b|\berase\b/i,
  /\bDROP\s+(?:TABLE|DATABASE|SCHEMA)\b/i,
  /\bDELETE\s+FROM\b/i,
  /\bFORMAT\s+[A-Z]:/i,
  /\bmkfs\./i,
  /\bdd\s+if=/i,
  /[>][>]?\s*\/(?:dev|etc|bin|usr|sys|proc)\b/i,  // redirect into system paths
  /\bcurl\b|\bwget\b|\bInvoke-WebRequest\b|\biwr\b/i, // network egress
  /\bnc\b|\bnetcat\b|\btelnet\b|\bssh\b|\bscp\b/i,
  /\bsudo\b|\bsu\b|\brunas\b/i,
  /\bchmod\b|\bchown\b|\bicacls\b/i,
  /\bgit\s+(?:push|commit|reset|checkout|clean|rebase|merge)\b/i, // mutating git
  /\bnpm\s+(?:publish|install|i)\b|\bpnpm\s+(?:publish|add|install)\b/i,
  /[;&|`$]/, // shell metacharacters that chain / substitute commands
];

export interface CommandPolicy {
  /** The configured validation command (allowed verbatim). */
  validationCommand?: string;
  /** Hard timeout for any command, ms. */
  timeoutMs?: number;
  /** Max captured output chars. */
  maxOutputChars?: number;
}

export interface CommandRunResult {
  allowed: boolean;
  exitCode: number | null;
  stdout: string;
  rejectedReason?: string;
}

export function isCommandAllowed(command: string, policy: CommandPolicy): { allowed: boolean; reason?: string } {
  const cmd = command.trim();
  if (!cmd) return { allowed: false, reason: 'empty command' };

  for (const deny of DENY_PATTERNS) {
    if (deny.test(cmd)) return { allowed: false, reason: `command matches deny-list pattern ${deny}` };
  }

  if (policy.validationCommand && cmd === policy.validationCommand.trim()) {
    return { allowed: true };
  }

  const lower = cmd.toLowerCase();
  for (const prefix of READONLY_ALLOW_PREFIXES) {
    const p = prefix.toLowerCase();
    if (lower === p || lower.startsWith(p + ' ')) return { allowed: true };
  }

  return { allowed: false, reason: 'command not on the read-only allow-list and is not the validation command' };
}

/** Run a command under the sandbox policy. cwd is forced to `workspace`. */
export function runSandboxedCommand(command: string, workspace: string, policy: CommandPolicy): CommandRunResult {
  const verdict = isCommandAllowed(command, policy);
  if (!verdict.allowed) {
    return { allowed: false, exitCode: null, stdout: '', rejectedReason: verdict.reason };
  }
  const maxChars = policy.maxOutputChars ?? 8000;
  try {
    const out = execSync(command, {
      cwd: workspace,
      timeout: policy.timeoutMs ?? 30_000,
      stdio: ['ignore', 'pipe', 'pipe'],
      encoding: 'utf-8',
      windowsHide: true,
      maxBuffer: 1024 * 1024 * 4,
    });
    return { allowed: true, exitCode: 0, stdout: String(out).slice(0, maxChars) };
  } catch (err) {
    const e = err as { status?: number; stdout?: Buffer | string; stderr?: Buffer | string; message?: string };
    const stdout = `${e.stdout ?? ''}${e.stderr ?? ''}` || e.message || 'command failed';
    return { allowed: true, exitCode: typeof e.status === 'number' ? e.status : 1, stdout: String(stdout).slice(0, maxChars) };
  }
}
