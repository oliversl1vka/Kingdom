/**
 * PHASE5 §12.1 — WorktreeSession step-wise lifecycle unit tests.
 *
 * Asserts the INV-1 building blocks: opening a session never touches integration
 * HEAD; commit on the job branch never touches integration HEAD; a clean
 * mergeBack advances it to mergedSha; a conflicting mergeBack leaves it identical
 * and aborts; discard is idempotent.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { WorktreeManager } from '@kingdomos/blacksmith';
import { createTempGitRepo, type TempGitRepo } from '../helpers/temp-git-repo.js';

describe('PHASE5 — WorktreeSession (§12.1)', () => {
  let repo: TempGitRepo;
  let mgr: WorktreeManager;

  beforeEach(() => {
    repo = createTempGitRepo();
    mgr = new WorktreeManager(repo.dir, { authorName: 'T', authorEmail: 't@t' });
  });
  afterEach(() => repo.cleanup());

  it('openSession creates the worktree dir + branch; baseSha === integrationHead()', () => {
    const h0 = mgr.integrationHead();
    const s = mgr.openSession('job-open');
    try {
      expect(existsSync(s.path)).toBe(true);
      expect(s.baseSha).toBe(h0);
      expect(s.branch).toBe('kingdom/job-job-open');
      expect(s.integrationBranch).toBe('main');
      // Branch exists.
      expect(repo.git(['branch', '--list', s.branch]).trim()).toContain(s.branch);
    } finally {
      s.discard();
    }
  });

  it('run() executes with cwd=worktree and returns code/stdout', () => {
    const s = mgr.openSession('job-run');
    try {
      const r = s.run('node -e "console.log(42)"');
      expect(r.code).toBe(0);
      expect(r.stdout).toContain('42');
      const fail = s.run('node -e "process.exit(3)"');
      expect(fail.code).toBe(3);
    } finally {
      s.discard();
    }
  });

  it('diff()/changedFiles() reflect an in-worktree edit; integration HEAD unchanged', () => {
    const h0 = mgr.integrationHead();
    const s = mgr.openSession('job-diff');
    try {
      writeFileSync(join(s.path, 'file.txt'), 'line1\nEDITED\nline3\n');
      expect(s.diff()).toMatch(/EDITED/);
      expect(s.changedFiles()).toContain('file.txt');
      // No commit, no merge → integration untouched.
      expect(mgr.integrationHead()).toBe(h0);
    } finally {
      s.discard();
    }
  });

  it('commit() creates a commit on the job branch; integration HEAD unchanged', () => {
    const h0 = mgr.integrationHead();
    const s = mgr.openSession('job-commit');
    try {
      writeFileSync(join(s.path, 'file.txt'), 'line1\nCOMMITTED\nline3\n');
      expect(s.commit('test commit')).toBe(true);
      expect(mgr.integrationHead()).toBe(h0);
      // commit with nothing staged → false.
      expect(s.commit('noop')).toBe(false);
    } finally {
      s.discard();
    }
  });

  it('mergeBack() clean → integration HEAD advances to mergedSha; file present', () => {
    const h0 = mgr.integrationHead();
    const s = mgr.openSession('job-merge');
    try {
      writeFileSync(join(s.path, 'file.txt'), 'line1\nMERGED\nline3\n');
      s.commit('merge me');
      const m = s.mergeBack();
      expect(m.success).toBe(true);
      expect(m.conflict).toBe(false);
      expect(m.mergedSha).toBeTruthy();
      expect(mgr.integrationHead()).toBe(m.mergedSha);
      expect(mgr.integrationHead()).not.toBe(h0);
      expect(readFileSync(join(repo.dir, 'file.txt'), 'utf-8')).toContain('MERGED');
    } finally {
      s.discard();
    }
  });

  it('mergeBack() conflict → integration HEAD unchanged, merge aborted (INV-1)', () => {
    const base = repo.head();
    const s = mgr.openSession('job-conflict', { baseRef: base });
    // After opening, advance integration with a conflicting change on the same line.
    repo.write('file.txt', 'line1\nINTEGRATION\nline3\n');
    const h1 = repo.commitAll('integration edit');
    expect(mgr.integrationHead()).toBe(h1);

    try {
      writeFileSync(join(s.path, 'file.txt'), 'line1\nJOB\nline3\n');
      s.commit('job edit');
      const m = s.mergeBack();
      expect(m.success).toBe(false);
      expect(m.conflict).toBe(true);
      expect(m.conflictingFiles).toContain('file.txt');
      // INV-1: integration HEAD is exactly h1; no conflict markers left behind.
      expect(mgr.integrationHead()).toBe(h1);
      const onDisk = readFileSync(join(repo.dir, 'file.txt'), 'utf-8');
      expect(onDisk).not.toContain('<<<<<<<');
      expect(onDisk).toContain('INTEGRATION');
    } finally {
      s.discard();
    }
  });

  it('discard() removes the worktree + branch; idempotent; integration unchanged', () => {
    const h0 = mgr.integrationHead();
    const s = mgr.openSession('job-discard');
    const p = s.path;
    expect(existsSync(p)).toBe(true);
    s.discard();
    expect(existsSync(p)).toBe(false);
    expect(repo.git(['branch', '--list', s.branch]).trim()).toBe('');
    // Second discard does not throw.
    expect(() => s.discard()).not.toThrow();
    expect(mgr.integrationHead()).toBe(h0);
  });
});
