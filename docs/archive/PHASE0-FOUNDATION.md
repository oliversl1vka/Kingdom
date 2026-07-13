# Phase 0 — Capability Substrate (API Reference)

> The keystone layer. Adds native **tool-use** + **structured output** to the provider
> interface, a new **llama.cpp** local provider, and activates the dormant
> **capability-based model routing**. Everything here is backward-compatible: when the
> new fields are absent, adapters behave byte-identically to before (the weak-model
> prose-and-parse path is preserved). Downstream phases (agentic Knight loop, structured
> decomposer/judge/healer, repo-grounded planner) build on this surface.

---

## 1. Tool-use & structured-output request/response surface

Defined in `packages/core/src/types.ts` (exported from `@kingdomos/core` and re-exported
from `@kingdomos/providers`). **All new fields are OPTIONAL.**

```ts
type JSONSchema = Record<string, unknown>; // permissive; forwarded verbatim to the provider

interface ToolDefinition { name: string; description: string; parameters: JSONSchema; }
interface ToolCall       { id: string; name: string; arguments: Record<string, unknown>; }
type ToolChoice = 'auto' | 'none' | 'required' | { name: string };
interface ResponseFormat { type: 'json_schema'; schema: JSONSchema; name?: string; strict?: boolean; }

interface CompletionRequest {
  // ...existing fields unchanged...
  tools?: ToolDefinition[];
  tool_choice?: ToolChoice;        // only meaningful when `tools` set
  response_format?: ResponseFormat; // schema-constrained JSON response
}

interface CompletionResponse {
  // ...existing fields unchanged...
  tool_calls?: ToolCall[];         // populated when the model requested tool calls
}

type FinishReason = 'stop' | 'length' | 'content_filter' | 'error' | 'tool_calls';
// ^ new 'tool_calls' member, set whenever tool_calls is non-empty.
```

### How to call it (5-line example)

```ts
import { createOpenAIAdapter } from '@kingdomos/providers';
const adapter = createOpenAIAdapter({ api_key: process.env.OPENAI_API_KEY! });
const res = await adapter.complete({
  model: 'gpt-4.1-mini', max_tokens: 1024, messages: [{ role: 'user', content: 'Plan it.' }],
  tools: [{ name: 'emit_task_graph', description: 'Emit the plan', parameters: { type: 'object', properties: { tasks: { type: 'array' } }, required: ['tasks'] } }],
  tool_choice: { name: 'emit_task_graph' },          // force the call
});
if (res.finish_reason === 'tool_calls') console.log(res.tool_calls![0].arguments); // already JSON-parsed
```

For a guaranteed JSON object instead of a tool call, pass
`response_format: { type: 'json_schema', schema, name, strict }` and read `res.content`
(JSON string). `arguments` / structured content are already parsed/serialized for you.

### Per-adapter mapping (all in `packages/providers/src/`)

| Adapter | tools → | tool_choice → | response_format → | tool_calls parsed from |
|---|---|---|---|---|
| `openai-adapter.ts` | `tools:[{type:'function',function:{name,description,parameters}}]` | `'auto'\|'none'\|'required'` or `{type:'function',function:{name}}` | `{type:'json_schema',json_schema:{name,schema,strict}}` | `message.tool_calls` (args JSON-parsed) |
| `llamacpp-adapter.ts` | same OpenAI-compatible shape | same | same json_schema `response_format` (preferred; llama-server also accepts `grammar`) | `message.tool_calls` |
| `lmstudio-adapter.ts` | OpenAI-compatible `tools` pass-through | pass-through | **NOT** emitted (weak-model fallback — kept on the prose path) | `message.tool_calls` |
| `anthropic-adapter.ts` | `tools:[{name,description,input_schema}]` | `{type:'auto'\|'any'\|'none'}` or `{type:'tool',name}` | **synthesized**: a single forced tool whose `input_schema` IS the schema; its input is surfaced as JSON `content` (Anthropic has no native json_schema response_format) | `tool_use` content blocks |
| `google-adapter.ts` | `tools:[{functionDeclarations:[{name,description,parameters}]}]` | `toolConfig.functionCallingConfig.mode` = `AUTO\|ANY\|NONE` (+`allowedFunctionNames`) | `generationConfig.responseMimeType:'application/json'` + `responseSchema` | `functionCall` parts |

OpenAI / LM Studio / llama.cpp share `packages/providers/src/openai-compat.ts`
(`buildOpenAICompatBody`, `parseOpenAICompatResponse`) so their behavior stays identical.

