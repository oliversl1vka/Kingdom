import type Database from 'better-sqlite3';

/**
 * Phase 1 — P1.1 Transactional state transitions + append-only log.
 *
 * Replaces the old read-check-write pattern (SELECT status → JS guard → UPDATE)
 * with a single atomic guarded UPDATE:
 *
 *   UPDATE <table> SET status=? WHERE id=? AND status IN (<allowedFrom>)
 *
 * and a `state_transitions` row written in the SAME db.transaction(). The caller
 * branches on the returned `changed` flag (changes === 1) instead of relying on
 * a thrown error / swallowed try-catch. A transition row exists iff the status
 * actually moved, so the log is the durable source of truth for recovery.
 */

export interface TransitionResult {
  /** True iff exactly one row matched an allowed from-state and was updated. */
  changed: boolean;
  /** The status the entity held when the UPDATE ran (null if entity missing). */
  fromStatus: string | null;
}

const stateTransitionsTablePresent = new WeakMap<Database.Database, boolean>();

function hasStateTransitionsTable(db: Database.Database): boolean {
  const cached = stateTransitionsTablePresent.get(db);
  if (cached !== undefined) return cached;
  const row = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='state_transitions'")
    .get();
  const present = !!row;
  stateTransitionsTablePresent.set(db, present);
  return present;
}

/**
 * Atomically transition an entity's status from any of `allowedFrom` to
 * `toStatus`, recording a state_transitions row in the same transaction.
 *
 * @param entityType 'task' or 'job'
 * @param table      backing table (must have id + status columns)
 * @param touchUpdatedAt when true, also set updated_at = now (task table has it; jobs do not)
 */
export function transitionStatus(
  db: Database.Database,
  entityType: 'task' | 'job',
  table: string,
  id: string,
  allowedFrom: string[],
  toStatus: string,
  opts: { reason?: string; actor?: string; touchUpdatedAt?: boolean } = {},
): TransitionResult {
  const now = new Date().toISOString();
  const placeholders = allowedFrom.map(() => '?').join(', ');
  const setClause = opts.touchUpdatedAt
    ? 'status = ?, updated_at = ?'
    : 'status = ?';

  const run = db.transaction((): TransitionResult => {
    // Capture the current status so we can record an accurate from_status and
    // distinguish "no such row" from "row in an illegal state".
    const current = db
      .prepare(`SELECT status FROM ${table} WHERE id = ?`)
      .get(id) as { status: string } | undefined;
    const fromStatus = current?.status ?? null;

    const params: unknown[] = opts.touchUpdatedAt
      ? [toStatus, now, id, ...allowedFrom]
      : [toStatus, id, ...allowedFrom];

    const result = db
      .prepare(`UPDATE ${table} SET ${setClause} WHERE id = ? AND status IN (${placeholders})`)
      .run(...params);

    const changed = result.changes > 0;

    if (changed && hasStateTransitionsTable(db)) {
      db.prepare(
        `INSERT INTO state_transitions (entity_type, entity_id, from_status, to_status, reason, actor, ts)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).run(entityType, id, fromStatus, toStatus, opts.reason ?? null, opts.actor ?? null, now);
    }

    return { changed, fromStatus };
  });

  return run();
}
