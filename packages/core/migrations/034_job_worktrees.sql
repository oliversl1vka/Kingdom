-- Migration 034 (Phase 5 / Agentic Dispatch): widen the per-job worktree ledger.
--
-- Phase 1 (migration 019) created `job_worktrees` with a narrow schema and a
-- status CHECK constraint that only permits ('open','merged','conflict',
-- 'abandoned'). Phase 5 drives the table through the lifecycle
--   open → merging → merged   (success)
--   open → discarded          (any failure / finally cleanup)
-- and records `integration_branch` + `merged_sha` so the reconciler can recover
-- a crash mid-flight. SQLite cannot relax a CHECK constraint in place, so we
-- rebuild the table (preserving any existing rows) and map the old terminal
-- states onto the new vocabulary.
--
-- The load-bearing invariant (INV-1): the integration branch HEAD equals
-- base_sha for every row whose status is NOT 'merged'.

INSERT OR IGNORE INTO schema_version (version) VALUES (34);

ALTER TABLE job_worktrees RENAME TO job_worktrees_pre034;

CREATE TABLE job_worktrees (
  job_id             TEXT PRIMARY KEY,
  branch             TEXT NOT NULL,
  worktree_path      TEXT NOT NULL,
  integration_branch TEXT NOT NULL,
  base_sha           TEXT NOT NULL,
  status             TEXT NOT NULL DEFAULT 'open',  -- open | merging | merged | discarded
  merged_sha         TEXT,
  created_at         TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at         TEXT
);

-- Preserve any Phase 1 rows, mapping legacy terminal states. 'conflict' and
-- 'abandoned' both mean "did not land" → 'discarded'; 'open'/'merged' carry over.
INSERT INTO job_worktrees (job_id, branch, worktree_path, integration_branch, base_sha, status, created_at)
  SELECT job_id, branch, worktree_path, '', COALESCE(base_sha, ''),
         CASE status
           WHEN 'abandoned' THEN 'discarded'
           WHEN 'conflict'  THEN 'discarded'
           ELSE status
         END,
         created_at
  FROM job_worktrees_pre034;

DROP TABLE job_worktrees_pre034;

CREATE INDEX IF NOT EXISTS idx_job_worktrees_status ON job_worktrees(status);
