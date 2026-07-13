import type Database from 'better-sqlite3';
import type { Lesson } from '../types.js';
import { generateUlid } from '../ulid.js';

/**
 * Upsert input for a distilled lesson. The distiller produces these; the repo
 * handles dedup / times_seen bookkeeping.
 */
export interface LessonUpsert {
  tier: Lesson['tier'];
  rule_id: string;
  signature: string;
  title: string;
  body: string;
  matches_failure_type?: string | null;
  source_task_id?: string | null;
  source_run_id?: string | null;
  source_incident_ids?: string[];
  // PHASE4 (P4.1): provenance + seed confidence for generated lessons.
  /** 'rule' (R1–R5) or 'generated' (LLM-discovered). Default 'rule'. */
  origin?: 'rule' | 'generated';
  /** Seed win-rate for a brand-new lesson (generated lessons start lower). */
  seed_confidence?: number | null;
}

// PHASE4 (P4.1): decay / promotion tuning. A lesson must accrue at least
// MIN_OUTCOMES_FOR_DECAY resolved injections before its win-rate is trusted;
// below DECAY_THRESHOLD it decays (active=0). Generated lessons only earn
// injection once their confidence clears the inject threshold (gated in
// lesson-injector.ts).
export const DECAY_THRESHOLD = 0.35;
export const PROMOTE_THRESHOLD = 0.6;
export const MIN_OUTCOMES_FOR_DECAY = 4;
export const GENERATED_INJECT_THRESHOLD = 0.5;
export const GENERATED_SEED_CONFIDENCE = 0.5;
export const RULE_SEED_CONFIDENCE = 0.7;

/**
 * Pure win-rate helper (exported for unit tests). Laplace-smoothed so a single
 * early failure doesn't immediately bury a lesson: (success + 1) / (total + 2).
 */
export function computeWinRate(success: number, total: number): number {
  return (success + 1) / (total + 2);
}

/**
 * SQLite-backed access to the `lessons` table.
 *
 * Storage contract: exactly one *active* row per (tier, rule_id, signature).
 * A second `upsert` with matching keys bumps `times_seen` and refreshes
 * `last_seen_at` / `title` / `body` (so the latest phrasing wins) instead of
 * creating a duplicate. Soft-deletes (`active=0`) are retained as audit trail.
 */
export class LessonsRepository {
  constructor(private db: Database.Database) {}

  // PHASE4: detect whether the 030 outcome columns exist so the repo also works
  // against a pre-migration DB (defensive — old snapshots / partial upgrades).
  private _hasOutcomeCols?: boolean;
  private hasOutcomeColumns(): boolean {
    if (this._hasOutcomeCols !== undefined) return this._hasOutcomeCols;
    const cols = this.db.prepare('PRAGMA table_info(lessons)').all() as Array<{ name: string }>;
    this._hasOutcomeCols = cols.some((c) => c.name === 'confidence');
    return this._hasOutcomeCols;
  }

  /** Dedup-aware insert. Returns the lesson id (new or existing). */
  upsert(input: LessonUpsert): string {
    const existing = this.db
      .prepare(
        `SELECT id, times_seen FROM lessons
         WHERE tier = ? AND rule_id = ? AND signature = ? AND active = 1`,
      )
      .get(input.tier, input.rule_id, input.signature) as
      | { id: string; times_seen: number }
      | undefined;

    const now = new Date().toISOString();
    const sourceIds = JSON.stringify(input.source_incident_ids ?? []);

    if (existing) {
      this.db
        .prepare(
          `UPDATE lessons
             SET times_seen = times_seen + 1,
                 last_seen_at = ?,
                 title = ?,
                 body = ?,
                 matches_failure_type = COALESCE(?, matches_failure_type),
                 source_incident_ids = ?
           WHERE id = ?`,
        )
        .run(
          now,
          input.title,
          input.body,
          input.matches_failure_type ?? null,
          sourceIds,
          existing.id,
        );
      return existing.id;
    }

    const id = generateUlid();
    if (this.hasOutcomeColumns()) {
      const origin = input.origin ?? 'rule';
      const seed =
        input.seed_confidence ??
        (origin === 'generated' ? GENERATED_SEED_CONFIDENCE : RULE_SEED_CONFIDENCE);
      this.db
        .prepare(
          `INSERT INTO lessons (
             id, tier, rule_id, signature, title, body,
             matches_failure_type, times_seen,
             first_seen_at, last_seen_at,
             source_task_id, source_run_id, source_incident_ids,
             active, created_at,
             confidence, injected_job_ids, outcome_success, outcome_total, origin
           ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, 1, ?, ?, '[]', 0, 0, ?)`,
        )
        .run(
          id,
          input.tier,
          input.rule_id,
          input.signature,
          input.title,
          input.body,
          input.matches_failure_type ?? null,
          now,
          now,
          input.source_task_id ?? null,
          input.source_run_id ?? null,
          sourceIds,
          now,
          seed,
          origin,
        );
      return id;
    }

    this.db
      .prepare(
        `INSERT INTO lessons (
           id, tier, rule_id, signature, title, body,
           matches_failure_type, times_seen,
           first_seen_at, last_seen_at,
           source_task_id, source_run_id, source_incident_ids,
           active, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, 1, ?)`,
      )
      .run(
        id,
        input.tier,
        input.rule_id,
        input.signature,
        input.title,
        input.body,
        input.matches_failure_type ?? null,
        now,
        now,
        input.source_task_id ?? null,
        input.source_run_id ?? null,
        sourceIds,
        now,
      );
    return id;
  }

