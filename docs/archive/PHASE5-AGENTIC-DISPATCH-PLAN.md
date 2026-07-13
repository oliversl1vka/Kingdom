# Phase 5 — Agentic Dispatch via Isolated Worktrees

> **Deferral #1, fully specified.** This document is written to be executed end-to-end by a fresh
> session with no prior context beyond the repository itself. Every component, signature, migration,
> test, and invariant is named. Follow the milestones in order; each milestone keeps `pnpm run build`
> at exit 0 and `pnpm test` green.
>
> **Branch state assumed at start:** the integrated tree on `worktree-iterative-yawning-lovelace`
> at/after commit `8c26755` (Phases 0–4 merged + activation pass). Baseline: **build exit 0, 403 tests**.

---

## 0. How to use this document

1. Read §1–§4 to internalise the single decision and the target flow.
2. Implement §11 milestones **M0 → M6 in order**. Do not start a milestone until the previous one is green.
3. §5 gives exact target signatures — implement to them. §12 gives the exact tests — write them as you go (TDD-friendly: most can be written before the implementation of their milestone).
4. §13 is the provability checklist — the work is **not done** until every box is asserted by an automated test, not by inspection.

---

## 1. Mission & the one decision

**Mission:** make tool-capable models execute coding jobs as a real **read → edit → run → self-correct agentic loop**, instead of the current one-shot "emit a perfect unified diff blind." This is the core thesis of the project: capability that compounds as models improve.

**The single architectural decision being made — state it out loud and keep it visible:**

> We are **relocating the safety boundary**, not removing it.
>
> - **Today:** the model emits a *proposal* (a diff string); an independent Judge + an execution gate decide whether it may mutate the workspace; the workspace is mutated once, mechanically, by Blacksmith, with `.bak` rollback. *Review happens before apply.* A bad model cannot corrupt the project.
> - **Phase 5:** the model freely edits an **isolated git worktree**; we then review the resulting diff, run the same compile/test/probe gates **inside that worktree**, and only **merge it onto the integration branch if everything passes**. *Review happens before merge.* A bad model can only make a mess inside a throwaway worktree that is discarded on any failure.

**The load-bearing invariant (must be proven by tests, §13):**

> **INV-1 — Integration branch immutability on failure.** For every non-success outcome
> (empty diff, review rejection, validation failure, verification-gate failure, probe failure,
> merge conflict, cancellation, crash), the integration branch `HEAD` is **identical** to its value
> captured at the moment the job's worktree was opened. The change lands **iff** the full gauntlet passes and the merge is clean.

This is *stronger* than the legacy `.bak` model: there is never a half-applied state on the real workspace, ever.

---

## 2. Current architecture (grounded)

### 2.1 The legacy dispatch pipeline — `packages/core/src/job/dispatcher.ts`
`JobDispatcher.executeJob(job, task, provider, lockedFiles)` (≈L684–1162) is a linear pipeline:

| Step | Lines | What |
|---|---|---|
| Assemble (grounded) | L692 | `await this.assembler.assembleForJobAsync(job, task)` → `JobPacket` |
| Groom | L699–737 | pre-flight path validation for `unified-diff` jobs; expands locks |
| **Model call (one-shot)** | L743–749 | `completeWithCancellation(... provider.complete ...)` → diff **string** in `response.content` |
| Write result | L757–773 | result JSON to `packet.result_path` |
| **Judge review** | L777–826 | `reviewEngine.review({ diffText: response.content, projectPath, ... })` — simulates the diff in-memory against the **real** workspace and grades the *resulting* code |
| Reject → fail | L926–945 | `setFailed('review-rejection')`, healer incident, `retryOrEscalate` — **workspace untouched** |
| **Blacksmith apply** | L950–968 | `this.blacksmith(response.content, projectPath)` — in-place write + `.bak` |
| Apply failure paths | L972–1024 | `failAppliedDiff(...)` rolls back via `.bak` |
| **Validation** (compile) | L1030–1058 | `execSync(config.validationCommand, {cwd: projectPath})`; non-zero → `failAppliedDiff('validation', ...)` |
| **Verification gate** (P3.2) | L1062–1088 | `runVerificationGate(task.verification, {projectPath})`; non-zero → `failAppliedDiff('verification-gate', ...)` |
| **Behavioural probes** | L1093–1126 | `execSync(probe, {cwd: projectPath})`; non-zero → `failAppliedDiff('probe', ...)` |
| Complete | L1136–1158 | `jobRepo.setCompleted`, atomic `taskRepo.tryTransition(... 'completed')`, `writeCheckpoint` |

