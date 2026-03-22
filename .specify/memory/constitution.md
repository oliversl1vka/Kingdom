<!--
  ╔═══════════════════════════════════════════════════════════════╗
  ║                    SYNC IMPACT REPORT                        ║
  ╠═══════════════════════════════════════════════════════════════╣
  ║ Version change: 0.0.0 (template) → 1.0.0                    ║
  ║                                                              ║
  ║ Modified principles: N/A (initial creation)                  ║
  ║                                                              ║
  ║ Added sections:                                              ║
  ║   - I. Terminal-Native Identity                              ║
  ║   - II. Absolute Security (NON-NEGOTIABLE)                   ║
  ║   - III. Token Budget Sovereignty (FOUNDATIONAL)             ║
  ║   - IV. Hierarchical Authority                               ║
  ║   - V. Code Quality                                          ║
  ║   - VI. Observability                                        ║
  ║   - VII. Autonomy Safety                                     ║
  ║   - Testing Standards (dedicated section)                    ║
  ║   - Development Workflow & Compliance Gates (section)        ║
  ║   - Governance (filled from template)                        ║
  ║                                                              ║
  ║ Removed sections: All template placeholders replaced         ║
  ║                                                              ║
  ║ Templates requiring updates:                                 ║
  ║   - .specify/templates/plan-template.md         ✅ reviewed  ║
  ║     (Constitution Check section is dynamic — no change)      ║
  ║   - .specify/templates/spec-template.md         ✅ reviewed  ║
  ║     (No constitution-specific references to update)          ║
  ║   - .specify/templates/tasks-template.md        ✅ reviewed  ║
  ║     (Phase structure compatible — no change needed)          ║
  ║   - .specify/templates/checklist-template.md    ✅ reviewed  ║
  ║   - .specify/templates/agent-file-template.md   ✅ reviewed  ║
  ║                                                              ║
  ║ Follow-up TODOs: None — all fields resolved.                 ║
  ╚═══════════════════════════════════════════════════════════════╝
-->

# KingdomOS Constitution

## Core Principles

### I. Terminal-Native Identity

KingdomOS is a terminal-native, hierarchical AI agent orchestration
system themed as a medieval kingdom.

- The system MUST run inside the terminal, PowerShell-first on Windows,
  with Linux support planned as a subsequent target.
- Every design decision MUST favor **token efficiency** over
  convenience — the system exists to maximize work-done-per-token-spent.
- The system MUST achieve full autonomy after initial setup. The
  success metric is: **one full day of autonomous productive work with
  positive results**.
- Heavy lifting MUST be performed by the local model
  (Qwen2.5-Coder-7B-Instruct) whenever possible. API-called models
  (cloud tier) delegate, review, and heal — they do NOT perform grunt
  work.
- Every component MUST earn its place or be removed. No bloat, no
  dead code, no organizational-only abstractions.
- Medieval theming MUST be immersive and persistent across the entire
  project: naming, logging, UI, commands, errors, and documentation.
  Theming MUST NOT obscure engineering clarity — when in doubt,
  clarity wins.

**Rationale**: KingdomOS is not a chat wrapper. It is an autonomous
execution engine that lives where developers already work — the
terminal. Token efficiency is the fundamental constraint that shapes
every architectural choice.

### II. Absolute Security (NON-NEGOTIABLE)

Security is the highest priority, above feature completeness, above
performance, above convenience.

- **ZERO data leakage**: The system MUST never expose personal,
  private, or sensitive data under any circumstances, even after days
  of autonomous operation.
- **NO free internet roaming**: The only permitted internet access is
  through explicitly configured MCP servers (e.g., GitHub MCP for
  repository information). All other outbound connections are
  forbidden.
- **NO security vulnerabilities**: Every code change MUST be evaluated
  for OWASP Top 10 and agent-specific attack surfaces before merge.
- All API keys, tokens, and credentials MUST be stored encrypted and
  MUST NEVER appear in logs, agent instructions, or plaintext files.
- Agent instructions MUST NEVER contain or reference real credentials,
  personal data, or secrets.
- Every autonomous action MUST be auditable — complete logs of what
  was done, by which agent, when, and why.
- Security posture MUST NOT degrade over time. The system MUST be as
  secure on day 30 as on day 1. Accumulated drift from autonomous
  operation MUST be detected and corrected.

