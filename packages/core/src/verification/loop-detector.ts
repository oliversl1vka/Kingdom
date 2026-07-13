import { createHash } from 'node:crypto';
import type { ProviderAdapter } from '../types.js';

/**
 * PHASE3 (P3.4) — Semantic loop-breaking.
 *
 * The legacy stuck-detector (`isFeedbackIdentical`) compared retry feedback by
 * raw string overlap (>=50% of bullet lines identical). A rephrased same-cause
 * failure slips past it and burns the whole retry budget; a superficial wording
 * tweak also defeats it. This module decides "is the model stuck on the SAME
 * ROOT CAUSE?" using a normalized failure signature plus a cheap LLM
 * "same root cause? y/n" comparison, cached by signature-pair hash. It falls
 * back to the lexical check when no provider is available or the provider errors
 * (preserving the weak-model / offline path).
 */

export interface LoopDetectorDeps {
  /** Optional provider used for the one-line semantic comparison. */
  provider?: ProviderAdapter | null;
  /** Model id for the comparison call. */
  model?: string;
  /** Cache keyed by signature-pair hash → boolean (same root cause?). */
  cache?: Map<string, boolean>;
  /** Per-call timeout (ms). Default 10s. */
  timeoutMs?: number;
}

/**
 * Reduce a list of failure reasons to a single normalized root-cause line.
 * Lowercased, whitespace-collapsed, volatile tokens (hashes, line numbers,
 * paths, hex, timestamps) masked so cosmetic differences don't read as
 * different causes.
 */
export function computeFailureSignature(reasons: string[]): string {
  const joined = reasons.join(' | ').toLowerCase();
  const normalized = joined
    .replace(/[a-f0-9]{8,}/g, '<hex>')                 // hashes / ids
    .replace(/\b\d{4}-\d{2}-\d{2}[t \d:.,z+-]*/g, '<ts>') // timestamps
    .replace(/(?:line|col(?:umn)?)\s*\d+/g, 'line <n>')   // line/col refs
    .replace(/:\d+(?::\d+)?/g, ':<n>')                  // path:line:col
    .replace(/\b\d+\b/g, '<n>')                          // bare numbers
    .replace(/['"`].*?['"`]/g, '<str>')                 // quoted literals
    .replace(/\s+/g, ' ')
    .trim();
  return normalized;
}

/** Stable hash of a failure signature (for cache keys / persistence). */
export function signatureHash(signature: string): string {
  return createHash('sha1').update(signature).digest('hex').slice(0, 16);
}

/**
 * Legacy lexical check, preserved verbatim as the fallback path. Returns true
 * if >=50% of the current reasons match a previous reason exactly.
 */
export function isFeedbackIdentical(previous: string[], current: string[]): boolean {
  if (previous.length === 0 || current.length === 0) return false;
  const prevSet = new Set(previous.map((p) => p.trim().toLowerCase()));
  const cur = current.map((c) => c.trim().toLowerCase());
  const matchCount = cur.filter((r) => prevSet.has(r)).length;
  return matchCount >= Math.ceil(cur.length * 0.5);
}

/**
 * Decide whether two failure attempts share the same root cause.
 *
 * Strategy:
 *   1. Identical signatures ⇒ stuck (cheap, no LLM).
 *   2. If a provider is supplied, ask a one-line "same root cause? answer y or n",
 *      cached by signature-pair hash. `y` ⇒ stuck.
 *   3. On no-provider / provider error / unparseable answer ⇒ lexical fallback.
 */
export async function isSemanticallyStuck(
  previous: string[],
  current: string[],
  deps: LoopDetectorDeps = {},
): Promise<boolean> {
  if (previous.length === 0 || current.length === 0) return false;

  const prevSig = computeFailureSignature(previous);
  const curSig = computeFailureSignature(current);

  if (prevSig && prevSig === curSig) return true;

  const provider = deps.provider;
  const model = deps.model;
  if (!provider || !model) {
    return isFeedbackIdentical(previous, current);
  }

  const cacheKey = `${signatureHash(prevSig)}:${signatureHash(curSig)}`;
  if (deps.cache?.has(cacheKey)) return deps.cache.get(cacheKey)!;

  try {
    const res = await provider.complete({
      model,
      max_tokens: 4,
      temperature: 0,
      timeout_ms: deps.timeoutMs ?? 10_000,
      messages: [
        {
          role: 'user',
          content:
            'Two automated build/test failures occurred on consecutive attempts at the same task. ' +
            'Do they have the SAME ROOT CAUSE (the fix would be the same)? Answer with a single letter: y or n.\n\n' +
            `Attempt A: ${prevSig}\nAttempt B: ${curSig}`,
        },
      ],
    });
    const answer = res.content.trim().toLowerCase();
    const stuck = answer.startsWith('y');
    deps.cache?.set(cacheKey, stuck);
    return stuck;
  } catch {
    // Provider unavailable / errored — preserve the weak-model fallback.
    return isFeedbackIdentical(previous, current);
  }
}
