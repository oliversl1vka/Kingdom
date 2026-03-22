# Feature Specification: KingdomOS — Autonomous Hierarchical Agent Orchestration System

**Feature Branch**: `001-kingdomos-orchestration-system`
**Created**: 2026-03-22
**Status**: Draft
**Input**: User description: "Build KingdomOS — a fully autonomous, terminal-native, medieval-themed hierarchical AI agent orchestration system that decomposes coding tasks, delegates through a ranked hierarchy of AI agents, executes primarily via a local LLM, reviews results, heals failures, and iterates without human intervention."

## User Scenarios & Testing *(mandatory)*

<!--
  KingdomOS is a single-user, single-machine system. The user is the project
  creator — a power user running autonomous AI coding workflows 24/7 using
  free-tier API tokens and a local 7B coding model on consumer hardware.
  
  Stories are ordered so each one delivers standalone value. Story 1 alone
  is a usable MVP. Each subsequent story adds a capability layer.
-->

### User Story 1 — Token Budget Engine (Priority: P1)

The user wants to accurately estimate whether a given prompt (system message + task instructions + file content + overhead) will fit within a specific model's context window before sending it, so that no model call is ever wasted on a prompt that will overflow or produce truncated output.

The user provides a structured prompt (or raw text) and a target model identifier. The system calculates the exact or conservatively estimated token count, compares it against the model's usable capacity (not advertised spec), and returns a fit/no-fit verdict with a detailed budget breakdown. If the prompt does not fit, the system recommends whether to compress, summarize, or split the task.

**Why this priority**: Token budget sovereignty is the foundational capability per the constitution (Principle III). Every other capability — task delegation, execution, review — depends on knowing whether a prompt fits before sending it. Without this, the system wastes tokens, produces corrupted output, and cannot safely run autonomously.

**Independent Test**: Can be fully tested by feeding known prompts to the budget engine and verifying the token count, breakdown, and fit verdict against hand-calculated expected values. Delivers value as a standalone CLI tool for any developer working with LLMs.

**Acceptance Scenarios**:

1. **Given** a structured prompt with system message, task instructions, and two file excerpts totaling 15,000 tokens, **When** the user requests a budget check targeting a model with 32K context window, **Then** the system returns a detailed breakdown (system prompt tokens, task tokens, file tokens, output reservation, safety margin, formatting overhead) and a "FIT" verdict with remaining headroom displayed.
2. **Given** a prompt that exceeds the target model's usable capacity, **When** the user requests a budget check, **Then** the system returns a "NO-FIT" verdict with the overage amount and a recommendation (compress, split, or reduce file content).
3. **Given** two different model identifiers with different tokenizer characteristics, **When** the same prompt is budget-checked against each, **Then** the token counts differ appropriately to reflect each model's tokenizer.
4. **Given** a prompt with no explicit output reservation specified, **When** a budget check is performed, **Then** the system applies a default output reservation and 10-15% safety margin automatically.

---

### User Story 2 — Hierarchical Task Decomposition & Management (Priority: P2)

The user wants to define a high-level objective (e.g., "Add user authentication to this web app") and have the system decompose it into a structured task graph — from objective down through epics, tasks, subtasks, and individual executable jobs — with each node carrying its own acceptance criteria, token budget estimate, priority, assigned agent tier, and status.

The user creates a project and assigns an objective. The system's planning tier (King) decomposes the objective into epics. The operational tier (Nobility) breaks epics into tasks. The supervisory tier (Knights) transforms tasks into executable job packets with specific file references and token budgets. The full task graph is persisted and queryable.

**Why this priority**: Without hierarchical decomposition, there is no work to execute. This story establishes the core data model (task graph) and the delegation chain that every subsequent capability depends on.

**Independent Test**: Can be tested by creating an objective, triggering decomposition, and verifying the resulting task graph structure — correct parent-child relationships, presence of acceptance criteria at every level, valid token budget estimates, and correct tier assignments.

**Acceptance Scenarios**:

