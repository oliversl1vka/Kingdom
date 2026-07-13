# CLI Command Contracts

**Phase**: 1 — Design & Contracts
**Date**: 2026-03-22

This document defines the input/output contracts for every KingdomOS CLI command.

**Executable**: `kingdom` (global binary via `pnpm` workspace, registered in `packages/cli/package.json` `"bin"`)
**Framework**: Commander.js v14 + @commander-js/extra-typings

---

## 1. `kingdom init`

Initialize a new KingdomOS project in the current directory.

| Aspect | Contract |
|--------|----------|
| **Usage** | `kingdom init [project-name]` |
| **Positional** | `project-name` (optional, defaults to directory name) |
| **Options** | `--force` — overwrite existing configuration |
| **Creates** | `kingdom.config.json`, `kingdom/` directory structure |
| **Exit 0** | "Kingdom '{name}' established at {path}" |
| **Exit 1** | Configuration already exists (without `--force`) |

**Output Directory Structure**:
```
kingdom/
├── agents/            # Agent identity files
├── memory/            # Agent memory files
│   └── shared/        # Cross-agent shared memory
└── kingdom.db         # SQLite database
```

---

## 2. `kingdom decree <objective>`

Submit a new high-level objective for the King to decompose.

| Aspect | Contract |
|--------|----------|
| **Usage** | `kingdom decree <objective>` |
| **Positional** | `objective` (required, string, max 2000 chars) |
| **Options** | `--priority <n>` (1-10, default: 5) |
| | `--dry-run` (show plan without executing) |
| | `--criteria <file>` (path to acceptance criteria JSON) |
| **Stdin** | Accepts objective from stdin if positional not provided |
| **Exit 0** | JSON: `{ "objective_id": string, "task_count": number, "estimated_tokens": number }` |
| **Exit 1** | No active kingdom, invalid priority range |

---

## 3. `kingdom summon`

Start the agent orchestration system (Sentinel, workers, background services).

| Aspect | Contract |
|--------|----------|
| **Usage** | `kingdom summon` |
| **Options** | `--workers <n>` (max concurrent workers, default: auto-detect from CPU cores) |
| | `--no-ui` (headless mode, terminal output only) |
| | `--verbose` (verbose logging to stdout) |
| **Behavior** | Spawns Sentinel as a background process; Sentinel manages workers |
| **Exit 0** | "Kingdom awakened. Sentinel watching. {n} workers standing by." |
| **Exit 1** | Kingdom not initialized, Sentinel already running |

---

## 4. `kingdom farewell`

Gracefully shut down all running agents and services.

| Aspect | Contract |
|--------|----------|
| **Usage** | `kingdom farewell` |
| **Options** | `--force` (kill workers without waiting for in-progress jobs) |
| | `--timeout <seconds>` (wait this long for graceful shutdown, default: 30) |
| **Behavior** | Sets `cancel_requested` on all active jobs; waits for completion or timeout |
| **Exit 0** | "Kingdom rests. All agents dismissed." |
| **Exit 1** | No running kingdom found |

---

## 5. `kingdom status`

Display current system status: active jobs, agent health, queue depth.

| Aspect | Contract |
|--------|----------|
| **Usage** | `kingdom status` |
| **Options** | `--json` (machine-readable output) |
| | `--watch` (live-updating terminal display) |
| | `--jobs` (show only active jobs) |
| | `--agents` (show only agent statuses) |
| **Exit 0** | Status report (table or JSON) |
| **Exit 1** | Kingdom not initialized |

**JSON Schema** (when `--json`):
```json
{
  "kingdom": { "name": "string", "uptime_seconds": "number" },
  "sentinel": { "pid": "number", "status": "string" },
  "workers": { "active": "number", "max": "number" },
  "jobs": {
    "running": "number",
    "queued": "number",
    "completed_today": "number",
    "failed_today": "number"
  },
  "token_budget": {
    "estimated_remaining": "number",
    "consumed_today": "number"
  }
}
```

---

## 6. `kingdom treasury`

View and manage token budget allocations.