  /** Active lessons for a tier, ordered by relevance (frequency, then recency). */
  listActiveByTier(tier: string, limit = 20): Lesson[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM lessons
          WHERE tier = ? AND active = 1
          ORDER BY times_seen DESC, last_seen_at DESC
          LIMIT ?`,
      )
      .all(tier, limit) as Record<string, unknown>[];
    return rows.map(mapRow);
  }

  /** Active lessons matching a specific failure_type (for the Healer). */
  listByFailureType(failureType: string, limit = 5): Lesson[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM lessons
          WHERE matches_failure_type = ? AND active = 1
          ORDER BY times_seen DESC, last_seen_at DESC
          LIMIT ?`,
      )
      .all(failureType, limit) as Record<string, unknown>[];
    return rows.map(mapRow);
  }

  listAllActive(): Lesson[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM lessons WHERE active = 1
          ORDER BY tier ASC, times_seen DESC, last_seen_at DESC`,
      )
      .all() as Record<string, unknown>[];
    return rows.map(mapRow);
  }

  /** Counts of active lessons per tier — used by `kingdom doctor`. */
  countsByTier(): Record<string, number> {
    const rows = this.db
      .prepare(
        `SELECT tier, COUNT(*) AS n FROM lessons WHERE active = 1 GROUP BY tier`,
      )
      .all() as { tier: string; n: number }[];
    const out: Record<string, number> = {};
    for (const r of rows) out[r.tier] = r.n;
    return out;
  }

  totalActive(): number {
    const row = this.db
      .prepare(`SELECT COUNT(*) AS n FROM lessons WHERE active = 1`)
      .get() as { n: number };
    return row.n;
  }

  /** Soft-delete. The row stays for audit but will not be injected. */
  forget(id: string): boolean {
    const res = this.db
      .prepare(`UPDATE lessons SET active = 0 WHERE id = ? AND active = 1`)
      .run(id);
    return res.changes > 0;
  }

  getById(id: string): Lesson | null {
    const row = this.db
      .prepare(`SELECT * FROM lessons WHERE id = ?`)
      .get(id) as Record<string, unknown> | undefined;
    return row ? mapRow(row) : null;
  }

  // ──────────────────────────────────────────────────────────────────────
  // PHASE4 (P4.1): outcome tracking + decay/promotion.
  // ──────────────────────────────────────────────────────────────────────

  /**
   * Record that `lessonIds` were injected into `jobId`'s prompt. Appended to
   * each lesson's `injected_job_ids` so the outcome can later be attributed.
   * No-op on a pre-030 DB.
   */
  recordInjection(jobId: string, lessonIds: string[]): void {
    if (!this.hasOutcomeColumns() || lessonIds.length === 0) return;
    const sel = this.db.prepare('SELECT injected_job_ids FROM lessons WHERE id = ?');
    const upd = this.db.prepare('UPDATE lessons SET injected_job_ids = ? WHERE id = ?');
    const tx = this.db.transaction((ids: string[]) => {
      for (const id of ids) {
        const row = sel.get(id) as { injected_job_ids?: string } | undefined;
        if (!row) continue;
        const arr = parseStringArray(row.injected_job_ids);
        if (!arr.includes(jobId)) arr.push(jobId);
        upd.run(JSON.stringify(arr), id);
      }
    });
    tx(lessonIds);
  }

  /**
   * Attribute a resolved job outcome to every lesson that was injected into it.
   * Increments outcome_total (and outcome_success when `success`), recomputes a
   * Laplace-smoothed win-rate into `confidence`, drops the job from each
   * lesson's pending `injected_job_ids`, then decays losers. Returns the ids of
   * lessons that decayed in this call. No-op on a pre-030 DB.
   */
  recordOutcome(jobId: string, success: boolean): string[] {
    if (!this.hasOutcomeColumns()) return [];

    const decayed: string[] = [];
    const now = new Date().toISOString();

    // Prepared once, executed inside the transaction so the SELECT + atomic
    // counter UPDATE are serialized — no lost updates from concurrent calls.
    const selectStmt = this.db.prepare(
      `SELECT id, injected_job_ids, outcome_success, outcome_total
         FROM lessons
        WHERE injected_job_ids LIKE ?`,
    );

    const atomicUpd = this.db.prepare(
      `UPDATE lessons
          SET injected_job_ids = ?,
              outcome_success = outcome_success + CASE WHEN ? THEN 1 ELSE 0 END,
              outcome_total = outcome_total + 1
        WHERE id = ?`,
    );

    const confidenceUpd = this.db.prepare(
      `UPDATE lessons
          SET confidence = ?, active = ?, decayed_at = ?
        WHERE id = ?`,
    );

    const tx = this.db.transaction(() => {
      const rows = selectStmt.all(`%${jobId}%`) as Array<{
        id: string;
        injected_job_ids: string;
        outcome_success: number;
        outcome_total: number;
      }>;

      for (const row of rows) {
        const pending = parseStringArray(row.injected_job_ids);
        if (!pending.includes(jobId)) continue; // LIKE false-positive guard
        const remaining = pending.filter((j) => j !== jobId);

        // Atomic counter increment inside the transaction — no lost updates.
        atomicUpd.run(JSON.stringify(remaining), success ? 1 : 0, row.id);

        // Compute new values from the old SELECT (safe: within a transaction
        // nothing else can modify the row between the SELECT and the UPDATE).
        const total = row.outcome_total + 1;
        const succ = row.outcome_success + (success ? 1 : 0);
        const winRate = computeWinRate(succ, total);
        const shouldDecay = total >= MIN_OUTCOMES_FOR_DECAY && winRate < DECAY_THRESHOLD;

        confidenceUpd.run(
          winRate,
          shouldDecay ? 0 : 1,
          shouldDecay ? now : null,
          row.id,
        );
        if (shouldDecay) decayed.push(row.id);
      }
    });
    tx();
    return decayed;
  }

  /**
   * Feed a positive signal from the crypt (successful task summaries) to any
   * lessons injected into those jobs. Maps a set of successful job ids to
   * `recordOutcome(jobId, true)`.
   */
  recordCryptSuccess(jobIds: string[]): void {
    for (const j of jobIds) this.recordOutcome(j, true);
  }

  /** Lessons that have cleared the promotion threshold (proven winners). */
  listPromoted(limit = 50): Lesson[] {
    if (!this.hasOutcomeColumns()) return [];
    const rows = this.db
      .prepare(
        `SELECT * FROM lessons
          WHERE active = 1 AND confidence >= ? AND outcome_total >= ?
          ORDER BY confidence DESC, times_seen DESC
          LIMIT ?`,
      )
      .all(PROMOTE_THRESHOLD, MIN_OUTCOMES_FOR_DECAY, limit) as Record<string, unknown>[];
    return rows.map(mapRow);
  }
}

function parseStringArray(raw: unknown): string[] {
  try {
    if (typeof raw === 'string' && raw.length > 0) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed.map(String);
    }
  } catch {
    /* fall through */
  }
  return [];
}

function mapRow(row: Record<string, unknown>): Lesson {
  let sourceIds: string[] = [];
  try {
    const raw = row.source_incident_ids;
    if (typeof raw === 'string' && raw.length > 0) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) sourceIds = parsed.map(String);
    }
  } catch {
    sourceIds = [];
  }
  return {
    id: row.id as string,
    tier: row.tier as string,
    rule_id: row.rule_id as string,
    signature: row.signature as string,
    title: row.title as string,
    body: row.body as string,
    matches_failure_type: (row.matches_failure_type as string | null) ?? null,
    times_seen: Number(row.times_seen ?? 1),
    first_seen_at: row.first_seen_at as string,
    last_seen_at: row.last_seen_at as string,
    source_task_id: (row.source_task_id as string | null) ?? null,
    source_run_id: (row.source_run_id as string | null) ?? null,
    source_incident_ids: sourceIds,
    active: Number(row.active ?? 1) === 1,
    created_at: row.created_at as string,
    // PHASE4 (P4.1) — present only on a post-030 DB; undefined otherwise.
    confidence: row.confidence === undefined ? undefined : (row.confidence as number | null),
    injected_job_ids:
      row.injected_job_ids === undefined ? undefined : parseStringArray(row.injected_job_ids),
    outcome_success: row.outcome_success === undefined ? undefined : Number(row.outcome_success),
    outcome_total: row.outcome_total === undefined ? undefined : Number(row.outcome_total),
    decayed_at: row.decayed_at === undefined ? undefined : (row.decayed_at as string | null),
    origin: row.origin === undefined ? undefined : (row.origin as 'rule' | 'generated'),
  };
}
