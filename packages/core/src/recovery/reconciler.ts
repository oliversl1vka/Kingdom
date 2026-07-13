import type Database from 'better-sqlite3';
import { execFileSync } from 'node:child_process';
import { JobRepository } from '../repositories/job-repo.js';
import { TaskRepository } from '../repositories/task-repo.js';
import { FileLockManager } from '../locks/file-lock-manager.js';
import { WorktreeRepository } from '../repositories/worktree-repo.js';

/**
 * Phase 1 — P1.4 Crash-recovery reconciler.
 *
 * Folds the CLAUDE.md SQL-recipe runbook (clear orphaned locks, reset stalled
 * tasks, release locks for dead processes) into code, run ONCE at `summon`
 * startup BEFORE the dispatcher begins.
 *
 * A job in running/streaming whose owning worker process is *provably dead* is
 * orphaned by a prior crash. We:
 *   1. roll the job back: failed-runtime-crash → retrying (durable, logged),
 *   2. transition its task back to queued/retrying so it can be re-dispatched,
 *   3. release every file lock the dead job held.
 *
 * "Provably dead" = the lease PID is not a live process, OR (no PID recorded and
 * the lease has expired), OR (no lease at all — legacy pre-P1.3 job left running
 * across a process boundary, which by definition cannot be the current process's
 * in-flight work since the dispatcher hasn't started yet).
 */

export interface ReconcileResult {
  orphanedJobs: number;
  rolledBackTasks: number;
  releasedLocks: number;
  // PHASE5: worktree crash recovery.
  /** Worktree rows finalized as 'merged' (crash after merge, before bookkeeping). */
  worktreesFinalized: number;
  /** Worktree rows discarded (did not land) and their jobs requeued. */
  worktreesDiscarded: number;
  details: Array<{ jobId: string; taskId: string; reason: string }>;
}

export interface ReconcileOptions {
  /** Probe whether a PID is alive. Default uses process.kill(pid, 0). Injectable for tests. */
  isPidAlive?: (pid: number) => boolean;
  /** Current time in ms (injectable for tests). */
  now?: () => number;
  /** When true, log each reconciliation action. */
  verbose?: boolean;
  logger?: (msg: string) => void;
  // PHASE5: worktree recovery. Absent projectPath ⇒ the worktree pass is skipped.
  /** Git repo root of the integration workspace (for ancestry checks + prune). */
  projectPath?: string;
  /** Remove a worktree + its branch (summon passes WorktreeManager.removeWorktree). */
  removeWorktree?: (worktreePath: string, branch: string) => void;
}