**Invariant:** when `tools`, `tool_choice`, and `response_format` are all absent, every
adapter produces the exact request body it produced before Phase 0. Verified by tests.

---

## 2. llama.cpp provider (new local default; replaces LM Studio)

`packages/providers/src/llamacpp-adapter.ts`:

```ts
import { createLlamaCppAdapter, type LlamaCppConfig } from '@kingdomos/providers';
const local = createLlamaCppAdapter({ endpoint: 'http://localhost:8080' }); // default endpoint
// provider_id === 'llamacpp'; no api_key. OpenAI-compatible /v1/chat/completions.
// healthCheck → GET /health (falls back to /v1/models). 300s default timeout.
```

- Supports tools (OpenAI-compatible `tools`) **and** structured output via llama.cpp's
  `response_format:{type:'json_schema',json_schema:{schema}}` (preferred forward-compatible
  feature; `grammar` also accepted by llama-server).
- Registered in `ProviderRouter.initializeAdapters` (key `llamacpp`, endpoint default 8080)
  and wired into `summon.ts` / `dry-run.ts` / `doctor.ts`.
- `LM Studio` adapter (`createLMStudioAdapter`) is retained for back-compat.

### Config (`kingdom.config.json`)

```jsonc
"providers": {
  "lmstudio": { "endpoint": "http://localhost:1234", "priority_order": 2, "enabled": false },
  "llamacpp": { "endpoint": "http://localhost:8080", "priority_order": 3, "enabled": true }
}
// squire tier now: { "model": "qwen2.5-coder-7b", "provider": "llamacpp", ... }
```

---

## 3. Capability-based model routing (activated)

### Resolver precedence rule — `makeModelResolver` (`packages/token-engine/src/resolve-model.ts`)

1. **An explicit `tier.profile` ALWAYS wins** → `resolveModel` scores the registry; the
   `tier.model` becomes the final fallback only if the profile matches nothing.
2. Otherwise, **a concrete `tier.model` pin is honored exactly** — no synthetic profile is
   injected (this is the anti-regression for the old squire→gpt-4.1-mini misroute; a pure
   pin resolves to that exact model, `source: 'pinned'`).
3. Only when **neither** a profile nor a pin is set is a default profile for the task kind
   synthesized so unconfigured tiers still resolve.

Two config tiers now carry example `profile` blocks (still keeping `model` as fallback):
`knight` (`implementation` / cheap / `needs_tool_use`) and `squire`
(`implementation` / cheap / `prefer_local` → routes to the local llama.cpp coder).

### Capabilities lookup helper

```ts
import { ModelRegistry } from '@kingdomos/token-engine';
const caps = new ModelRegistry(db).getModelCapabilities(modelId); // ModelCapabilities | null
// null  = unknown OR unverified → assume the legacy prose-and-parse path.
// Phase 2/3 gate agentic loops on caps.tool_use / caps.structured_output.
```

`ModelCapabilities` = `{ strengths, tool_use, structured_output, multimodal, streaming,
tier_class, latency_class, verified_at? }`.

### Seeded capability rows — migration `015_phase0_capabilities.sql`

| model | provider | tool_use | structured_output | tier_class | notes |
|---|---|---|---|---|---|
| `gpt-4.1-mini` | openai | ✓ | ✓ | balanced | king/nobility/judge/healer workhorse |
| `gpt-4o-mini` | openai | ✓ | ✓ | cheap | (seeded in 009) |
| `gpt-4o` | openai | ✓ | ✓ | premium | (seeded in 009) frontier example |
| `claude-opus-4` | anthropic | ✓ | ✓ | premium | frontier example |
| `qwen2.5-coder-7b` | **llamacpp** | ✗ | ✓ | cheap | local coder; migrated off lmstudio; tool_use false keeps prose fallback |

---

## Files changed / added

- **Added**: `packages/providers/src/llamacpp-adapter.ts`,
  `packages/providers/src/openai-compat.ts`,
  `packages/core/migrations/015_phase0_capabilities.sql`,
  `tests/providers/adapter-tooluse.test.ts`,
  `tests/token-engine/phase0-capabilities.test.ts`, this file.
- **Modified**: `packages/core/src/types.ts` (new optional fields/types + `'tool_calls'`
  finish reason); `packages/providers/src/{openai,anthropic,google,lmstudio}-adapter.ts`,
  `index.ts`, `router.ts`, `types.ts`; `packages/token-engine/src/{resolve-model.ts,
  model-registry.ts}`; `packages/cli/src/commands/{summon,dry-run,doctor}.ts`;
  `kingdom.config.json`.
