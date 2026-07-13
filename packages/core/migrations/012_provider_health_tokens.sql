-- Track provider token usage alongside request counts.

ALTER TABLE provider_health ADD COLUMN tokens_today INTEGER NOT NULL DEFAULT 0;
ALTER TABLE provider_health ADD COLUMN last_check TEXT;

UPDATE provider_health SET last_check = datetime('now') WHERE last_check IS NULL;

INSERT OR IGNORE INTO schema_version (version) VALUES (12);