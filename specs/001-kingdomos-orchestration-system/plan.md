# Implementation Plan: KingdomOS — Autonomous Hierarchical Agent Orchestration System

**Branch**: `001-kingdomos-orchestration-system` | **Date**: 2026-03-22 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `/specs/001-kingdomos-orchestration-system/spec.md`

## Summary

Build a terminal-native, medieval-themed hierarchical AI agent orchestration system in TypeScript/Node.js. The system decomposes user objectives into a task graph, delegates jobs through a KING → NOBILITY → KNIGHT → SQUIRE hierarchy, executes coding tasks primarily on a local Qwen 7B model via LM Studio, reviews outputs, heals failures, and iterates autonomously. A preflight token budget engine gates every model call. Coordination happens through SQLite shared state with file-based agent identities and memory. A pixel-art medieval UI served via a local web server provides visualization and configuration.

## Technical Context

**Language/Version**: TypeScript (strict mode, ESM) on Node.js 22+
**Primary Dependencies**: better-sqlite3 (sync SQLite), tiktoken (OpenAI tokenizers), @huggingface/tokenizers (Qwen tokenizer), commander.js (CLI), jsdiff (unified diff parsing/application), chokidar (file watching), React 19 + Vite (pixel UI), Express or Fastify (local HTTP server for UI)
**Storage**: SQLite via better-sqlite3 (synchronous, single-file); file system for agent identities (markdown), task packets (JSON), patches (unified diff), memory (markdown), logs
**Testing**: Vitest (unit + integration), fixture-based token tests, process simulation for cancellation/heartbeat tests
**Target Platform**: Windows 11 + PowerShell 7+ (primary); Linux (future, not MVP)
**Project Type**: CLI application + local web UI (monorepo with pnpm workspaces)
**Performance Goals**: Preflight token budget check < 50ms; heartbeat writes every 10s; UI updates via SSE with < 1s latency; SQLite ops < 10ms for single-row operations
**Constraints**: Must operate within free-tier API token budgets across multiple providers; local model limited to ~18-22K usable tokens per call (32K advertised); single machine, multiple terminal workers as child processes; zero internet access outside MCP-gated services
**Scale/Scope**: Single user, single machine, 1-10 concurrent worker processes, hundreds of tasks per day, SQLite database < 1GB under normal operation

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| # | Principle | Status | Evidence |
|---|-----------|--------|----------|
| I | Terminal-Native Identity | PASS | CLI-first with `kingdom` command; PowerShell-first on Windows; local model does grunt work; medieval theming throughout; monorepo with earn-your-place module policy |
| II | Absolute Security | PASS | Encrypted credential storage (FR-030); MCP-only internet access (FR-029); full audit logging (FR-023); no credentials in agent instructions (FR-031); zero-leakage edge cases documented |
| III | Token Budget Sovereignty | PASS | Preflight budget check before every model call (FR-003); model-specific tokenizers (tiktoken + HF); conservative 10-15% safety margin (FR-005); usable capacity targeting (18-22K for 32K models); budget-rejected status in lifecycle |
| IV | Hierarchical Authority | PASS | KING > NOBILITY > KNIGHT > SQUIRE hierarchy with clear delegation rules; cancellation restricted to delegator (FR-013); contract-based completion (FR-014); escalation chain through healer to higher tiers |
| V | Code Quality | PASS | All output as unified diffs (FR-009); scope enforcement (FR-015); acceptance criteria gating (FR-014); retry with feedback (FR-016); comprehensive test requirements per Testing Standards |
| VI | Observability | PASS | Every event logged (FR-023); time-limited retention with Crypt archival (FR-024); dry-run mode (FR-025); agent memory persistence (FR-026) |
| VII | Autonomy Safety | PASS | Heartbeats every 10s (FR-010); stall detection (FR-011); soft-then-hard cancellation (FR-012); file locking (FR-019); retry caps with healer escalation (FR-017) |

**Gate result: PASS — all seven principles satisfied. Proceeding to Phase 0.**

### Post-Design Re-evaluation (after Phase 1)

