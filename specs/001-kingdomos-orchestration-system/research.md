# Research: KingdomOS Orchestration System

**Phase**: 0 — Outline & Research
**Date**: 2026-03-22
**Status**: Complete — all unknowns resolved

## R-001: Token Counting — OpenAI Models

**Decision**: Use `tiktoken` (npm) — the WASM-based package (canonical name, same as `@dqbd/tiktoken`).

**Rationale**: Full 1-to-1 parity with OpenAI's Python tiktoken. Supports all encodings including `o200k_base` (GPT-4o/GPT-5). WASM runs natively in Node.js 22 with zero config. Use `tiktoken/lite` for tree-shakeable imports with only the needed encoding. Call `enc.free()` when done (manual WASM memory management).

**Alternatives Considered**:
- `js-tiktoken` — pure JS port, ~10-30% slower for large inputs, no WASM complexity. Use only if WASM loading is problematic.
- `@dqbd/tiktoken` — deprecated name for same package. Do not use.

## R-002: Token Counting — Qwen/Local Model

**Decision**: Use `@huggingface/tokenizers` (v0.1.3) — lightweight pure-JS tokenizer.

**Rationale**: Qwen2.5-Coder-7B-Instruct uses a standard HuggingFace BPE tokenizer format (`tokenizer.json` + `tokenizer_config.json`). The `@huggingface/tokenizers` package is ~8.3kB gzip, zero dependencies, pure JS, and loads the tokenizer JSON directly. Bundle the `tokenizer.json` file locally to avoid runtime downloads (security: no free internet per Constitution II).

**Alternatives Considered**:
- `@huggingface/transformers` (Transformers.js) — proven with Qwen but overkill for token counting only.
- Python sidecar with `transformers.AutoTokenizer` — exact but adds runtime dependency on Python.
- Note: Qwen2.5 uses BPE format, NOT sentencepiece and NOT raw tiktoken `.tiktoken` files.

## R-003: SQLite Binding

**Decision**: Use `better-sqlite3` (v12.8.0) — synchronous, fastest benchmarks, prebuilt binaries for Node.js 22 LTS.

**Rationale**: Gold standard for synchronous SQLite in Node.js (2.6M downloads/wk). Ships prebuilt binaries for Node.js LTS — Node.js 22 is LTS so prebuilds should work on Windows 11 without compilation. If prebuilds fail, fallback to `node-gyp` requires Visual Studio Build Tools.

**Alternatives Considered**:
- `sql.js` — SQLite compiled to WASM, no native compilation. But async initialization, entire DB in memory, ~10x slower. Use only if native modules are absolutely blocked.
- `@libsql/client` — libSQL fork of SQLite. Worth evaluating if `better-sqlite3` gives Windows trouble.
- Node.js 22 built-in `node:sqlite` (experimental) — evaluate closer to ship date; eliminates the dependency entirely if stable.

**Setup Note**: Document in quickstart.md that Visual Studio Build Tools with C++ workload may be required as a fallback on Windows.

## R-004: CLI Framework

**Decision**: Use Commander.js (v14.0.3) with `@commander-js/extra-typings` for inferred TypeScript types.

**Rationale**: 152M downloads/wk, zero dependencies, built-in TypeScript declarations, supports async actions (`parseAsync()`), subcommands, and lifecycle hooks. `@commander-js/extra-typings` provides inferred types from `.option()` and `.argument()` definitions — strongest TypeScript ergonomics of any CLI library. 12+ subcommands and daemon mode are well-supported.

**Alternatives Considered**:
- oclif — enterprise-grade, plugin system. Overkill for single-user system (18 deps, 417kB).
- yargs — external types via DefinitelyTyped, weaker TypeScript inference.
- clipanion — stuck on RC for 2+ years. Cannot recommend for production.

## R-005: Unified Diff Parsing & Application

**Decision**: Use `diff` (jsdiff, v8.0.3) — handles both parsing AND applying unified diffs.

**Rationale**: Complete pipeline: `parsePatch()` for parsing, `applyPatch()` for applying, `applyPatches()` for multi-file operations, `createPatch()` for generation. Built-in TypeScript types as of v8. Supports `fuzzFactor` for fuzzy matching, `autoConvertLineEndings`, and `compareLine` callbacks. 41M downloads/wk. Single-package solution — no additional library needed.

**Alternatives Considered**:
- `patch-package` — designed for patching node_modules, not general-purpose.
- `git apply` via child_process — adds git dependency, shell escaping concerns, harder to test.

## R-006: Pixel UI Rendering

**Decision**: Direct Canvas 2D API wrapped in React component with `requestAnimationFrame` game loop.

**Rationale**: For pixel-art with `image-rendering: pixelated`, direct Canvas 2D gives precise control over canvas scaling and nearest-neighbor interpolation. Pattern: single `<canvas>` ref in React, `useEffect` for game loop, `drawImage()` for sprite sheets, `ctx.imageSmoothingEnabled = false`. Animated sprites (8-16 frames) are trivially handled with sprite sheet slicing. Health bars and UI widgets are `fillRect()` calls. React handles DOM overlays (menus, dialogs) while Canvas handles pixel rendering.

