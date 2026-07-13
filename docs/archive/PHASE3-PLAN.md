# Phase 3 — Resilience, Self-Healing & Verification (PLAN)

Branched from Phase 0 foundation (base `6eb7f09`). Builds on the Phase 0 tool-use /
structured-output surface (`CompletionRequest.tools/response_format`, `CompletionResponse.tool_calls`)
and `ModelRegistry.getModelCapabilities`.

Priority order (build+test green after each): **P3.2 → P3.4 → P3.3 → P3.1**.

Migrations reserved: **025–029**.

---

## P3.2 — Per-task verification contract (test-execution-as-gate)

- **Model**: add optional `verification { test_command, probe?, timeout_seconds? }` to `TaskGraphNode`.
  Migration `025` adds a `verification` TEXT (JSON) column to `task_graph_nodes`; `task-repo.ts`
  reads/writes it (additive — `create()` accepts optional `verification`, `mapRow` parses it).
- **New module** `core/src/verification/verification-gate.ts`: `runVerificationGate(verification, {projectPath, timeoutMs})`
  runs the task-scoped `test_command` (and optional `probe`) with `cwd=projectPath`, hard timeout,
  captures combined stdout/stderr. Returns `{ ran, passed, output, command }`.
- **Dispatcher hook** (PHASE3 single-line call): in the post-apply pipeline, between the global
  `validationCommand` block and the `behavioralProbes` block, call the gate. Non-zero → reuse
  existing `failAppliedDiff(...)` with the test output as feedback (rollback + healer + retry).
  Result is stashed on the dispatcher instance so the *next* review can cite it.
- **Decomposer**: emit a `test_command` in the plan when sensible (test-framework known / type==='test').
  Plumb `verification` through `create()`.
- **Reviewer**: `ReviewContext.verificationEvidence?` — when a gate ran and passed, the criteria
  prompt is told "an executable verification gate (`<cmd>`) passed" as positive evidence. Additive.

## P3.4 — Semantic loop-breaking

- **New module** `core/src/verification/loop-detector.ts`:
  - `computeFailureSignature(reasons[])` → normalized one-line root-cause string + stable hash.
  - `isSemanticallyStuck(prev, curr, {provider?, model?, cache})` → a one-line LLM "same root cause? y/n"
    (cached by signature-pair hash). Falls back to the existing lexical >=50%-overlap check when no
    provider / provider errors.
- **Persistence**: migration `026` adds `failure_signature` TEXT to `jobs` (per-attempt).
- **Dispatcher**: replace the inline `isFeedbackIdentical` call in `retryOrEscalate` with a single call
  into the new module + a stuck-streak counter. When semantically stuck **>=2 attempts**, escalate the
  *strategy* (route to healer) instead of only bumping the tier.
- `isFeedbackIdentical` retained as the exported lexical fallback.

## P3.3 — Agentic, execution-grounded Healer

- **Diagnostician**: when `capabilities.tool_use === true`, run a bounded tool-using loop
  (`read_file`, `run_command` [whitelisted: validation/test cmd, `git diff`, grep], `propose_patch`).
  Uses `response_format` for the final structured diagnosis. Non-tool models keep today's classifier
  (prose+parse) path unchanged. Bounded iterations + per-call timeout + `cwd=workspace`.
- **action-executor**: new `repair` action — applies a healer-produced unified diff through the
  blacksmith callback + the SAME validation/probe verifier, and only `resolve`s the incident when the
  gate is green (**verify-before-resolve**); otherwise escalate.
- **HealerWorker**: pass workspace path + blacksmith + verifier + capabilities hooks through. All
  additive / optional — existing constructor call sites keep working.

## P3.1 — Mutable task graph + replanning + true DAG

- **task-repo** (additive):
  - Relax `validateDependencies` to allow cross-subtree edges within the **same objective**;
    keep self-dep + missing-dep rejection; **add a cycle check** using the recursive-CTE descendant
    machinery.
  - Migration `027` replaces the DB-level `task_dependencies_same_scope_insert` trigger with a
    `same_objective` trigger (cross-subtree allowed, cross-objective rejected); cycle trigger kept.
  - New `supersedeSubtree(rootId, reason)` — marks a subtree `superseded` (roll-up), additive.
- **Replanning**:
  - Migration `028` adds `replan_count` to `objectives` (per-objective replan budget).
  - `decomposer.replanNode(taskId, reason)` — additive entry that re-decomposes a node with the
    failure reason injected, superseding the old subtree.
  - `orchestration-loop.ts` — additive `replanStuckSubtrees()` wired into `tick()`, triggered from
    `awaiting-healer`, guarded by the per-objective replan budget. Wires `superseded` /
    `awaiting-redesign` terminal states.

## Tests (vitest)

- verification gate: pass; fail→rollback (dispatcher reuses failAppliedDiff).
- loop-detector: semantic-stuck detection (mock provider y/n) + lexical fallback on provider error.
- healer repair: verify-before-resolve (mock provider + mock blacksmith + mock verifier) green→resolve, red→escalate.
- task-repo: cross-subtree same-objective dependency allowed; cross-objective rejected; cycle rejected; `supersedeSubtree` roll-up.
- replan: budget guard stops runaway replanning.

## Shared-hot-file edits (minimized, marked `// PHASE3:`)

- `dispatcher.ts` — verification-gate call + loop-detector call (single-line into new modules) + signature record.
- `task-repo.ts` — additive `validateDependencies` relax + cycle check, `supersedeSubtree`, `verification` plumb.
- `orchestration-loop.ts` — additive `replanStuckSubtrees`.
- `decomposer.ts` — additive `replanNode` + `test_command` emission.
