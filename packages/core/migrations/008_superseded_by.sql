-- Migration 008: Add superseded_by to jobs for full retry lineage tracking.
-- parent_job_id (migration 007) is the backward link (new → old).
-- superseded_by is the forward link (old → new), set when a retry/escalation replaces a job.
-- Together they form a doubly-linked chain for complete history and analytics.

ALTER TABLE jobs ADD COLUMN superseded_by TEXT REFERENCES jobs(id);

CREATE INDEX IF NOT EXISTS idx_jobs_superseded_by ON jobs(superseded_by);

INSERT INTO schema_version (version) VALUES (8);
