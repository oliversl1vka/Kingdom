import type Database from 'better-sqlite3';
import { HeartbeatMonitor } from './heartbeat-monitor.js';
import { LockCleanup } from './lock-cleanup.js';

export { HeartbeatMonitor } from './heartbeat-monitor.js';
export { LockCleanup } from './lock-cleanup.js';

export interface SentinelState {
  status: 'running' | 'stopped';
  startedAt: string | null;
  polls: number;
  staleDetected: number;
  locksReleased: number;
}

let state: SentinelState = {
  status: 'stopped',
  startedAt: null,
  polls: 0,
  staleDetected: 0,
  locksReleased: 0,
};

let monitor: HeartbeatMonitor | null = null;
let lockCleanup: LockCleanup | null = null;
let pollTimer: ReturnType<typeof setInterval> | null = null;

export function startSentinel(db: Database.Database, pollIntervalMs = 5000): void {
  if (state.status === 'running') return;

  monitor = new HeartbeatMonitor(db, 30, pollIntervalMs);
  lockCleanup = new LockCleanup(db);

  state = {
    status: 'running',
    startedAt: new Date().toISOString(),
    polls: 0,
    staleDetected: 0,
    locksReleased: 0,
  };

  pollTimer = setInterval(() => {
    state.polls++;
    const staleJobs = monitor!.checkForStaleJobs();
    state.staleDetected += staleJobs.length;
    const cleaned = lockCleanup!.cleanupStaleLocks();
    state.locksReleased += cleaned;
  }, pollIntervalMs);
}

export function stopSentinel(): void {
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
}

export function getSentinelState(): SentinelState {
  return { ...state };
}
