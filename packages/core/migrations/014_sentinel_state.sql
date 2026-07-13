-- Persist Sentinel process state so separate CLI processes can inspect monitor health.

CREATE TABLE IF NOT EXISTS sentinel_state (
  id TEXT PRIMARY KEY CHECK (id = 'sentinel'),
  status TEXT NOT NULL DEFAULT 'stopped' CHECK (status IN ('running', 'stopped')),
  process_id INTEGER,
  started_at TEXT,
  stopped_at TEXT,
  last_heartbeat_at TEXT,
  poll_interval_ms INTEGER NOT NULL DEFAULT 5000,
  polls INTEGER NOT NULL DEFAULT 0,
  stale_detected INTEGER NOT NULL DEFAULT 0,
  locks_released INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT OR IGNORE INTO sentinel_state (id, status, updated_at)
VALUES ('sentinel', 'stopped', datetime('now'));

INSERT OR IGNORE INTO schema_version (version) VALUES (14);