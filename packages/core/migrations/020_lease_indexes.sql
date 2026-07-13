-- KingdomOS Phase 1 — P1.3/P1.4 supporting indexes
-- Speeds up the crash-recovery reconciler's scan for running/streaming jobs and
-- the lock-fencing owner lookup. Pure performance; no behavioural change.

INSERT INTO schema_version (version) VALUES (20);

CREATE INDEX IF NOT EXISTS idx_jobs_status_lease ON jobs(status, lease_owner_pid);
CREATE INDEX IF NOT EXISTS idx_file_locks_owning_job ON file_locks(owning_job_id);