1. **Given** a new project with a stated objective, **When** the user triggers planning, **Then** the system produces a multi-level task graph where each node has: ID, parent reference, priority, type, assigned tier, acceptance criteria, estimated token budget, and status set to "queued."
2. **Given** a task graph with 3 epics, **When** the user queries the graph, **Then** each epic contains one or more operational tasks, and each task contains one or more executable jobs with specific file references.
3. **Given** a task graph, **When** a job's status changes (e.g., queued → running → completed), **Then** the change is persisted immediately and the parent task's status reflects the aggregate state of its children.
4. **Given** a job assigned to the Squire tier, **When** the job packet is generated, **Then** it contains: the exact files and line ranges needed, pre-assembled context that fits within the Squire's usable token budget, acceptance criteria, and expected output format (unified diff).

---

### User Story 3 — Local Model Execution with Job Lifecycle (Priority: P3)

The user wants the system to execute narrowly-scoped coding jobs on the local Qwen model via LM Studio's OpenAI-compatible API, managing the full job lifecycle from context assembly through execution, heartbeat monitoring, output collection, and result storage — producing patches (unified diffs), not full file rewrites.

A Knight assembles a context packet for a specific job, the system performs a preflight token budget check (Story 1), sends the prompt to the local model, monitors execution with 10-second heartbeats, collects the output (unified diff), and stores the result artifact. If the model stalls or times out, the system detects this and transitions the job to the appropriate failure state.

**Why this priority**: The local model is where the bulk of actual coding work happens. This story validates the core execution loop — the single most exercised path in the entire system. Combined with Stories 1 and 2, this delivers a working autonomous coding pipeline.

**Independent Test**: Can be tested by submitting a pre-assembled coding job to the local model via LM Studio, verifying heartbeat emission during execution, collecting the unified diff output, and confirming the job transitions through the correct lifecycle states. Can also be tested with a mock model endpoint.

**Acceptance Scenarios**:

1. **Given** a job packet with pre-assembled context that passes the token budget check, **When** execution begins, **Then** the system sends the prompt to the local model's API endpoint, emits heartbeats every 10 seconds, and writes the model's output (a unified diff) to the designated artifact location.
2. **Given** an executing job, **When** 30 seconds pass without a heartbeat update, **Then** the Sentinel marks the job as "stalled" and notifies the supervising Knight.
3. **Given** a job that exceeds its configured timeout, **When** the timeout fires, **Then** the system issues a soft cancellation request, waits a grace period for checkpoint, and if still running, performs a hard kill. Any partial output is saved.
4. **Given** a completed job with a unified diff output, **When** the result is stored, **Then** the artifact includes: the diff content, execution duration, tokens consumed, model identifier, and job ID for traceability.

---

### User Story 4 — Review, Rejection & Healing (Priority: P4)

The user wants every completed job to be reviewed against its acceptance criteria before the output is applied, with rejected work either retried (with corrections) or escalated to a Healer agent for diagnosis, so that no bad edit ever compounds through days of autonomous operation.

When a Squire completes a job, the supervising Knight (or a dedicated Judge) reviews the output: checking acceptance criteria, verifying the diff contains no unrelated changes, and validating format. If rejected, the Knight provides feedback and the Squire retries (up to a fixed limit). If retries are exhausted, a structured incident report is sent to the Healer, who diagnoses the root cause and recommends a recovery strategy. The supervisor then decides whether to retry with healer guidance, redesign the task, or escalate further.

**Why this priority**: Without review and healing, the system is an uncontrolled code generator. This story closes the quality loop and makes autonomous operation safe. Combined with Stories 1-3, this delivers a full plan → execute → review → heal cycle.

**Independent Test**: Can be tested by submitting a known-bad diff (e.g., with unrelated changes) and verifying it is rejected with specific feedback, then submitting a corrected diff and verifying acceptance. Healing can be tested by exhausting retries and verifying the incident report is generated and the healer returns a diagnosis.

**Acceptance Scenarios**:

1. **Given** a completed job with a valid unified diff that meets all acceptance criteria, **When** the reviewer evaluates it, **Then** the job transitions to "completed" and the diff is approved for application.
2. **Given** a completed job with a diff containing unrelated file changes, **When** the reviewer evaluates it, **Then** the job is rejected with specific feedback citing the scope violation, and retry is initiated.
3. **Given** a job that has failed review 3 times (configurable retry limit), **When** the retry limit is exhausted, **Then** a structured incident report is generated and sent to the Healer containing: incident ID, task context, failure type, the three review rejection reasons, and recent execution history.
4. **Given** a healer diagnosis recommending task splitting, **When** the supervisor receives the recommendation, **Then** the original task is marked "awaiting-redesign" and new subtasks are created per the healer's guidance.

