-- Phase 3 (P3.2): per-task verification contract.
-- Adds an optional `verification` column holding a JSON object:
--   { "test_command": string, "probe"?: string, "timeout_seconds"?: number }
-- When present, the dispatcher runs the task-scoped command as an execution gate
-- between the global validationCommand and the behavioural probes. A non-zero
-- exit rolls the diff back (reusing the existing failAppliedDiff path) with the
-- captured test output injected as retry feedback. Absent => behaves exactly as
-- before (no per-task gate).

ALTER TABLE task_graph_nodes ADD COLUMN verification TEXT;

INSERT OR IGNORE INTO schema_version (version) VALUES (25);
