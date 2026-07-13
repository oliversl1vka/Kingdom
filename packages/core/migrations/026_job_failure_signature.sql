-- Phase 3 (P3.4): semantic loop-breaking.
-- Persist a normalized per-attempt failure signature on each job so consecutive
-- attempts can be compared by ROOT CAUSE rather than raw string overlap. When
-- the same root cause repeats across attempts the dispatcher escalates the
-- STRATEGY (route to the healer) rather than only bumping the tier.

ALTER TABLE jobs ADD COLUMN failure_signature TEXT;

INSERT OR IGNORE INTO schema_version (version) VALUES (26);
