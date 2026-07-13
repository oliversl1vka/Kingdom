-- Add PRIMARY KEY to schema_version to prevent duplicate version rows.
-- Use INSERT OR REPLACE pattern: create new table with PK, copy data, rename.
CREATE TABLE IF NOT EXISTS schema_version_new (
  version INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL DEFAULT (datetime('now'))
);
INSERT OR REPLACE INTO schema_version_new (version, applied_at)
  SELECT version, applied_at FROM schema_version;
DROP TABLE schema_version;
ALTER TABLE schema_version_new RENAME TO schema_version;
INSERT OR IGNORE INTO schema_version (version) VALUES (35);
