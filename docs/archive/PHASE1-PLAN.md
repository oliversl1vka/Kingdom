# Phase 1 — Durable & Isolated Execution Substrate (Structural Plan)

> Built on the committed Phase 0 foundation (`6eb7f09`). Goal: turn SQLite from a
> destructive status table into a durable workflow store, make locking atomic,
> isolate workers behind leases + fencing, recover crashes automatically, and
> isolate workspace mutation in per-job git worktrees with 3-way merge-back.

## Design principles
- **Backward compatible / weak-model safe.** Every new column + table is additive.
  All new code detects whether the Phase 1 schema (migrations 016–020) is present
  and degrades to the legacy path when it isn't (covers partial-migration test DBs
  and the non-git workspace fallback).
- **Source of truth = the append-only log.** A `state_transitions` row is written
  in the SAME transaction as the status UPDATE, so the log exists iff the status
  actually moved.
- **Atomic, non-throwing transitions on the hot path.** Replace read-check-write +
  swallowed `try/catch` with a single guarded `UPDATE … WHERE status IN (<from>)`
  and branch on `changes`.

## Migrations (016–020)
| # | File | What |
|---|------|------|
| 016 | `state_transitions.sql` | Append-only `state_transitions(entity_type, entity_id, from_status, to_status, reason, actor, ts)` + index. |
| 017 | `lock_fencing.sql` | Global monotonic `fence_counter` row + `file_locks.fencing_token` column. |
| 018 | `job_leases.sql` | `jobs.lease_owner_pid` + `jobs.lease_expires_at`. |
| 019 | `job_worktrees.sql` | `job_worktrees` tracking table (job → worktree path/branch/base/status). |
| 020 | `lease_indexes.sql` | Indexes for the reconciler scan + lock-owner lookup. |

## P1.1 — Transactional state transitions + append-only log
- New `repositories/state-transition.ts` → `transitionStatus(db, entityType, table, id, allowedFrom, toStatus, {reason,actor,touchUpdatedAt})`:
  guarded UPDATE + log row in one `db.transaction()`. Table-presence-guarded so it
  is a no-op-log on legacy DBs.
- `task-repo.ts`: `updateStatus` now routes through `transitionStatus` (guarding on
  the *current* status as the from-state) and keeps throwing on a genuinely illegal
  transition for existing callers/tests. New `tryTransition(allowedFrom, to)` is the
  non-throwing variant for the dispatcher hot path.
- `job-repo.ts`: `updateStatus`/`setStarted`/`setCompleted`/`setFailed` now log a
  transition row via a `logTransition()` helper (table-guarded). New `tryTransition`.
- `dispatcher.ts`: every swallowed `try{updateStatus}catch{}` replaced by an atomic
  `transitionTaskToFailed()` / `tryTransition()` that branches on `changes`.

## P1.2 — Atomic batch lock acquisition
- `file-lock-manager.ts`: new `acquireBatch(filePaths, jobId, supervisorId, maxSecs)`
  takes all locks in ONE transaction → all-or-nothing, no partial holds / livelock.
  Returns `{path: fencingToken}` or `null`. Dispatcher's per-file acquire loop is
  replaced by a single `acquireBatch` call.

## P1.3 — Process-isolated workers + leases + fencing
- `jobs.lease_owner_pid` + `lease_expires_at`: set on dispatch (`JobRepository.setLease`),
  renewed by `HeartbeatWriter` (now lease-aware), cleared on job end.
- `file_locks.fencing_token`: monotonic token stamped at acquire; `validateFence(path, jobId, token)`
  rejects a zombie worker's late write (old job/old token) after the lock was re-granted.
- `cancellation.ts`: kills by the durable lease PID (`killWorkerByPid`) — real
  cross-restart cancellation — and clears the lease on cancel.
- **DEFERRED (TODO(PHASE1)):** the full spawn-per-job process swap (replace the
  in-process `executeJob` promise with `spawnWorker()`). Lease/fencing schema,
  reconciler integration, and cancellation-by-PID are shipped; the spawn swap is
  marked behind a clearly-labelled TODO in `dispatcher.ts` to keep the green build.

## P1.4 — Crash-recovery reconciler
- New `recovery/reconciler.ts` → `reconcile(db, opts)`: at startup, find
  running/streaming jobs whose worker is provably dead (dead lease PID / expired
  lease / no lease at startup), roll them back (`failed-runtime-crash → retrying`),
  re-queue their tasks, release their locks; then sweep orphan locks owned by
  missing/terminal jobs. Wired into `summon.ts` BEFORE dispatch.

## P1.5 — Git-worktree-per-job isolation + 3-way merge-back
- New `blacksmith/worktree-manager.ts` → `WorktreeManager.applyInWorktree(jobId, diff)`:
  `git worktree add` a fresh branch off the integration HEAD (or `baseRef`), apply
  the diff inside it, commit, `git merge --no-ff` back. Clean merge → success +
  mergedSha; conflict → `git merge --abort`, return conflicting files/hunks as
  feedback. Retires `.bak` reliance for git workspaces; `.bak` kept as the non-git
  fallback (diff-applicator unchanged). Windows node_modules cost handled via an
  optional `linkNodeModules` junction (`mklink /J`, no admin) with post-merge
  validation as the documented fallback. `isGitRepo()` gates git vs `.bak` path.

## Tests (tests/integration/phase1-durable-substrate.test.ts — 14 tests)
Atomic transition rejects illegal from-state (changes===0); transition-log row
written/not-written; job transitions logged; atomic batch all-or-nothing; fencing
token rejection; reconciler rollback + re-queue + lock release; reconciler leaves
live jobs; orphan-lock sweep; worktree clean merge; worktree merge conflict.
