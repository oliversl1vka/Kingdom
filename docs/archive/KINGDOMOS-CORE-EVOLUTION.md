# KingdomOS — Core Engine Evolution Plan

> Synthesized 2026-06-09 from five parallel architecture reviews (orchestration, agent intelligence,
> context/memory, resilience, execution substrate). Scope: the **core engine only** — no dashboard, no FE.
> Picks up where `KINGDOMOS-IMPROVEMENTS.md` left off (the original 26-item backlog is closed; this is the
> *next altitude* — net-new architecture, not bug-fixing).

---

## The Thesis

KingdomOS was deliberately built for models that didn't exist yet. The architecture it shipped with,
however, is everywhere shaped by **coping with weak models**: it coaxes JSON and diffs out of prose,
minimizes what each agent sees, serializes work to avoid file conflicts, and recovers via human-run SQL recipes.

The single unifying move of this plan is to **invert every one of those compensations** so the engine gets
*dramatically better as models get smarter* instead of merely *less broken*:

| Today (built down to weak models) | Target (built up to frontier models) |
|---|---|
| Text-in / text-out, parse JSON & diffs from prose | Native tool-use + structured output |
| One-shot worker emits a perfect diff blind | Agentic worker loop: read → edit → run → self-fix |
| Task graph frozen at decomposition | Mutable DAG that replans stuck subtrees |
| Planner decomposes from the objective string, never reads the repo | Tool-using planner grounded in the actual codebase |
| Context = LLM-hallucinated file refs; minimize tokens | Retrieval-grounded packs / repo-scale dossiers |
| Healer = 4-button classifier reading a text blob | Agentic SRE that reproduces, patches, and *proves* the fix |
| All agents mutate one shared tree in place | Worktree-per-agent isolation + git 3-way merge |
| One process; a crash orphans everything | Durable execution + process isolation + auto-reconcile |
| Lessons = 5 hardcoded rules, bulk-injected by tier | Discovered, outcome-validated, relevance-retrieved memory |

The north-star test for every change: **"How does this scale with a 10×-smarter model — or 50 of them — in 6 months?"**

---

## Status — Deferral #1 (Agentic Dispatch via Isolated Worktrees): **CLOSED** (2026-06-10)

The keystone capability — tool-capable models executing coding jobs as a real
**read → edit → run → self-correct** loop inside an **isolated git worktree**, merged to the
integration branch **only after review + compile + tests + a clean merge all pass** — is implemented and
enabled by default (`agentic_dispatch.enabled: true`). This composes P1.5 (worktree isolation) with P2.1
(the agentic loop) into the live dispatch path, relocating the safety boundary from *review-before-apply*
to *review-before-merge* with a **stronger** guarantee than the legacy `.bak` model:

> **INV-1** — on every non-success outcome (empty diff, review reject, validation/verification/probe
> failure, merge conflict, post-merge-validation failure, cancellation, crash) the integration branch HEAD is
> **identical** to its value when the job's worktree opened. The change lands **iff** the full gauntlet passes.

See `PHASE5-AGENTIC-DISPATCH-PLAN.md` (milestones M0–M6, all complete). The legacy one-shot in-place pipeline
remains fully intact as the fallback for non-tool models, non-git workspaces, and `enabled:false` /
`KINGDOM_AGENTIC_DISPATCH=0`. Crash recovery of throwaway worktrees is automatic at `summon` startup, making
the CLAUDE.md orphan-lock / `.bak`-corruption runbook obsolete for agentic jobs.

---

## The Keystone (every pillar pointed here)

Three of the five reviews independently identified the **same root bottleneck**:

> `CompletionRequest` (`packages/core/src/types.ts:407`) is **text-only** — no `tools`, no `tool_choice`,
> no `response_format`, no streaming, no `tool_calls` on the response. Grep confirms `tools`/`function_call`
> appear in **zero** adapter or worker files. Every structured artifact — decomposition plans, unified diffs,
> review verdicts, healer diagnoses — is squeezed out as prose and recovered with `JSON.parse`/regex.

This single interface caps reliability **independent of model strength** and wastes the one capability modern
models are best at. Fixing it unlocks roughly half the proposals across all five pillars. **Nothing else should
go first.**

