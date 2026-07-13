# Data Model: KingdomOS Orchestration System

**Phase**: 1 — Design & Contracts
**Date**: 2026-03-22

## Entity Relationships

```
Project (Kingdom)
 └─ Objective  [1:N]
     └─ TaskGraphNode (epic)  [1:N]
         └─ TaskGraphNode (task)  [1:N]
             └─ TaskGraphNode (subtask)  [1:N]
                 └─ Job  [1:1]
                     ├─ Heartbeat  [1:N]
                     ├─ ReviewDecision  [1:N]
                     └─ IncidentReport  [0:N]

AgentIdentity ──assigns──> TaskGraphNode  (via tier)
AgentIdentity ──has──> AgentMemoryFile  [1:N]
ProviderConfig ──serves──> AgentIdentity  (via tier assignment)
FileLock ──owned_by──> Job  (via supervising agent's job)
CryptEntry ──archived_from──> TaskGraphNode  (permanent summary)
```

## Entities

### Project (Kingdom)

Represents a user workspace — a codebase and its goals.

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| id | string (ULID) | PK, unique | Unique project identifier |
| name | string | required, max 100 chars | Display name of the kingdom |
| description | string | optional, max 1000 chars | Purpose description |
| repository_path | string | required, valid path | Absolute path to the codebase |
| active | boolean | default: true | Whether the project is currently active |
| created_at | datetime | auto-set | Creation timestamp |
| updated_at | datetime | auto-set on change | Last modification timestamp |

**Validation Rules**:
- `repository_path` must exist on disk at project creation time
- `name` must be unique across all projects

---

### Objective

A high-level goal assigned to a project, decomposed by the King agent.

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| id | string (ULID) | PK, unique | Unique objective identifier |
| project_id | string | FK → Project.id, required | Parent project |
| description | string | required, max 2000 chars | What to achieve |
| priority | integer | 1-10, default: 5 | Priority weight |
| status | enum | see lifecycle below | Current status |
| assigned_king | string | FK → AgentIdentity.name | King agent handling this objective |
| acceptance_criteria | JSON | required, array of strings | What defines success |
| created_at | datetime | auto-set | Creation timestamp |
| updated_at | datetime | auto-set on change | Last modification |

**Status Lifecycle**: `draft` → `planning` → `active` → `completed` | `failed` | `cancelled`

---

### TaskGraphNode

A unit of work at any decomposition level. Self-referencing hierarchy.

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| id | string (ULID) | PK, unique | Unique task identifier |
| parent_id | string | FK → TaskGraphNode.id, nullable | Parent node (null for top-level epics) |
| objective_id | string | FK → Objective.id, required | Root objective |
| level | enum | `epic` \| `task` \| `subtask` \| `job` | Decomposition depth |
| title | string | required, max 200 chars | Human-readable title |
| description | string | optional, max 2000 chars | Detailed description |
| priority | integer | 1-10, default: 5 | Priority weight |
| type | string | `code` \| `test` \| `review` \| `research` \| `design` | Work category |
| assigned_tier | enum | `king` \| `nobility` \| `knight` \| `squire` | Agent tier responsible |
| reviewer_tier | enum | same as assigned_tier | Tier that reviews output |
| acceptance_criteria | JSON | required, array of strings | Success conditions |
| context_refs | JSON | array of {file, startLine, endLine} | Files and line ranges needed |
| token_budget_estimate | integer | >= 0 | Estimated tokens for execution |
| status | enum | see lifecycle below | Current status |
| retry_count | integer | default: 0 | Times retried |
| max_retries | integer | default: 3 | Retry cap before healer escalation |
| artifact_paths | JSON | array of strings | Paths to produced artifacts |
| created_at | datetime | auto-set | Creation timestamp |
| updated_at | datetime | auto-set on change | Last modification |

**Status Lifecycle**:
```
queued
 → preparing-context
   → awaiting-budget-check
     → budget-rejected → (back to queued after context compression)
     → running
       → streaming (output in progress)
       → stalled (missed heartbeats)
       → cancel-requested → cancelled
       → completed
       → completed-with-warnings
       → failed-token-overflow
       → failed-timeout
       → failed-runtime-crash
       → failed-invalid-output
       → failed-review
         → retrying → running (up to max_retries)
         → awaiting-healer
           → awaiting-redesign → (new subtasks created)
```

**Validation Rules**:
- `parent_id` must reference a node at a higher decomposition level
- `context_refs` required for `level = 'job'`
- `token_budget_estimate` required for `level = 'job'`
- `assigned_tier` must match the level: `epic` → `nobility`, `task` → `knight`, `subtask`/`job` → `squire`
- `reviewer_tier` must be equal to or one level above `assigned_tier`

---

### Job

