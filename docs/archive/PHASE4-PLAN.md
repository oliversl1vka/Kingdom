# Phase 4 — Compounding Self-Improvement (Plan)

Branched from the Phase 0 capability substrate (`6eb7f09`). Builds on
`getModelCapabilities`, the resolver, and the native tool-use / structured-output
API. Goal: a memory loop that proves which lessons help, retrieves them by
relevance, routes by model evidence, and measures its own models.

## Deliverables & approach

### P4.1 — LLM-discovered, outcome-validated, decaying lessons
- **Migration 030**: add `confidence`, `injected_job_ids`, `outcome_success`,
  `outcome_total`, `decayed_at`, `origin` to `lessons`.
- **lessons-repo.ts**: `recordInjection(jobId, lessonIds)`,
  `recordOutcome(jobId, success)` (Laplace-smoothed win-rate, decays losers,
  drops the job from pending), `recordCryptSuccess`, `listPromoted`,
  `computeWinRate`. Defensive against a pre-030 DB.
- **lesson-distiller.ts**: new async `distillGenerated()` — feeds incidents +
  review feedback the 5 rules did NOT match to an LLM via `response_format`
  structured output, parses candidates, gates with `isLikelyInjection`, runs the
  same `sanitize` + dedup `signature` path, stores `origin='generated'` with a
  seed confidence.
- **scribe-agent.ts**: on `recordTaskCompletion`, attribute the task outcome to
  the lessons injected into its jobs (crypt success = positive signal).

### P4.2 — Relevance-ranked semantic injection
- **Migration 031**: `lesson_embeddings` cache.
- **EmbeddingProvider** interface (core) + OpenAI (`text-embedding-3-small`) and
  local llama.cpp implementations (providers).
- **lesson-injector.ts**: async `buildLessonsBlock` ranks lessons by cosine
  similarity of body vs current task; failure-type matches retained for the
  Healer; dynamic byte cap for large-context models; generated-lesson confidence
  gate. **Graceful degrade**: with no embedder / on embedder error, falls back
  to today's `times_seen DESC` order. `buildLessonsBlockSync` preserves the
  packet-assembler's synchronous path byte-for-byte.

### P4.3 — Model self-eval & auto-tiering harness
- **Migration 033**: `model_configs.verified_at` + `model_eval_results` ledger.
- **eval-harness.ts**: 4-probe battery (decompose / code-diff / review /
  diagnose); `evaluateModel` runs probes via an injected adapter, derives
  measured `ModelCapabilities` (+ `verified_at`), persists results, writes
  capabilities into the registry; `recommendTierClass` / `winsTaskKind` feed
  auto-tiering. `decompose` probe is fully graded; the other three are real but
  lightweight (richer rubrics are TODO).
- **model-registry.ts**: `writeVerifiedCapabilities` (additive to Phase 0 seed).
- **CLI**: `kingdom eval [--model --probes --dry-run --json]`.

### P4.4 — Model-aware routing + per-model health
- **Migration 032**: `provider_model_health`.
- **health-tracker.ts**: `updateModelAfterCall`, `getModelHealth`,
  `isModelAvailable`, `modelHealthScore` (per provider+model).
- **router.ts**: build a model→provider(s) index from `model_configs`; route
  only to providers serving `request.model`, ordered by health then priority;
  record per-model latency/errors; cooldown a failing (provider,model) pair so
  the loop re-resolves (fallback chain at model granularity). Unknown models
  fall back to legacy provider fanout.

### P4.5 (hook only) — Healer calibration
- **calibration.ts** (separate module so it survives Phase 3's diagnostician
  rewrite): `computeCalibration` / `calibrateConfidence` shrink over-confident
  diagnoses based on historical resolve-rate. Not yet wired into
  `diagnostician.ts` — opt-in one-liner left for Phase 3.

## Security
- `sanitize.ts` hardened (broader role-delimiter strip set) and a new
  `isLikelyInjection` gate **rejects** (not just strips) generated lessons that
  look like prompt-injection. Generated lessons are withheld from injection
  until their outcome-validated confidence clears `GENERATED_INJECT_THRESHOLD`.

## Constraints honored
- Migrations limited to 030–033.
- Shared files (`model-registry.ts`, `diagnostician.ts`) touched additively /
  not at all — see INTEGRATION NOTES in the report.