Two adjacent facts make the keystone cheap to act on:
- The **capability layer already exists but is dormant**: `resolve-model.ts` (`scoreCandidate`, `selectByProfile`),
  `CapabilityProfile`/`ModelCapabilities` (`types.ts:285`), migration `009_model_capabilities.sql`. It's switched
  off only because `kingdom.config.json` pins every tier to a model *name*, and `makeModelResolver` suppresses
  profile routing whenever a name is present. Flip the precedence and the whole fleet becomes model-name-agnostic.
- The **context engine is fully built but completely disconnected**: `searchContext`/`indexContextProject`
  (`packages/context-engine`) — FTS5, TS-compiler symbol extraction, import graph, ranker — are called *only*
  from the CLI and tests. **Zero** calls from `core`/`agents`/`healer`/orchestration. A complete retrieval
  engine sits unused while agents are fed hallucinated file refs.

---

## Cross-Pillar Roadmap (sequenced by real dependency, not by pillar)

The pillars are presented individually below, but they ship in this dependency order because the highest-leverage
moves cut across pillars.

### Phase 0 — Capability Substrate *(keystone; blocks most of Phases 2–4)*
- **P0.1** Extend `CompletionRequest` with `tools`, `tool_choice`, `response_format`; add `tool_calls` to
  `CompletionResponse`. Implement in the OpenAI/Anthropic/Google adapters; LMStudio + any model lacking
  `tool_use` falls back to today's prose-and-parse path (so the squire tier keeps working). — *Agent-Intel R1, Orchestration R1*
- **P0.2** Activate dormant capability tiering: add `profile` blocks to config tiers, make an explicit profile win
  over the legacy name-pin in `makeModelResolver` (keep the pin as fallback + a regression test for the old
  squire→gpt-4.1-mini misroute). — *Agent-Intel R2*
- **P0.3** Hand-seed real `ModelCapabilities` rows (prerequisite for P0.1/P0.2 to behave correctly).

### Phase 1 — Durable & Isolated Substrate *(infra; runs in parallel with Phase 0)*
- **P1.1** Transactional state transitions: replace read-check-write `updateStatus` with a single atomic
  `UPDATE … WHERE status IN (allowedFrom)` + an append-only `state_transitions` log in the same transaction;
  delete the swallowed `try/catch` transition blocks. — *Substrate R2*