| Aspect | Contract |
|--------|----------|
| **Usage** | `kingdom treasury [subcommand]` |
| **Subcommands** | `status` (default) — show current token budget |
| | `history` — show token consumption over time |
| | `set-limit <tokens>` — set daily token limit |
| **Options** | `--json` (machine-readable output) |
| | `--period <days>` (history lookback, default: 7) |
| **Exit 0** | Budget report |
| **Exit 1** | Kingdom not initialized |

---

## 7. `kingdom crypt`

Query the permanent history archive.

| Aspect | Contract |
|--------|----------|
| **Usage** | `kingdom crypt [query]` |
| **Positional** | `query` (optional, search term) |
| **Options** | `--last <n>` (show last N entries, default: 20) |
| | `--failures` (show only failed tasks) |
| | `--json` (machine-readable output) |
| **Exit 0** | Matching crypt entries (table or JSON) |
| **Exit 1** | Kingdom not initialized |

---

## 8. `kingdom heal <task-id>`

Manually trigger the Healer on a failed task.

| Aspect | Contract |
|--------|----------|
| **Usage** | `kingdom heal <task-id>` |
| **Positional** | `task-id` (required, ULID) |
| **Options** | `--strategy <name>` (`retry` \| `decompose` \| `reassign`, default: auto) |
| **Exit 0** | JSON: `{ "incident_id": string, "action": string, "new_tasks": string[] }` |
| **Exit 1** | Task not found, task not in failed state |

---

## 9. `kingdom cancel <task-id>`

Request cancellation of a task and its descendants.

| Aspect | Contract |
|--------|----------|
| **Usage** | `kingdom cancel <task-id>` |
| **Positional** | `task-id` (required, ULID) |
| **Options** | `--force` (attempt immediate kill of worker process) |
| | `--reason <text>` (cancellation reason, recorded in DB) |
| **Behavior** | Sets `cancel_requested` on job; worker checks flag at next heartbeat |
| **Exit 0** | "Cancellation requested for task {id} and {n} descendants." |
| **Exit 1** | Task not found, task already completed/cancelled |

---

## 10. `kingdom inspect <task-id>`

Show detailed information about a task, its jobs, heartbeats, and review history.

| Aspect | Contract |
|--------|----------|
| **Usage** | `kingdom inspect <task-id>` |
| **Positional** | `task-id` (required, ULID) |
| **Options** | `--json` (machine-readable output) |
| | `--full` (include heartbeat history and all review decisions) |
| **Exit 0** | Task detail report |
| **Exit 1** | Task not found |

---

## 11. `kingdom dry-run <objective>`

Simulate objective decomposition without executing.

| Aspect | Contract |
|--------|----------|
| **Usage** | `kingdom dry-run <objective>` |
| **Positional** | `objective` (required, string) |
| **Options** | `--depth <n>` (decomposition depth, default: full) |
| | `--json` (machine-readable output) |
| **Exit 0** | Simulated task tree with token estimates |
| **Exit 1** | Kingdom not initialized |

---

## 12. `kingdom configure`

View or update KingdomOS configuration.

| Aspect | Contract |
|--------|----------|
| **Usage** | `kingdom configure [key] [value]` |
| **Positional** | `key` (optional, dot-notation config key) |
| | `value` (optional, new value) |
| **Options** | `--list` (show all current config values) |
| | `--reset <key>` (reset to default) |
| | `--json` (machine-readable output) |
| **Behavior** | No args → interactive config wizard; key only → show value; key+value → set |
| **Exit 0** | Configuration updated/displayed |
| **Exit 1** | Invalid key, invalid value type |

---

## 13. `kingdom sentinel`

Direct control of the Sentinel monitoring process.

| Aspect | Contract |
|--------|----------|
| **Usage** | `kingdom sentinel <subcommand>` |
| **Subcommands** | `status` — show Sentinel health and poll metrics |
| | `restart` — restart the Sentinel process |
| | `logs` — tail Sentinel log output |
| **Options** | `--json` (machine-readable output) |
| | `--lines <n>` (log tail lines, default: 50) |
| **Exit 0** | Requested output |
| **Exit 1** | Sentinel not running |

---

## Global Options (all commands)

| Option | Description |
|--------|-------------|
| `--help` | Show help text |
| `--version` | Show version |
| `--no-color` | Disable color output |
| `--config <path>` | Override config file path |
