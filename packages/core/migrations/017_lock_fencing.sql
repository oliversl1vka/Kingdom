-- KingdomOS Phase 1 — P1.3 Fencing tokens on file locks
-- A monotonically-increasing fencing token is stamped on every lock acquisition.
-- A worker carries the token it was granted; a late write from a zombie worker
-- (whose lock was already released and re-granted to a newer job) is rejected
-- because the current lock's token is strictly greater than the zombie's token.
--
-- fence_counter is a single-row global monotonic source so tokens never collide
-- across files or reuse, even after a lock row is deleted and recreated.

INSERT INTO schema_version (version) VALUES (17);

CREATE TABLE IF NOT EXISTS fence_counter (
  id      INTEGER PRIMARY KEY CHECK (id = 1),
  current INTEGER NOT NULL DEFAULT 0
);
INSERT OR IGNORE INTO fence_counter (id, current) VALUES (1, 0);

ALTER TABLE file_locks ADD COLUMN fencing_token INTEGER NOT NULL DEFAULT 0;