- **P1.2** Atomic batch lock acquisition (one `db.transaction()` for all of a job's locks) — cheap, immediate,
  kills the multi-INSERT livelock. — *Substrate R5*
- **P1.3** Process-isolated workers with DB leases + fencing tokens (actually use `spawner.ts`; makes
  cancellation real — it is currently dead code for dispatched jobs). — *Substrate R4*
- **P1.4** Crash-recovery reconciler at `summon` startup (folds the CLAUDE.md SQL-recipe runbook into code). — *Substrate R3*
- **P1.5** **Git-worktree-per-job isolation + 3-way merge-back** — the big infra bet; retires in-place mutation
  and lossy `.bak`. — *Substrate R1*

### Phase 2 — Agentic, Grounded Execution *(needs P0 + P1)*
- **P2.1** Tool-using agentic Knight loop: `read_file` / `apply_edit` (structured `{path,old,new}` → blacksmith
  generates the diff programmatically, killing diff-string brittleness) / `run_command` (sandboxed in the
  worktree) / `finish`. — *Agent-Intel R1*
- **P2.2** Wire the context engine into packet assembly + run-time index lifecycle (auto-index at start and after
  each apply; validate/repair decomposer refs against the symbol index). — *Context R1 + R2*
- **P2.3** Repo-grounded, tool-using planner (decomposition becomes a bounded agent session that reads the repo
  before emitting the task graph via a structured `emit_task_graph` call). — *Orchestration R2*
- **P2.4** Structured outputs for decomposer / judge / healer via P0.1's `response_format`. — *Agent-Intel R6*

### Phase 3 — Adaptive Intelligence *(self-correction & self-grounding)*
- **P3.1** Mutable task graph + automatic replanning of stuck subtrees; relax `validateDependencies` to allow
  cross-subtree edges (same objective) + cycle detection → a **true DAG**. — *Orchestration R3 + R4*
- **P3.2** Per-task **verification contract** (test-execution-as-gate): tasks carry a `{test_command, probe}` block;
  approval requires a passing execution, not an LLM opinion. — *Resilience R2*
- **P3.3** **Agentic, execution-grounded Healer**: reproduce → inspect → patch → re-run the gate → only resolve
  when green; add a `repair` action through the blacksmith+validation pipeline. — *Resilience R1*
- **P3.4** Semantic loop-breaking (replace ≥50% string-overlap with embedding/LLM root-cause similarity; escalate
  the *strategy*, not just the tier). — *Resilience R3*
- **P3.5** Hybrid retrieval: activate the dead `context_embeddings` table; BM25 + vector (RRF) + optional LLM
  rerank. — *Context R3*
- **P3.6** Critical-path-aware scheduler with starvation guard + per-provider concurrency budgets. — *Orchestration R5*

### Phase 4 — Compounding Self-Improvement *(the long-run moat)*
- **P4.1** LLM-discovered + outcome-validated, decaying lessons (move beyond the 5 hardcoded rules; track whether
  injecting a lesson correlated with success). — *Context R5*
- **P4.2** ✅ **CLOSED (Deferral #2, 2026-06-10)** Relevance-ranked semantic lesson injection (retrieve by
  similarity to the task, not `times_seen DESC`). Wired onto the live async assembly path
  (`assembleForJobAsync` → `buildLessonsBlock`) with an embedder built from the `embeddings` config block
  (local llama.cpp / LM Studio or OpenAI). Degrades gracefully to frequency ordering when no embedder is
  configured or the embedder throws. See `DEFERRAL2-RELEVANCE-LESSON-INJECTION-PLAN.md`. — *Context R4*
- **P4.3** Model self-evaluation & auto-tiering harness (`kingdom eval` writes real `ModelCapabilities`/`verified_at`;
  routing becomes evidence-based). — *Agent-Intel R5*
- **P4.4** Model-aware provider routing + per-model health (router currently routes by *provider*, not *model* —
  latently broken for cross-provider models). — *Agent-Intel R4*
- **P4.5** Healer confidence calibration; unified knowledge graph (code symbols + lessons + crypt as one store);
  unify the two divergent retry paths into one `RecoveryPolicy`. — *Resilience R4/R5, Context R6*

---

## Pillar 1 — Orchestration & Task-Graph Core

**State:** Decomposition is a fixed 3-level recursive tree, not a planner. The "King" never decomposes —
objectives are mechanically wrapped in one epic and the Nobility model does the first real decomposition
(`orchestration-loop.ts:170`); King is only a design reviewer (prompt/engine disagree). The planner is **blind**
(`planDecomposition`, `decomposer.ts:156` — decomposes from the objective string, never reads the repo). The DAG
is real but **strictly intra-sibling** — `validateDependencies` (`task-repo.ts:289`) throws on any cross-epic edge.
The scheduler (`dispatchPending`, `dispatcher.ts:219`) is greedy, contention-avoidant, with no critical-path
awareness and **no starvation guard**. The plan is **frozen** — `superseded`/`awaiting-redesign` states exist but
nothing ever replans. Adaptive signal is lossy (retry feedback is English spliced into the description; "stuck" is
≥50% string overlap).

**Top bets:** (1) Native tool-calling + structured output [keystone P0.1]; (2) mutable cross-cutting DAG with
automatic replanning [P3.1]; (3) repo-grounded tool-using planner [P2.3].

**Critical files:** `task-graph/decomposer.ts`, `orchestration-loop.ts`, `job/dispatcher.ts`,
`repositories/task-repo.ts`, `types.ts`.

---

## Pillar 2 — Agent Intelligence, Prompting & Model Abstraction

**State:** Tiering is a fixed 4-rung name-pinned ladder (`tier-manager.ts`); the capability layer
(`resolve-model.ts`, migration 009) is built but **dormant** because config pins names and `makeModelResolver`
suppresses profiles. Prompts are static markdown read verbatim (`packet-assembler.ts:178`), hardwired *down* to
"Qwen 7B class"/"GPT-4o class" — the verbose "output ONLY raw diff, count the hunk lines" blocks exist purely to
coax a 7B model and actively handicap a strong one. **No native tool-use anywhere.** The Knight loop is one-shot:
`executeWorker` does a single `provider.complete()` and parses a diff string — no read/act/verify loop. Provider
routing is priority-ordered failover **by provider, not by model** (latently broken cross-provider).
`verified_at` is never written by any eval loop.

**Top bets:** (1) Native tool-use agentic worker [P2.1] — converts "prompt-and-pray diff generator" into a real
agent and deletes the diff-string backlog; (2) activate the dormant capability tiering [P0.2] — highest
payoff-per-effort, the architecture already exists; (3) prompt-as-code, capability-aware composable prompts [Agent
R3] — coping text auto-disappears on strong models.

**Critical files:** `worker/worker-main.ts`, `job/packet-assembler.ts`, `token-engine/resolve-model.ts`,
`providers/router.ts`, `types.ts`.

---

## Pillar 3 — Context Engine & Knowledge/Memory/Learning

**State:** A genuinely capable retrieval engine (incremental indexer, TS-compiler symbol extraction, FTS5 BM25,
import graph, ranker) that **nothing in the agent loop calls** — used only by the CLI. Context for prompts comes
*exclusively* from `task.context_refs`, which the **decomposer hallucinates** from the objective text (file +
line numbers guessed blind). The `context_embeddings` table exists but is **never written or read**;
`used_embeddings`/`used_rerank` are hardcoded to 0. The learning loop is real but shallow: 5 hardcoded distiller
rules, bulk-injected by tier + `times_seen` under a 4 KB cap, no relevance retrieval, no validation, no decay; the
crypt (success summaries) is never fed back.

**Top bets:** (1) Wire the context engine into the prompt path + keep the index fresh [P2.2] — grounds context at
the source and retroactively fixes path-hallucination; (2) repo-scale context dossiers for frontier models (flip
from token-minimizing to subgraph-assembling) [Context R1 extended + P3.5]; (3) a real self-improving memory loop —
LLM-discovered, outcome-validated, decaying, relevance-retrieved [P4.1 + P4.2].

**Critical files:** `job/packet-assembler.ts`, `context-engine/search/fts.ts`, `context-engine/indexer.ts`,
`scribe/lesson-distiller.ts`, `core/memory/lesson-injector.ts`.

---

## Pillar 4 — Resilience, Self-Healing & Verification

**State:** Failures are classified at the point of detection and routed **count-based** (`retryOrEscalate`,
`dispatcher.ts:1146`). The Judge's strongest gate (`reviewer.ts`) is genuinely good — it reviews the *post-apply*
file with line numbers, hunting dead branches/unwired helpers — but its deepest check (criteria) is a single
ungrounded LLM call; scope/format/security are regex. **The Healer is blind and powerless**: it diagnoses from a
text blob with no ability to read files, run commands, or reproduce, and its four actions are crude DB mutations
that are **never verified to have worked**. Loop detection is lexical (string overlap), so a rephrased same-cause
failure burns the full retry budget. Two divergent retry paths (`RetryManager` vs dispatcher) risk drift.
Execution-grounded verification exists (`validationCommand` + probes + `.bak` rollback) but is **global and binary**
— one build for the whole workspace, static `--help` probes, no test-execution-as-gate.

**Top bets:** (1) Agentic tool-using Healer that proves its fix [P3.3]; (2) execution-grounded per-task
verification contract [P3.2]; (3) semantic loop-breaking [P3.4] — kills the documented test-death-loop and
healer-spinning patterns at the root.

**Critical files:** `job/dispatcher.ts`, `healer/diagnostician.ts`, `healer/action-executor.ts`,
`review/reviewer.ts`, `job/retry-manager.ts`.

---

## Pillar 5 — Execution Substrate, Concurrency & State Integrity *(the "infrastructure-abuse" layer)*

**State:** SQLite is a **status table, not a workflow engine** — `status` is a destructive overwrite, there's no
transition log as source of truth, which is *why* recovery is encoded as CLAUDE.md SQL recipes. State transitions
are enforced in app code, **non-atomically** (read → check → separate UPDATE), and the dispatcher swallows the
resulting races with `try/catch`. Locks are **coarse (whole-file), advisory, and acquired in a non-atomic
multi-INSERT loop** that livelocks. Workspace mutation is **in-place** with a single lossy `.bak` per file
(sequential applies clobber it — the source of "two `export default`" corruption). Workers are **in-process async
promises, not processes** — so `killWorker` is dead code, and one crash takes down the dispatcher, sentinel, and
every worker at once, leaving orphaned locks + half-applied diffs. Crash recovery is **manual**.

**Top bets:** (1) **Git-worktree-per-job isolation + 3-way merge-back** [P1.5] — converts the shared mutable
workspace into per-agent isolation with conflict-free merge; this is what makes "50 parallel frontier agents on one
repo" architecturally possible instead of serialized on hotspot files; (2) durable execution core = transactional
transitions + append-only log + startup reconciler [P1.1 + P1.4]; (3) process-isolated workers with leases +
fencing tokens [P1.3] — removes the single failure domain and makes cancellation real.

**Critical files:** `job/dispatcher.ts`, `blacksmith/diff-applicator.ts`, `locks/file-lock-manager.ts`,
`repositories/task-repo.ts` + `job-repo.ts`, `worker/spawner.ts` + `sentinel/lock-cleanup.ts`.

---

## Consolidated Risk Register

- **Don't break the weak-model path.** Every tool-use / structured-output / agentic change MUST keep the current
  prose-and-parse path as a capability-gated fallback, routed by `ModelCapabilities`. LMStudio/qwen-7b can't do
  reliable tool-calling (CLAUDE.md Pattern 5: 2048-token truncation). The squire tier must keep working.
- **Command execution is a security + cost surface** (agentic worker P2.1, agentic healer P3.3, test-gate P3.2).
  Reuse the reviewer's `DESTRUCTIVE_PATTERNS`/`SECURITY_PATTERNS` as a tool-call allow-list; hard timeouts (the
  existing 30s/20s probe pattern); run with `cwd=workspace`/worktree, **never** the Kingdom repo; bound tool-loop
  iterations and token budgets.
