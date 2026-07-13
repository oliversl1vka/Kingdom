-- KingdomOS Phase 1 — P1.1 Append-only state transition log
-- Records every committed status change for tasks and jobs as the durable
-- source of truth. Written in the SAME transaction as the status UPDATE so a
-- transition row exists iff the status actually changed (changes === 1).

INSERT INTO schema_version (version) VALUES (16);

CREATE TABLE IF NOT EXISTS state_transitions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('task', 'job')),
  entity_id   TEXT NOT NULL,
  from_status TEXT,
  to_status   TEXT NOT NULL,
  reason      TEXT,
  actor       TEXT,
  ts          TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_state_transitions_entity
  ON state_transitions(entity_type, entity_id, id);
