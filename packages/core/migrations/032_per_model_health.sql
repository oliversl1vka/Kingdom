-- Migration 032 (Phase 4 / P4.4): per-(provider,model) health tracking.
--
-- The router historically tracked health at the PROVIDER granularity only, and
-- routed by provider priority while passing `request.model` opaquely. Phase 4
-- routes by MODEL (only to providers that serve the requested model) and tracks
-- latency/error rates per (provider, model) so a model that is failing on one
-- provider can be de-prioritised without blackballing the whole provider.
--
-- provider_health (provider granularity) is unchanged and remains authoritative
-- for provider availability/cooldown; this table is an additive refinement.

INSERT OR IGNORE INTO schema_version (version) VALUES (32);

CREATE TABLE IF NOT EXISTS provider_model_health (
  provider_id        TEXT NOT NULL,
  model              TEXT NOT NULL,
  requests           INTEGER NOT NULL DEFAULT 0,
  errors             INTEGER NOT NULL DEFAULT 0,
  total_latency_ms   INTEGER NOT NULL DEFAULT 0,
  last_latency_ms    INTEGER,
  last_error         TEXT,
  last_status        TEXT NOT NULL DEFAULT 'unknown',
  cooldown_until     TEXT,
  last_check         TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (provider_id, model)
);

CREATE INDEX IF NOT EXISTS idx_provider_model_health_model
  ON provider_model_health(model);