The lowest-level executable unit — a single model invocation assigned to a worker.

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| id | string (ULID) | PK, unique | Unique job identifier |
| task_id | string | FK → TaskGraphNode.id, required | Parent task node |
| worker_id | string | nullable | PID or identifier of the worker process |
| model | string | FK → ModelConfig.model_id, required | Model to invoke |
| status | enum | mirrors TaskGraphNode lifecycle | Current status |
| started_at | datetime | nullable | Execution start time |
| heartbeat_at | datetime | nullable | Last heartbeat received |
| timeout_at | datetime | nullable | Deadline for completion |
| cancel_requested | boolean | default: false | Soft cancel flag |
| cancel_reason | string | nullable | Why cancellation was requested |
| result_path | string | nullable | Path to output artifact |
| failure_type | enum | nullable | `token-overflow` \| `timeout` \| `runtime-crash` \| `invalid-output` \| `review-rejection` |
| token_estimate | integer | required | Pre-flight estimated tokens |
| tokens_used | integer | nullable | Actual tokens consumed (from response metadata) |
| delegating_supervisor_id | string | required | Agent that delegated this job |
| created_at | datetime | auto-set | Creation timestamp |

**Validation Rules**:
- `cancel_requested` can only be set to `true` by the `delegating_supervisor_id` or a higher tier
- `timeout_at` = `started_at` + configurable timeout per model tier
- `result_path` required when `status = 'completed'`

---

### Heartbeat

Periodic health signal from an active worker.

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| id | integer | PK, auto-increment | Row identifier |
| job_id | string | FK → Job.id, required | Associated job |
| worker_id | string | required | Worker process identifier |
| timestamp | datetime | required | When the heartbeat was emitted |
| status | enum | `healthy` \| `slow` \| `finishing` | Worker-reported status |
| progress | string | nullable, max 200 chars | Human-readable progress indicator |
| tokens_generated | integer | default: 0 | Tokens produced so far |

**Retention**: Subject to time-limited retention. Purged after configured period.

---

### IncidentReport

Structured failure record requiring Healer attention.

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| id | string (ULID) | PK, unique | Incident identifier |
| task_id | string | FK → TaskGraphNode.id, required | Affected task |
| job_id | string | FK → Job.id, nullable | Affected job (if applicable) |
| severity | enum | `low` \| `medium` \| `high` \| `critical` | Impact level |
| failure_type | string | required | Category of failure |
| symptoms | JSON | required | Observable symptoms (structured) |
| context_summary | string | max 2000 chars | Brief description of what was attempted |
| failure_history | JSON | array of {attempt, reason, timestamp} | Prior failure attempts |
| probable_cause | string | nullable | Healer's diagnosis |
| healer_confidence | float | 0.0-1.0, nullable | Healer's confidence in diagnosis |
| healer_recommendation | JSON | nullable | Recommended recovery actions |
| action_taken | string | nullable | What was actually done |
| resolved_at | datetime | nullable | When the incident was resolved |
| created_at | datetime | auto-set | Creation timestamp |

**State Transitions**: `open` → `diagnosing` → `diagnosed` → `resolved` | `escalated`

---

### ReviewDecision

A reviewer's judgment on a completed job.

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| id | string (ULID) | PK, unique | Review identifier |
| job_id | string | FK → Job.id, required | Reviewed job |
| reviewer_agent_id | string | required | Agent performing the review |
| decision | enum | `approved` \| `rejected` | Verdict |
| rejection_reasons | JSON | nullable, array of strings | Specific reasons for rejection |
| scope_check | enum | `pass` \| `fail` | Were changes limited to specified files? |
| format_check | enum | `pass` \| `fail` | Is output valid unified diff? || security_check | enum | `pass` \\| `fail` | Diff free of credential patterns, destructive commands, malevolent code? || criteria_check | enum | `pass` \| `fail` | Are acceptance criteria met? |
| feedback | string | nullable, max 2000 chars | Review feedback for retry |
| created_at | datetime | auto-set | Review timestamp |

---

### FileLock

Exclusive reservation on a file for editing.

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| file_path | string | PK, unique | Absolute path to locked file |
| owning_job_id | string | FK → Job.id, required | Job that needs the file |
| owning_supervisor_id | string | required | Supervising agent holding the lock |
| locked_at | datetime | auto-set | When the lock was acquired |
| lock_type | enum | `exclusive` | Lock type (only exclusive for now) |
| max_duration_seconds | integer | default: 600 | Maximum lock hold time before force-release |

**Validation Rules**:
- Only one lock per `file_path` at a time (enforced by PK)
- Sentinel checks: if `locked_at + max_duration_seconds < NOW()` AND worker heartbeat stale → force-release candidate
- Release only by `owning_supervisor_id` after review approval

---

### ModelConfig

