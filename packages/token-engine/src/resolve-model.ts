import type {
  CapabilityProfile,
  ModelConfig,
  TierConfig,
  TaskKind,
  TierClass,
  LatencyClass,
} from '@kingdomos/core';
import type { ModelRegistry } from './model-registry.js';

/**
 * Result of `resolveModel()`. Always carries a `model_id` — the caller can
 * hand it straight to a provider adapter. `source` explains *why* this model
 * was chosen, which is useful for logging and dry-run explanations.
 */
export interface ResolvedModel {
  model: ModelConfig;
  /**
   * - `pinned`   — operator set `tier.model` to a concrete ID, we honored it.
   * - `profile`  — selected by capability profile scoring.
   * - `alias`    — matched an alias on the registry (e.g. "best-coder").
   * - `fallback` — primary selection was unavailable, picked from fallback_chain.
   * - `default`  — ultimate fallback to the `tier.model` string.
   */
  source: 'pinned' | 'profile' | 'alias' | 'fallback' | 'default';
  /** Human-readable trace for dry-run / logging. */
  rationale: string;
}

/**
 * Score candidate models against a capability profile. Higher is better.
 * Returns `null` when a hard constraint fails (context window too small,
 * required capability missing) — the candidate is filtered out entirely.
 *
 * Scoring heuristic (not a hard science — tune by watching real runs):
 *   +10  for each task_kind match in `strengths`
 *   +5   for matching cost_preference
 *   +5   for matching latency_preference
 *   +3   for prefer_local match
 *   +1   for each "nice-to-have" capability present beyond minimum
 */
export function scoreCandidate(model: ModelConfig, profile: CapabilityProfile): number | null {
  // Unverified models can still be picked, but only as a last resort.
  const caps = model.capabilities;
  if (!caps) return 0.5;

  // Hard filters.
  if (profile.min_context_tokens && model.safe_input_budget < profile.min_context_tokens) return null;
  if (profile.needs_tool_use && !caps.tool_use) return null;
  if (profile.needs_structured_output && !caps.structured_output) return null;
  if (profile.needs_multimodal && !caps.multimodal) return null;

  let score = 0;
  if (caps.strengths.includes(profile.task_kind)) score += 10;
  if (profile.cost_preference && caps.tier_class === profile.cost_preference) score += 5;
  if (profile.latency_preference && caps.latency_class === profile.latency_preference) score += 5;
  if (profile.prefer_local && isLocalProvider(model.provider)) score += 3;

  // Small tiebreaker: prefer recently-verified models.
  if (caps.verified_at) {
    const daysSince = (Date.now() - Date.parse(caps.verified_at)) / 86_400_000;
    if (Number.isFinite(daysSince) && daysSince < 90) score += 1;
  }

  return score;
}

function isLocalProvider(provider: string): boolean {
  return (
    provider === 'lmstudio' ||
    provider === 'llamacpp' ||
    provider === 'ollama' ||
    provider === 'local'
  );
}

/**
 * Find the best model for a capability profile. Returns null if nothing in the
 * registry satisfies the hard filters. Does NOT fall back to the tier's pinned
 * `model` string — that's `resolveModel()`'s job.
 */
export function selectByProfile(
  profile: CapabilityProfile,
  registry: ModelRegistry,
): { model: ModelConfig; score: number } | null {
  const candidates = registry.getAllModels();
  let best: { model: ModelConfig; score: number } | null = null;

  for (const model of candidates) {
    const score = scoreCandidate(model, profile);
    if (score === null) continue;
    if (best === null || score > best.score) {
      best = { model, score };
    }
  }
  return best;
}

/**
 * The single seam consumers call. Resolution order:
 *
 *   1. If `tier.profile` is set → try capability-based selection.
 *   2. If `tier.model` is an alias → look it up in the registry.
 *   3. If `tier.model` is a direct ID → look it up in the registry.
 *   4. If `fallback_chain` has entries → try each in order.
 *   5. Final: return a synthetic ResolvedModel pointing at `tier.model` —
 *      caller can still hand it to a provider even if we know nothing about
 *      it (useful for brand-new models not yet in the registry).
 *
 * This means the legacy path (just `tier.model = "gpt-4o-mini"`) keeps
 * working unchanged, and operators can adopt capability-based selection
 * incrementally by adding a `profile` field to one tier at a time.
 */
