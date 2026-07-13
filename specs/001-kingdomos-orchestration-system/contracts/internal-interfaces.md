# Internal Interface Contracts

**Phase**: 1 — Design & Contracts
**Date**: 2026-03-22

This document defines contracts between internal packages. All interfaces are TypeScript-first; the SQLite database is the sole coordination mechanism (no IPC, no sockets, no message brokers).

---

## 1. Token Budget Check — `@kingdomos/token-engine`

The pre-flight budget gate that every job must pass before execution.

### Request

```typescript
interface TokenBudgetCheckRequest {
  /** Job identifier */
  job_id: string;
  /** Model to be invoked */
  model_id: string;
  /** Context segments to be included in the prompt */
  context_segments: ContextSegment[];
  /** Reserved tokens for expected output */
  output_reservation: number;
}

interface ContextSegment {
  /** Label for tracking (e.g., "system-prompt", "file:src/main.ts") */
  label: string;
  /** Raw text content */
  content: string;
  /** If true, cannot be trimmed — fails the check if it doesn't fit */
  required: boolean;
  /** Lower = higher priority when trimming */
  priority: number;
}
```

### Response

```typescript
interface TokenBudgetCheckResult {
  /** Whether the context fits within the model's safe input budget */
  approved: boolean;
  /** Total tokens counted across all segments */
  total_tokens: number;
  /** Model's safe input budget (context_window - output_reservation - safety_margin) */
  budget_limit: number;
  /** Tokens remaining after context (negative if over budget) */
  headroom: number;
  /** Per-segment breakdown */
  segment_counts: { label: string; tokens: number; included: boolean }[];
  /** If not approved: segments that were trimmed or excluded */
  trimmed_segments?: string[];
  /** Strategy used: 'exact' (tiktoken/HF) or 'estimate' (char-based fallback) */
  counting_strategy: 'exact' | 'estimate';
}
```

### Contract Rules
- Uses `tiktoken` (WASM) for OpenAI models, `@huggingface/tokenizers` for Qwen, character estimate (÷4) as universal fallback
- Safety margin: per-model configurable via `ModelConfig.safety_margin_percent` (default 12%) — applied as overestimation on all token counts
- If `approved: false`, the caller must compress context and retry
- Token counting is synchronous (both tiktoken WASM and HF tokenizers support sync API)

---

## 2. Provider Adapter — `@kingdomos/providers`

Uniform interface for all LLM providers (OpenAI, Anthropic, Google, LM Studio).

### Interface

```typescript
interface ProviderAdapter {
  /** Provider identifier */
  readonly provider_id: string;

  /** Send a completion request */
  complete(request: CompletionRequest): Promise<CompletionResponse>;

  /** Check provider health (lightweight ping) */
  healthCheck(): Promise<ProviderHealthStatus>;
}

interface CompletionRequest {
  model: string;
  messages: Message[];
  /** Maximum tokens to generate */
  max_tokens: number;
  /** Temperature (0.0-2.0) */
  temperature?: number;
  /** Stop sequences */
  stop?: string[];
  /** System prompt (prepended to messages) */
  system?: string;
}

interface Message {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface CompletionResponse {
  /** Generated text */
  content: string;
  /** Tokens used in prompt */
  prompt_tokens: number;
  /** Tokens generated */
  completion_tokens: number;
  /** Total tokens */
  total_tokens: number;
  /** Provider-reported finish reason */
  finish_reason: 'stop' | 'length' | 'content_filter' | 'error';
  /** Raw provider response metadata */
  metadata?: Record<string, unknown>;
}

interface ProviderHealthStatus {
  status: 'healthy' | 'degraded' | 'unavailable' | 'rate-limited';
  latency_ms?: number;
  error?: string;
}
```

### Contract Rules
- Each provider package exports a factory: `createAdapter(config: ProviderConfig): ProviderAdapter`
- All providers normalize responses to `CompletionResponse` regardless of native API shape
- Rate limit errors must set `ProviderHealth.cooldown_until` in the database
- LM Studio adapter uses OpenAI-compatible endpoint (`/v1/chat/completions`)
- Timeouts: 30s for cloud providers, 120s for local LM Studio
- All errors wrapped in `ProviderError` with `{ provider_id, status_code, retryable, message }`

---

## 3. Job Packet — `@kingdomos/core`

The data structure passed from a delegating supervisor to a worker.

### Schema

```typescript
interface JobPacket {
  /** Job identifier */
  job_id: string;
  /** Task identifier */
  task_id: string;
  /** Agent identity file path */
  agent_identity_path: string;
  /** Model to invoke */
  model_id: string;
  /** Pre-assembled prompt messages */
  messages: Message[];
  /** Files this job is authorized to modify */
  allowed_files: string[];
  /** Expected output format */
  output_format: 'unified-diff' | 'markdown' | 'json' | 'free-text';
  /** Acceptance criteria for self-check */
  acceptance_criteria: string[];
  /** Token budget (max tokens for the model call) */
  max_tokens: number;
  /** Timeout in seconds */
  timeout_seconds: number;
  /** Path to write the result artifact */
  result_path: string;
}
```

