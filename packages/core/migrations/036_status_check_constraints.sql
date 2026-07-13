-- Add CHECK-like validation on status columns via triggers.
-- SQLite does not support ALTER TABLE ADD CONSTRAINT for CHECK,
-- so we use BEFORE INSERT/UPDATE triggers to reject invalid status values.
-- This is backward-compatible (no table rebuild required) and catches typos
-- like 'streamming' or 'queud' at write time.

-- Validate jobs.status
CREATE TRIGGER IF NOT EXISTS validate_job_status_insert
BEFORE INSERT ON jobs
FOR EACH ROW
BEGIN
  SELECT CASE
    WHEN NEW.status NOT IN (
      'queued','preparing-context','awaiting-budget-check','budget-rejected','running','streaming',
      'completed','completed-with-warnings','cancelled','cancel-requested',
      'failed-token-overflow','failed-timeout','failed-runtime-crash','failed-invalid-output','failed-review',
      'retrying','awaiting-healer','awaiting-redesign','superseded','needs-human','stalled'
    )
    THEN RAISE(ABORT, 'Invalid job status: ' || NEW.status)
  END;
END;

CREATE TRIGGER IF NOT EXISTS validate_job_status_update
BEFORE UPDATE ON jobs
FOR EACH ROW
WHEN NEW.status != OLD.status
BEGIN
  SELECT CASE
    WHEN NEW.status NOT IN (
      'queued','preparing-context','awaiting-budget-check','budget-rejected','running','streaming',
      'completed','completed-with-warnings','cancelled','cancel-requested',
      'failed-token-overflow','failed-timeout','failed-runtime-crash','failed-invalid-output','failed-review',
      'retrying','awaiting-healer','awaiting-redesign','superseded','needs-human','stalled'
    )
    THEN RAISE(ABORT, 'Invalid job status: ' || NEW.status)
  END;
END;

-- Validate task_graph_nodes.status
CREATE TRIGGER IF NOT EXISTS validate_task_status_insert
BEFORE INSERT ON task_graph_nodes
FOR EACH ROW
BEGIN
  SELECT CASE
    WHEN NEW.status NOT IN (
      'queued','preparing-context','awaiting-budget-check','budget-rejected','running','streaming',
      'completed','completed-with-warnings','cancelled','cancel-requested',
      'failed-token-overflow','failed-timeout','failed-runtime-crash','failed-invalid-output','failed-review',
      'retrying','awaiting-healer','awaiting-redesign','superseded','needs-human','stalled',
      'retrying','awaiting-healer','awaiting-redesign','stalled','superseded','needs-human'
    )
    THEN RAISE(ABORT, 'Invalid task status: ' || NEW.status)
  END;
END;

CREATE TRIGGER IF NOT EXISTS validate_task_status_update
BEFORE UPDATE ON task_graph_nodes
FOR EACH ROW
WHEN NEW.status != OLD.status
BEGIN
  SELECT CASE
    WHEN NEW.status NOT IN (
      'queued','preparing-context','awaiting-budget-check','budget-rejected','running','streaming',
      'completed','completed-with-warnings','cancelled','cancel-requested',
      'failed-token-overflow','failed-timeout','failed-runtime-crash','failed-invalid-output','failed-review',
      'retrying','awaiting-healer','awaiting-redesign','superseded','needs-human','stalled',
      'retrying','awaiting-healer','awaiting-redesign','stalled','superseded','needs-human'
    )
    THEN RAISE(ABORT, 'Invalid task status: ' || NEW.status)
  END;
END;

INSERT OR IGNORE INTO schema_version (version) VALUES (36);
