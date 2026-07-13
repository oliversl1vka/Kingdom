import type Database from 'better-sqlite3';

/**
 * PHASE5 (§6): durable ledger for per-job isolated worktrees. Lifecycle:
 *   open → merging → merged   (success)
 *   open → discarded          (any failure / finally cleanup)
 *
 * The reconciler reads `listLive()` at summon startup to recover crashed jobs.
 */
export type WorktreeStatus = 'open' | 'merging' | 'merged' | 'discarded';

export interface JobWorktreeRow {
  job_id: string;
  branch: string;
  worktree_path: string;
  integration_branch: string;
  base_sha: string;
  status: WorktreeStatus;
  merged_sha: string | null;
  created_at: string;
  updated_at: string | null;
}

export interface OpenWorktreeParams {
  jobId: string;
  branch: string;
  worktreePath: string;
  integrationBranch: string;
  baseSha: string;
}

export class WorktreeRepository {
  constructor(private db: Database.Database) {}

  /** Record a freshly-opened worktree session (status='open'). Idempotent (upsert). */
  open(p: OpenWorktreeParams): void {
    this.db
      .prepare(
        `INSERT INTO job_worktrees (job_id, branch, worktree_path, integration_branch, base_sha, status, updated_at)
         VALUES (?, ?, ?, ?, ?, 'open', datetime('now'))
         ON CONFLICT(job_id) DO UPDATE SET
           branch=excluded.branch,
           worktree_path=excluded.worktree_path,
           integration_branch=excluded.integration_branch,
           base_sha=excluded.base_sha,
           status='open',
           merged_sha=NULL,
           updated_at=datetime('now')`,
      )
      .run(p.jobId, p.branch, p.worktreePath, p.integrationBranch, p.baseSha);
  }

  /** Mark the session as entering the merge critical section. */
  setMerging(jobId: string): void {
    this.db
      .prepare("UPDATE job_worktrees SET status='merging', updated_at=datetime('now') WHERE job_id=?")
      .run(jobId);
  }

  /** Mark the session merged onto the integration branch (records merged_sha). */
  setMerged(jobId: string, mergedSha: string): void {
    this.db
      .prepare("UPDATE job_worktrees SET status='merged', merged_sha=?, updated_at=datetime('now') WHERE job_id=?")
      .run(mergedSha, jobId);
  }

  /** Mark the session discarded (worktree removed; integration untouched). */
  setDiscarded(jobId: string): void {
    this.db
      .prepare("UPDATE job_worktrees SET status='discarded', updated_at=datetime('now') WHERE job_id=?")
      .run(jobId);
  }

  get(jobId: string): JobWorktreeRow | null {
    const row = this.db.prepare('SELECT * FROM job_worktrees WHERE job_id=?').get(jobId) as JobWorktreeRow | undefined;
    return row ?? null;
  }

  /** All worktrees still live (open or merging) — the reconciler's recovery set. */
  listLive(): JobWorktreeRow[] {
    return this.db
      .prepare("SELECT * FROM job_worktrees WHERE status IN ('open','merging') ORDER BY created_at ASC")
      .all() as JobWorktreeRow[];
  }
}