function defaultIsPidAlive(pid: number): boolean {
  if (!Number.isFinite(pid) || pid <= 0) return false;
  try {
    // Signal 0 performs error checking without sending a signal: throws ESRCH
    // if the process does not exist, EPERM if it exists but we can't signal it.
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

interface RunningJobRow {
  id: string;
  task_id: string;
  status: string;
  lease_owner_pid: number | null;
  lease_expires_at: string | null;
}

export function reconcile(db: Database.Database, options: ReconcileOptions = {}): ReconcileResult {
  const isPidAlive = options.isPidAlive ?? defaultIsPidAlive;
  const now = options.now ?? Date.now;
  const log = (msg: string) => { if (options.verbose) (options.logger ?? console.log)(msg); };

  const jobRepo = new JobRepository(db);
  const taskRepo = new TaskRepository(db);
  const lockManager = new FileLockManager(db);

  const result: ReconcileResult = {
    orphanedJobs: 0, rolledBackTasks: 0, releasedLocks: 0,
    worktreesFinalized: 0, worktreesDiscarded: 0, details: [],
  };

  // ── PHASE5 (§7): worktree crash recovery — run BEFORE the running-jobs orphan
  // pass so a landed-but-unrecorded merge is finalized (not requeued) and a
  // not-landed worktree job is requeued here (so the orphan pass then skips it). ──
  reconcileWorktrees(db, options, jobRepo, taskRepo, lockManager, result, log);

  const runningJobs = db
    .prepare("SELECT id, task_id, status, lease_owner_pid, lease_expires_at FROM jobs WHERE status IN ('running', 'streaming')")
    .all() as RunningJobRow[];

  for (const job of runningJobs) {
    const reason = orphanReason(job, isPidAlive, now());
    if (!reason) continue; // worker still provably alive — leave it

    result.orphanedJobs++;
    result.details.push({ jobId: job.id, taskId: job.task_id, reason });
    log(`[reconciler] Orphaned job ${job.id} (task ${job.task_id}): ${reason}`);

    // 1. Roll the job back. running/streaming → failed-runtime-crash → retrying.
    //    Use the guarded transition helpers so the move is atomic + logged.
    jobRepo.setFailed(job.id, 'runtime-crash');
    jobRepo.tryTransition(
      job.id,
      ['failed-runtime-crash'],
      'retrying',
      `reconciler: ${reason}`,
      'reconciler',
    );
    // Clear the dead lease so it isn't re-flagged on a subsequent run.
    db.prepare('UPDATE jobs SET lease_owner_pid = NULL, lease_expires_at = NULL WHERE id = ?').run(job.id);

    // 2. Roll the task back so the dispatcher re-queues it. The task could be in
    //    running/streaming/stalled. Move it to queued (resetting retry pressure is
    //    NOT done here — retry_count is preserved so a persistently failing task
    //    still escalates). queued is reachable from these via the recovery path.
    const task = taskRepo.getById(job.task_id);
    if (task && ['running', 'streaming', 'stalled', 'retrying'].includes(task.status)) {
      const moved = taskRepo.tryTransition(
        job.task_id,
        ['running', 'streaming', 'stalled', 'retrying'],
        'queued',
        `reconciler: worker crash recovery`,
        'reconciler',
      );
      if (moved) result.rolledBackTasks++;
    }

    // 3. Release every lock the dead job held (fold in lock-cleanup orphan logic).
    const heldLocks = db.prepare('SELECT file_path FROM file_locks WHERE owning_job_id = ?').all(job.id) as Array<{ file_path: string }>;
    for (const lock of heldLocks) {
      if (lockManager.forceRelease(lock.file_path)) result.releasedLocks++;
    }
  }

  // Also sweep locks whose owning job no longer exists or is terminal — these are
  // pure orphans from crashes where the job row was already moved but locks leaked.
  const orphanLocks = db.prepare(
    `SELECT fl.file_path
     FROM file_locks fl
     LEFT JOIN jobs j ON fl.owning_job_id = j.id
     WHERE j.id IS NULL
        OR j.status IN ('completed','completed-with-warnings','cancelled','superseded','needs-human','awaiting-redesign')
        OR j.status LIKE 'failed-%'`,
  ).all() as Array<{ file_path: string }>;
  for (const lock of orphanLocks) {
    if (lockManager.forceRelease(lock.file_path)) {
      result.releasedLocks++;
      log(`[reconciler] Released orphan lock ${lock.file_path}`);
    }
  }

  return result;
}

/**
 * PHASE5 (§7): recover per-job isolated worktrees left behind by a crash.
 *
 * For each live (open|merging) row:
 *  - If the job branch is already merged into the integration branch (crash AFTER
 *    `git merge`, BEFORE bookkeeping) → finalize: mark merged, complete the job +
 *    task. Exactly-once: the model is never re-invoked.
 *  - Otherwise the change did NOT land → abort any in-progress merge, remove the
 *    throwaway worktree + branch, mark discarded, and requeue the owning job/task
 *    + release its locks. INV-1: the integration HEAD is untouched.
 *
 * Idempotent: a second run sees no live rows and is a no-op. Skipped entirely when
 * `projectPath` is absent (non-git workspace / no agentic dispatch).
 */
function reconcileWorktrees(
  db: Database.Database,
  options: ReconcileOptions,
  jobRepo: JobRepository,
  taskRepo: TaskRepository,
  lockManager: FileLockManager,
  result: ReconcileResult,
  log: (msg: string) => void,
): void {
  const projectPath = options.projectPath;
  if (!projectPath) return;

  const wtRepo = new WorktreeRepository(db);
  const live = wtRepo.listLive();
  if (live.length === 0) return;

  const gitTry = (args: string[]): { code: number; out: string } => {
    try {
      const out = execFileSync('git', args, { cwd: projectPath, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] }).toString();
      return { code: 0, out };
    } catch (err) {
      const e = err as { status?: number; stdout?: Buffer | string };
      return { code: e.status ?? 1, out: e.stdout?.toString() ?? '' };
    }
  };

  for (const row of live) {
    // Did the job branch already land on the integration branch? It landed iff the
    // branch has commits beyond its base (tip !== base_sha) AND that tip is an
    // ancestor of the integration branch. A branch sitting at base (no commits, or
    // committed-but-not-merged) has NOT landed → discard + requeue.
    const branchTip = gitTry(['rev-parse', '--verify', '--quiet', row.branch]).out.trim();
    const branchMerged = branchTip.length > 0
      && branchTip !== row.base_sha
      && gitTry(['merge-base', '--is-ancestor', branchTip, row.integration_branch]).code === 0;

    if (branchMerged) {
      const head = gitTry(['rev-parse', row.integration_branch]).out.trim();
      wtRepo.setMerged(row.job_id, row.merged_sha ?? head);
      options.removeWorktree?.(row.worktree_path, row.branch);
      // Finalize the job/task exactly-once (the merge already landed pre-crash).
      jobRepo.tryTransition(row.job_id, ['running', 'streaming'], 'completed', 'reconciler: merge landed pre-crash', 'reconciler');
      const mergedTaskId = jobTaskId(db, row.job_id);
      if (mergedTaskId) {
        taskRepo.tryTransition(mergedTaskId, ['running', 'streaming', 'stalled'], 'completed', 'reconciler: merge landed pre-crash', 'reconciler');
      }
      result.worktreesFinalized++;
      log(`[reconciler] Finalized merged worktree for job ${row.job_id} (branch already on ${row.integration_branch})`);
      continue;
    }

    // Did not land: abort any in-progress merge in THIS worktree only,
    // drop the worktree, discard, requeue. Scope the abort to avoid
    // nuking an unrelated merge on the integration branch or another worktree.
    if (gitTry(['-C', row.worktree_path, 'rev-parse', '--verify', '--quiet', 'MERGE_HEAD']).code === 0) {
      gitTry(['-C', row.worktree_path, 'merge', '--abort']);
    }
    options.removeWorktree?.(row.worktree_path, row.branch);
    gitTry(['worktree', 'prune']);
    wtRepo.setDiscarded(row.job_id);
    result.worktreesDiscarded++;

    const taskId = jobTaskId(db, row.job_id);
    jobRepo.setFailed(row.job_id, 'runtime-crash');
    jobRepo.tryTransition(row.job_id, ['failed-runtime-crash'], 'retrying', 'reconciler: worktree crash recovery', 'reconciler');
    db.prepare('UPDATE jobs SET lease_owner_pid = NULL, lease_expires_at = NULL WHERE id = ?').run(row.job_id);
    if (taskId) {
      const task = taskRepo.getById(taskId);
      if (task && ['running', 'streaming', 'stalled', 'retrying'].includes(task.status)) {
        if (taskRepo.tryTransition(taskId, ['running', 'streaming', 'stalled', 'retrying'], 'queued', 'reconciler: worktree crash recovery', 'reconciler')) {
          result.rolledBackTasks++;
        }
      }
    }
    const heldLocks = db.prepare('SELECT file_path FROM file_locks WHERE owning_job_id = ?').all(row.job_id) as Array<{ file_path: string }>;
    for (const lock of heldLocks) {
      if (lockManager.forceRelease(lock.file_path)) result.releasedLocks++;
    }
    log(`[reconciler] Discarded orphan worktree for job ${row.job_id} (did not land); requeued task ${taskId ?? '?'}`);
  }

  gitTry(['worktree', 'prune']);
}

/** Resolve the task_id for a job (returns null if the job row is gone). */
function jobTaskId(db: Database.Database, jobId: string): string | null {
  const row = db.prepare('SELECT task_id FROM jobs WHERE id = ?').get(jobId) as { task_id: string } | undefined;
  return row?.task_id ?? null;
}

function orphanReason(
  job: RunningJobRow,
  isPidAlive: (pid: number) => boolean,
  nowMs: number,
): string | null {
  if (job.lease_owner_pid != null) {
    if (isPidAlive(job.lease_owner_pid)) return null; // worker alive — not orphaned
    return `lease PID ${job.lease_owner_pid} is dead`;
  }
  // No PID recorded. If a lease expiry exists and has passed, it's orphaned.
  if (job.lease_expires_at) {
    const expMs = new Date(job.lease_expires_at).getTime();
    if (Number.isFinite(expMs) && expMs < nowMs) return 'lease expired with no live worker';
    // Lease still nominally valid but no PID — treat as orphaned at startup since
    // no worker process is running before the dispatcher starts.
    return 'running at startup with no owning process';
  }
  // No lease at all (legacy / in-process worker from a previous run that crashed).
  return 'running at startup with no lease (prior crash)';
}
