-- Migration 031 (Phase 4 / P4.2): lesson body embeddings for relevance ranking.
--
-- Relevance-ranked injection retrieves lessons by cosine similarity between the
-- CURRENT task text and each lesson body, instead of bulk `times_seen DESC`.
-- We cache the lesson body embedding here (keyed by the embedding model + a
-- hash of the body) so we don't re-embed unchanged lessons every run. The task
-- side is embedded on the fly at injection time and not stored.
--
-- Graceful degradation: when no EmbeddingProvider is configured, the injector
-- never reads this table and falls back to the legacy `times_seen DESC` path.

INSERT OR IGNORE INTO schema_version (version) VALUES (31);

CREATE TABLE IF NOT EXISTS lesson_embeddings (
  lesson_id    TEXT NOT NULL,
  model        TEXT NOT NULL,
  body_hash    TEXT NOT NULL,
  dim          INTEGER NOT NULL,
  -- Float32 vector serialized as JSON array text. Small (≤1536 floats) so JSON
  -- is fine; avoids a BLOB codec dependency and stays inspectable.
  vector       TEXT NOT NULL,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (lesson_id, model)
);

CREATE INDEX IF NOT EXISTS idx_lesson_embeddings_model
  ON lesson_embeddings(model);