Key helpers reused below: `failAppliedDiff(job, task, appliedFiles, kind, output, message, symptoms, severity?)`, `retryOrEscalate(task, reasons[])`, `transitionTaskToFailed(taskId, status)`, `cancelJobIfRequested(job, task, stage, appliedFiles?)`, `completeWithCancellation`, `runWithCancellation(job, task, stage, fn(signal))`, `writeCheckpoint(job, task, files)`.

### 2.2 The agentic loop (already built, dormant) — `packages/core/src/worker/worker-main.ts`
- `executeWorker(db, provider, packetPath, workerId, agentic?)` (L109) — reads a packet file, runs either the **one-shot** path (L146–164) or the **agentic loop** when `agentic.capabilities?.tool_use === true` (L140–144). It also writes the result file and flips `jobs.status` itself (L126, L170).
- `runAgenticLoop(provider, packet, agentic, heartbeat)` (L200–280, **module-private — must be exported**) — bounded loop (default 8 iterations). Tools `AGENTIC_TOOLS` (L62): `read_file`, `apply_edit`, `run_command`, `finish`. `apply_edit` calls `agentic.applyEdit(...)` which mutates `agentic.workspace`. Returns `WorkerResult { applied_files, content (summary), tokens_used, agentic:true }`.
- `AgenticOptions` (L32): `{ capabilities, workspace, applyEdit: ApplyEditFn, maxIterations?, tokenBudget?, commandPolicy?, verbose? }`.
- `ApplyEditFn` (L27): `(edit:{path,old_string,new_string}, workspace) => {success, appliedFile?, error?, created?}` — implemented by blacksmith `applyEdit` (`packages/blacksmith/src/edit-applicator.ts`), wired in summon.
- Command sandbox: `runSandboxedCommand(command, policy)` + `CommandPolicy` (`packages/core/src/worker/command-sandbox.ts`).

### 2.3 Worktree isolation (already built) — `packages/blacksmith/src/worktree-manager.ts`
`WorktreeManager(repoRoot, opts)` with:
- `applyInWorktree(jobId, diffText): WorktreeApplyResult` — **one-shot** create→apply→commit→merge. **Too coarse for Phase 5** (it merges immediately; we need review+gates *between* commit and merge). We will refactor it into a step-wise session (§5.1) and keep `applyInWorktree` as a thin wrapper for the existing diff-based isolated path (still used/tested).
- `removeWorktree(path, branch)`, `isGitRepo(dir)`, `resolveIntegrationBranch()` (private), `linkNodeModules(path)` (private; Win11 junction via `mklink /J`).
- `WorktreeApplyResult { success, conflict, appliedFiles, failedFiles, conflictingFiles, feedback[], errors[], mergedSha? }`.
- Exported from `@kingdomos/blacksmith` (`WorktreeManager`, `isGitRepo`).

### 2.4 Wiring site — `packages/cli/src/commands/summon.ts`
- `JobDispatcher` constructed at L489–511 with `assemblyOptions { projectPath, contextResolver, ... }`, `validationCommand`, `behavioralProbes`, `escalationPath`.
- Blacksmith hook L541–550 (`applyDiff` + reindex). Judge L522–527. Healer worker L614–633 (already agentic-capable, in-place repair).

---

## 3. Why & what changes

**Why:** §1. One-shot is the single biggest handicap on a strong model; the agentic loop + isolation is the path that improves with every model generation and eliminates diff-string brittleness (structured `apply_edit`).

**What changes (additive, flag-gated, fallback-preserving):**
1. `WorktreeManager` gains a **step-wise session API** (open → run/diff/commit → mergeBack/discard).
2. `runAgenticLoop` is **exported** with cancellation + heartbeat hooks so the dispatcher can drive it.
3. `JobDispatcher` gains a **new `executeAgenticJob` path** selected by a flag + capability + git-repo gate. The legacy one-shot path is **untouched** and remains the fallback.
4. A process-level **integration merge lock** serialises merge-backs.
5. A **`job_worktrees`** table + **reconciler** extension make crashes recoverable.
6. (Secondary) the **Healer repair** action runs in a worktree for the same safety relocation.

Nothing is removed. Non-tool models, non-git workspaces, and `agentic_dispatch.enabled=false` all run the exact legacy pipeline.

---

## 4. Target execution flow (`executeAgenticJob`)