---

### User Story 5 — Cancellation & Concurrent Worker Safety (Priority: P5)

The user wants the system to safely cancel running jobs (soft then hard), prevent concurrent conflicting file edits through locking, and handle multiple parallel workers pulling from the same job queue without race conditions or data corruption.

A supervisor can cancel any job it delegated. Cancellation is soft first (the worker gets a chance to checkpoint), then hard if the worker does not respond within a grace period. File locks are held by the supervising agent and released only after successful review. When two workers target the same file, one waits deterministically. All coordination happens through the shared persistent state — no in-memory message passing between processes.

**Why this priority**: Autonomous systems that cannot safely cancel work or prevent conflicting edits are dangerous to leave running. This story is the safety foundation for unattended multi-terminal operation.

**Independent Test**: Can be tested by starting a long-running job, issuing a cancel, and verifying soft-then-hard cancellation flow with partial output salvage. File locking can be tested by attempting concurrent edits to the same file and verifying deterministic wait behavior.

**Acceptance Scenarios**:

1. **Given** a running job delegated by Knight A, **When** Knight A requests cancellation, **Then** the system sends a soft cancel signal, waits a configurable grace period, and if the job has not stopped, performs a hard kill. Partial output produced before cancellation is saved.
2. **Given** a running job delegated by Knight A, **When** Knight B (a peer, not the delegator) attempts to cancel it, **Then** the cancellation is rejected because Knight B did not delegate the job.
3. **Given** two workers assigned jobs that both target the same file, **When** both attempt to acquire the file lock, **Then** one acquires it and proceeds while the other waits. After the first worker's result is reviewed and the lock is released, the second worker proceeds.
4. **Given** a worker holding a file lock that becomes stalled (missed heartbeats), **When** the Sentinel detects the stall, **Then** the stale lock is released after the supervising agent confirms, and the waiting worker can proceed.

---

### User Story 6 — Multi-Provider Model Routing (Priority: P6)

The user wants to configure which AI model and provider is used for each agent tier (King, Nobility, Knight, Squire, Healer), with automatic fallback to an alternative provider if the preferred one is unavailable or rate-limited, so that autonomous operation continues even when a single provider has an outage.

The user assigns models to tiers through the configuration interface. The system tracks provider health (availability, rate limit status, cooldown timers). When a model call is needed, the system routes it to the preferred provider; if unavailable, it falls back to the next configured option. Each provider's tokenizer characteristics are stored so that token budget checks remain accurate regardless of which provider is active.

**Why this priority**: Multi-provider support enables the "free-tier budget" strategy (rotating across multiple providers) and ensures autonomous operation survives provider outages. This is critical for the 24/7 autonomy goal but depends on the execution pipeline (Stories 1-5) being in place first.

**Independent Test**: Can be tested by configuring two providers for the same tier, disabling the primary, and verifying the system automatically routes to the fallback with correct tokenizer characteristics applied.

**Acceptance Scenarios**:

1. **Given** a tier configured with Provider A (primary) and Provider B (fallback), **When** a model call is needed and Provider A is healthy, **Then** the call is routed to Provider A using Provider A's tokenizer for budget checks.
2. **Given** Provider A returns a rate-limit error, **When** the next model call for that tier is needed, **Then** the system routes to Provider B, applies Provider B's tokenizer for the budget check, and starts a cooldown timer for Provider A.
3. **Given** Provider A's cooldown timer expires, **When** the next call is needed, **Then** the system attempts Provider A again (primary preference restored).
4. **Given** all configured providers for a tier are unavailable, **When** a model call is needed, **Then** the job is set to a waiting state with a clearly logged reason, and the system retries after a backoff period rather than failing permanently.

---

### User Story 7 — Observability, Logging & the Crypt (Priority: P7)

The user wants full visibility into what every agent did, when, and why — with time-limited detailed logs that are automatically cleaned after a configurable retention period, and a permanent condensed history (the Crypt of Kings) that preserves a one-line summary of every completed task forever.

