# KingdomOS Quickstart Guide

**Phase**: 1 — Design & Contracts
**Date**: 2026-03-22

## Prerequisites

| Requirement | Version | Purpose |
|-------------|---------|---------|
| Node.js | 22+ (LTS) | Runtime |
| pnpm | 9+ | Package manager and monorepo workspace |
| Git | 2.40+ | Version control |
| LM Studio | Latest | Local model hosting (optional but recommended) |
| VS Build Tools | 2022+ | Native addon compilation for `better-sqlite3` (Windows only, if prebuilt not available) |

### Optional: Local Model Setup

1. Install [LM Studio](https://lmstudio.ai/)
2. Download **Qwen2.5-Coder-7B-Instruct** (GGUF Q4_K_M quantization)
3. Start the local server (default: `http://localhost:1234`)
4. Verify: `curl http://localhost:1234/v1/models`

---

## Installation

```bash
# Clone the repository
git clone <repository-url> kingdomos
cd kingdomos

# Install all dependencies (pnpm workspaces)
pnpm install

# Build all packages (tsc --build with project references)
pnpm build
```

---

## First Kingdom

### 1. Initialize

```bash
# Create a new kingdom in your project directory
cd /path/to/your/project
kingdom init "My First Kingdom"
```

This creates:
- `kingdom.config.json` — project configuration
- `kingdom/` — runtime data directory (agents, memory, database)

### 2. Configure Providers

```bash
# Set up your API keys (encrypted storage)
kingdom configure providers.openai.api-key
# You'll be prompted for: API key + encryption password

# Or configure LM Studio (no key needed)
kingdom configure providers.lmstudio.endpoint http://localhost:1234
```

### 3. Assign Models to Tiers

```bash
# King tier — strongest model for planning
kingdom configure tiers.king.model gpt-4o

# Nobility — mid-tier for supervision
kingdom configure tiers.nobility.model gpt-4o-mini

# Knight — work-tier for coding
kingdom configure tiers.knight.model qwen2.5-coder-7b

# Squire — lightweight for subtasks
kingdom configure tiers.squire.model qwen2.5-coder-7b
```

### 4. Issue a Decree

```bash
# Dry-run first to see the plan without executing
kingdom dry-run "Add input validation to all API endpoints"

# Execute for real
kingdom decree "Add input validation to all API endpoints" --priority 7
```

### 5. Summon the Kingdom

```bash
# Start the orchestration system
kingdom summon --workers 4

# Watch activity
kingdom status --watch
```

### 6. Monitor and Inspect

```bash
# Check overall status
kingdom status

# Inspect a specific task
kingdom inspect <task-id>

# View the permanent history
kingdom crypt --last 10

# Check token spending
kingdom treasury status
```

### 7. Shut Down

```bash
# Graceful shutdown (waits for in-progress jobs)
kingdom farewell

# Force shutdown (immediate)
kingdom farewell --force
```

---

## Project Structure

After `pnpm install && pnpm build`, the monorepo looks like:

```
kingdomos/
├── packages/
│   ├── core/           # SQLite schema, shared types, coordination logic
│   ├── cli/            # Commander.js CLI entry point
│   ├── token-engine/   # Token counting (tiktoken + HF tokenizers)
│   ├── providers/      # LLM provider adapters (OpenAI, Anthropic, Google, LM Studio)
│   ├── agents/         # Agent identity templates and runtime
│   ├── sentinel/       # Health monitoring, heartbeat polling
│   ├── healer/         # Failure diagnosis and recovery
│   ├── blacksmith/     # Diff parsing/application (jsdiff)
│   ├── scribe/         # Logging and observability
│   └── ui/             # React 19 + Canvas 2D pixel art dashboard
├── pnpm-workspace.yaml
├── tsconfig.json       # Root tsconfig with project references
└── package.json        # Root workspace package
```

---

## Common Workflows

### Cancel a stuck task

```bash
kingdom cancel <task-id> --reason "Requirements changed"
```

### Manually heal a failed task

```bash
kingdom heal <task-id> --strategy decompose
```

### View Sentinel logs

```bash
kingdom sentinel logs --lines 100
```

---

## Troubleshooting

| Problem | Solution |
|---------|----------|
| `better-sqlite3` fails to install | Install VS Build Tools 2022 or use `npm install --build-from-source` |
| LM Studio connection refused | Verify LM Studio server is running: `curl http://localhost:1234/v1/models` |
| "Kingdom not initialized" | Run `kingdom init` in your project directory |
| Token budget always rejected | Check safety margin: `kingdom configure token-engine.safety-margin` (default: 0.12) |
| Sentinel keeps restarting | Check `kingdom sentinel logs` for crash reason |
