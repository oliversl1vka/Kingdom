import type Database from 'better-sqlite3';
import { HeartbeatMonitor, type HeartbeatMonitorOptions, type IncidentCallback } from './heartbeat-monitor.js';
import { LockCleanup } from './lock-cleanup.js';

export { HeartbeatMonitor, type HeartbeatMonitorOptions, type IncidentCallback, type IncidentData } from './heartbeat-monitor.js';
export { LockCleanup } from './lock-cleanup.js';

export interface SentinelState {
  status: 'running' | 'stopped' | 'stale';
  startedAt: string | null;
  stoppedAt: string | null;
  lastHeartbeatAt: string | null;
  processId: number | null;
  pollIntervalMs: number;
  polls: number;
  staleDetected: number;
  locksReleased: number;
}

let state: SentinelState = {
  status: 'stopped',
  startedAt: null,
  stoppedAt: null,
  lastHeartbeatAt: null,
  processId: null,
  pollIntervalMs: 5000,
  polls: 0,
  staleDetected: 0,
  locksReleased: 0,
};

let monitor: HeartbeatMonitor | null = null;
let lockCleanup: LockCleanup | null = null;
let pollTimer: ReturnType<typeof setInterval> | null = null;

export function startSentinel(
  db: Database.Database,
  pollIntervalMs = 5000,
  options?: HeartbeatMonitorOptions,
  onIncident?: IncidentCallback,
): void {
  if (state.status === 'running') return;

  ensureSentinelStateTable(db);
  monitor = new HeartbeatMonitor(db, options ?? 90, pollIntervalMs, onIncident);
  lockCleanup = new LockCleanup(db, options ?? 90);

  const now = new Date().toISOString();
  state = {
    status: 'running',
    startedAt: now,
    stoppedAt: null,
    lastHeartbeatAt: now,
    processId: process.pid,
    pollIntervalMs,
    polls: 0,
    staleDetected: 0,
    locksReleased: 0,
  };

  persistSentinelStart(db, state);

  pollTimer = setInterval(() => {
    state.polls++;
    const staleJobs = monitor!.checkForStaleJobs();
    state.staleDetected += staleJobs.length;
    const cleaned = lockCleanup!.cleanupStaleLocks();
    state.locksReleased += cleaned;
    state.lastHeartbeatAt = new Date().toISOString();
    persistSentinelPoll(db, staleJobs.length, cleaned, pollIntervalMs);
  }, pollIntervalMs);
}

export function stopSentinel(db?: Database.Database): void {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
  if (monitor) {
    monitor.stop();
    monitor = null;
  }
  lockCleanup = null;
  state.status = 'stopped';
  state.stoppedAt = new Date().toISOString();
  state.lastHeartbeatAt = state.stoppedAt;
  if (db) persistSentinelStop(db);
}

export function getSentinelState(db?: Database.Database): SentinelState {
  if (db) {
    const persisted = readPersistedSentinelState(db);
    if (persisted) return persisted;
  }
  return { ...state };
}

function ensureSentinelStateTable(db: Database.Database): void {
  db.prepare(
    `CREATE TABLE IF NOT EXISTS sentinel_state (
      id TEXT PRIMARY KEY CHECK (id = 'sentinel'),
      status TEXT NOT NULL DEFAULT 'stopped' CHECK (status IN ('running', 'stopped')),
      process_id INTEGER,
      started_at TEXT,
      stopped_at TEXT,
      last_heartbeat_at TEXT,
      poll_interval_ms INTEGER NOT NULL DEFAULT 5000,
      polls INTEGER NOT NULL DEFAULT 0,
      stale_detected INTEGER NOT NULL DEFAULT 0,
      locks_released INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
  ).run();

  db.prepare(
    `INSERT OR IGNORE INTO sentinel_state (id, status, updated_at)
     VALUES ('sentinel', 'stopped', datetime('now'))`,
  ).run();
}

function persistSentinelStart(db: Database.Database, nextState: SentinelState): void {
  db.prepare(
    `INSERT INTO sentinel_state (
      id, status, process_id, started_at, stopped_at, last_heartbeat_at,
      poll_interval_ms, polls, stale_detected, locks_released, updated_at
    ) VALUES ('sentinel', 'running', ?, ?, NULL, ?, ?, 0, 0, 0, ?)
    ON CONFLICT(id) DO UPDATE SET
      status = 'running',
      process_id = excluded.process_id,
      started_at = excluded.started_at,
      stopped_at = NULL,
      last_heartbeat_at = excluded.last_heartbeat_at,
      poll_interval_ms = excluded.poll_interval_ms,
      polls = 0,
      stale_detected = 0,
      locks_released = 0,
      updated_at = excluded.updated_at`,
  ).run(
    nextState.processId,
    nextState.startedAt,
    nextState.lastHeartbeatAt,
    nextState.pollIntervalMs,
    nextState.lastHeartbeatAt,
  );
}

function persistSentinelPoll(db: Database.Database, staleDetected: number, locksReleased: number, pollIntervalMs: number): void {
  ensureSentinelStateTable(db);
  const now = new Date().toISOString();
  db.prepare(
    `UPDATE sentinel_state
     SET status = 'running',
         process_id = ?,
         last_heartbeat_at = ?,
         poll_interval_ms = ?,
         polls = polls + 1,
         stale_detected = stale_detected + ?,
         locks_released = locks_released + ?,
         updated_at = ?
     WHERE id = 'sentinel'`,
  ).run(process.pid, now, pollIntervalMs, staleDetected, locksReleased, now);
}

function persistSentinelStop(db: Database.Database): void {
  ensureSentinelStateTable(db);
  const now = new Date().toISOString();
  db.prepare(
    `UPDATE sentinel_state
     SET status = 'stopped', stopped_at = ?, last_heartbeat_at = ?, updated_at = ?
     WHERE id = 'sentinel'`,
  ).run(now, now, now);
}

function readPersistedSentinelState(db: Database.Database): SentinelState | null {
  try {
    ensureSentinelStateTable(db);
    const row = db.prepare('SELECT * FROM sentinel_state WHERE id = ?').get('sentinel') as Record<string, unknown> | undefined;
    if (!row) return null;

    const startedAt = row.started_at as string | null;
    const stoppedAt = row.stopped_at as string | null;
    const lastHeartbeatAt = row.last_heartbeat_at as string | null;
    const pollIntervalMs = (row.poll_interval_ms as number | null) ?? 5000;
    const status = derivePersistedStatus(row.status as string, lastHeartbeatAt, pollIntervalMs);

    return {
      status,
      startedAt,
      stoppedAt,
      lastHeartbeatAt,
      processId: row.process_id as number | null,
      pollIntervalMs,
      polls: row.polls as number,
      staleDetected: row.stale_detected as number,
      locksReleased: row.locks_released as number,
    };
  } catch {
    return null;
  }
}

function derivePersistedStatus(status: string, lastHeartbeatAt: string | null, pollIntervalMs: number): SentinelState['status'] {
  if (status !== 'running') return 'stopped';
  if (!lastHeartbeatAt) return 'stale';
  const heartbeatMs = new Date(lastHeartbeatAt).getTime();
  if (!Number.isFinite(heartbeatMs)) return 'stale';
  const staleAfterMs = Math.max(15_000, pollIntervalMs * 3);
  return Date.now() - heartbeatMs > staleAfterMs ? 'stale' : 'running';
}
