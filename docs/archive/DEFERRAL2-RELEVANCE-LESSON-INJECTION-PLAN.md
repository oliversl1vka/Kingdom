# Deferral #2 — Relevance-Ranked Lesson Injection (async assembly wiring)

> **Low-risk, high-value.** Most of the machinery already exists and is unit-tested; this plan only
> wires it onto the live (already-async) assembly path and adds an embedder from config. No invariant
> changes, no safety implications. Executable end-to-end by a fresh session.
>
> **Branch state assumed:** integrated tree at/after `8c26755` (build exit 0, 403 tests).

---

## 1. Mission

Inject the lessons that are **relevant to the current task** (semantic similarity) instead of the
globally most-frequent ones, so the budget shows the model the lesson that prevents *this* task's
failure — and so injection quality *improves* as the lesson corpus grows (frequency-ranking degrades
with scale; relevance-ranking scales). Exploit large context windows via the dynamic cap. Always
**degrade gracefully** to today's frequency ordering when no embedder is configured.

---

## 2. Current state (grounded)

Already built and tested (no work needed, just wiring):
- `packages/core/src/memory/lesson-injector.ts`:
  - `buildLessonsBlock(input): Promise<string>` (L82) — **relevance** path; uses `selectRelevantLessons` + `EmbeddingProvider`; records injection via `LessonsRepository.recordInjection(jobId, ids)`.
  - `buildLessonsBlockSync(input): string` (L136) — **legacy frequency** path; identical pre-Phase-4 output.
  - `selectRelevantLessons(candidates, opts)` (L224) — cosine ranking, failure-type pinning, graceful degrade on embedder error/empty.
  - `cosineSimilarity` (L277), `applyDynamicCap` (L325), confidence gate for generated lessons (L319).
  - `LessonInjectionInput` (L55): `{ db, kingdomDir, tier, config?, taskText?, embedder?, failureType?, modelContextTokens?, jobId? }`.
  - `EmbeddingProvider` interface (L44): `{ model; embed(texts): Promise<number[][]> }`.
- `packages/providers/src/embedding-provider.ts`: `createOpenAIEmbeddingProvider(cfg)` (L59, default `text-embedding-3-small`) and `createLocalEmbeddingProvider(cfg)` (L95, llama.cpp/LM Studio `/v1/embeddings`, default `http://localhost:8080` + `nomic-embed-text`). Both OpenAI-compatible; degrade by throwing.

The gap — `packages/core/src/job/packet-assembler.ts`:
- `assembleForJob(job, task, grounded?)` (sync, L136) builds messages via the **private sync** `buildMessages(task, identityPath, grounded?, jobId?)` (L241), which injects lessons via `buildLessonsBlockSync`.
- `assembleForJobAsync(job, task)` (L174) is the **live path** (the dispatcher already calls it, dispatcher.ts L692). It resolves grounded context, then calls the **sync** `assembleForJob` — so lessons are still injected by frequency.
- No `embedder` is threaded into the assembler, and `modelContextTokens` (for the dynamic cap) isn't passed.

**Why this is small:** the expensive half (making the live path async) is *already done* — `assembleForJobAsync` exists and is wired. We only need to (a) inject the **async relevance** lessons block on that path, (b) thread an embedder + context-size from config.

---

## 3. Target design

### 3.1 Factor lesson injection to a single seam (packet-assembler.ts)
Refactor `buildMessages` so the lessons block is **passed in** rather than computed inside:
```ts
// before: buildMessages(task, identityPath, grounded?, jobId?)   // calls buildLessonsBlockSync internally
// after:  buildMessages(task, identityPath, grounded?, jobId?, lessonsBlock?: string)
//         injects the provided lessonsBlock where buildLessonsBlockSync was called.
```
- **Sync path** (`assembleForJob`): compute `lessonsBlock = buildLessonsBlockSync({...})` (unchanged behavior) and pass it in. Preserves all existing sync tests byte-for-byte.
- **Async path** (`assembleForJobAsync`): compute `lessonsBlock = await buildLessonsBlock({... taskText, embedder, modelContextTokens, failureType, jobId})` (relevance) and pass it in, then delegate the rest of packet construction to `assembleForJob(job, task, grounded, { lessonsBlock })` (add an internal options arg so the async path injects its precomputed block instead of recomputing the sync one).

### 3.2 Thread inputs
Add to the assembler's construction options (`AssemblyOptions` used in summon L492):
```ts
embedder?: EmbeddingProvider;                              // absent ⇒ frequency (degrade)
modelContextResolver?: (modelId: string) => number | undefined;  // → safe input budget for dynamic cap
```
- `taskText` = `[task.title, ...task.acceptance_criteria, task.description].filter(Boolean).join('\n')`.
- `modelContextTokens` = `modelContextResolver?.(packet.model_id)` (from token-engine `getSafeInputBudget`).
- `failureType` = the task's most recent failure type when present (optional; primarily helps the healer tier). Pull from the task/job failure history if readily available; otherwise omit.
- `jobId` = `job.id` (already threaded for outcome tracking).

