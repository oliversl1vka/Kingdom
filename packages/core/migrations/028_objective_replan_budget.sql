-- Phase 3 (P3.1): mutable task graph — per-objective replan budget.
-- The orchestration replan phase re-decomposes stuck subtrees. Without a budget
-- a confused planner could churn the graph forever, so we track how many replans
-- an objective has consumed and stop once a configured cap is reached.

ALTER TABLE objectives ADD COLUMN replan_count INTEGER NOT NULL DEFAULT 0;

INSERT OR IGNORE INTO schema_version (version) VALUES (28);
