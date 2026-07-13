-- Migration 007: Add parent_job_id to jobs for retry lineage tracking.
-- When a job is retried or escalated, the new job records its origin.
-- This makes retry chains inspectable and enables per-task cost roll-up.

ALTER TABLE jobs ADD COLUMN parent_job_id TEXT REFERENCES jobs(id);

INSERT INTO schema_version (version) VALUES (7);