```
            ┌─ assembleForJobAsync (grounded packet)  [unchanged]
            │
 open ──────┤  WorktreeManager.openSession(jobId)
 (capture H0 = integration HEAD, baseSha)            ← INV-1 anchor
            │  git worktree add -b kingdom/job-<id> <wt> H0 ; link node_modules
            │
 agentic ───┤  runAgenticLoop(provider, packet, {workspace: session.path, applyEdit, commandPolicy}, {signal, heartbeat})
 loop       │     model: read_file / run_command / apply_edit* / finish   → edits land INSIDE session.path
            │
 propose ───┤  diff = session.diff()        (git diff baseSha → resulting unified diff)
            │  if diff is empty  → DISCARD → no-op failure → retry/heal     [INV-1 holds]
            │
 review ────┤  reviewEngine.review({ diffText: diff, projectPath: session.path, allowedFiles, criteria, verificationEvidence })
            │  if rejected      → DISCARD → setFailed('review-rejection') + healer + retryOrEscalate   [INV-1 holds]
            │
 gates ─────┤  (run INSIDE session.path, node_modules junctioned)
            │  validationCommand   non-zero → DISCARD → failAgentic('validation', out)     [INV-1 holds]
            │  verification gate   non-zero → DISCARD → failAgentic('verification-gate')    [INV-1 holds]
            │  behavioural probes  non-zero → DISCARD → failAgentic('probe', out)           [INV-1 holds]
            │
 land ──────┤  session.commit("job <id>: agentic change")
 (exclusive)│  IntegrationGate.runExclusive:
            │     status='merging' (job_worktrees)
            │     merge = session.mergeBack()                       (git merge --no-ff job branch → integration)
            │     if conflict → DISCARD → failAgentic('merge-conflict', feedback)           [INV-1 holds: merge --abort]
            │     if clean:
            │        (optional) post-merge re-validate on integration branch
            │            fail → revert merge commit (git reset --hard H0) → failAgentic     [INV-1 restored]
            │        reindex; writeCheckpoint(mergedSha, changedFiles); setCompleted; task→completed
            │
 finally ───┘  session.discard()  (best-effort; no-op if already merged & removed)
```

`failAgentic(...)` is the agentic analogue of `failAppliedDiff` — same DB effects (`jobRepo.setFailed`, `transitionTaskToFailed('failed-review'|...)`, healer incident, `retryOrEscalate`) but **rollback = `session.discard()`** instead of `.bak` restore, because nothing on the integration branch was touched.

---

## 5. Component designs (exact target signatures)

### 5.1 `WorktreeSession` — step-wise lifecycle (`packages/blacksmith/src/worktree-manager.ts`)
Add a session abstraction; keep `applyInWorktree` as a wrapper.

```ts
export interface WorktreeRunResult { code: number; stdout: string; stderr: string; timedOut: boolean; }

export interface MergeBackResult {
  success: boolean; conflict: boolean; conflictingFiles: string[];
  mergedSha?: string; feedback: string[]; errors: string[];
}

export class WorktreeSession {
  readonly jobId: string;
  readonly path: string;            // absolute worktree dir
  readonly branch: string;          // kingdom/job-<id>
  readonly baseSha: string;         // integration HEAD at open()  ← INV-1 anchor
  readonly integrationBranch: string;

  /** git diff baseSha..worktree (working tree), unified, for review. '' if no change. */
  diff(): string;
  /** Names of files changed vs baseSha. */
  changedFiles(): string[];
  /** Run a command sandboxed to the worktree (cwd=path), with timeout. */
  run(command: string, opts?: { timeoutMs?: number; env?: Record<string,string> }): WorktreeRunResult;
  /** Stage all + commit on the job branch. No-op-safe if nothing staged (returns false). */
  commit(message: string): boolean;
  /** Merge the job branch into the integration branch. MUST be called inside IntegrationGate. */
  mergeBack(): MergeBackResult;
  /** Remove worktree + delete job branch. Integration HEAD untouched. Idempotent. */
  discard(): void;
}

export interface OpenSessionOptions { baseRef?: string; linkNodeModules?: boolean; }

export class WorktreeManager {
  // existing: applyInWorktree(), removeWorktree(), isGitRepo(), linkNodeModules()
  /** Create an isolated worktree+branch off integration HEAD and return a session. */
  openSession(jobId: string, opts?: OpenSessionOptions): WorktreeSession;
  /** Current integration branch HEAD sha (for reconciler / assertions). */
  integrationHead(): string;
}
```

Implementation notes:
- `openSession` ≈ first half of the existing `applyInWorktree` (prune stale, `rev-parse` base, `worktree add -b`, optional `linkNodeModules`). Capture `baseSha`.
- `diff()` = `git -C <path> diff <baseSha>` (working tree, not committed) so review sees uncommitted agent edits. `changedFiles()` = `git -C <path> diff --name-only <baseSha>`.
- `run()` uses `execFileSync('cmd'|'sh', ...)` or reuse the existing `git()` helper's pattern; capture code/stdout/stderr; enforce `timeoutMs`.
- `mergeBack()` = `git -C <repoRoot> merge --no-ff --no-edit <branch>`; on non-zero capture `diff --name-only --diff-filter=U`, `merge --abort`, return `conflict:true`. On zero, `mergedSha = rev-parse HEAD`.
- `discard()` = `removeWorktree(path, branch)` (already idempotent + prunes).
- Refactor `applyInWorktree(jobId, diffText)` to: `const s = openSession(jobId); applyDiff(diffText, s.path); s.commit(...); within-lock s.mergeBack(); finally s.discard();` — **preserves existing behavior + tests**.

