# Phase 1 — Durable & Isolated Execution Substrate (Results)

Base: Phase 0 `6eb7f09`. Build: `pnpm run build` exits 0. Tests: **302 → 316**
passing (14 new Phase 1 tests; 0 regressions; 5 suites skipped, 40 todo unchanged).

## Files added
- `packages/core/migrations/016_state_transitions.sql` — append-only transition log.
- `packages/core/migrations/017_lock_fencing.sql` — `fence_counter` + `file_locks.fencing_token`.
- `packages/core/migrations/018_job_leases.sql` — `jobs.lease_owner_pid` + `lease_expires_at`.
- `packages/core/migrations/019_job_worktrees.sql` — `job_worktrees` tracking table.
- `packages/core/migrations/020_lease_indexes.sql` — reconciler/lock-owner indexes.
- `packages/core/src/repositories/state-transition.ts` — `transitionStatus()` helper (P1.1).
- `packages/core/src/recovery/reconciler.ts` — `reconcile()` crash-recovery (P1.4).
- `packages/blacksmith/src/worktree-manager.ts` — `WorktreeManager` + `isGitRepo` (P1.5).
- `tests/integration/phase1-durable-substrate.test.ts` — 14 tests (P1.1–P1.5).

## Files changed
- `packages/core/src/repositories/task-repo.ts` — `updateStatus` routes through atomic transition; new `tryTransition`.
- `packages/core/src/repositories/job-repo.ts` — transition-logging setters; `tryTransition`; `setLease`/`renewLease`; lease/log column guards; mapRow lease fields.
- `packages/core/src/locks/file-lock-manager.ts` — `acquireBatch`, fencing tokens, `validateFence`, `getFencingToken`, fencing-schema fallback.
- `packages/core/src/job/cancellation.ts` — kill-by-lease-PID; lease-column-aware cancel.
- `packages/core/src/worker/spawner.ts` — `killWorkerByPid`, `isPidAlive`.
- `packages/core/src/worker/heartbeat-writer.ts` — optional lease renewal (column-guarded).
- `packages/core/src/job/dispatcher.ts` — **shared hot file** (see Integration Notes).
- `packages/core/src/types.ts` — `Job.lease_owner_pid/lease_expires_at`, `FileLock.fencing_token`.
- `packages/core/src/index.ts` — exports for `transitionStatus`, `reconcile`, `killWorkerByPid`, `isPidAlive`.
- `packages/blacksmith/src/index.ts` — exports `WorktreeManager`, `isGitRepo`.
- `packages/cli/src/commands/summon.ts` — calls `reconcile()` at startup before dispatch.

## Build status
`pnpm run build` → exit 0. `pnpm test` → 316 passed | 5 skipped | 40 todo.

## INTEGRATION NOTES — every shared-hot-file edit

### `packages/core/src/job/dispatcher.ts` (Phase 3 also edits this file)
All edits are marked with `// PHASE1:` / `// TODO(PHASE1)` comments. By line area:
- **L2** — added `TaskStatus` to the type import (needed by `transitionTaskToFailed`).
- **L300–314 (P1.2)** — replaced the per-file `acquire` loop with a single
  `fileLockManager.acquireBatch(...)`; defer on `null` (all-or-nothing). `lockedFiles`
  derived from the returned token map.
- **L316–343 (P1.1)** — replaced the throwing `updateStatus` step-chain + swallowed
  `try/catch` with `taskRepo.tryTransition(['queued'],'running')`; orphan path uses
  `jobRepo.tryTransition`.
- **L345–353 (P1.3)** — `jobRepo.setLease(job.id, process.pid, timeout+120)` after
  `setStarted`. Carries the spawn-swap `TODO(PHASE1)` (in-process model retained).
- **L356–358 (P1.3)** — `HeartbeatWriter` constructed with the lease window so it
  renews `lease_expires_at`.
- **L368–376 (P1.3)** — finally block clears the lease (`lease_owner_pid/expires_at = NULL`)
  alongside lock release.
- **L626–645 (P1.1)** — new private `transitionTaskToFailed(taskId, failedStatus)`:
  atomic stalled→running hop + running/streaming→failed transition (non-throwing).
- **L672, L695, L711, L915, L986 (P1.1)** — five swallowed `try{updateStatus}catch{}`
  failure transitions replaced by `transitionTaskToFailed(...)`.
- **L1097–1104 (P1.1)** — completion path: `setCompleted` then atomic
  `tryTransition(['running','streaming'],'completed')`; `taskCompleted` from `changes`.
- **L1124 (P1.1)** — runtime-crash handler uses `transitionTaskToFailed(...,'failed-runtime-crash')`.

### `packages/core/src/repositories/task-repo.ts`
- **L1–3** — import `transitionStatus`.
- **L124–161** — `updateStatus` rewritten to delegate to `transitionStatus` (guarding on
  the current status as from-state; still throws on a genuinely illegal edge for
  existing callers/tests). Added `tryTransition(allowedFrom, newStatus, reason?, actor?)`
  — the non-throwing atomic variant used by the dispatcher + reconciler.

### `packages/cli/src/commands/summon.ts`
- **L138** — added `reconcile` to the `@kingdomos/core` dynamic import.
- **L150–163** — `reconcile(db, …)` invoked once at startup before dispatch; logs a
  recovery summary when any job/lock was rolled back.

## Deferred TODOs
- **TODO(PHASE1) — spawn-per-job process model** (`dispatcher.ts` ~L349): the lease
  owner is currently the dispatcher PID and jobs still run as in-process promises.
  Lease/fencing schema, reconciler integration, and cancellation-by-PID are all
  shipped and tested; the full `spawnWorker()` swap was deferred per the brief to
  protect the green build. When swapped, set the lease PID to the child PID and
  renew `lease_expires_at` from the child's heartbeat.
- **Worktree wiring into the dispatcher** — `WorktreeManager` is implemented and
  tested end-to-end (create/apply/merge/conflict) but is not yet the dispatcher's
  default apply path; the dispatcher still calls the `applyDiff` blacksmith callback
  (in-place + `.bak`). Switching the dispatcher to `applyInWorktree` for git
  workspaces (gated by `isGitRepo`) + persisting `job_worktrees` rows + post-merge
  re-validation is the follow-up. Non-git workspaces keep the `.bak` path.
- **Reconciler worktree pruning** — `job_worktrees` table exists; pruning abandoned
  worktrees on startup can be folded into `reconcile()` once the dispatcher records rows.

## Patch
`git format-patch 6eb7f09..HEAD` → `.integration/phase1/` (with PLAN + REPORT copies).
