-- Migration 010: Lessons — closed-loop learning across runs.
--
-- A lesson is a durable, LLM-readable note distilled from past run artifacts
-- (incidents, review_decisions, task transitions). Lessons are written by the
-- post-run distiller in @kingdomos/scribe and injected into future agent
-- prompts by the packet assembler (king/nobility/healer tiers only in v1).
--
-- Dedup: (tier, rule_id, signature) is unique among active lessons — a second
-- distill pass that re-derives the same lesson bumps times_seen rather than
-- inserting a duplicate row.

INSERT OR IGNORE INTO schema_version (version) VALUES (10);

CREATE TABLE IF NOT EXISTS lessons (
  id                    TEXT PRIMARY KEY,
  tier                  TEXT NOT NULL CHECK (tier IN (
                          'king','nobility','healer','judge','knight','squire','shared'
                        )),
  rule_id               TEXT NOT NULL,
  signature             TEXT NOT NULL,
  title                 TEXT NOT NULL,
  body                  TEXT NOT NULL,
  matches_failure_type  TEXT,
  times_seen            INTEGER NOT NULL DEFAULT 1,
  first_seen_at         TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen_at          TEXT NOT NULL DEFAULT (datetime('now')),
  source_task_id        TEXT,
  source_run_id         TEXT,
  source_incident_ids   TEXT NOT NULL DEFAULT '[]',
  active                INTEGER NOT NULL DEFAULT 1,
  created_at            TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_lessons_tier_active
  ON lessons(tier, active);

CREATE INDEX IF NOT EXISTS idx_lessons_failure_type
  ON lessons(matches_failure_type, active);

-- Partial unique index: one active lesson per (tier, rule_id, signature).
-- Soft-deleted (active=0) rows are kept as an audit trail and are exempt.
CREATE UNIQUE INDEX IF NOT EXISTS idx_lessons_sig_active
  ON lessons(tier, rule_id, signature) WHERE active = 1;
