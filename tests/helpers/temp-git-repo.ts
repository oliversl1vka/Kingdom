/**
 * PHASE5 test harness: a throwaway git repo in os.tmpdir() with a single initial
 * commit. No network. Caller is responsible for cleanup() (or use afterEach).
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';

export interface TempGitRepo {
  /** Absolute repo root. */
  dir: string;
  /** Default branch name (e.g. 'main'). */
  branch: string;
  /** Run a git command in the repo, returning stdout. */
  git(args: string[]): string;
  /** Write a file (creating parent dirs), relative to the repo root. */
  write(relPath: string, content: string): void;
  /** Stage everything + commit; returns the new HEAD sha. */
  commitAll(message: string): string;
  /** Current HEAD sha of `branch`. */
  head(): string;
  /** Remove the repo dir (best-effort). */
  cleanup(): void;
}

export function createTempGitRepo(opts: { branch?: string; seedFile?: { path: string; content: string } } = {}): TempGitRepo {
  const branch = opts.branch ?? 'main';
  const dir = mkdtempSync(join(tmpdir(), 'kingdom-wt-'));

  const git = (args: string[]): string =>
    execFileSync('git', args, { cwd: dir, encoding: 'utf-8' }).toString();

  execFileSync('git', ['init', '-b', branch], { cwd: dir });
  git(['config', 'user.email', 't@t']);
  git(['config', 'user.name', 'T']);
  git(['config', 'commit.gpgsign', 'false']);

  const write = (relPath: string, content: string): void => {
    const full = join(dir, relPath);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content);
  };

  const commitAll = (message: string): string => {
    git(['add', '-A']);
    git(['commit', '--no-gpg-sign', '-m', message]);
    return git(['rev-parse', 'HEAD']).trim();
  };

  // Keep throwaway worktrees out of the integration tree so `git add -A` on the
  // integration branch never embeds them (mirrors the real repo's .gitignore).
  write('.gitignore', '.kingdom-worktrees/\nnode_modules/\n');
  const seed = opts.seedFile ?? { path: 'file.txt', content: 'line1\nline2\nline3\n' };
  write(seed.path, seed.content);
  commitAll('init');

  return {
    dir,
    branch,
    git,
    write,
    commitAll,
    head: () => git(['rev-parse', branch]).trim(),
    cleanup: () => {
      try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
    },
  };
}
