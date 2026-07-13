# Tasks: KingdomOS — Autonomous Hierarchical Agent Orchestration System

**Input**: Design documents from `/specs/001-kingdomos-orchestration-system/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/cli-commands.md, contracts/internal-interfaces.md, quickstart.md

**Organization**: Tasks grouped by user story (from spec.md P1–P9). Each phase is an independently testable increment.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: Which user story (US1–US9)
- Exact file paths included in all descriptions

## Path Conventions

Monorepo with pnpm workspaces. All source paths relative to repository root:

- `packages/{name}/src/` — package source
- `packages/{name}/package.json` + `tsconfig.json` — per-package config
- `packages/core/migrations/` — SQLite migration files
- `kingdom/agents/` — agent identity templates (runtime, created by `kingdom init`)
- `tests/` — integration and cross-package tests

---

## Phase 1: Setup (Project Initialization)

**Purpose**: Scaffold the pnpm monorepo, configure TypeScript build system, establish shared tooling.

- [X] T001 Create monorepo root files: package.json (name: `@kingdomos/root`, private: true, scripts: build/test/lint), pnpm-workspace.yaml (packages: `packages/*`), and tsconfig.json (composite root with project references to all 10 packages) per plan.md Project Structure
- [X] T002 Scaffold all 10 package directories (core, cli, ui, token-engine, providers, agents, sentinel, healer, blacksmith, scribe) with package.json (name: `@kingdomos/{name}`, type: module, main: dist/index.js, types: dist/index.d.ts) and tsconfig.json (extends: ../../tsconfig.base.json, composite: true) in packages/
- [X] T003 [P] Create tsconfig.base.json at root with shared compiler options: target ES2022, module Node16, moduleResolution Node16, strict true, esModuleInterop true, declaration true, declarationMap true, sourceMap true, outDir dist per research.md R-007
- [X] T004 [P] Configure Vitest at root level: create vitest.config.ts with workspace support, add vitest and @vitest/coverage-v8 as root devDependencies in package.json
- [X] T005 [P] Create .gitignore with node_modules/, dist/, *.db, kingdom/.credentials.enc, .env; create .npmrc with shamefully-hoist=false

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure that MUST be complete before ANY user story. Establishes SQLite schema, shared types, configuration system, and CLI skeleton.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [X] T006 Create SQLite schema migration 001_initial.sql in packages/core/migrations/ with all tables from data-model.md: projects, objectives, task_graph_nodes, jobs, heartbeats, incidents, review_decisions, file_locks, model_configs, provider_health, agent_configs, crypt_entries, schema_version — including all indexes defined in data-model.md Indexes section
- [X] T007 Implement database connection module in packages/core/src/db.ts: open better-sqlite3 connection with WAL mode enabled, apply migrations from packages/core/migrations/ in order, track schema version, export singleton database instance
- [X] T008 [P] Define all shared TypeScript types and interfaces in packages/core/src/types.ts: export types for Project, Objective, TaskGraphNode, Job, Heartbeat, IncidentReport, ReviewDecision, FileLock, ModelConfig, ProviderHealth, AgentConfig, CryptEntry per data-model.md entity definitions — include all status enums and lifecycle types (TaskStatus, JobStatus, Severity, FailureType, etc.)
- [X] T009 [P] Implement ULID generation utility in packages/core/src/ulid.ts: export generateUlid() function using a lightweight ULID library (ulid or ulidx) — all entity IDs use ULID format per data-model.md
- [X] T010 Implement configuration system in packages/core/src/config.ts: load/save kingdom.config.json (project root), define ConfigSchema type with sections for providers, tiers, retention, token-engine settings, export getConfig/setConfig/resetConfig functions
- [X] T011 Scaffold CLI entry point in packages/cli/src/index.ts: create Commander.js v14 program with @commander-js/extra-typings, register global options (--help, --version, --no-color, --config) per contracts/cli-commands.md Global Options, export bin entry as `kingdom`
- [X] T012 Implement `kingdom init` command in packages/cli/src/commands/init.ts: accept optional project-name positional, --force option, create kingdom.config.json and kingdom/ directory structure (agents/, memory/, memory/shared/), initialize SQLite database at kingdom/kingdom.db, output "Kingdom '{name}' established at {path}" per contracts/cli-commands.md §1
- [X] T013 [P] Create default agent identity markdown templates in packages/agents/templates/: create king.md, nobility.md, knight.md, squire.md, healer.md, judge.md, sentinel.md, scribe.md, blacksmith.md — each containing sections per data-model.md AgentIdentity (Tier, Model Class, Role, Goals, Allowed Tools, Forbidden Behaviors, Output Format, Escalation Rules, Token Limits) with medieval-themed descriptions per FR-034
- [X] T014 [P] Implement ProviderError class in packages/providers/src/errors.ts: export ProviderError extending Error with properties { provider_id: string, status_code: number, retryable: boolean, message: string } per internal-interfaces.md §2 Contract Rules
- [X] T086 [P] Apply medieval theming to all CLI output messages in packages/cli/src/theme.ts: create themed output functions for success ("The decree hath been issued"), error ("A plague upon the kingdom!"), warning ("The scribe counsels caution"), info messages — used by all CLI commands per FR-034
- [X] T087 [P] Add medieval-themed error messages throughout packages/core/src/errors.ts: create custom error classes (KingdomError, BudgetOverflowError, LockConflictError, StalledWorkerError, HeresyDetectedError) with themed messages per FR-034

**Checkpoint**: Foundation ready — monorepo builds, database initializes, CLI skeleton works, `kingdom init` creates a project. Medieval theming infrastructure available for all subsequent CLI commands.

### Phase 2 Tests

- [X] T090 [P] Implement SQLite migration and schema tests in tests/foundational/migration.test.ts: verify 001_initial.sql creates all expected tables (projects, objectives, task_graph_nodes, jobs, heartbeats, incidents, review_decisions, file_locks, model_configs, provider_health, agent_configs, crypt_entries), verify schema_version tracking, verify WAL mode enabled, verify all indexes exist per data-model.md Indexes section — Constitution Testing Standards: "migration tests"
- [X] T091 [P] Implement CLI contract tests for `kingdom init` in tests/foundational/cli-init.test.ts: verify `kingdom init` creates expected directory structure, verify exit 0 message format matches cli-commands.md §1, verify --force flag behavior, verify exit 1 on existing config without --force — Constitution Testing Standards: "CLI contract input/output schema verification"

---

## Phase 3: User Story 1 — Token Budget Engine (Priority: P1) 🎯 MVP

**Goal**: Accurately estimate whether a prompt fits within a model's context window before sending it, with detailed budget breakdown and fit/no-fit verdict.

**Independent Test**: Feed known prompts to the budget engine, verify token counts against hand-calculated expected values. Usable as a standalone CLI tool.

### Implementation for User Story 1

- [X] T015 [P] [US1] Implement tiktoken wrapper in packages/token-engine/src/tiktoken-counter.ts: import tiktoken WASM, support all OpenAI encodings (o200k_base for GPT-4o, cl100k_base for GPT-4/3.5), export countTokens(text: string, encoding: string): number, call enc.free() after use per research.md R-001
- [X] T016 [P] [US1] Implement HuggingFace tokenizer wrapper in packages/token-engine/src/hf-counter.ts: load @huggingface/tokenizers with bundled local tokenizer.json for Qwen2.5-Coder-7B-Instruct, export countTokens(text: string): number per research.md R-002 — tokenizer.json file stored at packages/token-engine/data/qwen2.5-coder-tokenizer.json
- [X] T017 [P] [US1] Implement character estimation fallback in packages/token-engine/src/char-counter.ts: export countTokens(text: string): number using chars ÷ 4 formula as universal fallback per internal-interfaces.md §1 Contract Rules
- [X] T018 [US1] Implement model registry in packages/token-engine/src/model-registry.ts: load ModelConfig records from SQLite, map model_id to tokenizer type and config, export getModelConfig(model_id: string): ModelConfig, expose safe_input_budget calculation (context_window - output_reservation - safety_margin) per data-model.md ModelConfig entity
- [X] T019 [US1] Implement TokenBudgetCheck service in packages/token-engine/src/budget-checker.ts: accept TokenBudgetCheckRequest, route to correct tokenizer by model_id, count each ContextSegment, apply configurable safety margin from ModelConfig.safety_margin_percent (default 12%), return TokenBudgetCheckResult with per-segment breakdown, trimmed_segments, and approved/rejected verdict — full contract per internal-interfaces.md §1
- [X] T020 [US1] Implement `kingdom treasury status` subcommand in packages/cli/src/commands/treasury.ts: register treasury command with status/history/set-limit subcommands per contracts/cli-commands.md §6, query token consumption from jobs table (sum of tokens_used), display budget report with --json option
- [X] T021 [US1] Seed default model configurations in packages/core/migrations/002_seed_models.sql: insert ModelConfig rows for gpt-4o (o200k_base, 128K window), gpt-4o-mini (o200k_base, 128K window), qwen2.5-coder-7b (huggingface, 32K window) with correct safe_input_budget, output_reservation, and safety_margin_percent values per research.md R-001/R-002

**Checkpoint**: Token budget engine returns accurate counts for OpenAI and Qwen models. `kingdom treasury` shows budget status. FR-002, FR-003, FR-004, FR-005 satisfied.

### Phase 3 Tests

- [X] T092 [P] Implement tiktoken fixture-based tests in tests/token-engine/tiktoken.test.ts: create fixture set of known prompts with hand-verified token counts for o200k_base (GPT-4o) and cl100k_base (GPT-4/3.5), verify countTokens() matches expected values within ±1 token, test edge cases (empty string, Unicode, code snippets, markdown) — Constitution Testing Standards: "Known tokenizer outputs for each supported model"
- [X] T093 [P] Implement HuggingFace tokenizer fixture tests in tests/token-engine/hf-tokenizer.test.ts: create fixture set with known token counts for Qwen2.5-Coder-7B-Instruct, verify countTokens() accuracy, test code-heavy prompts (TypeScript, Python, SQL) and mixed-language inputs — Constitution Testing Standards: "Known tokenizer outputs for each supported model"
- [X] T094 [P] Implement character estimation fallback tests in tests/token-engine/char-counter.test.ts: verify chars÷4 formula, verify overestimation relative to exact tokenizer counts across representative prompts
- [X] T095 Implement budget checker integration tests in tests/token-engine/budget-checker.test.ts: test TokenBudgetCheckRequest/Result contract with multi-segment prompts, verify safety margin application from ModelConfig.safety_margin_percent, verify trimming of low-priority segments, verify approved/rejected verdicts with headroom calculations, test edge case of exactly-at-budget prompts — Constitution Testing Standards: "100% branch coverage for deterministic subsystems"
- [X] T096 Implement `kingdom treasury` CLI contract tests in tests/token-engine/cli-treasury.test.ts: verify status/history/set-limit subcommands produce correct output format per cli-commands.md §6, verify --json output matches schema, verify exit codes — Constitution Testing Standards: "CLI contract input/output schema verification"

---

## Phase 4: User Story 2 — Hierarchical Task Decomposition & Management (Priority: P2)

**Goal**: Decompose user objectives into a multi-level task graph (objective → epic → task → subtask → job) with tier assignments, acceptance criteria, and token budgets at every level.

**Independent Test**: Create an objective, trigger decomposition, verify correct parent-child relationships, tier assignments, and budget estimates in the task graph.

### Implementation for User Story 2

- [X] T022 [P] [US2] Implement Project repository in packages/core/src/repositories/project-repo.ts: CRUD operations for the projects table — create (validate repository_path exists, enforce unique name), getById, getAll, update, deactivate — using better-sqlite3 prepared statements per data-model.md Project entity
- [X] T023 [P] [US2] Implement Objective repository in packages/core/src/repositories/objective-repo.ts: CRUD operations for objectives table — create (validate project_id FK, require acceptance_criteria), getById, getByProject, updateStatus with lifecycle validation (draft → planning → active → completed|failed|cancelled) per data-model.md Objective entity
- [X] T024 [US2] Implement TaskGraphNode repository in packages/core/src/repositories/task-repo.ts: CRUD for task_graph_nodes table — create with hierarchy validation (parent_id must reference higher level), getById, getChildren, getByObjective, getByStatus, updateStatus with full lifecycle state machine per data-model.md TaskGraphNode entity, tree traversal via recursive CTE query
- [X] T025 [US2] Implement agent identity file parser in packages/agents/src/identity-parser.ts: parse agent markdown files (Tier, Model Class, Role, Goals, Allowed Tools, Forbidden Behaviors, Output Format, Escalation Rules, Token Limits sections), validate all required sections present, export parseIdentity(filePath: string): AgentIdentity per data-model.md AgentIdentity entity
- [X] T026 [US2] Implement agent tier assignment logic in packages/agents/src/tier-manager.ts: enforce data-model.md validation rules (epic → nobility, task → knight, subtask/job → squire), select reviewer_tier (equal or one above assigned_tier), map AgentConfig from SQLite to identity files per data-model.md AgentConfig
- [X] T027 [US2] Implement task graph decomposition engine in packages/core/src/task-graph/decomposer.ts: accept an Objective, produce a multi-level TaskGraphNode tree by invoking the King model (via provider adapter) to plan epics, then Nobility to break epics into tasks, then Knights into job-ready subtasks — each node gets acceptance_criteria, token_budget_estimate, assigned_tier per FR-006
- [X] T028 [US2] Implement job packet assembler in packages/core/src/job/packet-assembler.ts: given a TaskGraphNode at job level, assemble a JobPacket (internal-interfaces.md §3) with agent_identity_path, pre-assembled messages from context_refs, allowed_files, output_format, acceptance_criteria, max_tokens from budget check — verify packet fits within target model budget using token-engine
- [X] T029 [US2] Implement `kingdom decree` command in packages/cli/src/commands/decree.ts: accept required objective positional, --priority (1-10), --dry-run, --criteria file options, create Objective in DB, trigger decomposition, output JSON { objective_id, task_count, estimated_tokens } per contracts/cli-commands.md §2
- [X] T030 [US2] Implement `kingdom status` command in packages/cli/src/commands/status.ts: query projects, jobs, and provider_health tables, display table with kingdom info, sentinel status, worker counts, job statistics, token budget summary — support --json, --watch, --jobs, --agents options per contracts/cli-commands.md §5
- [X] T031 [US2] Implement `kingdom inspect` command in packages/cli/src/commands/inspect.ts: accept required task-id positional, query task_graph_nodes + jobs + heartbeats + review_decisions for that task, display detail report — support --json and --full options per contracts/cli-commands.md §10
- [X] T032 [US2] Implement `kingdom dry-run` command in packages/cli/src/commands/dry-run.ts: accept required objective positional, simulate decomposition by calling the decomposer with a dry-run flag that logs without persisting, display simulated task tree with token estimates per contracts/cli-commands.md §11

**Checkpoint**: User can `kingdom decree` an objective, see it decomposed into a task graph, query with `kingdom status` and `kingdom inspect`. FR-006, FR-007, FR-008, FR-031, FR-033 satisfied.

---

## Phase 5: User Story 3 — Local Model Execution with Job Lifecycle (Priority: P3)

**Goal**: Execute coding jobs on the local Qwen model via LM Studio, managing the full lifecycle with heartbeats, timeouts, and unified diff output collection.

**Independent Test**: Submit a coding job to LM Studio, verify heartbeat emission, collect unified diff, confirm lifecycle state transitions.

### Implementation for User Story 3

- [X] T033 [P] [US3] Define ProviderAdapter interface and types in packages/providers/src/types.ts: export ProviderAdapter, CompletionRequest, CompletionResponse, ProviderHealthStatus, Message interfaces exactly per internal-interfaces.md §2
- [X] T034 [US3] Implement LM Studio provider adapter in packages/providers/src/lmstudio-adapter.ts: implement ProviderAdapter using OpenAI-compatible /v1/chat/completions endpoint, 120s timeout, normalize response to CompletionResponse, health check via /v1/models, wrap errors in ProviderError per internal-interfaces.md §2 and research.md R-010
- [X] T035 [US3] Implement Job repository in packages/core/src/repositories/job-repo.ts: CRUD for jobs table — create (require task_id, model, token_estimate, delegating_supervisor_id), getById, getByTask, getByStatus, updateStatus with lifecycle validation, set cancel_requested per data-model.md Job entity
- [X] T036 [US3] Implement heartbeat writer in packages/core/src/worker/heartbeat-writer.ts: export startHeartbeat(job_id, worker_id) that inserts into heartbeats table every 10 seconds via setInterval, updates jobs.heartbeat_at, reports status/progress/tokens_generated per internal-interfaces.md §4 Write Contract and data-model.md Heartbeat entity
- [X] T037 [US3] Implement worker main loop in packages/core/src/worker/worker-main.ts: read JobPacket from temp file (path via CLI arg), perform token budget preflight check, call provider adapter, emit heartbeats during execution, write unified diff result to result_path, update job status, on completion or failure invoke memory manager to persist agent learnings (error patterns, codebase insights) to agent memory files — handle timeout and cancel_requested flag per internal-interfaces.md §3 and §4 and FR-026
- [X] T038 [US3] Implement job lifecycle state machine in packages/core/src/job/lifecycle.ts: enforce all valid transitions per data-model.md TaskGraphNode Status Lifecycle (queued → preparing-context → awaiting-budget-check → running → completed|failed-*|stalled|cancel-requested), reject invalid transitions, emit status change events
- [X] T039 [US3] Implement worker process spawner in packages/core/src/worker/spawner.ts: use child_process.spawn() with detached: false for managed workers, pass job packet temp file path as argument, track PIDs for hard-kill capability, support 'start' command for visible Windows terminals per research.md R-010
- [X] T040 [US3] Implement job queue dispatcher in packages/core/src/job/dispatcher.ts: poll queued jobs from SQLite, check concurrent worker limit, perform token budget preflight, assemble job packet, spawn worker — integrate with file lock system (acquire locks for job's allowed_files before dispatch)
- [X] T041 [US3] Implement `kingdom summon` command in packages/cli/src/commands/summon.ts: --workers (default: CPU cores), --no-ui, --verbose options, start Sentinel process, initialize dispatcher, output "Kingdom awakened. Sentinel watching. {n} workers standing by." per contracts/cli-commands.md §3

**Checkpoint**: Jobs execute on LM Studio, produce unified diffs, heartbeats flow, lifecycle transitions work. FR-009, FR-010, FR-032 satisfied. Combined with US1+US2, this is a working autonomous coding pipeline.

### Phase 5 Tests

- [X] T097 Implement job lifecycle integration tests in tests/integration/job-lifecycle.test.ts: test full cycle from job creation → preparing-context → budget-check → running (with mock LM Studio) → completed, verify all state transitions persisted in SQLite, verify heartbeat records written, verify result artifact saved with diff content + metadata — Constitution Testing Standards: "Full lifecycle: creation → execution → review → completion"
- [X] T098 [P] Implement lifecycle state machine unit tests in tests/integration/lifecycle-states.test.ts: verify all valid transitions per data-model.md status lifecycle, verify invalid transitions are rejected (e.g., queued → completed, cancelled → running), test every failure type transition (failed-token-overflow, failed-timeout, failed-runtime-crash, failed-invalid-output, failed-review) — Constitution Testing Standards: "100% branch coverage for deterministic subsystems"

---

## Phase 6: User Story 4 — Review, Rejection & Healing (Priority: P4)

**Goal**: Review every completed job against acceptance criteria; retry with feedback on rejection; escalate to Healer when retries exhausted.

**Independent Test**: Submit a known-bad diff → verify rejection with feedback → submit corrected diff → verify acceptance. Exhaust retries → verify incident report generation and healer diagnosis.

### Implementation for User Story 4

- [X] T042 [P] [US4] Implement unified diff parser using jsdiff in packages/blacksmith/src/diff-parser.ts: export parseDiff(diffText: string): ParsedPatch[] using jsdiff.parsePatch(), validate diff structure, extract file paths and hunks per internal-interfaces.md §6 and research.md R-005
- [X] T043 [P] [US4] Implement diff applicator using jsdiff in packages/blacksmith/src/diff-applicator.ts: export applyDiff(diffText: string, baseDir: string): ApplyResult using jsdiff.applyPatch(), support fuzzFactor and autoConvertLineEndings, return success/failure with details per internal-interfaces.md §6
- [X] T044 [US4] Implement review engine in packages/core/src/review/reviewer.ts: accept completed Job + its diff output, perform four checks: scope_check (only allowed_files modified), format_check (valid unified diff via blacksmith parser), security_check (scan diff for credential patterns, destructive commands, suspicious imports, and malevolent code patterns — reject with 'security-violation' reason if detected per Constitution Principle V), criteria_check (acceptance criteria — invoke reviewer model), produce ReviewDecision per data-model.md ReviewDecision entity — reject with specific reasons per FR-014, FR-015
- [X] T045 [US4] Implement ReviewDecision repository in packages/core/src/repositories/review-repo.ts: insert/query review_decisions table, link to job_id, store decision + rejection_reasons + check results per data-model.md ReviewDecision
- [X] T046 [US4] Implement retry manager in packages/core/src/job/retry-manager.ts: on ReviewDecision rejection, increment task retry_count, check against max_retries (default: 3), append feedback to retry prompt, re-queue job — if retries exhausted, transition to awaiting-healer and trigger incident report per FR-016, FR-017
- [X] T047 [US4] Implement incident report generator in packages/healer/src/incident-reporter.ts: create IncidentSubmission (internal-interfaces.md §5) from failed task — collect failure_history from all retry attempts, serialize symptoms, write to incidents table per data-model.md IncidentReport entity
- [X] T048 [US4] Implement Healer diagnosis engine in packages/healer/src/diagnostician.ts: read IncidentSubmission, invoke Healer model to analyze root cause, produce HealerDiagnosis with probable_cause, confidence (0.0-1.0), and recommendation (retry|decompose|reassign|escalate) — if confidence < 0.5, force escalate per internal-interfaces.md §5
- [X] T049 [US4] Implement healing action executor in packages/healer/src/action-executor.ts: receive HealerRecommendation, execute the recommended action — 'retry' modifies prompt, 'decompose' creates new TaskGraphNode children, 'reassign' changes assigned_tier, 'escalate' notifies higher tier — update task status accordingly per FR-018
- [X] T050 [US4] Implement `kingdom heal` command in packages/cli/src/commands/heal.ts: accept required task-id, --strategy option (retry|decompose|reassign, default: auto), trigger healer on specified failed task, output JSON { incident_id, action, new_tasks[] } per contracts/cli-commands.md §8

**Checkpoint**: Completed jobs are reviewed before application. Bad diffs rejected with feedback. Healer diagnoses root causes. FR-014, FR-015, FR-016, FR-017, FR-018 satisfied. Full plan → execute → review → heal cycle operational.

### Phase 6 Tests

- [X] T099 Implement review engine security tests in tests/security/malevolent-edit.test.ts: submit diffs containing credential patterns (API keys, tokens, passwords in plaintext), destructive shell commands (rm -rf, DROP TABLE, format), suspicious imports (child_process.exec with user input, eval()), backdoor patterns — verify security_check returns 'fail' and ReviewDecision rejects with 'security-violation' reason for each case — Constitution Testing Standards: "Security boundary enforcement" and Constitution Principle V: "Dangerous or malevolent edits MUST be caught and rejected"
- [X] T100 [P] Implement review scope and format tests in tests/security/review-scope.test.ts: submit diffs modifying files outside allowed_files → verify scope_check fail; submit invalid diff format → verify format_check fail; submit valid scoped diff → verify all checks pass — Constitution Principle V: "No unrelated file changes"
- [X] T101 Implement retry and healer escalation integration tests in tests/integration/retry-healing.test.ts: verify retry manager increments retry_count, appends feedback, re-queues; verify retry_count exhaustion triggers incident report creation; verify healer diagnosis flow produces valid HealerRecommendation — Constitution Testing Standards: "Full lifecycle integration"

---

## Phase 7: User Story 5 — Cancellation & Concurrent Worker Safety (Priority: P5)

**Goal**: Safely cancel running jobs (soft → hard), prevent concurrent file conflicts via locking, handle multiple parallel workers without race conditions.

**Independent Test**: Start a long job, cancel it, verify soft-then-hard flow. Attempt concurrent edits to same file, verify deterministic wait.

### Implementation for User Story 5

- [X] T051 [P] [US5] Implement file lock manager in packages/core/src/locks/file-lock-manager.ts: acquire exclusive locks per file_path in file_locks table (SQLite PK uniqueness enforces exclusivity), release by owning_supervisor_id only after review, check max_duration_seconds for force-release eligibility per data-model.md FileLock entity — FR-019, FR-020
- [X] T052 [US5] Implement soft-then-hard cancellation flow in packages/core/src/job/cancellation.ts: set cancel_requested flag in jobs table (only if caller is delegating_supervisor_id or higher tier per FR-013), wait configurable grace period, if job still running perform hard kill via process.kill(pid), save partial output — per FR-012
- [X] T053 [US5] Implement Sentinel heartbeat monitor in packages/sentinel/src/heartbeat-monitor.ts: poll SQLite every 5 seconds for stale jobs (no heartbeat in 30 seconds per internal-interfaces.md §4 Read Contract — 3 missed 10s heartbeats), mark stale jobs as 'stalled', create IncidentReport, notify supervising agent per FR-011
- [X] T054 [US5] Implement stale lock detection and cleanup in packages/sentinel/src/lock-cleanup.ts: scan file_locks for entries where locked_at + max_duration_seconds < NOW() AND owning job's heartbeat is stale, report to supervisor for force-release confirmation per data-model.md FileLock Validation Rules
- [X] T055 [US5] Implement Sentinel main loop in packages/sentinel/src/index.ts: combine heartbeat monitor + lock cleanup + provider health checks into a single polling loop with configurable intervals, export startSentinel() and stopSentinel() lifecycle functions
- [X] T056 [US5] Implement `kingdom cancel` command in packages/cli/src/commands/cancel.ts: accept required task-id, --force and --reason options, cascade cancel to all descendant tasks in task graph, set cancel_requested on active jobs, output "Cancellation requested for task {id} and {n} descendants." per contracts/cli-commands.md §9
- [X] T057 [US5] Implement `kingdom farewell` command in packages/cli/src/commands/farewell.ts: --force and --timeout options, set cancel_requested on all active jobs, wait for graceful completion or timeout, stop Sentinel, output "Kingdom rests. All agents dismissed." per contracts/cli-commands.md §4
- [X] T058 [US5] Implement `kingdom sentinel` command in packages/cli/src/commands/sentinel.ts: status/restart/logs subcommands, --json and --lines options, query Sentinel health metrics and tail log output per contracts/cli-commands.md §13

**Checkpoint**: Cancellation flows correctly (soft → hard). File locks prevent conflicts. Sentinel detects stalls. FR-011, FR-012, FR-013, FR-019, FR-020, FR-032 satisfied. System is safe for unattended multi-worker operation.

### Phase 7 Tests

- [X] T102 Implement cancellation simulation tests in tests/sentinel/cancellation.test.ts: simulate soft cancel → verify grace period → simulate unresponsive worker → verify hard kill via process.kill, verify partial output saved, verify cancel_requested flag propagation, verify cascading cancel to descendant tasks — Constitution Testing Standards: "Timeout simulation verifying soft-then-hard cancellation flow"
- [X] T103 Implement SQLite concurrent access tests in tests/sentinel/concurrency.test.ts: spawn multiple worker processes writing heartbeats simultaneously, verify WAL mode handles concurrent writes without SQLITE_BUSY errors, verify file lock acquisition under contention (two workers requesting same file), verify deterministic wait ordering per FR-020 — Constitution Testing Standards: "Concurrent access tests, lock contention tests"
- [X] T104 [P] Implement Sentinel heartbeat stale detection tests in tests/sentinel/heartbeat-stale.test.ts: insert job with heartbeat older than 30 seconds, verify Sentinel poll detects it as stalled, verify IncidentReport created, verify stale lock cleanup triggers for locks held by stalled workers — validates SC-009 (30-second detection)

---

## Phase 8: User Story 6 — Multi-Provider Model Routing (Priority: P6)

**Goal**: Configure model providers per agent tier with automatic fallback routing when a provider is unavailable or rate-limited.

**Independent Test**: Configure two providers, disable primary, verify automatic fallback with correct tokenizer. Verify cooldown and recovery.

### Implementation for User Story 6

- [X] T059 [P] [US6] Implement OpenAI provider adapter in packages/providers/src/openai-adapter.ts: implement ProviderAdapter for OpenAI API, 30s timeout, handle rate-limit headers (x-ratelimit-remaining), set cooldown_until in provider_health on 429, normalize to CompletionResponse per internal-interfaces.md §2
- [X] T060 [P] [US6] Implement Anthropic provider adapter in packages/providers/src/anthropic-adapter.ts: implement ProviderAdapter for Anthropic Messages API, 30s timeout, handle rate-limit responses, normalize to CompletionResponse per internal-interfaces.md §2
- [X] T061 [P] [US6] Implement Google provider adapter in packages/providers/src/google-adapter.ts: implement ProviderAdapter for Google Generative AI API, 30s timeout, handle rate-limit responses, normalize to CompletionResponse per internal-interfaces.md §2
- [X] T062 [US6] Implement AES-256-GCM credential encryption in packages/core/src/security/credential-store.ts: derive key from user password via PBKDF2 (100K iterations, SHA-256), encrypt with random IV + salt, store as EncryptedCredential JSON in kingdom/.credentials.enc — never log credentials, decrypt in-memory only for API call duration per internal-interfaces.md §7 and research.md R-008
- [X] T063 [US6] Implement provider health tracker in packages/providers/src/health-tracker.ts: read/write provider_health table — track status, last_error, cooldown_until, requests_today, rate_limit_remaining, update on every provider call per data-model.md ProviderHealth entity
- [X] T064 [US6] Implement provider router with fallback in packages/providers/src/router.ts: given a tier, look up configured providers ordered by priority_order, skip providers where status is 'unavailable' or 'cooldown' (cooldown_until > now), route to first healthy provider, apply correct tokenizer profile for budget check — fallback through entire list before entering wait state per FR-022
- [X] T065 [US6] Implement `kingdom configure` command in packages/cli/src/commands/configure.ts: accept optional key/value positionals, --list, --reset, --json options, support interactive wizard (no args), set/get config values, handle provider API key encryption flow per contracts/cli-commands.md §12
- [X] T066 [US6] Seed additional provider configurations in packages/core/migrations/003_seed_providers.sql: insert ProviderHealth rows for openai, anthropic, google, lmstudio with default endpoints, priority_order, and status='unavailable' (until configured)

**Checkpoint**: Multiple providers configured per tier. Automatic fallback on rate-limit or outage. Credentials encrypted. FR-021, FR-022, FR-030 satisfied. System can rotate across free-tier providers for 24/7 operation.

### Phase 8 Tests

- [X] T105 Implement credential encryption security tests in tests/security/credentials.test.ts: verify AES-256-GCM encrypt/decrypt roundtrip, verify unique IV and salt per credential, verify credentials never appear in log output (mock logger and scan for key patterns), verify credentials never written to SQLite, verify decrypted keys held in memory only during API call scope, verify .credentials.enc file format matches EncryptedCredential schema — Constitution Testing Standards: "Credential handling and data isolation"
- [X] T106 [P] Implement provider fallback integration tests in tests/integration/provider-fallback.test.ts: configure two providers, simulate primary returning 429 rate-limit, verify router falls back to secondary with correct tokenizer applied, verify cooldown_until set on primary, verify recovery after cooldown expires — validates SC-004 free-tier compliance

---

## Phase 9: User Story 7 — Observability, Logging & the Crypt (Priority: P7)

**Goal**: Full audit logging of every action, time-limited retention with Crypt archival, agent memory persistence, and dry-run mode.

**Independent Test**: Run a task lifecycle, verify all log entries present. Advance past retention, confirm logs purged and Crypt entries persist. Execute dry-run, confirm zero model calls and zero state mutations.

### Implementation for User Story 7

- [X] T067 [P] [US7] Implement structured event logger in packages/scribe/src/logger.ts: log every model invocation, task transition, review decision, cancellation, retry, and incident with { timestamp, agent_id, event_type, job_id, task_id, details } — support console output and SQLite persistence per FR-023
- [X] T068 [P] [US7] Implement Crypt entry writer in packages/scribe/src/crypt-writer.ts: accept completed/failed task, write CryptEntry to crypt_entries table (task_id, title, summary, success, completed_at) — entries are permanent and never deleted per data-model.md CryptEntry entity and FR-024
- [X] T069 [US7] Implement log retention and cleanup scheduler in packages/scribe/src/retention.ts: configurable retention period (default: 7 days), purge detailed log records older than threshold, ensure Crypt entry exists before purging, run as periodic task within Sentinel loop per FR-024
- [X] T070 [US7] Implement agent memory file manager in packages/agents/src/memory-manager.ts: read/write/append to markdown files in kingdom/memory/{agent-name}/ and kingdom/memory/shared/, track last-modified timestamp for freshness, ensure Obsidian-compatible format per data-model.md AgentMemoryFile and FR-026
- [X] T070B [US7] Integrate memory-write hooks into worker lifecycle in packages/core/src/worker/memory-hooks.ts: on job completion, extract learnings (error patterns resolved, codebase insights, successful strategies) and append to the executing agent's memory file via memory manager; on review rejection, record the rejection reason and feedback; on healer diagnosis, record the root cause and recommendation — ensures agents learn from every interaction per FR-026 and spec.md US7 acceptance scenario 4
- [X] T071 [US7] Implement dry-run mode wrapper in packages/core/src/dry-run.ts: export withDryRun(fn) that wraps operations — in dry-run mode, log all planned actions but skip model API calls and database writes, roll back any SQLite transactions — integrate with decomposer, dispatcher, and review engine per FR-025
- [X] T072 [US7] Implement `kingdom crypt` command in packages/cli/src/commands/crypt.ts: accept optional query search term, --last N, --failures, --json options, query crypt_entries table, display matching entries per contracts/cli-commands.md §7

**Checkpoint**: Every agent action logged and auditable. Crypt preserves permanent history. Agent memory persists across sessions. Dry-run mode safe to validate. FR-023, FR-024, FR-025, FR-026 satisfied.

### Phase 9 Tests

- [X] T107 Implement dry-run mode validation tests in tests/integration/dry-run.test.ts: execute full decomposition + dispatch workflow in dry-run mode, verify zero model API calls made (mock provider, assert zero invocations), verify zero database writes persisted (snapshot DB before and after, assert equality), verify log output shows simulated actions — Constitution Testing Standards: "Full lifecycle integration" and FR-025
- [X] T108 [P] Implement Crypt retention tests in tests/integration/crypt-retention.test.ts: create completed tasks, run retention cleanup with a 0-day period, verify detailed logs purged, verify CryptEntry written with correct task_id/title/summary/success before purge, verify CryptEntry is never deleted on subsequent cleanups — validates FR-024

---

## Phase 10: User Story 8 — Medieval Pixel UI (Priority: P8)

**Goal**: A medieval-themed pixel-art web UI served locally, showing agent activity, task queues, token budgets, and configuration — all via React 19 + Canvas 2D.

**Independent Test**: Launch `kingdom summon`, navigate to local URL, create a project, see animated agents, verify configuration changes persist.

### Implementation for User Story 8

- [X] T073 [P] [US8] Scaffold React 19 + Vite project in packages/ui/: create vite.config.ts (React plugin, build output to dist/), index.html entry, src/main.tsx root mount, tailored tsconfig.json for JSX — per plan.md and research.md R-006
- [X] T074 [P] [US8] Create pixel art sprite sheet and asset constants in packages/ui/src/assets/: define sprite metadata (character names, frame counts, pixel dimensions), placeholder sprites for all agent types (King, Knight, Squire, Healer, Judge, Scribe, Sentinel), UI elements (scroll board, health bars, castle) — asset types: king-throne, knight-war-table, squire-workbench per spec.md US8
- [X] T075 [US8] Implement Canvas 2D rendering engine in packages/ui/src/engine/renderer.ts: create game loop with requestAnimationFrame, canvas reference with imageSmoothingEnabled=false and image-rendering: pixelated, drawImage for sprite sheets, sprite animation (8-16 frames), fillRect for UI widgets per research.md R-006
- [X] T076 [US8] Implement agent character visualization scene in packages/ui/src/scenes/agents.ts: render animated medieval characters reflecting current agent state (idle, working, reviewing, stalled), position agents by tier (King on throne at top, Knights at war table, Squires at workbenches) per spec.md US8 acceptance scenarios
- [X] T077 [US8] Implement task queue scroll board scene in packages/ui/src/scenes/task-board.ts: render task queue as a medieval scroll board showing task titles, statuses, assigned agents — update in real-time via SSE data per spec.md US8
- [X] T078 [US8] Implement token budget health bar component in packages/ui/src/scenes/treasury.ts: display token budgets as health bars (used vs remaining) per active job, color-code by budget utilization (green/yellow/red) per spec.md US8 acceptance scenario 3
- [X] T079 [US8] Implement kingdom management UI in packages/ui/src/scenes/kingdom.ts: project creation form, objective assignment, model configuration per tier, retention period settings, Crypt of Kings viewer — all changes persisted via API calls to backend per FR-028
- [X] T080 [US8] Implement local HTTP server in packages/ui/src/server.ts: Fastify v5 server serving the Vite-built UI at a local port (default: 7777), expose REST API endpoints for reading kingdom state (projects, jobs, agents, config, crypt) from SQLite, serve static assets per plan.md and research.md R-011
- [X] T081 [US8] Implement SSE-based real-time data bridge in packages/ui/src/api/sse-bridge.ts: server endpoint that streams job status changes, heartbeats, and task transitions as Server-Sent Events, client-side EventSource consumer in React that updates component state — < 1s latency per plan.md Performance Goals

**Checkpoint**: Medieval pixel UI renders with animated agents, live task board, health bars. Configuration changes persist. FR-027, FR-028, FR-034 satisfied.

---

## Phase 11: User Story 9 — GitHub Integration via MCP (Priority: P9)

**Goal**: Read repository info, create issues, and create PRs via a configured MCP server with full audit trail. No direct internet access.

**Independent Test**: Configure GitHub MCP, trigger issue creation from an agent, verify issue appears with correct content and audit log.

### Implementation for User Story 9

- [X] T082 [P] [US9] Implement MCP client connection manager in packages/core/src/mcp/client.ts: establish connection to configured MCP server, handle reconnection, validate MCP server availability at startup, export mcpCall(method, params) for type-safe MCP invocations per FR-029
- [X] T083 [US9] Implement GitHub issue creation via MCP in packages/core/src/mcp/github-issues.ts: create GitHub issues from agent-discovered problems — structured description, task reference, agent identifier, timestamp — all operations audited through Scribe per spec.md US9 acceptance scenario 2
- [X] T084 [US9] Implement GitHub PR creation via MCP in packages/core/src/mcp/github-prs.ts: create pull requests for completed work bodies — include diff, task IDs in description, agent reference — audit every operation per spec.md US9 acceptance scenario 1
- [X] T085 [US9] Implement MCP boundary enforcement in packages/core/src/mcp/boundary.ts: verify only configured MCP servers are accessed, reject any non-MCP internet attempts, log boundary violations as security incidents — graceful failure if MCP not configured per spec.md US9 acceptance scenario 3 and FR-029

**Checkpoint**: GitHub operations flow through MCP only. Full audit trail. No unauthorized internet access. FR-029 satisfied.

### Phase 11 Tests

- [X] T109 Implement MCP boundary enforcement tests in tests/security/mcp-boundary.test.ts: verify only configured MCP servers are accessed, attempt non-MCP URL access and verify rejection, verify boundary violations logged as security incidents, verify graceful failure when no MCP configured — Constitution Testing Standards: "MCP boundary enforcement" and Constitution Principle II: "NO free internet roaming"

---

## Phase 12: Polish & Cross-Cutting Concerns

**Purpose**: Documentation, final quality gates, and validation.

- [X] T088 Documentation: create docs/architecture.md summarizing the 10-package structure, data flow, and entity relationships from plan.md and data-model.md
- [X] T089 Run quickstart.md validation: execute every step in specs/001-kingdomos-orchestration-system/quickstart.md from a clean install, verify all commands work, fix any discrepancies

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: No dependencies — start immediately
- **Phase 2 (Foundational)**: Depends on Phase 1 — BLOCKS all user stories
- **Phase 3 (US1)**: Depends on Phase 2 — Token engine is the MVP foundation
- **Phase 4 (US2)**: Depends on Phase 2 + Phase 3 (decomposer needs budget checks)
- **Phase 5 (US3)**: Depends on Phase 3 (budget preflight) + Phase 4 (task graph + job packets)
- **Phase 6 (US4)**: Depends on Phase 5 (needs completed jobs to review)
- **Phase 7 (US5)**: Depends on Phase 5 (needs running workers to cancel/lock)
- **Phase 8 (US6)**: Depends on Phase 3 (token engine for per-provider budget) + Phase 5 (execution pipeline)
- **Phase 9 (US7)**: Can start after Phase 2 (logging infrastructure), but full value after Phase 6
- **Phase 10 (US8)**: Can start after Phase 2 (UI scaffolding), but full value after Phase 7
- **Phase 11 (US9)**: Depends on Phase 6 (needs review/completion flow for PR creation)
- **Phase 12 (Polish)**: Depends on all desired phases being complete

### User Story Dependencies

```
US1 (Token Engine) ← Foundational only
US2 (Task Decomposition) ← US1
US3 (Local Execution) ← US1 + US2
US4 (Review & Healing) ← US3
US5 (Cancellation & Safety) ← US3
US6 (Multi-Provider) ← US1 + US3
US7 (Observability) ← Foundational (can start early, parallel to US3+)
US8 (Pixel UI) ← Foundational (can start early, parallel to US3+)
US9 (GitHub MCP) ← US4
```

### Within Each User Story

1. Repository/data layer first
2. Service/business logic layer second
3. CLI commands last
4. Each story complete before its dependents begin

### Parallel Opportunities

**Phase 1**: T003, T004, T005 can all run in parallel
**Phase 2**: T008, T009, T013, T014, T086, T087 can run in parallel
**Phase 3**: T015, T016, T017 can run in parallel (different tokenizer files)
**Phase 4**: T022, T023 can run in parallel (different repo files)
**Phase 5**: T033 can run in parallel with T035
**Phase 6**: T042, T043 can run in parallel (parser vs applicator)
**Phase 7**: T051 can run in parallel with other phase 7 work
**Phase 8**: T059, T060, T061 can all run in parallel (different provider adapters)
**Phase 9**: T067, T068 can run in parallel (logger vs crypt writer)
**Phase 10**: T073, T074 can run in parallel (scaffold vs assets)
**Phase 11**: T082 can run in parallel with planning for T083
**Phase 12**: T088, T089 are sequential (docs then validation)

---

## Parallel Example: User Story 1 (Token Budget Engine)

```
# Launch all tokenizer implementations together:
T015: "tiktoken wrapper in packages/token-engine/src/tiktoken-counter.ts"
T016: "HF tokenizer wrapper in packages/token-engine/src/hf-counter.ts"
T017: "Character estimation fallback in packages/token-engine/src/char-counter.ts"

# Then sequentially:
T018: "Model registry in packages/token-engine/src/model-registry.ts" (needs T015-T017)
T019: "TokenBudgetCheck service in packages/token-engine/src/budget-checker.ts" (needs T018)
T020: "kingdom treasury CLI in packages/cli/src/commands/treasury.ts" (needs T019)
T021: "Seed model configs migration" (independent, can parallel with T018)
```

---

## Parallel Example: User Story 6 (Multi-Provider)

```
# Launch all provider adapters together:
T059: "OpenAI adapter in packages/providers/src/openai-adapter.ts"
T060: "Anthropic adapter in packages/providers/src/anthropic-adapter.ts"
T061: "Google adapter in packages/providers/src/google-adapter.ts"

# Then sequentially:
T062: "Credential encryption in packages/core/src/security/credential-store.ts"
T063: "Health tracker in packages/providers/src/health-tracker.ts" (needs adapters)
T064: "Router with fallback in packages/providers/src/router.ts" (needs T063)
T065: "kingdom configure CLI in packages/cli/src/commands/configure.ts" (needs T062, T064)
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational
3. Complete Phase 3: User Story 1 (Token Budget Engine)
4. **STOP and VALIDATE**: Token budget checks work accurately for OpenAI + Qwen models
5. Deliver: Standalone CLI tool for LLM token budget checking

### Core Loop (User Stories 1-4)

6. Complete Phase 4: US2 (Task Decomposition)
7. Complete Phase 5: US3 (Local Execution)
8. Complete Phase 6: US4 (Review & Healing)
9. **STOP and VALIDATE**: Full autonomous loop: plan → execute → review → heal
10. Deliver: Working autonomous coding agent system (single provider)

### Production Ready (User Stories 5-7)

11. Complete Phase 7: US5 (Cancellation & Safety)
12. Complete Phase 8: US6 (Multi-Provider)
13. Complete Phase 9: US7 (Observability)
14. **STOP and VALIDATE**: Safe for unattended 24/7 multi-provider operation
15. Deliver: Production-ready autonomous system

### Full Experience (User Stories 8-9)

16. Complete Phase 10: US8 (Pixel UI)
17. Complete Phase 11: US9 (GitHub Integration)
18. Complete Phase 12: Polish
19. **FINAL VALIDATION**: Run quickstart.md end-to-end, verify SC-001 through SC-010
