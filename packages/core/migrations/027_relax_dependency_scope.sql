-- Phase 3 (P3.1): mutable task graph — true DAG within an objective.
-- The original `task_dependencies_same_scope_insert` trigger (migration 013)
-- rejected ANY edge whose endpoints did not share the same parent, which forced
-- the dependency graph to be a forest of sibling chains. Cross-subtree ordering
-- (e.g. a feature task depending on a setup task under a different parent) is a
-- legitimate DAG edge. We drop that trigger and install a relaxed one that only
-- rejects edges crossing OBJECTIVE boundaries. The existing acyclicity trigger
-- (`task_dependencies_no_cycles_insert`) is kept — once cross-subtree edges are
-- allowed, the tree structure no longer guarantees acyclicity, so the explicit
-- cycle check becomes load-bearing.

DROP TRIGGER IF EXISTS task_dependencies_same_scope_insert;

CREATE TRIGGER IF NOT EXISTS task_dependencies_same_objective_insert
BEFORE INSERT ON task_dependencies
BEGIN
  SELECT RAISE(ABORT, 'task dependency must stay within the same objective')
  WHERE EXISTS (
    SELECT 1
    FROM task_graph_nodes t
    JOIN task_graph_nodes d ON d.id = NEW.depends_on_task_id
    WHERE t.id = NEW.task_id
      AND t.objective_id <> d.objective_id
  );
END;

INSERT OR IGNORE INTO schema_version (version) VALUES (27);