export function resolveModel(tier: TierConfig, registry: ModelRegistry): ResolvedModel {
  // 1. Capability profile is the highest-priority selector.
  if (tier.profile) {
    const picked = selectByProfile(tier.profile, registry);
    if (picked) {
      return {
        model: picked.model,
        source: 'profile',
        rationale:
          `selected ${picked.model.model_id} for ${tier.profile.task_kind} ` +
          `(score ${picked.score})`,
      };
    }
    // Profile yielded nothing — fall through to pinned/fallback.
  }

  // 2 + 3. Try the pinned model (direct ID or alias).
  const pinned = registry.getModelConfig(tier.model);
  if (pinned) {
    const isAlias = pinned.model_id !== tier.model;
    return {
      model: pinned,
      source: isAlias ? 'alias' : 'pinned',
      rationale: isAlias
        ? `alias "${tier.model}" → ${pinned.model_id}`
        : `pinned model ${pinned.model_id}`,
    };
  }

  // 4. Fallback chain.
  if (tier.fallback_chain) {
    for (const entry of tier.fallback_chain) {
      if (typeof entry === 'string') {
        const fb = registry.getModelConfig(entry);
        if (fb) {
          return {
            model: fb,
            source: 'fallback',
            rationale: `fallback to ${fb.model_id} (primary "${tier.model}" not in registry)`,
          };
        }
      } else {
        const picked = selectByProfile(entry, registry);
        if (picked) {
          return {
            model: picked.model,
            source: 'fallback',
            rationale:
              `fallback profile picked ${picked.model.model_id} ` +
              `(primary "${tier.model}" not in registry)`,
          };
        }
      }
    }
  }

  // 5. Synthetic — registry doesn't know this model yet. We return a stub
  //    ModelConfig so the caller has *something* to hand to a provider.
  //    Token accounting will fall back to character-estimate mode.
  return {
    model: syntheticConfig(tier.model),
    source: 'default',
    rationale: `no registry entry for "${tier.model}" — using conservative defaults`,
  };
}

function syntheticConfig(modelId: string): ModelConfig {
  return {
    model_id: modelId,
    provider: 'unknown',
    display_name: modelId,
    context_window: 8192, // conservative
    safe_input_budget: 6144,
    output_reservation: 2048,
    safety_margin_percent: 0.2, // extra margin for unknown models
    tokenizer_type: 'character-estimate',
    tokenizer_config: null,
    tier_assignment: null,
    capabilities: null,
    aliases: [],
  };
}


/**
 * Convenience factory: build a resolver closure for a specific task kind.
 * Consumers like `ReviewEngine` accept a `() => string` resolver to avoid
 * depending on `token-engine` directly (which would create an import cycle
 * with `core`). This helper makes wiring them up a one-liner:
 *
 *   const resolver = makeModelResolver(tier, registry, 'review');
 *   new ReviewEngine(db, provider, resolver);
 *
 * If the tier already has a `profile`, it is used as-is. Otherwise we inject
 * a default profile for `taskKind` so operators don't have to configure
 * every tier up-front.
 */
export function makeModelResolver(
  tier: TierConfig,
  registry: ModelRegistry,
  taskKind: TaskKind,
): () => string {
  // Precedence (Phase 0 — activate dormant capability tiering):
  //   1. An EXPLICIT `tier.profile` ALWAYS wins. Operators opt into capability
  //      routing by adding a profile; once present it is authoritative and
  //      `resolveModel` consults the registry (the `tier.model` becomes the
  //      final fallback if the profile matches nothing).
  //   2. Otherwise, if a concrete `tier.model` is pinned, honor the pin and do
  //      NOT inject a synthetic profile — injecting one would resurrect the
  //      squire→gpt-4.1-mini misroute (a capability-picked model silently
  //      overriding an operator pin). The pin must resolve to that exact model.
  //   3. Only when NEITHER a profile NOR a pin is present do we synthesize a
  //      default profile for `taskKind` so unconfigured tiers still resolve.
  const hasExplicitProfile = !!tier.profile;
  const hasPinnedModel = typeof tier.model === 'string' && tier.model.length > 0;
  const resolvedTier: TierConfig = hasExplicitProfile || hasPinnedModel
    ? tier
    : { ...tier, profile: { task_kind: taskKind } };
  return () => resolveModel(resolvedTier, registry).model.model_id;
}