Every model invocation, task transition, review decision, cancellation, retry, and incident is logged with timestamps, agent identifiers, and context. The user configures a retention period (e.g., 7 days). After expiry, detailed logs are purged and a permanent one-line entry is written to the Crypt. Agent memory files persist learning and insights across sessions. Dry-run mode allows simulating any operation without invoking models or modifying state.

**Why this priority**: Observability is constitutionally required (Principle VI) and essential for debugging autonomous systems. However, the system can operate (Stories 1-6) before full observability is polished — basic logging is implicit in earlier stories; this story formalizes and completes it.

**Independent Test**: Can be tested by running a task lifecycle, verifying all expected log entries are present, advancing the clock past retention, and confirming logs are purged while Crypt entries persist. Dry-run mode can be tested by executing a workflow and confirming zero model calls and zero state mutations.

**Acceptance Scenarios**:

1. **Given** a job that transitions through queued → running → completed, **When** the user queries the log, **Then** each transition has a timestamped entry with the agent identifier, job ID, and transition reason.
2. **Given** a retention period of 7 days and logs older than 7 days, **When** the retention cleanup runs, **Then** the detailed logs are deleted and a permanent one-line Crypt entry is written for each purged task containing: task name, ID, summary, and success/failure status.
3. **Given** dry-run mode is enabled, **When** the user triggers a full task decomposition and execution workflow, **Then** the system simulates all steps, produces log output showing what would happen, but makes zero model API calls and zero persistent state changes.
4. **Given** an agent that encountered and resolved a novel error pattern, **When** the session ends, **Then** the agent's memory file is updated with the learned insight so it is available in future sessions.

---

### User Story 8 — Medieval Pixel UI (Priority: P8)

The user wants to launch KingdomOS with the `kingdom` command and see a medieval-themed pixel-art terminal UI where active agents are visualized as animated medieval characters (King on throne, Knights at war table, Squires at workbenches, etc.), task queues appear as scroll boards, token budgets display as health bars, and the user can create projects, assign objectives, configure model assignments per tier, set retention periods, and monitor all agent activity in real time.

The UI is a visualization and configuration layer — all heavy work happens in the terminal processes behind it. The user can also view the Crypt of Kings (permanent history). The UI is closed with `kingdom farewell`.

**Why this priority**: The UI is the human-facing shell. The system is fully functional without it (Stories 1-7 can be driven entirely through CLI commands and configuration files). The UI adds usability and the medieval immersion experience but is not on the critical path for autonomous operation.

**Independent Test**: Can be tested by launching the `kingdom` command, creating a project, assigning an objective, verifying agent characters appear and animate as tasks execute, and confirming that configuration changes (model assignments, retention periods) are persisted and take effect.

**Acceptance Scenarios**:

1. **Given** a terminal with the system installed, **When** the user runs `kingdom`, **Then** a pixel-art medieval-themed UI renders showing the castle overview with no active projects, and the user can create a new project.
2. **Given** an active project with running jobs, **When** the user views the main screen, **Then** active agents appear as their medieval character counterparts (Squire at workbench for executing workers, Knight at war table for supervisors, etc.) with activity animations reflecting their current state.
3. **Given** token budgets for active jobs, **When** the user views the budget panel, **Then** budgets are displayed as health bars showing used vs. remaining capacity per active job.
4. **Given** the user runs `kingdom farewell`, **When** the command executes, **Then** the UI closes gracefully, active jobs continue running in their terminal processes, and the user is returned to a normal terminal prompt.

---

### User Story 9 — GitHub Integration via MCP (Priority: P9)

The user wants agents to be able to read repository information, create issues for discovered problems, and create pull requests for completed work — all routed exclusively through a configured MCP server, with no direct internet access permitted.

When an agent discovers a problem worth tracking, it creates a GitHub issue. When a body of work passes review, the system creates a PR. All GitHub operations are logged and auditable. No other internet access is permitted beyond the configured MCP boundary.

**Why this priority**: GitHub integration is the external output channel — how autonomous work becomes visible to the broader development workflow. It is valuable but depends on the core autonomous loop (Stories 1-7) and is safely deferred.

