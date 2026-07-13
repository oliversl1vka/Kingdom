# Phase 2 — Agentic, Grounded Execution (PLAN)

Built on the Phase 0 capability substrate (`getModelCapabilities`, native `tools`/
`tool_choice`/`response_format`). Every new code path is **gated on capabilities** and
falls back byte-identically to the legacy prose path when the model lacks tool-use /
structured output.

## P2.1 — Tool-using agentic Knight worker loop (`worker/worker-main.ts`)
- When `getModelCapabilities(model)?.tool_use === true`, `executeWorker` runs a **bounded
  agentic loop** instead of one-shot `complete()`.
- Tools exposed: `read_file`, `apply_edit({path,old_string,new_string})`, `run_command`
  (whitelisted + sandboxed to workspace + hard timeout), `finish`.
- `apply_edit` uses a new **programmatic** blacksmith `applyEdit` (literal string
  replacement → write, with `.bak`), eliminating diff-string brittleness.
- Loop bounded by `max_iterations` + a token budget; tool results fed back as messages.
- Non-tool models KEEP the exact current one-shot path (`complete()` → write result).
- Capabilities + workspace + limits passed via a new optional `AgenticOptions` arg
  (defaulted, so all existing callers/tests stay green).
- `run_command` allow-list = explicit read-only inspector prefixes + the configured
  validation_command; deny-list reuses the reviewer's destructive pattern shapes.

## P2.2 — Context engine wired into packet assembly + index lifecycle
- New **context client** module in core (`context/context-client.ts`) — a thin seam that
  lazy-imports `@kingdomos/context-engine` so core keeps compiling and tests stay hermetic.
- `packet-assembler.ts`: before reading raw slices, an optional `contextResolver`
  (a) validates/repairs decomposer `context_refs` against the real symbol index
  (drops hallucinated paths, clamps ranges) and (b) appends high-ranked retrieved chunks.
- Index lifecycle: incremental `indexContextProject` at run start and after each
  successful apply, exposed as a `ContextIndexLifecycle` and hooked in orchestration-loop.ts.
- Freshness/health gate via `getContextStatus`: when the index is stale/missing the
  resolver degrades to raw slices and emits a warning (no in-loop repair).
- Index DB path resolved alongside `kingdom.db` (`defaultContextDbPath`).

## P2.3 — Repo-grounded tool-using planner (`task-graph/decomposer.ts`)
- When the planner model has `tool_use`, decomposition runs a **bounded read-only agent
  session** with tools `list_files`, `read_file`, `grep`, `get_task_graph`, then emits the
  graph via a forced structured `emit_task_graph` call.
- Non-capable models keep today's blind prose + `JSON.parse` path untouched.
- Capabilities + repo-read seam + structured-emit injected via constructor options,
  defaulting to off so existing tests stay green.

## P2.4 — Structured-output decomposer
- When `structured_output` is supported, the final decomposition call uses Phase 0's
  `response_format` json_schema; `parsePlan` remains the fallback.
- Judge/Healer untouched (Phase 3).

## Migrations
- None required (021–024 reserved). The context index lives in its own `context.db`
  managed by the context-engine schema; no orchestration schema change needed.

## Tests (vitest)
- agentic loop: happy-path (apply_edit→finish), iteration cap, fallback when no tool_use.
- `applyEdit` programmatic generation (blacksmith).
- packet-assembler ref validation/repair + retrieved-chunk injection against a seeded index.
- index lifecycle incremental update.
- planner structured emit (mock provider — no network).
</content>