### 3.3 Embedder from config (summon.ts)
Add config block:
```json
"embeddings": {
  "enabled": true,
  "provider": "local",                 // "local" (llama.cpp) | "openai"
  "endpoint": "http://localhost:8080",
  "model": "nomic-embed-text",
  "api_key_name": "openai"             // only for provider: "openai"
}
```
In summon, when `embeddings.enabled`:
- `provider==='openai'` → `createOpenAIEmbeddingProvider({ api_key: creds.openai, model, endpoint })`.
- `provider==='local'` → `createLocalEmbeddingProvider({ endpoint, model })`.
Pass into `assemblyOptions.embedder` and a `modelContextResolver` backed by `modelRegistry.getSafeInputBudget`. When `embeddings.enabled` is false/absent → pass nothing → frequency ordering (degrade). Env kill-switch: `KINGDOM_NO_LESSONS=1` already disables injection entirely.

---

## 4. Step-by-step plan

**S0 — Assembler refactor (no behavior change).** Make `buildMessages` accept a `lessonsBlock`; sync path computes it via `buildLessonsBlockSync` and passes it. Build + full suite green (byte-identical).

**S1 — Async relevance on the live path.** `assembleForJobAsync` computes the block via `await buildLessonsBlock({...})` and threads it through. Add `embedder`/`modelContextResolver` to assembler options (default undefined ⇒ degrade). Build + suite green.

**S2 — Config + summon wiring.** Add `embeddings` config; construct provider; pass `embedder` + `modelContextResolver` into `assemblyOptions`. Build + suite green.

**S3 — Tests (§5) + docs.** Update `KINGDOMOS-CORE-EVOLUTION.md` (mark deferral #2 closed) and note the config in `CLAUDE.md`/`PHASE0-FOUNDATION.md`.

---

## 5. Test plan (`tests/core/relevance-lessons.test.ts`, fake embedder — no network)

Use a deterministic fake `EmbeddingProvider` that maps known strings to fixed vectors (e.g. one-hot per keyword) so similarity is predictable.
- **relevance ordering:** seed 3 active lessons for an injection tier (e.g. `nobility`); the one whose body shares the task's keyword ranks **first** in the rendered block when an embedder + `taskText` are supplied via `assembleForJobAsync`.
- **graceful degrade:** same fixture, **no embedder** → output equals the `buildLessonsBlockSync` frequency order (assert identical block).
- **embedder error:** fake embedder throws → falls back to frequency order; no exception escapes assembly.
- **dynamic cap:** with `modelContextTokens ≥ large_context_threshold`, the byte cap is multiplied (more lessons survive) — assert a lesson present that would be truncated at the base cap.
- **injection recorded once:** `LessonsRepository.recordInjection` called with `job.id` and the selected lesson ids (spy/assert a single call).
- **non-injection tier:** a `knight` packet injects nothing (DEFAULT_INJECTION_TIERS unchanged).
- build exit 0; full suite green.

---

## 6. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Embedding endpoint down/slow | Provider throws ⇒ `selectRelevantLessons` degrades to frequency (already implemented + tested); 30s timeout in `postEmbeddings`. |
| Added latency per job | One embedding call per assembled packet on injection tiers only; cache via `lesson_embeddings` table (already written best-effort in `cacheEmbeddings`). |
| Local embedding model not installed | `embeddings.enabled:false` (default safe) ⇒ frequency ordering; opt-in only. |
| Sync path regression | S0 keeps `buildLessonsBlockSync` as the sync source; golden test asserts identical block. |

---

## 7. Definition of Done
- `assembleForJobAsync` injects relevance-ranked lessons when an embedder is configured, frequency-ranked otherwise.
- `embeddings` config wired in summon (local + openai); degrade path intact.
- §5 tests green; build exit 0; full suite green.
- `KINGDOMOS-CORE-EVOLUTION.md` deferral #2 marked closed.

---

## 8. File-by-file change manifest

| File | Change |
|---|---|
| `packages/core/src/job/packet-assembler.ts` | `buildMessages` accepts `lessonsBlock`; `assembleForJobAsync` computes it via async `buildLessonsBlock`; add `embedder` + `modelContextResolver` options |
| `packages/cli/src/commands/summon.ts` | build `EmbeddingProvider` from `embeddings` config; pass `embedder` + `modelContextResolver` into `assemblyOptions` |
| `kingdom.config.json` | + `embeddings` block (default `enabled:false` until a local embed model is confirmed, or `true` with `provider:"local"`) |
| `tests/core/relevance-lessons.test.ts` | **new** — §5 suite with a fake embedder |
| `KINGDOMOS-CORE-EVOLUTION.md` | mark deferral #2 closed |