**Independent Test**: Can be tested by configuring the GitHub MCP server, triggering an issue creation from an agent, and verifying the issue appears in the repository with correct content and audit log entry.

**Acceptance Scenarios**:

1. **Given** a configured GitHub MCP server and a completed body of work, **When** the system creates a pull request, **Then** the PR contains the correct diff, a description referencing the task IDs, and the operation is logged with the agent identifier and timestamp.
2. **Given** an agent that discovers a failing dependency during execution, **When** the agent creates a GitHub issue, **Then** the issue contains a structured description of the problem, relevant context, and a reference back to the originating task.
3. **Given** no MCP server is configured for GitHub, **When** an agent attempts a GitHub operation, **Then** the operation fails gracefully with a clear error message and no attempt is made to access the internet directly.
4. **Given** an active MCP connection, **When** any GitHub operation occurs, **Then** a complete audit log entry is created with: operation type, agent ID, target repository, timestamp, and the content sent.

---

### Edge Cases

- What happens when the local LM Studio instance is not running or crashes mid-job? Jobs targeting the local model transition to a failure state; the Sentinel detects missing heartbeats and triggers supervisor notification. Jobs are retryable once the local model is restored.
- What happens when ALL configured providers (local and remote) are simultaneously unavailable? The system enters a "kingdom-idle" state: no new jobs are dispatched, existing queued jobs wait, and the system retries providers with an exponential backoff. When any provider recovers, normal operation resumes.
- What happens when a task cannot be decomposed to fit within the Squire's usable context window even after compression? The Healer recommends redesigning the task into smaller independent subtasks. If the Healer cannot find a viable split, the task is escalated to the next higher tier for manual redesign or scope reduction.
- What happens when the SQLite database file becomes corrupted? The system detects corruption at startup or during operations, logs the incident, and refuses to operate rather than silently producing incorrect state. Recovery requires restoring from backup or reinitializing.
- What happens when a Squire produces output that is not a valid unified diff? The reviewer (Judge) rejects the output with a specific "invalid format" reason, and the job retries with an explicit formatting instruction appended to the prompt. After retry exhaustion, the Healer is consulted.
- What happens when accumulated file locks from crashed workers are never released? The Sentinel periodically scans for locks held by workers whose heartbeats have gone stale. Stale locks are reported to the supervising agent, who can release them after confirming the worker is dead.
- What happens during a long autonomous run if token budget calculations drift due to model updates? Per-model tokenizer characteristics are versioned. If a discrepancy is detected (e.g., through calibration checks), the system logs a warning and falls back to more conservative estimation until the tokenizer profile is updated.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST provide a CLI entry point (`kingdom`) that launches the application and a corresponding exit command (`kingdom farewell`) that gracefully shuts down the UI while leaving background processes running.
- **FR-002**: System MUST calculate token counts for structured prompts with model-specific accuracy, accounting for system prompts, task instructions, file contents with line ranges, output reservation, safety margins, and formatting overhead.
- **FR-003**: System MUST perform a preflight token budget check before every model invocation, returning a fit/no-fit verdict with detailed breakdown. No model call may proceed without a passing budget check.
- **FR-004**: System MUST support configurable per-model tokenizer profiles that can be updated independently as model characteristics change.
- **FR-005**: System MUST overestimate token counts by 10-15% (configurable) as a safety margin to prevent context overflow.
- **FR-006**: System MUST decompose user-defined objectives into a multi-level task graph (objective → epic → task → subtask → job) where each node has: ID, parent reference, priority, type, assigned tier, acceptance criteria, token budget estimate, status, retry count, and artifact paths.
- **FR-007**: System MUST persist the task graph and make it queryable by ID, status, tier, priority, or parent.
- **FR-008**: System MUST generate machine-readable job packets for Squires containing: pre-assembled file contents with specific line ranges, task instructions, acceptance criteria, and expected output format — all verified to fit within the target model's token budget.
- **FR-009**: System MUST execute coding jobs on the local model via an OpenAI-compatible API endpoint (LM Studio), collecting output as unified diffs.
- **FR-010**: System MUST emit heartbeats from active workers every 10 seconds containing: job status, progress indicator, and tokens generated so far.
- **FR-011**: System MUST detect stalled workers (missing heartbeats beyond a configurable threshold) and trigger Sentinel alerts to the supervising agent.
- **FR-012**: System MUST support cancellation of running jobs with soft-then-hard escalation: soft cancel signal → grace period → hard kill if unresponsive. Partial output from cancelled jobs MUST be saved.
- **FR-013**: System MUST enforce that a supervisor can only cancel jobs it delegated, never jobs delegated to it from above.
- **FR-014**: System MUST review every completed job against its defined acceptance criteria before allowing the output to be applied. No output is applied without review approval.
- **FR-015**: System MUST reject completed jobs that contain changes to files not specified in the job's scope.
- **FR-016**: System MUST retry rejected jobs up to a configurable limit, with specific review feedback included in the retry prompt.
- **FR-017**: System MUST generate structured incident reports for the Healer when retry limits are exhausted, containing: incident ID, task context, failure type, failure history, and recent execution events.
- **FR-018**: System MUST support healing responses that recommend: task splitting, context compression, prompt revision, or escalation — and the supervisor MUST act on the recommendation.
- **FR-019**: System MUST prevent concurrent conflicting file edits through file locking, where the supervising agent holds the lock and releases it only after successful review.
- **FR-020**: System MUST support deterministic wait ordering when multiple workers need the same locked file.
- **FR-021**: System MUST support configuring model and provider assignments per agent tier (King, Nobility, Knight, Squire, Healer).
- **FR-022**: System MUST track provider health (availability, rate limit status, cooldown timers) and automatically route to fallback providers when the primary is unavailable.
- **FR-023**: System MUST log every model invocation, task state transition, review decision, cancellation, retry, and incident with timestamps and agent identifiers.
- **FR-024**: System MUST enforce time-limited log retention: after a user-configurable period, detailed logs are purged and a permanent one-line summary is written to the Crypt of Kings.
- **FR-025**: System MUST support dry-run mode for every operation, simulating the full execution path without invoking models or modifying persistent state.
- **FR-026**: System MUST persist agent memory files (markdown-based) across sessions, enabling agents to learn from past experiences.
- **FR-027**: System MUST display a medieval-themed pixel-art terminal UI showing agent activity, task queues, token budgets, and project status.
- **FR-028**: System MUST support project creation, objective assignment, model configuration, and retention period configuration through the UI.
- **FR-029**: System MUST integrate with GitHub via a configured MCP server for: reading repository info, creating issues, and creating pull requests. No other internet access is permitted.
- **FR-030**: System MUST store all API keys, tokens, and credentials in encrypted form. Credentials MUST never appear in logs, agent instructions, or any plaintext file.
- **FR-031**: System MUST define agent identities in versioned markdown files containing: role, goals, allowed tools, forbidden behaviors, output format, escalation rules, review standards, delegation rules, and token limits.
- **FR-032**: System MUST support multiple parallel terminal workers pulling from a shared job queue, coordinated through the persistent state store rather than in-memory message passing.
- **FR-033**: System MUST maintain a task status lifecycle covering at minimum: queued, preparing-context, running, stalled, cancel-requested, cancelled, completed, failed (with typed failure reasons: token-overflow, timeout, runtime-crash, invalid-output, review-rejection), awaiting-healer, awaiting-redesign, and retrying.
- **FR-034**: System MUST apply medieval theming consistently across all user-facing surfaces: command names, log messages, error messages, UI elements, and documentation — without obscuring engineering clarity.

