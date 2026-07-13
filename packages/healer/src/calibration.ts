import type Database from 'better-sqlite3';

/**
 * PHASE4 (P4.5, additive hook only): Healer confidence calibration.
 *
 * The Diagnostician emits a self-reported `confidence` for each diagnosis. Raw
 * model confidence is poorly calibrated — a model may say 0.9 on a recommendation
 * that then fails. This helper computes a calibration MULTIPLIER from the
 * historical accuracy of past diagnoses (did the recommended action actually
 * resolve the incident?) so the diagnostician can shrink over-confident scores.
 *
 * Deliberately a SEPARATE module (not edits inside diagnostician.ts) so it
 * survives Phase 3's diagnostician rewrite: the diagnostician can opt in with a
 * single call `calibrateConfidence(db, raw)` if/when it wants to, and Phase 3
 * can ignore it freely. It reads only existing `incidents` columns
 * (`healer_confidence`, `resolved_at`) and never writes.
 */

export interface CalibrationStats {
  /** Past diagnoses considered. */
  sample: number;
  /** Fraction whose recommended action ultimately resolved the incident. */
  empiricalAccuracy: number;
  /** Mean self-reported confidence over the sample. */
  meanReportedConfidence: number;
  /** Multiplier in (0,1] to apply to a fresh raw confidence. */
  multiplier: number;
}

/**
 * Compute a calibration multiplier from historical Healer accuracy. Returns a
 * neutral multiplier (1.0) when there isn't enough history to judge, so a cold
 * system behaves exactly as today.
 */
export function computeCalibration(
  db: Database.Database,
  opts: { minSample?: number } = {},
): CalibrationStats {
  const minSample = opts.minSample ?? 5;
  const neutral: CalibrationStats = {
    sample: 0,
    empiricalAccuracy: 1,
    meanReportedConfidence: 1,
    multiplier: 1,
  };

  let rows: Array<{ confidence: number | null; resolved: number | null }> = [];
  try {
    rows = db
      .prepare(
        `SELECT healer_confidence AS confidence,
                CASE WHEN resolved_at IS NOT NULL THEN 1 ELSE 0 END AS resolved
           FROM incidents
          WHERE healer_confidence IS NOT NULL`,
      )
      .all() as Array<{ confidence: number | null; resolved: number | null }>;
  } catch {
    // Schema differs (Phase 3 may rename columns) — degrade to neutral.
    return neutral;
  }

  if (rows.length < minSample) return neutral;

  const sample = rows.length;
  const resolved = rows.reduce((s, r) => s + (r.resolved ? 1 : 0), 0);
  const empiricalAccuracy = resolved / sample;
  const meanReportedConfidence =
    rows.reduce((s, r) => s + clamp01(r.confidence ?? 0), 0) / sample;

  // Multiplier = how well empirical accuracy tracked self-reported confidence.
  // If the model is systematically over-confident (reported > actual), shrink.
  const multiplier =
    meanReportedConfidence > 0
      ? clamp01(empiricalAccuracy / meanReportedConfidence)
      : 1;

  return { sample, empiricalAccuracy, meanReportedConfidence, multiplier };
}

/**
 * Apply calibration to a single raw confidence. The diagnostician can call this
 * right before enforcing its `< 0.5 → escalate` rule, tightening that gate when
 * the Healer has a track record of over-confidence. Pure + side-effect free.
 */
export function calibrateConfidence(db: Database.Database, raw: number): number {
  const stats = computeCalibration(db);
  return clamp01(clamp01(raw) * stats.multiplier);
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}
