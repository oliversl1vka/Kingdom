# Phase 2 — Agentic, Grounded Execution (REPORT)

## Status
- Build: `pnpm run build` → exit 0.
- Tests: **302 → 325 passing** (+23 new), 5 files skipped, 40 todo. No regressions.
- Base: branched from Phase 0 `6eb7f09` (see SETUP note below).

## SETUP note (important)
The worktree was created on `9e27b42` (the commit *before* Phase 0), not on the
documented Phase 0 base `6eb7f09`. Phase 0 (`6eb7f09`) is a direct child of `9e27b42`,
and the worktree had no unique commits, so I fast-forwarded the branch to `6eb7f09`
(`git reset --hard 6eb7f09`) before starting. All Phase 0 substrate
(`getModelCapabilities`, native `tools`/`tool_choice`/`response_format`, llama.cpp) is
present and was built on, not reinvented.

## Files added
- `packages/blacksmith/src/edit-applicator.ts` — `applyEdit({path,old_string,new_string})`
  programmatic structured edit (literal replace + `.bak`), killing diff-string brittleness.
- `packages/core/src/worker/command-sandbox.ts` — whitelisted/deny-listed, workspace-cwd,
  hard-timeout `run_command` runner (security surface).
- `packages/core/src/context/context-client.ts` — `ContextResolver` + structural seam that
  lazy-imports `@kingdomos/context-engine` (no static dep → no build cycle).
- `packages/core/src/context/index-lifecycle.ts` — `ContextIndexLifecycle` (index at start,
  reindex after apply).
- `packages/core/src/context/index.ts` — context barrel.
- `packages/core/src/task-graph/planner-tools.ts` — read-only planner tools + `emit_task_graph`
  JSON schema + `PlannerOptions`/`RepoReader`.
- Tests: `tests/blacksmith/apply-edit.test.ts`, `tests/security/command-sandbox.test.ts`,
  `tests/integration/agentic-worker.test.ts`,
  `tests/integration/packet-assembler-grounding.test.ts`,
  `tests/integration/context-index-lifecycle.test.ts`,
  `tests/task-decomposition/grounded-planner.test.ts`.
- `PHASE2-PLAN.md`, `PHASE2-REPORT.md`.

## Files changed
- `packages/blacksmith/src/index.ts` — export `applyEdit`.
- `packages/core/src/worker/worker-main.ts` — **P2.1**: `executeWorker` gains an optional
  `AgenticOptions` arg; when `capabilities.tool_use` is true it runs a bounded
  read/act/verify loop with `read_file`/`apply_edit`/`run_command`/`finish` tools (iteration
  + token caps, scope-guarded edits, tool results fed back as messages). Non-tool models and
  callers passing no options keep the **exact** one-shot prose path.
- `packages/core/src/job/packet-assembler.ts` — **P2.2**: optional `contextResolver`;
  new `assembleForJobAsync`/`resolveGroundedContext` validate/repair `context_refs` against
  the index, inject high-ranked retrieved chunks, and emit a degrade notice when the index is
  unhealthy. Synchronous `assembleForJob` is unchanged when no grounded context is supplied.
- `packages/core/src/task-graph/decomposer.ts` — **P2.3/P2.4**: constructor gains optional
  `PlannerOptions`. Tool-using planner → bounded repo-read agent session → forced
  `emit_task_graph`. `structured_output` → `response_format` json_schema call. Both fall back
  to the legacy blind prose + `JSON.parse` path. Subtask coercion shared via `normalizeSubtasks`.
- `packages/core/src/orchestration-loop.ts` — **SHARED HOT FILE** (see INTEGRATION NOTES).
- `packages/core/src/index.ts` — new exports.
- `packages/cli/src/commands/summon.ts` — wires `ContextResolver`/`ContextIndexLifecycle`/
  context-engine-backed `contextHydrator`/`plannerOptions`/after-apply reindex into the run.

## INTEGRATION NOTES — shared hot-file edits

### `orchestration-loop.ts` (every edit marked `// PHASE2:`)
1. **Import (top, ~line 16)** — added `import type { PlannerOptions } from './task-graph/planner-tools.js';`.
2. **`OrchestrationConfig` (interface, just after the existing `contextHydrator` field, ~line 50)** —
   added two optional fields: `contextIndexLifecycle?: { indexAtStart(): Promise<boolean>; hasIndexed(): boolean }`
   and `plannerOptions?: PlannerOptions`. Both optional ⇒ no caller breakage.
3. **Constructor `TaskDecomposer` construction (~line 122)** — passed `config.plannerOptions`
   as the new 6th decomposer arg.
4. **`start()` (~line 126)** — added a one-shot, fire-and-forget `contextIndexLifecycle.indexAtStart()`
   (guarded by `hasIndexed()`), placed before `setInterval`. Not awaited; failure is logged in
   verbose mode and degrades to raw slices.
   - No changes to `tick()`, decomposition, job-creation, completion-propagation, or any
     existing control flow. Phase 3's replan phase can be added without conflicting with these
     localized additions.

### `decomposer.ts` (Phase 3 adds a replan entry)
- All Phase 2 logic is additive and confined to: the constructor (new optional 6th param +
  `capabilities()` helper), and a branch at the top of the existing `planDecomposition`
  request site that tries grounded/structured paths then **falls through** to the untouched
  legacy `provider.complete` + `parsePlan` path. New private methods (`planStructured`,
  `planGrounded`, `runPlannerTool`, `parsePlanObject`, `normalizeSubtasks`) are appended; the
  public `decompose()` signature/behavior is unchanged. A Phase 3 replan entry can hook
  `decompose`/`planDecomposition` without touching these branches.

## Deferred TODOs
- **Dispatcher activation of P2.1 + P2.2 grounded assembly.** The live `JobDispatcher` runs
  its own inline `provider.complete()` + `applyDiff` path rather than `executeWorker`, and
  calls `assembleForJob` synchronously (`dispatcher.ts:656`). To fully activate the agentic
  loop and grounded packets in production, the dispatcher should (a) swap
  `assembleForJob(job, task)` → `await assembleForJobAsync(job, task)` (one line; `executeJob`
  is already async) and (b) route tool-capable code tasks through `executeWorker(..., AgenticOptions)`
  instead of its inline call. `dispatcher.ts` is outside this phase's ownership set, so these
  are left as a localized integration step. The owned entrypoints (`executeWorker`,
  `assembleForJobAsync`, the decomposer paths) are implemented, exported, wired in `summon.ts`,
  and tested; ref-validation/repair is already live via the `contextHydrator` (runs before
  job creation, persisted to the task).
- Retrieval currently uses BM25/FTS only (Phase 3 P3.5 adds hybrid vector + rerank).

## Patch
`git format-patch -o .integration/phase2 6eb7f09..HEAD` (see Report tail for the dir path).