### Key Entities

- **Project (Kingdom)**: A user-defined workspace representing a codebase and its goals. Attributes: name, description, repository path, active status, creation date.
- **Objective**: A high-level goal assigned to a project. Attributes: description, priority, status, assigned King agent, acceptance criteria.
- **Task Graph Node**: A unit of work at any decomposition level (objective, epic, task, subtask, job). Attributes: ID, parent ID, level, priority, type, assigned tier, acceptance criteria, token budget estimate, status, retry count, reviewer tier, artifact paths, file references.
- **Job**: The lowest-level executable unit, sent to a worker. Attributes: job ID, parent task ID, worker ID, model identifier, context packet, started-at timestamp, heartbeat-at timestamp, timeout, status, cancel flag, result artifact location, failure type.
- **Agent Identity**: A versioned definition of an agent's role and capabilities. Attributes: tier, model class, role description, allowed tools, forbidden behaviors, output format, escalation rules, delegation rules, token limits.
- **Heartbeat**: A periodic status signal from an active worker. Attributes: job ID, worker ID, timestamp, status, progress indicator, tokens generated.
- **Incident Report**: A structured record of a failure requiring healer attention. Attributes: incident ID, task context, failure type, failure history, recovery recommendation, healer confidence.
- **Review Decision**: A record of a reviewer's accept/reject judgment. Attributes: job ID, reviewer agent ID, decision (accept/reject), rejection reasons, scope verification result, format verification result.
- **File Lock**: An exclusive reservation on a file for editing. Attributes: file path, owning supervisor agent ID, owning job ID, acquired-at timestamp, status.
- **Provider Configuration**: A model provider's operational parameters. Attributes: provider ID, endpoint, tier assignment, tokenizer profile, health status, rate limit state, cooldown expiry, priority order.
- **Crypt Entry**: A permanent condensed record of a completed task. Attributes: task name, task ID, one-line summary, success/failure status, completion date.
- **Agent Memory File**: A markdown document persisting an agent's accumulated insights. Attributes: agent ID, content (learned patterns, error resolutions, codebase knowledge), last updated timestamp.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: The system can run autonomously for one full working day (8+ hours) processing coding tasks across the full hierarchy, producing working code changes that pass acceptance criteria, without human intervention after initial objective assignment.
- **SC-002**: 90% or more of coding work (measured by token expenditure) is performed by the local Qwen model, with remote models used only for planning, review, and healing.
- **SC-003**: Zero token overflow errors occur during a full day of autonomous operation — every model call is preceded by a successful budget check.
- **SC-004**: The system operates within free-tier token budgets across all configured remote providers for a full day of operation (provider-specific limits vary; the system tracks and respects each).
- **SC-005**: Failed jobs are detected, diagnosed, and either recovered or escalated within 3 retry cycles — no job remains in a failed state without a healer evaluation.
- **SC-006**: Zero security incidents during autonomous operation — no credential exposure, no unauthorized internet access, no data leakage. The system is as secure on day 30 as on day 1.
- **SC-007**: Every action taken by every agent during autonomous operation is traceable through the logging system — an auditor can reconstruct the full decision chain for any task from the logs and Crypt.
- **SC-008**: The user can launch the system, create a project, assign an objective, and begin autonomous operation in under 5 minutes from a cold start.
- **SC-009**: Stalled or wedged workers are detected within 30 seconds (3 missed heartbeats) and escalated to their supervisor.
- **SC-010**: The medieval theme is consistently applied across all user-facing surfaces (commands, logs, UI, errors) without requiring users to consult a "translation guide" to understand system behavior.