**Rationale**: An autonomous system that runs for days without human
oversight has an exponentially larger attack surface than a
human-driven tool. Security failures compound silently. This principle
is non-negotiable because a single breach invalidates all other work.

### III. Token Budget Sovereignty (FOUNDATIONAL)

Token counting is the single most important technical capability.
Every model invocation is a scarce resource expenditure.

- Token counting MUST be razor-sharp, flawless, and model-specific.
- Every model call MUST be preceded by a preflight token budget
  check — **NO EXCEPTIONS**.
- Token counts MUST account for: system prompts, task instructions,
  conversation history, tool schemas, file contents, line ranges,
  output reservation, safety margins, and formatting overhead.
- Conservative estimation is mandatory: overestimate by 10-15% rather
  than risk context overflow.
- When context exceeds budget: the healer MUST evaluate whether to
  compress/summarize or divide the task. Blind truncation is
  forbidden.
- Per-model tokenizer accuracy MUST be maintained and updatable. Each
  model's tokenizer characteristics MUST be stored and verified.
- A "32K context window" model yields approximately 18K-22K usable
  tokens after system prompts, output reservation, safety margins,
  and overhead. All designs MUST target **usable** capacity, not
  advertised spec sheets.

**Rationale**: Token overflow causes silent failures, hallucinations,
and wasted compute. In an autonomous system running thousands of
calls per day, even a 1% overflow rate produces dozens of corrupted
outputs. Budget sovereignty prevents this.

### IV. Hierarchical Authority

Authority flows downward: **KING > NOBILITY > KNIGHT > SQUIRE**.
This hierarchy is inviolable.

- Each tier can only cancel or stop jobs it delegated. No tier may
  cancel jobs delegated TO it from above.
- Every delegated task is a managed, cancellable **job** with
  heartbeats, timeouts, and explicit status states.
- Supervisors delegate **jobs** (task packets with acceptance
  criteria), NOT conversations.
- Task completion is defined by **contract**: acceptance criteria met
  AND reviewer approved. Self-report alone is never sufficient.
- Escalation flows upward: if a problem cannot be solved at the
  current tier, it MUST escalate to the next higher tier.
- Each tier has a fixed retry count. After exhaustion: escalate to
  healer. If healer cannot resolve: escalate to higher
  nobility or king.
- Partial output from cancelled or failed jobs MUST be salvaged when
  possible. Work is never discarded blindly.

**Rationale**: Without strict authority boundaries, autonomous agents
create feedback loops, override each other, and produce
contradictory outputs. The hierarchy ensures deterministic
delegation, clear accountability, and predictable escalation paths.

### V. Code Quality

Every edit to the codebase MUST meet strict quality gates before
application.

- Every code change MUST be produced as a **patch/diff**, NOT as a
  full file rewrite. Patches are smaller, safer, reviewable, and
  token-efficient.
- No code change is applied without meeting ALL acceptance criteria
  defined at task creation.
- No unrelated file changes — the scope of every edit MUST match the
  task scope exactly.
- Every deterministic subsystem (token counting, state management,
  file locking, cancellation logic) MUST have comprehensive tests.
- Dangerous or malevolent edits MUST be caught and rejected. It is
  better to return three tasks to the healer than accept one bad edit
  that compounds over days of autonomous operation.
- The system MUST maintain referential integrity: no stale references,
  no disconnected components. Agent files, skills, instructions, and
  workflow phases MUST be correctly connected and cross-referenced.

**Rationale**: Autonomous code generation without quality gates
produces technical debt at machine speed. Patch-based edits minimize
blast radius. Strict scope enforcement prevents the cascading
regressions that are fatal in unsupervised systems.

### VI. Observability

If it happened, it MUST be logged. If it was not logged, it did not
happen.

- Every model invocation, task transition, review decision,
  cancellation, incident, and retry MUST be logged.
- Logs are time-limited: user-configurable retention period. After
  expiry, logs are cleaned and a single permanent entry is written to
  the **Crypt** (task name, ID, summary, success/failure status).
- Agent memory files are the primary learning mechanism. SQLite
  persistence is for operational state, not permanent archives.
- **Dry-run mode** MUST be available for every operation — simulate
  the full execution path without invoking models or modifying state.

