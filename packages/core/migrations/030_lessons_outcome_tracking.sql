-- Migration 030 (Phase 4 / P4.1): outcome tracking + decay for lessons.
--
-- The 5 hardcoded rules in the distiller produce lessons that get injected
-- forever, regardless of whether they actually help. Phase 4 adds a closed
-- loop: when a lesson is injected into a job's prompt we record the job id;
-- when that job resolves (success vs rejection/failure) we correlate the
-- outcome and recompute a win-rate. Lessons whose win-rate falls below the
-- decay threshold are soft-decayed (active=0, decayed_at set); proven lessons
-- gain confidence and are promoted.
--
-- All columns are additive and nullable / defaulted so a pre-030 DB upgrades
-- in place and existing lessons behave as before until they accrue outcomes.

INSERT OR IGNORE INTO schema_version (version) VALUES (30);

-- Running win-rate in [0,1]. NULL = no outcomes recorded yet (treated as the
-- seed prior; a freshly generated lesson starts at its seed confidence).
ALTER TABLE lessons ADD COLUMN confidence REAL;

-- JSON array of job ids this lesson was injected into. Used to attribute
-- success/failure back to the lesson when the job resolves.
ALTER TABLE lessons ADD COLUMN injected_job_ids TEXT NOT NULL DEFAULT '[]';

-- Number of injected jobs that ended in success vs total resolved — kept as
-- raw counters so win-rate is recomputable and survives partial updates.
ALTER TABLE lessons ADD COLUMN outcome_success INTEGER NOT NULL DEFAULT 0;
ALTER TABLE lessons ADD COLUMN outcome_total   INTEGER NOT NULL DEFAULT 0;

-- Set when a lesson decays out (win-rate below threshold). Soft signal only;
-- the row is also flipped active=0 so it stops being injected.
ALTER TABLE lessons ADD COLUMN decayed_at TEXT;

-- 'rule' (the 5 hardcoded rules) or 'generated' (LLM-discovered). Generated
-- lessons are gated behind a confidence/validation threshold before earning
-- injection — see lesson-injector.ts.
ALTER TABLE lessons ADD COLUMN origin TEXT NOT NULL DEFAULT 'rule';

CREATE INDEX IF NOT EXISTS idx_lessons_origin_active
  ON lessons(origin, active);