### 5.2 Export the agentic loop (`packages/core/src/worker/worker-main.ts`)
```ts
export interface AgenticDriveOptions extends AgenticOptions {
  signal?: AbortSignal;
  onHeartbeat?: (status: string, detail: string, tokens: number) => void;
}
/** Drive the bounded agentic loop with cancellation + heartbeat, returning the result.
 *  Does NOT touch jobs.status or write a result file — the caller (dispatcher) owns lifecycle. */
export async function runAgenticLoop(
  provider: ProviderAdapter, packet: JobPacket, agentic: AgenticDriveOptions,
): Promise<WorkerResult>;
```
- Change the existing private `runAgenticLoop(provider, packet, agentic, heartbeat)` to accept `AgenticDriveOptions` and an optional internal heartbeat shim, and **export** it.
- Honour `signal`: check `signal.aborted` at the top of each iteration; if aborted, return `{ success:false, finish_reason:'cancelled', ... }`.
- Pass `signal` to each `provider.complete({ ..., signal })`.
- `executeWorker` keeps calling it (back-compat) by constructing a heartbeat shim.

### 5.3 Dispatcher: routing + `executeAgenticJob` (`packages/core/src/job/dispatcher.ts`)
New config on `DispatcherConfig`:
```ts
agenticDispatch?: {
  enabled: boolean;            // master flag
  maxIterations?: number;      // default 8
  linkNodeModules?: boolean;   // default true
  postMergeValidation?: boolean; // default true
  worktreeRoot?: string;       // default <projectPath>/.kingdom-worktrees
};
worktreeManager?: WorktreeManager;          // injected by summon (null ⇒ no agentic)
applyEdit?: ApplyEditFn;                     // injected by summon (blacksmith)
capabilitiesResolver?: (modelId: string) => ModelCapabilities | null; // injected by summon
integrationGate?: IntegrationGate;           // injected/created
```
Routing inside `executeJob`, immediately after assembly + groom (replace the single one-shot block at L739 with a branch):
```ts
const caps = this.config.capabilitiesResolver?.(packet.model_id) ?? null;
const useAgentic =
  this.config.agenticDispatch?.enabled === true &&
  packet.output_format === 'unified-diff' &&
  caps?.tool_use === true &&
  !!this.config.worktreeManager &&
  !!this.config.applyEdit &&
  isGitRepo(this.config.assemblyOptions.projectPath) &&
  process.env.KINGDOM_AGENTIC_DISPATCH !== '0';

if (useAgentic) { await this.executeAgenticJob(job, task, provider, packet, caps!); return; }
// else: existing one-shot path (unchanged) ...
```
`executeAgenticJob` implements §4. Reuse existing helpers verbatim where possible:
- Review: build the same `ReviewContext` as L787, but `diffText = session.diff()` and `projectPath = session.path`.
- Gates: replace `execSync(cmd, {cwd: projectPath})` with `session.run(cmd)`; same failure routing via a new `failAgentic` (mirror `failAppliedDiff` but rollback = `session.discard()`).
- Completion: `writeCheckpoint` with `merge.mergedSha`; `changedFiles = session.changedFiles()` for scribe/checkpoint.
- Cancellation: wrap the loop in `runWithCancellation`; on cancel, `session.discard()`.
- Result file: still write `packet.result_path` (durable step output — needed for resume/exactly-once).

### 5.4 Review of the worktree diff
No change to `ReviewEngine`. It already simulates a diff against a `projectPath` and grades the resulting code (dispatcher L797–800). Passing `projectPath = session.path` makes it grade against the worktree's pre-edit base, which is exactly the integration base — correct. The diff it receives is the *actual* agent change. (The agent already applied; review is post-apply-in-isolation, pre-merge.)

### 5.5 Gates inside the worktree
`validationCommand`, `task.verification.test_command`, and each `behavioralProbe` run via `session.run(cmd, {timeoutMs})` with `cwd = session.path`. node_modules junction (M0) makes builds resolve. If junction failed (logged), fall back to running gates on the integration branch *after* a provisional merge guarded by reconciler — **avoid this**; prefer junction. `runVerificationGate` gains an overload or the dispatcher calls `session.run(task.verification.test_command)` directly and reuses the gate's pass/fail semantics.