**Rationale**: An autonomous system that cannot explain what it did
is an uncontrollable system. Time-limited logs with permanent Crypt
summaries balance storage constraints with auditability. Dry-run
mode enables safe validation before committing resources.

### VII. Autonomy Safety

The system MUST be safe to leave running unattended for extended
periods.

- No infinite retry loops — every retry chain has a hard cap.
- No runaway token spending — budget tracking is continuous across
  the full session, not just per-call.
- File locks prevent concurrent conflicting edits. The supervising
  agent holds the lock key and releases only after successful review.
- When two workers need the same file: one waits, deterministically.
  No race conditions, no optimistic locking.
- Soft cancellation first, hard kill only on escalation. Workers
  MUST always have a chance to checkpoint before termination.
- Active workers MUST send heartbeats at 10-second intervals. Stale
  heartbeats trigger sentinel alerts and escalation.

**Rationale**: Autonomous agents without safety rails consume
unbounded resources, corrupt shared state, and enter unrecoverable
loops. Every safeguard here addresses a failure mode observed in
real multi-agent systems.

## Testing Standards

Testing is not optional. These standards define the minimum testing
requirements for every subsystem.

| Subsystem | Test Type | Requirements |
|-----------|-----------|-------------|
| Token budgeting | Fixture-based | Known tokenizer outputs for each supported model |
| Cancellation logic | Simulation | Timeout simulation verifying soft-then-hard cancellation flow |
| SQLite operations | Migration & concurrency | Migration tests, concurrent access tests, lock contention tests |
| CLI commands | Contract | Input/output schema verification |
| Task lifecycle | Integration | Full lifecycle: creation → execution → review → completion |
| Security | Boundary enforcement | Credential handling, data isolation, MCP boundary enforcement |

- Every test failure in a security-related subsystem **BLOCKS ALL
  deployment** — no exceptions.
- Deterministic subsystems (token counting, state management, file
  locking) MUST have 100% branch coverage in tests.
- Integration tests MUST cover the full job lifecycle from delegation
  through execution, review, and archival.

## Development Workflow & Compliance Gates

All development — human or agent — MUST comply with this constitution.

### Pre-Implementation Gates

1. **Constitution Check**: Every feature plan MUST be validated against
   all seven core principles before implementation begins.
2. **Token Budget Preflight**: Every model call site MUST demonstrate
   budget compliance at design time.
3. **Security Review**: Every feature touching credentials, network
   access, or agent instructions MUST pass security review.

### Implementation Rules

- All edits are patch-based (Principle V).
- All scope is task-scoped — no drive-by fixes, no unrelated changes.
- All tests pass before merge.
- Security test failures block all deployment (Testing Standards).

### Post-Implementation Validation

- Dry-run validation of new workflows before live deployment.
- Observability verification: confirm all new code paths produce
  appropriate log entries.
- Crypt archival verification: confirm completed tasks write permanent
  summaries.

## Governance

This constitution is the supreme governing document for KingdomOS.
It supersedes all other practices, conventions, and preferences.

### Amendment Procedure

1. Proposed amendments MUST be documented with: the change, the
   rationale, and the impact on existing principles.
2. Amendments MUST NOT weaken security principles (Principle II)
   unless a stronger replacement is simultaneously adopted.
3. All amendments MUST include a migration plan for existing code and
   workflows affected by the change.
4. Version increments follow semantic versioning:
   - **MAJOR**: Principle removal, redefinition, or backward-incompatible
     governance change.
   - **MINOR**: New principle or section added, material expansion of
     existing guidance.
   - **PATCH**: Clarifications, wording fixes, non-semantic refinements.

### Compliance Review

- Every PR and agent-generated code review MUST verify compliance with
  all seven core principles.
- Complexity beyond what a principle permits MUST be justified in a
  Complexity Tracking table (see plan template).
- Non-compliance discovered after merge MUST be treated as a
  high-priority bug and remediated immediately.

### Enforcement

- Agents MUST refuse to execute tasks that violate this constitution.
- The King tier holds final authority on constitutional interpretation.
- Runtime guidance documents (agent instructions, skill files) MUST
  reference this constitution and MUST NOT contradict it.

**Version**: 1.0.0 | **Ratified**: 2026-03-22 | **Last Amended**: 2026-03-22