**Alternatives Considered**:
- PixiJS v8 — WebGL/WebGPU renderer, 70MB unpacked. Overkill for sprites + health bars. Consider later if 1000+ sprites or particle effects needed.
- react-konva — declarative Canvas 2D but not designed for game loops or sprite animation.
- Phaser — full game engine. Overkill for a monitoring UI with sprites.

## R-007: Monorepo Build Tooling

**Decision**: Use `tsc --build` with TypeScript project references for type-checking + incremental compilation. Use tsdown (tsup successor) per-package if bundling is needed.

**Rationale**: tsup v8.5.1 is explicitly deprecated ("not actively maintained, use tsdown"). For 10 internal TypeScript packages: `tsc --build` with project references provides incremental compilation, cross-package type checking, and `.d.ts` generation. Each package gets its own `tsconfig.json` extending a shared `tsconfig.base.json`. Bundle with tsdown only for packages that need it (CLI entry point, UI). Internal-only packages can skip bundling entirely.

**Recommended tsconfig**: `target: ES2022`, `module: Node16`, `moduleResolution: Node16`, `composite: true`, `strict: true`.

**Alternatives Considered**:
- tsup — actively deprecated. Do not start new projects with it.
- unbuild — from Nuxt ecosystem. Less popular, library-publishing focused.
- `tsc` only — simplest approach, works well for internal packages. Use as default; add tsdown only where needed.
- Turborepo/Nx — monorepo orchestration layer (task ordering, caching). Separate concern from bundling. Consider if build times become a problem.

## R-008: Encrypted Credential Storage

**Decision**: Use Node.js built-in `crypto` module with AES-256-GCM encryption. Store encrypted credentials in a local config file, derive encryption key from a user-provided master password using PBKDF2.

**Rationale**: Constitution Principle II requires encrypted credential storage with credentials never appearing in plaintext. Node.js `crypto` module is built-in (zero dependencies), supports AES-256-GCM (authenticated encryption), and PBKDF2 for key derivation. On first setup, user provides a master password; subsequent launches require it to unlock credentials. Alternatively, integrate with Windows Credential Manager via `keytar` for OS-level secure storage.

**Alternatives Considered**:
- Windows Credential Manager via `keytar` — OS-level security, but adds a native dependency and is being deprecated.
- Environment variables — easy but plaintext in process memory and shell history. Use only during development.
- `.env` files — plaintext on disk. Violates Constitution II.

## R-009: Heartbeat Monitoring Architecture

**Decision**: Workers write heartbeats to SQLite. Sentinel daemon thread polls for stale heartbeats every 5 seconds.

**Rationale**: Workers already coordinate through SQLite (shared state). Heartbeats are an UPDATE to the `jobs` table (`heartbeat_at` column) plus an INSERT to the `heartbeats` table for history. The Sentinel runs as a recurring check (via `setInterval` or `node-cron`) in the core daemon process, querying for jobs where `heartbeat_at < NOW() - 30s` and `status = 'running'`. This avoids file-watching complexity and keeps all state in one place.

**Alternatives Considered**:
- File-based heartbeats (chokidar watching files) — adds filesystem overhead and race conditions. SQLite is already the coordination layer.
- IPC/sockets — violates the "all coordination through SQLite" architecture decision.

## R-010: Worker Process Spawning on Windows

**Decision**: Use `child_process.spawn()` with `detached: false` for managed workers. For visible terminal windows, use `start` command via `child_process.exec('start cmd /c "node worker.js"')`.

**Rationale**: Worker processes need to be spawnable as visible terminal windows on Windows for user monitoring. `start` opens new cmd.exe windows. For headless workers (no visible terminal), standard `child_process.spawn()` with `detached: false` keeps them as managed children of the daemon. The daemon tracks worker PIDs for hard-kill capability via `process.kill(pid)`.

**Alternatives Considered**:
- Windows Terminal `wt.exe` — supports tabs, but requires Windows Terminal to be installed. Not guaranteed on all Windows 11 machines.
- PowerShell `Start-Process` via child_process — works but adds PowerShell as a dependency for process spawning.

## R-011: HTTP Server Framework for Pixel UI

**Decision**: Use Fastify v5 for the local HTTP server serving the pixel UI and SSE data bridge.

**Rationale**: Fastify offers better TypeScript support out of the box, superior performance over Express (important for SSE streaming with frequent heartbeat/job updates), structured logging via pino (aligns with Scribe logging), and a plugin architecture that keeps route definitions clean. The UI server serves static Vite-built assets and exposes REST + SSE endpoints for kingdom state (projects, jobs, agents, config, crypt). Fastify's native JSON schema validation protects against malformed API requests without additional middleware.

**Alternatives Considered**:
- Express v5 — broader ecosystem familiarity, but weaker TypeScript types, middleware-chain pattern adds complexity for SSE, and lacks built-in schema validation.
- Hono — lightweight and fast, but less mature ecosystem and fewer production battle-test reports for SSE-heavy workloads on Node.js.
