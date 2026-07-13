-- Dependency ordering: tasks can declare which sibling tasks must complete before they run.
-- depends_on is a JSON array of task IDs (siblings within the same parent scope).

ALTER TABLE task_graph_nodes ADD COLUMN depends_on TEXT NOT NULL DEFAULT '[]';

INSERT OR IGNORE INTO schema_version (version) VALUES (6);
