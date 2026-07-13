# KingdomOS Architecture

## Overview

KingdomOS is a medieval-themed autonomous hierarchical agent orchestration system. It decomposes complex software tasks into a hierarchy of agents, each responsible for specific aspects of code generation, review, and healing.

## Package Structure (9 active packages)

```
packages/
├── core/         # Shared kernel: DB, types, config, repositories, lifecycle, MCP
├── cli/          # Commander.js CLI (kingdom binary) with 13 commands
├── token-engine/ # Token counting (tiktoken, HF, char÷4), budget checking
├── providers/    # LLM adapters (LM Studio, OpenAI, Anthropic, Google) + router
├── agents/       # Agent identity templates, tier management, memory manager
├── sentinel/     # Heartbeat monitoring, lock cleanup, health polling
├── healer/       # Incident reporting, LLM-based diagnosis, action execution
├── blacksmith/   # Diff parsing and application (jsdiff)
└── scribe/       # Structured event logging, Crypt writer, retention
```

The former React/Vite pixel art dashboard and related assets are preserved at
`archive/browser-dashboard-2026-05-30/`. It is not part of the active package graph.

## Data Flow

```
User → CLI (decree) → ProjectRepository + ObjectiveRepository
                     → TaskDecomposer (LLM-based decomposition)
                     → TaskRepository (task graph storage)
                     → JobDispatcher (polls queued jobs)
                     → JobPacketAssembler (assembles context)
                     → BudgetChecker (token validation)
                     → ProviderRouter (selects LLM provider)
                     → Worker (executes via provider adapter)
                     → ReviewEngine (4 checks: scope, format, security, criteria)
                     → CryptWriter (permanent history)
                     → Sentinel (heartbeat monitoring)
```

## Entity Relationships

- **Project** → has many **Objectives**
- **Objective** → has many **TaskGraphNodes** (root tasks)
- **TaskGraphNode** → has many children (recursive), has many **Jobs**
- **Job** → has many **Heartbeats**, has many **Reviews**
- **Job** → may have **FileLocks**, **IncidentReports**
- **ProviderHealth** → tracks LLM provider availability
- **ModelConfig** → defines token limits per model
- **CryptEntry** → permanent completion record per task
- **EventLog** → structured audit trail

## Key Design Decisions

- **SQLite + WAL mode**: Single-file coordination, no external DB required
- **Hierarchical agents**: King → Nobility → Knight → Squire tier system
- **TDD approach**: Tests before implementation for all contracts
- **Medieval theming**: All terminology reflects castle/kingdom metaphors
- **AES-256-GCM**: Credential encryption with PBKDF2 key derivation
- **MCP boundary enforcement**: No free internet roaming; only configured MCP servers
- **Terminal-first operations**: dashboard work centers on CLI/TUI views over durable runtime state

## Technology Stack

| Component | Technology | Version |
|-----------|-----------|---------|
| Runtime | Node.js | 22+ |
| Language | TypeScript (strict, ESM) | 5.7+ |
| Database | better-sqlite3 (WAL) | 12.8.0 |
| CLI | Commander.js | 14 |
| Testing | Vitest | 3 |
| Token Counting | tiktoken (WASM) | - |
| Diff Tooling | jsdiff | 8.0.0 |
| IDs | ULID (ulidx) | - |