- **Replan loops** (P3.1): enforce a per-objective replan budget (extend the existing spin-loop guard) or a
  confused planner churns the graph forever. Drive the replan trigger from a *structured* failure signal (P3.4),
  not string overlap, or it fires on noise.
- **Cycle introduction** (P3.1): relaxing the tree-only edge constraint removes the cheap acyclicity guarantee — a
  real cycle check is mandatory or dependency-gated dispatch deadlocks silently.
- **Worktree cost on Windows** (P1.5): `node_modules`/build per worktree is expensive; hoist/symlink deps to the
  base, and handle Win11 symlink permissions (junctions or copy-on-write). Run validation in the worktree, and
  re-run `validationCommand`+probes on the integration branch *after* merge to catch cross-job interactions.
- **Replay correctness** (P1.1/P1.4): LLM calls are non-deterministic — persist the model result as a durable step
  output (`result_path` already does) and replay it from disk, never re-invoke, to preserve exactly-once token spend.
- **SQLite write contention** (open backlog #14) worsens with process-per-worker (P1.3) and per-job logging
  (P4.1): each process opens its own WAL connection; batch heartbeats (already throttled 30s); consider a separate
  volatile DB for liveness.
- **Index staleness** (P2.2): if retrieval ships before the freshness guarantee, the engine serves confidently-wrong
  line numbers — gate with a `status.ts` health check that degrades to raw slices + a warning.
- **Re-enabling profile routing** (P0.2) can resurrect the squire→gpt-4.1-mini misroute — require an *explicit*
  profile, keep the name-pin as fallback, cover with a regression test.

---

## What Kingdom Becomes

If executed, the core stops being "an above-average AI-orchestration project tuned to small models" and becomes a
**durable, self-correcting, capability-adaptive build engine**: agents reason with native tools over a grounded
view of the real repo, work in isolated worktrees that merge conflict-free, plans rewrite themselves when execution
proves them wrong, correctness is established by *execution* rather than opinion, failures are healed by an agent
that proves its fix, and the system measurably improves every run via validated memory. Critically, **every one of
those properties improves automatically as the underlying models improve** — which is exactly the bet the project
was founded on.