### Contract Rules
- Serialized as JSON, passed to worker via temp file (path passed as CLI argument to worker process)
- Worker reads the packet, executes the model call, writes result to `result_path`
- Worker must not modify files outside `allowed_files`
- Worker must emit heartbeats to the SQLite `heartbeats` table every 10 seconds

---

## 4. Heartbeat Protocol — `@kingdomos/core`

How workers signal liveness to the Sentinel.

### Write Contract (Worker → SQLite)

```sql
INSERT INTO heartbeats (job_id, worker_id, timestamp, status, progress, tokens_generated)
VALUES (?, ?, datetime('now'), ?, ?, ?);
```

### Read Contract (Sentinel → SQLite)

```sql
-- Find stale jobs: no heartbeat in the last 30 seconds (3 missed 10s heartbeats)
SELECT j.id, j.task_id, j.worker_id, j.started_at,
       MAX(h.timestamp) as last_heartbeat
FROM jobs j
LEFT JOIN heartbeats h ON j.id = h.job_id
WHERE j.status IN ('running', 'streaming')
GROUP BY j.id
HAVING last_heartbeat IS NULL
   OR last_heartbeat < datetime('now', '-30 seconds');
```

### Contract Rules
- Workers write heartbeats every 10 seconds
- Sentinel polls every 5 seconds
- Stale threshold: 30 seconds (3 missed 10-second heartbeats)
- On stale detection: Sentinel marks job as `stalled`, creates incident report
- SQLite WAL mode enables concurrent reads during worker writes

---

## 5. Incident Report Protocol — `@kingdomos/core` → `@kingdomos/healer`

How failures are communicated to the Healer.

### Submission

```typescript
interface IncidentSubmission {
  task_id: string;
  job_id?: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  failure_type: string;
  symptoms: Record<string, unknown>;
  context_summary: string;
  failure_history: { attempt: number; reason: string; timestamp: string }[];
}
```

### Healer Response

```typescript
interface HealerDiagnosis {
  incident_id: string;
  probable_cause: string;
  confidence: number; // 0.0 - 1.0
  recommendation: HealerRecommendation;
}

type HealerRecommendation =
  | { action: 'retry'; modifications: string }
  | { action: 'decompose'; new_subtasks: NewSubtaskSpec[] }
  | { action: 'reassign'; target_tier: string; reason: string }
  | { action: 'escalate'; message: string };

interface NewSubtaskSpec {
  title: string;
  description: string;
  type: string;
  acceptance_criteria: string[];
  context_refs: { file: string; startLine: number; endLine: number }[];
}
```

### Contract Rules
- Incidents are written to the `incidents` table by the Sentinel or supervising agent
- Healer polls for undiagnosed incidents
- Healer must provide a confidence score; if < 0.5, the recommendation must be `escalate`
- `decompose` creates new TaskGraphNode entries; original task status set to `awaiting-redesign`

---

## 6. Diff Output Format — `@kingdomos/blacksmith`

Standard format for code-producing agents' output, parsed by `jsdiff`.

### Format

Unified diff format (RFC 5261 style):

```
--- a/src/example.ts
+++ b/src/example.ts
@@ -10,7 +10,8 @@
 import { foo } from './foo';
 
 function example() {
-  return foo();
+  const result = foo();
+  return validate(result);
 }
```

### Contract Rules
- All code-producing jobs MUST output unified diff format
- File paths in diff headers are relative to project root
- Reviewer validates: (1) diff parses cleanly, (2) only `allowed_files` are modified, (3) hunks apply cleanly
- `jsdiff.parsePatch()` used for parsing; `jsdiff.applyPatch()` used for application
- If diff fails to apply (merge conflict), job status set to `failed-invalid-output`

---

## 7. Credential Encryption — `@kingdomos/core`

How API keys are stored and retrieved.

### Storage Format

```typescript
interface EncryptedCredential {
  /** Initialization vector (hex-encoded, 12 bytes for GCM) */
  iv: string;
  /** AES-256-GCM encrypted ciphertext (hex-encoded) */
  ciphertext: string;
  /** GCM authentication tag (hex-encoded, 16 bytes) */
  auth_tag: string;
  /** PBKDF2 salt (hex-encoded, 32 bytes) */
  salt: string;
  /** PBKDF2 iteration count */
  iterations: number;
}
```

### Contract Rules
- Encryption key derived from user-provided password via PBKDF2 (100,000 iterations, SHA-256)
- Each credential gets a unique random IV and salt
- Stored in a local file: `kingdom/.credentials.enc` (JSON array of named entries)
- Never logged, never included in agent context, never written to SQLite
- Decrypted credentials held in memory only for the duration of the API call