## Assumptions

- The user has LM Studio installed and running with the Qwen2.5-Coder-7B-Instruct model loaded and accessible via its OpenAI-compatible API on localhost.
- The user's machine has sufficient hardware to run the local 7B model (minimum ~8GB VRAM or adequate RAM for CPU inference).
- The user has active accounts with at least one remote AI provider (OpenAI, Google, Anthropic) with free-tier or paid API access configured.
- The user has a configured GitHub MCP server if GitHub integration features are desired.
- PowerShell 5.1+ is available on the target Windows machine. Linux support is a future milestone, not a launch requirement.
- The local SQLite database is stored on a local filesystem with adequate I/O performance for the expected write volume.
- The pixel-art UI will be a web-based React 19 + Canvas 2D application served locally via an HTTP server (default port 7777), launched by `kingdom summon` and accessed in the browser. This was chosen over a terminal TUI because pixel-art sprite animation at the required fidelity cannot be achieved in a text-based UI.

## Non-Goals (Explicitly Out of Scope)

- No voice interface.
- No free internet browsing — only MCP-gated external access.
- No bloated dependency trees — minimal libraries, earn-your-place policy.
- No GUI beyond the terminal pixel UI visualization.
- No multi-machine distributed cluster — single machine, multiple terminals.
- No cloud dashboard — everything is local-first.
- No Linux support in MVP — PowerShell-first on Windows, Linux is a future milestone.
- No mobile or web client.