| # | Principle | Status | Design Artifact Evidence |
|---|-----------|--------|--------------------------|
| I | Terminal-Native Identity | PASS | CLI contracts define 13 `kingdom` commands (cli-commands.md); local Qwen model assigned to Knight/Squire tiers for grunt work; medieval naming throughout data model (Crypt, Kingdom, Decree); quickstart is terminal-first |
| II | Absolute Security | PASS | Credential encryption contract uses AES-256-GCM + PBKDF2 (internal-interfaces.md §7); credentials never in SQLite or logs; ProviderAdapter never exposes raw keys; FileLock prevents unauthorized file access; worker confined to `allowed_files` in JobPacket |
| III | Token Budget Sovereignty | PASS | TokenBudgetCheckRequest/Result contract enforces preflight on every job (internal-interfaces.md §1); per-segment counting with priority-based trimming; 12% safety margin; tiktoken for OpenAI, HF for Qwen, char fallback as last resort |
| IV | Hierarchical Authority | PASS | Data model enforces tier assignment per level (epic→nobility, task→knight, subtask→squire); `delegating_supervisor_id` on Job controls cancellation authority; ReviewDecision requires separate reviewer agent; `reviewer_tier >= assigned_tier` |
| V | Code Quality | PASS | Diff output contract (internal-interfaces.md §6) mandates unified diff for all code output; ReviewDecision has scope_check, format_check, criteria_check gates; Blacksmith uses jsdiff for parse+apply; `allowed_files` enforces task scope |
| VI | Observability | PASS | Heartbeat table with per-job history; IncidentReport with structured symptoms and failure history; CryptEntry is never-deleted permanent archive; all CLI commands support `--json` for machine-readable output; Sentinel logs contract |
| VII | Autonomy Safety | PASS | Heartbeat protocol: 10s write interval, 5s poll, 30s stale threshold (internal-interfaces.md §4); `max_retries` cap on TaskGraphNode; FileLock with `max_duration_seconds` and force-release; `cancel_requested` soft-cancel flag on Job; Healer confidence threshold enforces escalation when < 0.5 |

**Post-design gate result: PASS — all seven principles remain satisfied after Phase 1 design.**

## Project Structure

### Documentation (this feature)

```text
specs/001-kingdomos-orchestration-system/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output (CLI command schemas)
└── tasks.md             # Phase 2 output (/speckit.tasks command)
```

### Source Code (repository root)

```text
kingdom-os/
├── packages/
│   ├── core/                # Daemon process, job orchestration, task graph engine
│   │   └── src/
│   ├── cli/                 # Commander.js CLI entry point and subcommands
│   │   └── src/
│   ├── ui/                  # React 19 + Vite pixel-art medieval UI
│   │   └── src/
│   │       ├── components/
│   │       ├── scenes/
│   │       └── api/
│   ├── token-engine/        # Token budgeting, model-specific tokenizers, model registry
│   │   └── src/
│   ├── providers/           # Model provider adapters (OpenAI, Anthropic, Google, LMStudio)
│   │   └── src/
│   ├── agents/              # Agent lifecycle management, identity loading/parsing
│   │   └── src/
│   ├── sentinel/            # Heartbeat monitoring, timeout enforcement, health checks
│   │   └── src/
│   ├── healer/              # Incident diagnosis, recovery recommendation engine
│   │   └── src/
│   ├── blacksmith/          # Patch parsing, application, validation (jsdiff)
│   │   └── src/
│   └── scribe/              # Logging, Crypt management, retention cleanup
│       └── src/
├── kingdom/                 # Runtime data directory (created per-project)
│   ├── agents/              # Agent identity markdown files (templates)
│   ├── memory/              # Agent memory files (Obsidian-compatible markdown)
│   │   └── shared/          # Repo-wide shared context
│   ├── tasks/               # Task packet JSON files
│   ├── artifacts/           # Produced patches and diffs
│   ├── reviews/             # Review decision records
│   └── kingdom.db           # SQLite database
├── tests/
│   ├── token-engine/        # Tokenizer accuracy fixture tests
│   ├── sentinel/            # Timeout and cancellation simulation tests
│   ├── integration/         # Full lifecycle integration tests
│   └── security/            # Credential handling and isolation tests
├── assets/                  # Medieval pixel art sprites and UI assets
├── docs/                    # Project documentation
├── package.json
├── pnpm-workspace.yaml
└── tsconfig.json
```

**Structure Decision**: Monorepo with pnpm workspaces. Ten packages reflecting the medieval role hierarchy: `core` (daemon/orchestration), `cli` (entry point), `ui` (pixel UI), `token-engine` (budget system), `providers` (model adapters), `agents` (identity management), `sentinel` (monitoring), `healer` (recovery), `blacksmith` (patch tooling), `scribe` (logging/crypt). Each package has clear boundaries, independent tests, and earns its place per Constitution Principle I.

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| 10 packages in monorepo | Each maps 1:1 to a medieval role with distinct responsibility; constitution requires modular, earn-your-place components | Fewer packages would create god-modules mixing unrelated concerns (e.g., token counting + patch application); each package has clear test boundaries |
| Separate UI package with React + Vite | Pixel-art canvas rendering requires a browser runtime; terminal-based TUI cannot render animated pixel sprites at the required fidelity | A pure-text TUI was considered but cannot deliver the medieval pixel-art experience specified; the local web server approach keeps UI separate from engine |
