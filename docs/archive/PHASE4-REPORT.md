# Phase 4 — Compounding Self-Improvement (Report)

Base: `6eb7f09` (Phase 0). Build: `pnpm run build` exit **0**.
Tests: **302 → 336 passing** (+34 new, 0 failures, 40 todo, 5 suites skipped as before).
Schema version: **15 → 33** (migrations 030–033 apply cleanly on a fresh DB).

## Files added
- `packages/core/migrations/030_lessons_outcome_tracking.sql` — lessons: `confidence`, `injected_job_ids`, `outcome_success`, `outcome_total`, `decayed_at`, `origin`.
- `packages/core/migrations/031_lesson_embeddings.sql` — `lesson_embeddings` cache.
- `packages/core/migrations/032_per_model_health.sql` — `provider_model_health`.
- `packages/core/migrations/033_model_eval_results.sql` — `model_configs.verified_at` + `model_eval_results` ledger.
- `packages/providers/src/embedding-provider.ts` — OpenAI + local llama.cpp `EmbeddingProvider`.
- `packages/token-engine/src/eval-harness.ts` — eval battery + capability writer.
- `packages/healer/src/calibration.ts` — additive Healer calibration helper.
- `packages/cli/src/commands/eval.ts` — `kingdom eval`.
- `tests/foundational/phase4-{outcome-tracking,generated-lessons,relevance-injection,model-routing,eval-harness,healer-calibration}.test.ts` (34 tests).
- `PHASE4-PLAN.md`, `PHASE4-REPORT.md`.

## Files changed
- `packages/core/src/repositories/lessons-repo.ts` — outcome tracking, decay/promote, `origin`/seed confidence; defensive vs pre-030 DB.
- `packages/core/src/memory/lesson-injector.ts` — async relevance-ranked `buildLessonsBlock` + `selectRelevantLessons` + `cosineSimilarity`; `buildLessonsBlockSync` for the sync packet path; dynamic cap; generated-lesson confidence gate; embedding cache.
- `packages/core/src/memory/sanitize.ts` — hardened role-delimiter strip set + `isLikelyInjection` gate.
- `packages/core/src/types.ts` — additive `Lesson` outcome fields + `MemoryConfig` semantic-injection fields.
- `packages/core/src/job/packet-assembler.ts` — calls `buildLessonsBlockSync`, threads `jobId` for injection tracking.
- `packages/core/src/index.ts` — new exports.
- `packages/providers/src/health-tracker.ts` — per-(provider,model) health API.
- `packages/providers/src/router.ts` — model-aware routing + per-model failover.
- `packages/providers/src/index.ts` — new exports.
- `packages/scribe/src/lesson-distiller.ts` — `distillGenerated()` generative pass.
- `packages/scribe/src/scribe-agent.ts` — outcome attribution on task completion.
- `packages/scribe/src/index.ts`, `packages/token-engine/src/index.ts` — new exports.
- `packages/token-engine/src/model-registry.ts` — `writeVerifiedCapabilities`.
- `packages/cli/src/index.ts` — registers `eval`.

## How the loop closes
1. Distiller (rules R1–R5 + `distillGenerated`) writes lessons; generated ones start gated.
2. `buildLessonsBlock(Sync)` injects lessons into a job's prompt and records `injected_job_ids`.
3. On task completion the Scribe calls `recordOutcome(jobId, success)` → win-rate recompute → decay losers / promote winners. Crypt success is the positive signal.
4. Injection is relevance-ranked (cosine vs the task) when an embedder is configured; otherwise unchanged.
5. `kingdom eval` measures models → `verified_at` + capabilities → the resolver/router route on evidence; per-model health refines provider choice.

## INTEGRATION NOTES (shared-file edits — all marked `// PHASE4:`)
- **`packages/token-engine/src/model-registry.ts`** (Phase 0 owns the seed): ADDITIVE only — appended `writeVerifiedCapabilities()` + private `hasVerifiedAtColumn()` after `getSafeInputBudget` (~lines 63–95). No existing method changed; reads/writes go through the migration-033 `verified_at` column and overwrite `capabilities_json`.
- **`packages/healer/src/diagnostician.ts`**: **NOT TOUCHED.** P4.5 is delivered as a standalone `packages/healer/src/calibration.ts` (exported from the healer index) so Phase 3's diagnostician rewrite is unaffected. The diagnostician can opt in later with a one-line `calibrateConfidence(db, raw)` call before its `<0.5 → escalate` gate.
- **`packages/core/src/job/packet-assembler.ts`** (orchestration-adjacent): minimal — `buildMessages` gained an optional `jobId` param; the lesson block call switched from `buildLessonsBlock` → `buildLessonsBlockSync` (identical output) and now records the injection→job mapping. Marked `// PHASE4:` at the call site (~lines 122, 187–197).
- **`packages/core/src/memory/lesson-injector.ts`**: `buildLessonsBlock` is now **async** (relevance ranking may await an embedder). The only in-repo caller (packet-assembler) uses the new sync variant, so no caller broke. External callers that want relevance ranking should `await buildLessonsBlock({..., embedder})`.

## Deferred TODOs
- **P4.3 probes**: `code-diff`, `review`, `diagnose` use lightweight pass heuristics; `decompose` is fully graded. Richer rubrics (apply diff + compile-check; labelled secure/insecure review suite; labelled incident suite) are marked `TODO(P4.3)` in `eval-harness.ts`.
- **Auto-tiering wiring**: `recommendTierClass` / `winsTaskKind` expose the signal; promoting a winning model into the knight *profile* in `kingdom.config.json` is left to an operator step (eval writes the evidence; config flip is not automated).
- **P4.5 wiring**: calibration helper exists but is not yet called by the diagnostician (intentionally, to survive Phase 3).
- **Embedder config**: `EmbeddingProvider` is plumbed and tested with a fake; wiring a default embedder from `kingdom.config.json` into the orchestration prompt path (vs. the sync packet path) is a follow-up.

## Verification
- `pnpm run build` → exit 0.
- `pnpm test` → 336 passed / 0 failed.
- Fresh-DB migration check → all 030–033 tables/columns present, schema_version=33.
