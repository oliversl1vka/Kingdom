/**
 * Phase 1 — P1.5 Git-worktree-per-job isolation + 3-way merge-back.
 *
 * Converts the shared mutable workspace into per-agent isolation:
 *   1. `git worktree add` a fresh worktree off the integration HEAD per job,
 *      on a dedicated branch.
 *   2. Apply the agent's unified diff INSIDE that worktree (via applyDiff).
 *   3. Commit it on the job branch.
 *   4. Merge it back into the integration branch (fast-forward if possible,
 *      otherwise a real `git merge`). A clean merge → done. A merge conflict →
 *      the job fails, with the conflicting files/hunks returned as feedback so
 *      the retry can reconcile.
 *
 * This retires reliance on the single lossy `.bak` where the workspace is a git
 * repo (sequential applies that clobbered `.bak` produced the "two export
 * default" corruption). When the workspace is NOT a git repo, callers fall back
 * to the in-place applyDiff + `.bak` path (kept intact in diff-applicator.ts).
 *
 * --- Windows / node_modules cost ---
 * A naive `git worktree add` creates a full checkout WITHOUT node_modules, so a
 * per-worktree `pnpm install` would be prohibitively expensive. Strategy:
 *   - We DO NOT install per worktree. Instead, for the validation/build step the
 *     caller may junction (symlink) the base repo's node_modules into the
 *     worktree — see `linkNodeModules()`. On Win11 we use a directory junction
 *     (`mklink /J`, no admin/symlink privilege required) rather than a symbolic
 *     link, falling back to skipping validation in the worktree and re-running
 *     `validationCommand` + probes on the integration branch AFTER merge (which
 *     catches cross-job interactions anyway).
 *   - Worktrees are created under `<repoRoot>/.kingdom-worktrees/<jobId>` and
 *     removed with `git worktree remove --force` on cleanup.
 */