### 5.6 Integration merge lock (`packages/core/src/job/integration-gate.ts`, new)
```ts
/** Process-level async mutex serialising commit+merge+post-merge-validate.
 *  (When workers become separate processes — Phase 1 TODO — replace with a DB advisory lock.) */
export class IntegrationGate {
  runExclusive<T>(fn: () => Promise<T>): Promise<T>;  // promise-chain mutex
}
```
Only the **land** critical section (§4) runs inside `runExclusive`. The agentic loop + review + gates run *outside* the lock (fully parallel across jobs). This keeps merges serialized while maximising parallelism.

### 5.7 Cancellation
`cancelJobIfRequested` checks remain at each stage boundary. Additionally the agentic loop receives the abort `signal` from `runWithCancellation` and stops between iterations. Any cancellation path ends with `session.discard()`.

### 5.8 Healer parity (secondary, M5)
Upgrade the P3.3 `repair` action so that, when `isGitRepo(workspace)`, it runs the proposed patch in a `WorktreeSession` (apply → verify via `session.run` → mergeBack) instead of in-place `applyDiff`+`.bak`. Same relocation; same INV-1. Falls back to the existing in-place repair for non-git workspaces.

---

## 6. Data model & migrations

**Migration `packages/core/migrations/034_job_worktrees.sql`** (034 is the next free number after Phase 4's 033):
```sql
CREATE TABLE IF NOT EXISTS job_worktrees (
  job_id             TEXT PRIMARY KEY,
  branch             TEXT NOT NULL,
  worktree_path      TEXT NOT NULL,
  integration_branch TEXT NOT NULL,
  base_sha           TEXT NOT NULL,
  status             TEXT NOT NULL DEFAULT 'open',  -- open | merging | merged | discarded
  merged_sha         TEXT,
  created_at         TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at         TEXT
);
CREATE INDEX IF NOT EXISTS idx_job_worktrees_status ON job_worktrees(status);
```
Lifecycle writes (in `executeAgenticJob`): insert `open` at session open; `merging` before `mergeBack`; `merged` (with `merged_sha`) on success; `discarded` on any failure/finally. Repository helper: `WorktreeRepository` in `packages/core/src/repositories/worktree-repo.ts` (`open`, `setMerging`, `setMerged`, `setDiscarded`, `listLive()`).

Reserve `035` (unused) to leave headroom, matching the project's gap convention.

---

## 7. Crash recovery / reconciler extension

Extend `packages/core/src/recovery/reconciler.ts` `reconcile(db, ...)` (Phase 1) with a worktree pass, run at `summon` startup **before** dispatch:
1. `SELECT * FROM job_worktrees WHERE status IN ('open','merging')`.
2. For each: if `status='merging'` and the integration branch already contains `merged_sha` → mark `merged` (crash after merge, before bookkeeping). Else `git merge --abort` (if a merge is in progress) and `WorktreeManager.removeWorktree(worktree_path, branch)`; set `discarded`; transition the owning job/task back to `retrying`/`queued` via the existing atomic transitions; release any locks the job held (reuse Phase 1 orphan-lock logic).
3. Always `git worktree prune`.

This makes the CLAUDE.md "Lock Storm / corrupted file" runbook obsolete for agentic jobs: a crash leaves only a throwaway worktree, never a half-applied integration tree.

---

## 8. Concurrency & determinism model

- **Parallelism:** N agentic jobs open N worktrees and run their loops + reviews + gates concurrently (CPU-bound build steps aside). Only the **land** section serialises via `IntegrationGate`.
- **No mixing:** when `agentic_dispatch.enabled` is true for a git workspace, **all** `unified-diff` jobs whose model has `tool_use` go through worktrees. Jobs whose model lacks `tool_use` still use the legacy in-place path — but to avoid a legacy in-place write racing a worktree merge on the same branch, the legacy in-place apply for those jobs **must also acquire `IntegrationGate.runExclusive`** around its Blacksmith apply + gates when agentic dispatch is enabled. (Add this guard; it is a no-op when the flag is off.)
- **Exactly-once merge:** each job branch `kingdom/job-<id>` is created fresh per attempt and merged at most once; a retry is a *new* job id ⇒ a new branch. No double-apply.
- **Determinism of orchestration vs model:** the model call is non-deterministic, but its *output* (applied edits → committed on the job branch + result file) is a durable step. Resume/reconcile never re-invokes the model for an already-merged job.

---

## 9. Capability gating, fallback, configuration

**`kingdom.config.json`** — add:
```json
"agentic_dispatch": {
  "enabled": false,
  "max_iterations": 8,
  "link_node_modules": true,
  "post_merge_validation": true,
  "worktree_root": ".kingdom-worktrees"
}
```
- Default **`false`** until M6 validation; flip to `true` at M6.
- Env override: `KINGDOM_AGENTIC_DISPATCH=0` force-off, `=1` ignored unless config enabled (config is the source of truth; env can only force off, mirroring `KINGDOM_NO_LESSONS`).
- Gate (all required): flag on **AND** `packet.output_format==='unified-diff'` **AND** model `tool_use` **AND** workspace is a git repo **AND** `worktreeManager`+`applyEdit` wired.
- **Fallbacks (byte-identical legacy behavior):** flag off, non-tool model, non-git workspace, or missing wiring → the existing one-shot pipeline. The squire/local-model tier (no `tool_use`) keeps working unchanged.

**`.gitignore`** — add `.kingdom-worktrees/`.

**summon wiring (`packages/cli/src/commands/summon.ts`):** construct `new WorktreeManager(projectPath, { integrationBranch, linkNodeModules, authorName:'KingdomOS', verbose })`, an `IntegrationGate`, pass them + `applyEdit` (blacksmith) + `capabilitiesResolver` (`modelRegistry.getModelCapabilities`) + `agenticDispatch` config into the `JobDispatcher` config (L489). Reuse the already-wired `applyEdit` used by the agentic worker for non-dispatch tests.

---

## 10. Security & sandboxing

- `run_command` (agent tool) and all gates execute with `cwd = session.path` (the worktree), **never** the Kingdom repo and **never** the integration tree.
- Reuse the existing command allow-list from `command-sandbox.ts` (`CommandPolicy`) — only the configured `validationCommand`/`test_command`/probes + read-only inspectors; hard timeouts (30s build, 20s probe — match legacy constants).
- Reuse the reviewer's `DESTRUCTIVE_PATTERNS`/`SECURITY_PATTERNS` as a tool-call guard for `run_command`.
- Bounded loop: `maxIterations` (8) + `tokenBudget` (default `max_tokens*(maxIterations+1)`), already in `runAgenticLoop`.
- Worktrees live under `<projectPath>/.kingdom-worktrees/<jobId>` and are force-removed on discard.

---

## 11. Step-by-step implementation plan (milestones)

> Each milestone: implement, then `pnpm run build` (exit 0) + `pnpm test` green (≥ prior count) before moving on. Commit per milestone.

**M0 — Scaffolding (no behavior change).**
- Add `WorktreeSession` + `WorktreeManager.openSession/integrationHead` (§5.1); refactor `applyInWorktree` to use them. Export from `@kingdomos/blacksmith`.
- Add migration `034_job_worktrees.sql` + `WorktreeRepository` (§6).
- Add `IntegrationGate` (§5.6).
- Add `agentic_dispatch` config plumbing (types + read in summon, default off) + `.gitignore` entry.
- **Acceptance:** build green; existing worktree tests still pass; new unit tests for `WorktreeSession` (§12.1) pass; flag off ⇒ zero behavioral change (full suite still 403+).

**M1 — Export + cancellable agentic loop.**
- Export `runAgenticLoop` with `AgenticDriveOptions` (signal + heartbeat) (§5.2); keep `executeWorker` working.
- **Acceptance:** unit tests §12.2 (loop happy path, iteration cap, cancellation via aborted signal, fallback when no tool_use) pass.

**M2 — `executeAgenticJob` behind the flag (default off).**
- Implement routing + `executeAgenticJob` + `failAgentic` (§5.3, §4). Wire summon (§9).
- **Acceptance:** integration tests §12.3 (happy, empty-diff, review-reject, validation-fail, verification-gate-fail, probe-fail) pass with a **fake tool-using provider** that emits scripted `tool_calls`. **Every failure test asserts INV-1** (integration HEAD unchanged). Legacy path tests still pass (flag still defaults off; tests enable it explicitly).

**M3 — Merge serialization + post-merge validation.**
- `IntegrationGate.runExclusive` around land; optional post-merge re-validate with `git reset --hard baseSha` revert on failure; add the legacy-path `runExclusive` guard (§8).
- **Acceptance:** §12.4 (merge-conflict path leaves integration unchanged; two concurrent agentic jobs both land or one retries; post-merge validation failure reverts).

**M4 — Crash recovery.**
- `job_worktrees` lifecycle writes in `executeAgenticJob`; extend reconciler (§7).
- **Acceptance:** §12.5 (orphan worktree row → reconcile discards it, job requeued, integration unchanged; crash-after-merge → marked merged).

**M5 — Healer repair-in-worktree parity (secondary).**
- Upgrade `repair` action to use `WorktreeSession` for git workspaces (§5.8).
- **Acceptance:** §12.6 (healer repair that passes verify merges back; that fails verify discards, integration unchanged).

**M6 — Enable + harden.**
- Flip `agentic_dispatch.enabled` default to `true`; full suite green; update `CLAUDE.md` (new flow, worktree intervention notes), `PHASE0-FOUNDATION.md` cross-ref, and `KINGDOMOS-CORE-EVOLUTION.md` (mark deferral #1 closed).
- **Acceptance:** full build+test green with the flag on; a manual smoke (documented commands) against a throwaway git workspace using a tool-capable model OR the fake provider harness end-to-end.

---

## 12. Test plan (exhaustive)

> Use a **fake tool-using `ProviderAdapter`** (`tests/helpers/fake-agentic-provider.ts`) whose `complete()` returns a scripted queue of `tool_calls` (read_file → apply_edit → finish), and a **temp git repo** fixture (`tests/helpers/temp-git-repo.ts`) created in `os.tmpdir()`. No network.

### 12.1 `WorktreeSession` unit (`tests/blacksmith/worktree-session.test.ts`)
- `openSession` creates worktree dir + branch; `baseSha === integrationHead()`.
- `run('node -e ...')` executes with cwd=worktree; returns code/stdout.
- after writing a file in the worktree, `diff()` returns a unified diff; `changedFiles()` lists it.
- `commit()` creates a commit on the job branch; integration HEAD unchanged.
- `mergeBack()` clean → integration HEAD advances to `mergedSha`; file present on integration tree.
- `mergeBack()` conflict (seed a conflicting commit on integration after open) → `conflict:true`, integration HEAD **unchanged**, merge aborted.
- `discard()` removes worktree + branch; integration HEAD unchanged; idempotent (second call no-throw).

### 12.2 Agentic loop unit (`tests/core/agentic-loop.test.ts`)
- happy path: scripted finish after one apply_edit → `applied_files` populated, `agentic:true`.
- iteration cap: provider never calls finish → loop stops at `maxIterations`, `finish_reason:'length'`.
- cancellation: pre-aborted signal → returns `finish_reason:'cancelled'`, no provider call.
- guard: `apply_edit` outside `allowed_files` (planned-files mode) returns scoped error, no write.

### 12.3 `executeAgenticJob` integration (`tests/integration/agentic-dispatch.test.ts`) — flag enabled
For each, capture `H0 = integrationHead()` at start; assert outcome + INV-1:
- **happy:** approve + gates pass + clean merge → task `completed`; `integrationHead() === mergedSha !== H0`; changed file on disk; checkpoint row written.
- **empty-diff:** agent finishes with no edits → no-op failure; `integrationHead() === H0`; worktree removed.
- **review-reject:** fake review rejects → task `failed-review`; healer incident created; `integrationHead() === H0`.
- **validation-fail:** `validationCommand` exits non-zero in worktree → fail; `=== H0`.
- **verification-gate-fail:** `task.verification.test_command` non-zero → fail; `=== H0`.
- **probe-fail:** a probe non-zero → fail; `=== H0`.
- **cancellation:** set `cancel_requested` before land → session discarded; `=== H0`.

### 12.4 Concurrency & merge (`tests/integration/agentic-merge.test.ts`)
- **merge-conflict:** open session A; commit a conflicting change directly on integration; A passes gates; `mergeBack()` conflicts → fail with conflict feedback; `integrationHead()` unchanged from the post-conflict-commit value (A did not land).
- **two concurrent jobs:** both edit different files → both land (serialized); integration tree has both changes.
- **post-merge validation failure:** force post-merge validate to fail → merge commit reverted (`reset --hard`), task failed, integration back at H0.

### 12.5 Crash recovery (`tests/integration/agentic-reconcile.test.ts`)
- insert a `job_worktrees` row `status='open'` with a real orphan worktree → `reconcile()` removes worktree+branch, sets `discarded`, requeues job; `integrationHead()` unchanged.
- `status='merging'` with `merged_sha` already on integration → `reconcile()` marks `merged` (no double-merge).

### 12.6 Fallbacks (`tests/integration/agentic-fallback.test.ts`)
- non-tool model (caps.tool_use=false) + flag on → legacy in-place path runs; **no worktree created** (assert `.kingdom-worktrees` absent / `job_worktrees` empty).
- non-git workspace + flag on → legacy path.
- flag off → legacy path (assert byte-identical to pre-Phase-5 by snapshotting the result for a fixed fake one-shot provider).

### 12.7 Healer parity (`tests/integration/healer-worktree-repair.test.ts`) — M5
- repair patch that passes verify → merged; integration advances.
- repair patch that fails verify → discarded; `integrationHead()` unchanged.

---

## 13. Determinism / provability checklist (the work is done only when ALL are asserted by a test)

- [x] **INV-1** asserted in every §12.3/§12.4/§12.5/§12.7 failure case (`integrationHead()` before == after). *(agentic-dispatch, agentic-merge, agentic-reconcile, healer-worktree-repair)*
- [x] Happy path is the **only** path that advances integration HEAD. *(happy asserts `!= H0`; every failure asserts `== H0`)*
- [x] No `.bak` files are created on the integration tree for agentic jobs (assert absence). *(commit()/changedFiles() exclude `*.bak`; happy + healer tests assert `app.ts.bak` absent)*
- [x] Exactly-once: a retried (new-id) job creates a new branch; the old branch is gone (assert). *(empty-diff test asserts `kingdom/job-<id>` branch deleted on discard; each attempt = new job id = new branch)*
- [x] Reconcile is idempotent (run twice → same state). *(§12.5 merging-landed test runs reconcile twice)*
- [x] Legacy path unchanged: golden assertion of the one-shot result for a fixed fake provider (content == diff, no `agentic` flag). *(§12.6 fallbacks)*
- [x] Build exit 0; full suite green. Both flag states exercised by the suite (agentic suites enable it; §12.6 disables it; rest is flag-agnostic).

---

## 14. Rollout & migration strategy

1. Land M0–M5 with the flag **off** (zero production impact; all new behavior is test-only).
2. M6: flip default `true`. First real run on a **disposable git workspace** with a tool-capable model (or the fake-provider smoke harness). Watch: worktrees created/removed cleanly, merges serialized, no `.kingdom-worktrees` leakage.
3. Keep `KINGDOM_AGENTIC_DISPATCH=0` documented as the instant kill-switch back to legacy.
4. Update `CLAUDE.md` interventions: orphan-worktree cleanup replaces orphan-lock/`.bak` runbook for agentic jobs.

---

## 15. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Per-worktree `node_modules` cost on Windows | `mklink /J` junction (no admin) from base; never `pnpm install` per worktree; if junction fails, post-merge validation on integration (guarded). |
| Merge of a textually-clean but semantically-broken change | Post-merge re-validation on the integration branch (M3) with `reset --hard` revert on failure. |
| Legacy in-place write racing a worktree merge | When flag on, route legacy jobs' apply through the same `IntegrationGate`. |
| Agent makes a huge mess / loops | Bounded `maxIterations` + `tokenBudget`; worktree is throwaway. |
| Crash mid-merge | `job_worktrees.status='merging'` + reconciler abort/complete logic (M4). |
| Review now post-apply (in isolation) vs pre-apply | Semantically equivalent: review still gates *landing*; isolation guarantees no integration mutation pre-approval. Proven by INV-1. |
| Provider lacks real `tool_use` despite caps row | Loop degrades: no `tool_calls` ⇒ treats prose as final ⇒ empty/!valid diff ⇒ review/gates reject ⇒ discard. Safe. |

---

## 16. Definition of Done

- M0–M6 complete; flag default `true`.
- All §12 tests written and green; §13 checklist fully asserted.
- `pnpm run build` exit 0; `pnpm test` green with flag on **and** off.
- Docs updated (`CLAUDE.md`, `KINGDOMOS-CORE-EVOLUTION.md` deferral #1 marked closed, this file's milestones checked).
- A documented end-to-end smoke (fake-provider harness or a real tool-capable model on a throwaway git repo) showing: agentic edits in an isolated worktree, review+gates, clean merge to integration, and a rejected change leaving integration untouched.

---

## 17. File-by-file change manifest (quick index)

| File | Change |
|---|---|
| `packages/blacksmith/src/worktree-manager.ts` | + `WorktreeSession`, `openSession`, `integrationHead`; refactor `applyInWorktree` |
| `packages/blacksmith/src/index.ts` | export `WorktreeSession`, types |
| `packages/core/src/worker/worker-main.ts` | export `runAgenticLoop` + `AgenticDriveOptions`; signal/heartbeat |
| `packages/core/src/job/dispatcher.ts` | routing gate; `executeAgenticJob`; `failAgentic`; legacy `IntegrationGate` guard |
| `packages/core/src/job/integration-gate.ts` | **new** — async merge mutex |
| `packages/core/src/repositories/worktree-repo.ts` | **new** — `job_worktrees` CRUD |
| `packages/core/migrations/034_job_worktrees.sql` | **new** |
| `packages/core/src/recovery/reconciler.ts` | + worktree recovery pass |
| `packages/core/src/index.ts` | export new symbols |
| `packages/cli/src/commands/summon.ts` | construct + inject `WorktreeManager`, `IntegrationGate`, `applyEdit`, `capabilitiesResolver`, `agenticDispatch` config |
| `kingdom.config.json` | + `agentic_dispatch` block; squire stays legacy (no tool_use) |
| `.gitignore` | + `.kingdom-worktrees/` |
| `tests/helpers/{fake-agentic-provider,temp-git-repo}.ts` | **new** harness |
| `tests/**` | §12 suites |

> When this plan is complete, the model proposes inside a sandbox, the system disposes at the merge —
> and the safety guarantee is *stronger* than the day the project was conceived. That is the transformation.
