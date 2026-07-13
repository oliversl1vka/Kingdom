-- Migration 033 (Phase 4 / P4.3): model self-eval & auto-tiering harness.
--
-- `kingdom eval` runs a small fixed battery (decompose / code-diff / review /
-- diagnose) against each registered model and writes MEASURED ModelCapabilities
-- back into model_configs.capabilities_json with a fresh `verified_at`. We also
-- persist per-probe pass-rates here so auto-tiering can promote a model that
-- wins code tasks into the knight profile, and so operators can audit the
-- evidence behind a capability claim.
--
-- capabilities_json / aliases_json already exist (migration 009); the eval
-- writes are ADDITIVE updates to capabilities_json. This migration only adds
-- the results ledger plus a denormalised verified_at column for quick listing.

INSERT OR IGNORE INTO schema_version (version) VALUES (33);

-- Denormalised mirror of capabilities_json.verified_at for cheap listing /
-- staleness queries. The JSON value remains authoritative.
ALTER TABLE model_configs ADD COLUMN verified_at TEXT;

CREATE TABLE IF NOT EXISTS model_eval_results (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  model_id    TEXT NOT NULL,
  provider    TEXT NOT NULL,
  probe       TEXT NOT NULL,          -- decompose | code-diff | review | diagnose
  task_kind   TEXT NOT NULL,          -- maps probe → TaskKind
  passed      INTEGER NOT NULL,       -- 0/1
  score       REAL NOT NULL DEFAULT 0,
  latency_ms  INTEGER NOT NULL DEFAULT 0,
  tool_use_observed        INTEGER NOT NULL DEFAULT 0,
  structured_output_observed INTEGER NOT NULL DEFAULT 0,
  detail      TEXT,                   -- short note / error
  ran_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_model_eval_results_model
  ON model_eval_results(model_id, ran_at);