Model and tokenizer configuration.

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| model_id | string | PK, unique | Model identifier (e.g., `gpt-4o`, `qwen2.5-coder-7b`) |
| provider | string | FK → ProviderHealth.provider_id | Which provider serves this model |
| display_name | string | required | Human-readable name |
| context_window | integer | required | Advertised context window in tokens |
| safe_input_budget | integer | required | Usable input tokens after overhead |
| output_reservation | integer | required | Tokens reserved for output |
| safety_margin_percent | float | default: 0.12 | Overestimation margin (10-15%) |
| tokenizer_type | enum | `tiktoken` \| `huggingface` \| `character-estimate` | Which tokenizer to use |
| tokenizer_config | JSON | nullable | Tokenizer-specific config (encoding name, model path) |
| tier_assignment | enum | nullable | Default tier for this model |

---

### ProviderHealth

Provider operational state.

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| provider_id | string | PK, unique | Provider identifier (e.g., `openai`, `anthropic`, `google`, `lmstudio`) |
| display_name | string | required | Human-readable name |
| endpoint | string | required | Base URL for API calls |
| status | enum | `healthy` \| `degraded` \| `unavailable` \| `rate-limited` \| `cooldown` | Current health |
| last_error | string | nullable | Most recent error message |
| last_error_at | datetime | nullable | When the last error occurred |
| cooldown_until | datetime | nullable | Do not use until this time |
| requests_today | integer | default: 0 | Request count for current day |
| rate_limit_remaining | integer | nullable | Remaining requests per provider-reported limit |
| priority_order | integer | required | Lower = preferred (for fallback ordering) |

---

### AgentConfig

Per-agent tier and model assignment.

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| agent_name | string | PK, unique | Agent identifier (e.g., `king-01`, `knight-alpha`) |
| tier | enum | `king` \| `nobility` \| `knight` \| `squire` \| `healer` \| `sentinel` \| `scribe` \| `judge` \| `blacksmith` | Agent role tier |
| model_id | string | FK → ModelConfig.model_id | Assigned model |
| active | boolean | default: true | Whether the agent is currently active |
| config_json | JSON | nullable | Override configuration |

---

### CryptEntry

Permanent condensed history record. **Never deleted.**

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| id | integer | PK, auto-increment | Row identifier |
| task_id | string | required | Original task ID (for reference) |
| title | string | required, max 200 chars | Task title |
| summary | string | required, max 500 chars | One-line summary of what was done |
| success | boolean | required | Whether the task succeeded |
| completed_at | datetime | required | When the task was completed |

---

### AgentIdentity (File-based, not SQLite)

Stored as markdown files in `kingdom/agents/{agent-name}.md`.

| Section | Required | Description |
|---------|----------|-------------|
| Tier | yes | Agent's position in hierarchy |
| Model Class | yes | What type of model (e.g., "Strong mid-tier") |
| Role | yes | What this agent does |
| Goals | yes | What success looks like for this agent |
| Allowed Tools | yes | Actions this agent may perform |
| Forbidden Behaviors | yes | Explicit prohibitions |
| Output Format | yes | Expected output structure |
| Escalation Rules | yes | When and how to escalate |
| Delegation Rules | conditional | Who this agent can delegate to (supervisors only) |
| Review Standards | conditional | What to check when reviewing (reviewers only) |
| Token Limits | yes | Maximum token budget per invocation |

---

### AgentMemoryFile (File-based, not SQLite)

Stored as markdown files in `kingdom/memory/{agent-name}/`.

- Free-form markdown, Obsidian-compatible
- Each file represents a topic or learning area
- Agents append insights during sessions
- Shared memory in `kingdom/memory/shared/` for repo-wide patterns
- Last-modified timestamp used for freshness

## Indexes

| Table | Column(s) | Type | Purpose |
|-------|-----------|------|---------|
| tasks | parent_id | B-tree | Fast child lookup for tree traversal |
| tasks | status | B-tree | Queue polling by status |
| tasks | assigned_tier | B-tree | Tier-filtered queries |
| tasks | objective_id | B-tree | All tasks for an objective |
| jobs | task_id | B-tree | Jobs for a task |
| jobs | status, heartbeat_at | Composite | Stale heartbeat detection by Sentinel |
| jobs | delegating_supervisor_id | B-tree | Cancellation authorization check |
| heartbeats | job_id, timestamp | Composite | Heartbeat history lookup |
| incidents | task_id | B-tree | Incidents for a task |
| file_locks | file_path | PK (unique) | Lock existence check |
| crypt_of_kings | completed_at | B-tree | Time-ordered history |

## Migration Strategy

- Schema version tracked in a `schema_version` table (single row)
- Migrations stored as numbered `.sql` files in `packages/core/migrations/`
- Applied in order at startup; version check prevents re-application
- Destructive migrations require explicit confirmation in non-dry-run mode
