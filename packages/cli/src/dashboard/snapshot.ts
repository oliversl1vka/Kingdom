import type Database from 'better-sqlite3';

// --- Shape the smoke-dashboard variant renderers consume ---

export interface TierSnapshot {
  state: string;
  job: string;
  elapsed: number;
  prog: number;
  tokens: number;
  done: number;
  total: number;
  hb: number;
  stuck: number;
  verdict: 'ok' | 'attention' | 'critical';
}

export interface DashboardSnapshot {
  global: {
    objective: string;
    status: string;
    runtimeSec: number;
    tokens: number;
    locks: number;
    diffRate: number;
    health: string;
  };
  tiers: Record<string, TierSnapshot>;
}

// --- Helpers ---

const TIER_ORDER = ['king', 'nobility', 'judge', 'knight', 'squire', 'blacksmith', 'scribe', 'sentinel', 'healer'];

const TIER_ACTIVE_LABEL: Record<string, string> = {
  king: 'DECOMPOSING',
  nobility: 'PLANNING',
  judge: 'REVIEWING',
  knight: 'FORGING',
  squire: 'FORGING',
  blacksmith: 'APPLYING',
  scribe: 'ARCHIVING',
  sentinel: 'WATCHING',
  healer: 'DIAGNOSING',
};

function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

function toSec(val: string | null | undefined): number {
  if (!val) return 0;
  return Math.floor(new Date(val).getTime() / 1000);
}

// --- Builder ---