import { applyDiff, type ApplyResult } from './diff-applicator.js';
import { execFileSync, execSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { platform } from 'node:os';

export interface WorktreeApplyResult {
  /** Overall success — diff applied AND merged back cleanly. */
  success: boolean;
  /** True iff merge-back hit a conflict (distinct from an apply failure). */
  conflict: boolean;
  appliedFiles: string[];
  failedFiles: string[];
  /** Files with merge conflicts (when conflict === true). */
  conflictingFiles: string[];
  /** Conflicting hunks / git output to feed back to the agent on retry. */
  feedback: string[];
  errors: string[];
  /** SHA of the merge/commit on the integration branch when success. */
  mergedSha?: string;
}

export interface WorktreeOptions {
  /** Branch to merge back into. Defaults to the repo's current branch (integration HEAD). */
  integrationBranch?: string;
  /** Commit/ref to branch the worktree FROM. Defaults to the integration branch
   *  HEAD. Override when a job must branch from an earlier point (e.g. a recorded
   *  base SHA) while still merging back into the current integration branch. */
  baseRef?: string;
  /** Root dir for worktrees. Defaults to <repoRoot>/.kingdom-worktrees. */
  worktreeRoot?: string;
  /** When true, junction/symlink base node_modules into the worktree. Default false. */
  linkNodeModules?: boolean;
  /** Commit author identity for job commits. */
  authorName?: string;
  authorEmail?: string;
  /** Verbose logging. */
  verbose?: boolean;
  logger?: (msg: string) => void;
}

// PHASE5: step-wise worktree session result types (§5.1).
export interface WorktreeRunResult {
  code: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

export interface MergeBackResult {
  success: boolean;
  conflict: boolean;
  conflictingFiles: string[];
  mergedSha?: string;
  feedback: string[];
  errors: string[];
}

export interface OpenSessionOptions {
  /** Commit/ref to branch FROM. Defaults to the integration branch HEAD. */
  baseRef?: string;
  /** Junction/symlink base node_modules into the worktree. Default false. */
  linkNodeModules?: boolean;
}

function git(repoRoot: string, args: string[], opts: { allowFail?: boolean } = {}): { code: number; out: string } {
  try {
    const out = execFileSync('git', args, { cwd: repoRoot, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] });
    return { code: 0, out: out.toString() };
  } catch (err) {
    const e = err as { status?: number; stdout?: Buffer | string; stderr?: Buffer | string };
    const out = [e.stdout?.toString() ?? '', e.stderr?.toString() ?? ''].join('\n').trim();
    if (!opts.allowFail) {
      // Re-throw with the captured output so callers can surface it.
      const wrapped = new Error(`git ${args.join(' ')} failed: ${out}`);
      throw wrapped;
    }
    return { code: e.status ?? 1, out };
  }
}

/** Returns true if `dir` is inside a git working tree. */
export function isGitRepo(dir: string): boolean {
  try {
    const r = git(dir, ['rev-parse', '--is-inside-work-tree'], { allowFail: true });
    return r.code === 0 && r.out.trim() === 'true';
  } catch {
    return false;
  }
}

export class WorktreeManager {
  private worktreeRoot: string;
  constructor(private repoRoot: string, private opts: WorktreeOptions = {}) {
    this.worktreeRoot = opts.worktreeRoot ?? join(repoRoot, '.kingdom-worktrees');
  }

  private log(msg: string): void {
    if (this.opts.verbose) (this.opts.logger ?? console.log)(msg);
  }

  /** Resolve the integration branch (explicit option, else the current HEAD branch). */
  private resolveIntegrationBranch(): string {
    if (this.opts.integrationBranch) return this.opts.integrationBranch;
    const r = git(this.repoRoot, ['rev-parse', '--abbrev-ref', 'HEAD']);
    return r.out.trim();
  }

  /**
   * PHASE5 (§5.1): current integration branch HEAD sha — the INV-1 anchor used by
   * the reconciler and by tests to assert the branch is unchanged on failure.
   */
  integrationHead(): string {
    const integration = this.resolveIntegrationBranch();
    return git(this.repoRoot, ['rev-parse', integration]).out.trim();
  }

  /**
   * PHASE5 (§4): hard-reset the integration branch's working tree back to `sha`.
   * Used to revert a just-created merge commit when post-merge validation fails —
   * restoring INV-1. MUST be called inside the IntegrationGate.
   */
  resetIntegrationTo(sha: string): void {
    git(this.repoRoot, ['reset', '--hard', sha]);
    this.log(`[worktree] Reset integration → ${sha.slice(0, 8)} (post-merge revert)`);
  }

  /**
   * PHASE5 (§5.1): open a step-wise isolated worktree session off the integration
   * HEAD (or `opts.baseRef`). Returns a {@link WorktreeSession} the caller drives
   * through run/diff/commit/mergeBack/discard. The integration branch is NOT
   * touched until {@link WorktreeSession.mergeBack} is called inside the
   * IntegrationGate. Mirrors the first half of {@link applyInWorktree}.
   */
  openSession(jobId: string, opts: OpenSessionOptions = {}): WorktreeSession {
    const integration = this.resolveIntegrationBranch();
    const branch = `kingdom/job-${jobId}`;
    const safeJobDir = jobId.replace(/[^A-Za-z0-9_-]/g, '_');
    const worktreePath = join(this.worktreeRoot, safeJobDir);

    mkdirSync(this.worktreeRoot, { recursive: true });
    // Stale branch/worktree from a prior crash — prune first.
    this.removeWorktree(worktreePath, branch);

    const baseRef = opts.baseRef ?? this.opts.baseRef ?? integration;
    const baseSha = git(this.repoRoot, ['rev-parse', baseRef]).out.trim();

    git(this.repoRoot, ['worktree', 'add', '-b', branch, worktreePath, baseRef]);
    this.log(`[worktree] Opened session ${worktreePath} on ${branch} from ${baseRef}@${baseSha.slice(0, 8)}`);

    if (opts.linkNodeModules ?? this.opts.linkNodeModules) this.linkNodeModules(worktreePath);

    return new WorktreeSession({
      jobId,
      path: worktreePath,
      branch,
      baseSha,
      integrationBranch: integration,
      repoRoot: this.repoRoot,
      authorName: this.opts.authorName ?? 'KingdomOS',
      authorEmail: this.opts.authorEmail ?? 'kingdom@localhost',
      discardFn: () => this.removeWorktree(worktreePath, branch),
      log: (m) => this.log(m),
    });
  }

  /**
   * Full per-job flow: create worktree off integration HEAD, apply the diff,
   * commit, merge back. Returns a structured result. Always attempts to clean up
   * the worktree (best-effort) before returning.
   */
  applyInWorktree(jobId: string, diffText: string): WorktreeApplyResult {
    const result: WorktreeApplyResult = {
      success: false, conflict: false, appliedFiles: [], failedFiles: [],
      conflictingFiles: [], feedback: [], errors: [],
    };

    // PHASE5: re-expressed on top of the step-wise session (preserves behavior +
    // existing tests). open → applyDiff → commit → mergeBack → discard.
    let session: WorktreeSession | undefined;
    try {
      session = this.openSession(jobId);

      // Apply the diff inside the worktree (reuses the LLM-diff-tolerant applier).
      const applied: ApplyResult = applyDiff(diffText, session.path);
      result.appliedFiles = applied.appliedFiles;
      result.failedFiles = applied.failedFiles;
      result.errors.push(...applied.errors);
      if (!applied.success || applied.appliedFiles.length === 0) {
        result.feedback.push('Diff did not apply cleanly inside the isolated worktree.', ...applied.errors.slice(0, 3));
        return result;
      }

      // Stage + commit on the job branch.
      if (!session.commit(`job ${jobId}: apply agent diff`)) {
        result.feedback.push('Nothing to commit inside the isolated worktree.');
        return result;
      }

      // Merge back into the integration branch.
      const merge = session.mergeBack();
      if (merge.success) {
        result.success = true;
        result.mergedSha = merge.mergedSha;
      } else {
        result.conflict = merge.conflict;
        result.conflictingFiles = merge.conflictingFiles;
        result.feedback.push(...merge.feedback);
        result.errors.push(...merge.errors);
      }
    } catch (err) {
      result.errors.push((err as Error).message);
    } finally {
      // Best-effort cleanup. On success the branch was already merged; on
      // failure/conflict we drop the worktree + branch so retries start clean.
      session?.discard();
    }

    return result;
  }

  /** Remove a worktree and its branch (best-effort; ignores errors). */
  removeWorktree(worktreePath: string, branch: string): void {
    if (existsSync(worktreePath)) {
      git(this.repoRoot, ['worktree', 'remove', '--force', worktreePath], { allowFail: true });
      // git may leave the dir if it wasn't a registered worktree.
      try { rmSync(worktreePath, { recursive: true, force: true }); } catch { /* ignore */ }
    }
    git(this.repoRoot, ['worktree', 'prune'], { allowFail: true });
    git(this.repoRoot, ['branch', '-D', branch], { allowFail: true });
  }

  /**
   * Junction (Windows) / symlink (POSIX) the base repo's node_modules into the
   * worktree so the validation/build step resolves deps without a per-worktree
   * install. Best-effort: failure is non-fatal (caller can validate post-merge).
   */
  private linkNodeModules(worktreePath: string): void {
    const baseModules = join(this.repoRoot, 'node_modules');
    const target = join(worktreePath, 'node_modules');
    if (!existsSync(baseModules) || existsSync(target)) return;
    try {
      if (platform() === 'win32') {
        // Directory junction — does NOT require admin/symlink privilege on Win11.
        execSync(`mklink /J "${target}" "${baseModules}"`, { stdio: 'ignore', shell: 'cmd.exe' });
      } else {
        execSync(`ln -s "${baseModules}" "${target}"`, { stdio: 'ignore' });
      }
      this.log(`[worktree] Linked node_modules into ${worktreePath}`);
    } catch {
      this.log(`[worktree] node_modules link failed — validation deferred to post-merge integration run`);
    }
  }
}

// ── PHASE5 (§5.1): step-wise worktree session ───────────────────────────────

interface WorktreeSessionParams {
  jobId: string;
  path: string;
  branch: string;
  baseSha: string;
  integrationBranch: string;
  repoRoot: string;
  authorName: string;
  authorEmail: string;
  /** Removes the worktree + branch (manager.removeWorktree); idempotent. */
  discardFn: () => void;
  log: (msg: string) => void;
}

/**
 * PHASE5 (§5.1): a step-wise isolated worktree lifecycle. The agentic dispatcher
 * drives this through: run gates → diff/review → commit → (inside the merge gate)
 * mergeBack → discard. The integration branch HEAD is identical to {@link baseSha}
 * until {@link mergeBack} succeeds — that is the INV-1 anchor.
 */
export class WorktreeSession {
  readonly jobId: string;
  readonly path: string;
  readonly branch: string;
  readonly baseSha: string;
  readonly integrationBranch: string;
  private readonly repoRoot: string;
  private readonly authorName: string;
  private readonly authorEmail: string;
  private readonly discardFn: () => void;
  private readonly logFn: (msg: string) => void;
  private discarded = false;

  constructor(p: WorktreeSessionParams) {
    this.jobId = p.jobId;
    this.path = p.path;
    this.branch = p.branch;
    this.baseSha = p.baseSha;
    this.integrationBranch = p.integrationBranch;
    this.repoRoot = p.repoRoot;
    this.authorName = p.authorName;
    this.authorEmail = p.authorEmail;
    this.discardFn = p.discardFn;
    this.logFn = p.log;
  }

  /** Unified diff of the worktree (working tree) vs the base SHA. '' if no change. */
  diff(): string {
    const r = git(this.path, ['diff', this.baseSha], { allowFail: true });
    return r.out;
  }

  /** Names of files changed vs baseSha (working tree, includes untracked-added).
   *  Excludes `.bak` rollback litter written by the structured-edit applicator. */
  changedFiles(): string[] {
    const tracked = git(this.path, ['diff', '--name-only', this.baseSha], { allowFail: true }).out;
    const untracked = git(this.path, ['ls-files', '--others', '--exclude-standard'], { allowFail: true }).out;
    const set = new Set<string>();
    for (const line of (tracked + '\n' + untracked).split('\n')) {
      const f = line.trim();
      if (f && !f.endsWith('.bak')) set.add(f);
    }
    return [...set];
  }

  /** Run a command sandboxed to the worktree (cwd=path), with a hard timeout. */
  run(command: string, opts: { timeoutMs?: number; env?: Record<string, string> } = {}): WorktreeRunResult {
    const timeoutMs = opts.timeoutMs ?? 120_000;
    try {
      const stdout = execSync(command, {
        cwd: this.path,
        encoding: 'utf-8',
        timeout: timeoutMs,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, ...opts.env },
      });
      return { code: 0, stdout: stdout.toString(), stderr: '', timedOut: false };
    } catch (err) {
      const e = err as { status?: number; stdout?: Buffer | string; stderr?: Buffer | string; killed?: boolean; signal?: string };
      const timedOut = e.killed === true || e.signal === 'SIGTERM';
      return {
        code: e.status ?? (timedOut ? 124 : 1),
        stdout: e.stdout?.toString() ?? '',
        stderr: e.stderr?.toString() ?? '',
        timedOut,
      };
    }
  }

  /** Stage all + commit on the job branch. Returns false (no-op) when nothing staged.
   *  `.bak` rollback litter from the structured-edit applicator is never staged, so
   *  it can never reach the integration branch (PHASE5 §13). */
  commit(message: string): boolean {
    git(this.path, ['add', '-A', '--', '.', ':(exclude)*.bak']);
    const staged = git(this.path, ['diff', '--cached', '--name-only'], { allowFail: true }).out.trim();
    if (!staged) return false;
    const author = `${this.authorName} <${this.authorEmail}>`;
    git(this.path, [
      '-c', `user.name=${this.authorName}`,
      '-c', `user.email=${this.authorEmail}`,
      'commit', '--no-gpg-sign', '--author', author, '-m', message,
    ]);
    const sha = git(this.path, ['rev-parse', 'HEAD']).out.trim();
    this.logFn(`[worktree] Committed ${sha.slice(0, 8)} on ${this.branch}`);
    return true;
  }

  /**
   * Merge the job branch into the integration branch. MUST be called inside the
   * IntegrationGate so concurrent merges serialise. On conflict the merge is
   * aborted and the integration HEAD is left identical to its pre-merge value.
   */
  mergeBack(): MergeBackResult {
    const out: MergeBackResult = { success: false, conflict: false, conflictingFiles: [], feedback: [], errors: [] };
    const merge = git(this.repoRoot, ['merge', '--no-ff', '--no-edit', this.branch], { allowFail: true });
    if (merge.code === 0) {
      out.success = true;
      out.mergedSha = git(this.repoRoot, ['rev-parse', 'HEAD']).out.trim();
      this.logFn(`[worktree] Merged ${this.branch} → ${this.integrationBranch} @ ${out.mergedSha.slice(0, 8)}`);
      return out;
    }
    out.conflict = true;
    const status = git(this.repoRoot, ['diff', '--name-only', '--diff-filter=U'], { allowFail: true });
    out.conflictingFiles = status.out.split('\n').map((s) => s.trim()).filter(Boolean);
    out.feedback.push(
      'Merge-back into the integration branch produced a conflict — another job changed the same lines.',
      ...out.conflictingFiles.map((f) => `Conflicting file: ${f}`),
      merge.out.slice(0, 600),
    );
    git(this.repoRoot, ['merge', '--abort'], { allowFail: true });
    this.logFn(`[worktree] Conflict merging ${this.branch}; aborted. Files: ${out.conflictingFiles.join(', ')}`);
    return out;
  }

  /** Remove the worktree + delete the job branch. Integration HEAD untouched. Idempotent. */
  discard(): void {
    if (this.discarded) return;
    this.discarded = true;
    this.discardFn();
  }
}
