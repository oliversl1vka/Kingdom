-- Normalize task dependency ordering into a join table with FK and cycle checks.

CREATE TABLE IF NOT EXISTS task_dependencies (
  task_id TEXT NOT NULL REFERENCES task_graph_nodes(id) ON DELETE CASCADE,
  depends_on_task_id TEXT NOT NULL REFERENCES task_graph_nodes(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (task_id, depends_on_task_id),
  CHECK (task_id <> depends_on_task_id)
);

CREATE INDEX IF NOT EXISTS idx_task_dependencies_depends_on
  ON task_dependencies(depends_on_task_id);

CREATE TRIGGER IF NOT EXISTS task_dependencies_same_scope_insert
BEFORE INSERT ON task_dependencies
BEGIN
  SELECT RAISE(ABORT, 'task dependency must share objective and parent scope')
  WHERE EXISTS (
    SELECT 1
    FROM task_graph_nodes t
    JOIN task_graph_nodes d ON d.id = NEW.depends_on_task_id
    WHERE t.id = NEW.task_id
      AND (t.objective_id <> d.objective_id OR t.parent_id IS NOT d.parent_id)
  );
END;

CREATE TRIGGER IF NOT EXISTS task_dependencies_no_cycles_insert
BEFORE INSERT ON task_dependencies
BEGIN
  SELECT RAISE(ABORT, 'task dependency cycle detected')
  WHERE EXISTS (
    WITH RECURSIVE dependency_tree(id) AS (
      SELECT NEW.depends_on_task_id
      UNION
      SELECT td.depends_on_task_id
      FROM task_dependencies td
      JOIN dependency_tree dt ON td.task_id = dt.id
    )
    SELECT 1 FROM dependency_tree WHERE id = NEW.task_id
  );
END;

INSERT OR IGNORE INTO task_dependencies (task_id, depends_on_task_id)
SELECT t.id, CAST(j.value AS TEXT)
FROM task_graph_nodes t
JOIN json_each(CASE WHEN json_valid(t.depends_on) THEN t.depends_on ELSE '[]' END) j
JOIN task_graph_nodes d ON d.id = CAST(j.value AS TEXT)
WHERE t.id <> d.id
  AND t.objective_id = d.objective_id
  AND t.parent_id IS d.parent_id;

INSERT OR IGNORE INTO schema_version (version) VALUES (13);