export function buildSnapshot(db: Database.Database): DashboardSnapshot {
  // ---- global -----------------------------------------------------------
  const objective = db
    .prepare(`SELECT description, status FROM objectives ORDER BY created_at DESC LIMIT 1`)
    .get() as { description: string; status: string } | undefined;

  const tokensRow = db
    .prepare(`SELECT COALESCE(SUM(tokens_used), 0) n FROM jobs`)
    .get() as { n: number };

  const locksRow = db
    .prepare(`SELECT COUNT(*) n FROM file_locks`)
    .get() as { n: number };

  // Diff rate: (applied / (applied + diff-failed + review-rejected)) * 100
  const diffRow = db
    .prepare(
      `SELECT
        (SELECT COUNT(*) FROM jobs WHERE status = 'completed' AND result_path IS NOT NULL) as applied,
        (SELECT COUNT(*) FROM jobs WHERE failure_type = 'invalid-output') as diff_failed,
        (SELECT COUNT(*) FROM jobs WHERE failure_type = 'review-rejection') as review_rejected`
    )
    .get() as { applied: number; diff_failed: number; review_rejected: number };

  const diffTotal = diffRow.applied + diffRow.diff_failed + diffRow.review_rejected;
  const diffRate = diffTotal > 0 ? Math.round((diffRow.applied / diffTotal) * 100) : 100;

  // Runtime: seconds since the earliest job started
  const firstJob = db
    .prepare(`SELECT MIN(started_at) started_at FROM jobs WHERE started_at IS NOT NULL`)
    .get() as { started_at: string | null } | undefined;
  const runtimeSec = firstJob?.started_at
    ? Math.max(0, nowSec() - toSec(firstJob.started_at))
    : 0;

  // Task counts for health
  const taskCounts = db
    .prepare(`SELECT status, COUNT(*) n FROM task_graph_nodes GROUP BY status`)
    .all() as Array<{ status: string; n: number }>;

  const stuckCount =
    (taskCounts.find((r) => r.status === 'awaiting-healer')?.n ?? 0) +
    (taskCounts.find((r) => r.status === 'awaiting-redesign')?.n ?? 0) +
    (taskCounts.find((r) => r.status === 'needs-human')?.n ?? 0) +
    (taskCounts.find((r) => r.status === 'stalled')?.n ?? 0);

  let health = 'HEALTHY';
  if (stuckCount > 0) health = 'NEEDS ATTENTION';
  if (
    taskCounts.find((r) => r.status === 'awaiting-redesign')?.n ||
    taskCounts.find((r) => r.status === 'needs-human')?.n
  ) {
    health = 'CRITICAL';
  }

  // ---- per-tier ---------------------------------------------------------
  const tiers: Record<string, TierSnapshot> = {};

  for (const tier of TIER_ORDER) {
    // Running job for this tier
    const runningJob = db
      .prepare(
        `SELECT j.id, j.status, j.started_at, j.heartbeat_at, t.title
         FROM jobs j JOIN task_graph_nodes t ON j.task_id = t.id
         WHERE t.assigned_tier = ? AND j.status IN ('running', 'streaming')
         ORDER BY j.started_at DESC LIMIT 1`
      )
      .get(tier) as
      | { id: string; status: string; started_at: string | null; heartbeat_at: string | null; title: string }
      | undefined;

    // Task counts for this tier — exclude superseded/cancelled noise
    const tierCounts = db
      .prepare(
        `SELECT status, COUNT(*) n
         FROM task_graph_nodes
         WHERE assigned_tier = ?
           AND status NOT IN ('superseded', 'cancelled')
         GROUP BY status`
      )
      .all(tier) as Array<{ status: string; n: number }>;

    const total =
      tierCounts.reduce((s, r) => s + r.n, 0);
    const done =
      (tierCounts.find((r) => r.status === 'completed')?.n ?? 0) +
      (tierCounts.find((r) => r.status === 'completed-with-warnings')?.n ?? 0);

    const prog = total > 0 ? Math.round((done / total) * 100) : 0;

    const queuedTier = tierCounts.find((r) => r.status === 'queued')?.n ?? 0;
    const runningTier = tierCounts.find((r) => r.status === 'running')?.n ?? 0;

    // Tokens for this tier
    const tierTokens = db
      .prepare(
        `SELECT COALESCE(SUM(j.tokens_used), 0) n
         FROM jobs j JOIN task_graph_nodes t ON j.task_id = t.id
         WHERE t.assigned_tier = ?`
      )
      .get(tier) as { n: number };

    // State label
    let state = 'IDLE';
    if (runningJob) {
      state = TIER_ACTIVE_LABEL[tier] ?? 'WORKING';
    } else if (queuedTier > 0) {
      state = 'QUEUED';
    } else if (done > 0 && done >= total && total > 0) {
      state = 'DONE';
    }

    // Job title
    const jobTitle = runningJob?.title ?? '—';

    // Elapsed: running job age, or keep previous value for idle tiers
    const elapsed = runningJob?.started_at
      ? Math.max(0, nowSec() - toSec(runningJob.started_at))
      : 0;

    // Heartbeat age — only meaningful when a job is running
    const hb = runningJob
      ? runningJob.heartbeat_at
        ? Math.max(0, nowSec() - toSec(runningJob.heartbeat_at))
        : Math.max(0, nowSec() - toSec(runningJob.started_at)) // fallback: use job start age
      : 0;

    // Verdict
    const tierStuck =
      (tierCounts.find((r) => r.status === 'awaiting-healer')?.n ?? 0) +
      (tierCounts.find((r) => r.status === 'awaiting-redesign')?.n ?? 0) +
      (tierCounts.find((r) => r.status === 'needs-human')?.n ?? 0) +
      (tierCounts.find((r) => r.status === 'stalled')?.n ?? 0);

    let verdict: TierSnapshot['verdict'] = 'ok';
    // Only flag attention if there's a reason: stuck tasks or a running job with stale heartbeat
    if (tierStuck > 0) verdict = 'attention';
    if (runningJob && hb > 90) verdict = 'attention';
    if (
      tierCounts.find((r) => r.status === 'awaiting-redesign')?.n ||
      tierCounts.find((r) => r.status === 'needs-human')?.n
    ) {
      verdict = 'critical';
    }

    tiers[tier] = {
      state,
      job: jobTitle,
      elapsed,
      prog,
      tokens: tierTokens.n,
      done,
      total,
      hb,
      stuck: tierStuck,
      verdict,
    };
  }

  return {
    global: {
      objective: objective?.description?.slice(0, 70) ?? 'none',
      status: objective?.status ?? 'n/a',
      runtimeSec,
      tokens: tokensRow.n,
      locks: locksRow.n,
      diffRate,
      health,
    },
    tiers,
  };
}
