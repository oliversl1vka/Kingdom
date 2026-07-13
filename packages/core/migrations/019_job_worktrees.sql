-- KingdomOS Phase 1 — P1.5 Git-worktree-per-job isolation tracking
-- Records the per-job git worktree so a crash can clean up dangling worktrees
-- and so the merge-back step has a durable handle on the branch/path. Optional
-- metadata: the worktree-manager works without it, but recording it lets the
-- reconciler prune abandoned worktrees on startup.

INSERT INTO schema_version (version) VALUES (19);

CREATE TABLE IF NOT EXISTS job_worktrees (
  job_id        TEXT PRIMARY KEY,
  worktree_path TEXT NOT NULL,
  branch        TEXT NOT NULL,
  base_sha      TEXT,
  status        TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'merged', 'conflict', 'abandoned')),
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
