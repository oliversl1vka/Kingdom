-- Run checkpoints: record git state after each successful diff application.
-- Allows kingdom resume to skip already-completed tasks after a crash or restart.

CREATE TABLE IF NOT EXISTS run_checkpoints (
  id          TEXT PRIMARY KEY,
  objective_id TEXT NOT NULL,
  task_id     TEXT NOT NULL,
  job_id      TEXT NOT NULL,
  git_sha     TEXT,                    -- git HEAD at time of checkpoint (nullable for non-git projects)
  applied_files TEXT NOT NULL DEFAULT '[]', -- JSON array of files successfully modified
  checkpoint_at TEXT NOT NULL,
  FOREIGN KEY (objective_id) REFERENCES objectives(id),
  FOREIGN KEY (task_id)      REFERENCES task_graph_nodes(id),
  FOREIGN KEY (job_id)       REFERENCES jobs(id)
);

CREATE INDEX IF NOT EXISTS idx_checkpoints_objective ON run_checkpoints(objective_id);
CREATE INDEX IF NOT EXISTS idx_checkpoints_task      ON run_checkpoints(task_id);

INSERT OR IGNORE INTO schema_version (version) VALUES (5);
