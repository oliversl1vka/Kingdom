import type Database from 'better-sqlite3';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { LessonsRepository, GENERATED_INJECT_THRESHOLD } from '../repositories/lessons-repo.js';
import type { Lesson, MemoryConfig } from '../types.js';

/**
 * Assembles the `## Prior Lessons (from past runs)` block injected into agent
 * prompts. Two sources, merged in this order:
 *
 *   1. Active DB lessons for the tier (authoritative — produced by the
 *      distiller in @kingdomos/scribe).
 *   2. Hand-written lessons from `kingdom/memory/{tier}/lessons.md` and
 *      `kingdom/memory/shared/lessons.md` (escape hatch for operators).
 *
 * A byte cap (default 4 KB, raised dynamically for large-context models)
 * protects the prompt budget. `KINGDOM_NO_LESSONS=1` disables injection.
 *
 * PHASE4 (P4.2): when an `EmbeddingProvider` is supplied, DB lessons are
 * RANKED BY RELEVANCE to the current task (cosine similarity of lesson body
 * embeddings vs the task embedding) instead of bulk `times_seen DESC`. With no
 * embedder configured the function degrades gracefully to the legacy
 * frequency-ordered behavior — it is self-contained and never breaks.
 *
 * PHASE4 (P4.1): GENERATED (LLM-discovered) lessons are gated — they only earn
 * injection once their outcome-validated confidence clears a threshold. Rule
 * lessons (R1–R5) inject as before.
 */

export const DEFAULT_MAX_LESSONS_BYTES = 4096;
export const DEFAULT_MAX_PER_TIER = 20;
export const DEFAULT_INJECTION_TIERS = ['king', 'nobility', 'healer'];
const DEFAULT_MIN_SIMILARITY = 0.1;
const DEFAULT_LARGE_CONTEXT_THRESHOLD = 32_000;
const DEFAULT_LARGE_CONTEXT_MULTIPLIER = 4;

/**
 * PHASE4 (P4.2): pluggable embedding backend. Implementations: OpenAI
 * text-embedding-3-small, or a local llama.cpp `/v1/embeddings` endpoint. Must
 * return one vector per input, in order. Throwing or returning [] makes the
 * injector fall back to the legacy path for that call (graceful degrade).
 */
export interface EmbeddingProvider {
  readonly model: string;
  embed(texts: string[]): Promise<number[][]>;
}

export interface SelectedLesson {
  lesson: Lesson;
  /** Cosine similarity to the task, or null when ranked by frequency. */
  similarity: number | null;
}

export interface LessonInjectionInput {
  db: Database.Database;
  /** Root where `kingdom/memory/{tier}/lessons.md` lives (usually the Kingdom repo root). */
  kingdomDir: string;
  tier: string;
  config?: MemoryConfig;
  // PHASE4 (P4.2) — all optional; absence = legacy behavior.
  /** Text of the current task; lessons are ranked for relevance to this. */
  taskText?: string;
  /** Embedding backend. Absent ⇒ frequency ordering (graceful degrade). */
  embedder?: EmbeddingProvider;
  /** Healer hint: prioritise lessons whose matches_failure_type === this. */
  failureType?: string;
  /** Resolved model's safe input budget (tokens) — drives the dynamic cap. */
  modelContextTokens?: number;
  /** Job id; when set, records which lessons were injected (outcome tracking). */
  jobId?: string;
}

/**
 * Returns the rendered lessons block (trailing newline included) or an empty
 * string when injection is disabled / no lessons exist.
 *
 * Async because relevance ranking may call out to an embedding provider. The
 * legacy callers can `await` it; with no embedder it resolves synchronously in
 * spirit (one tick) and behaves identically to the pre-Phase-4 output.
 */
export async function buildLessonsBlock(input: LessonInjectionInput): Promise<string> {
  if (process.env.KINGDOM_NO_LESSONS === '1') return '';

  const cfg = input.config ?? {};
  if (cfg.enabled === false) return '';

  const injectionTiers = cfg.injection_tiers ?? DEFAULT_INJECTION_TIERS;
  if (!injectionTiers.includes(input.tier)) return '';

  const baseMaxBytes = cfg.max_lessons_bytes ?? DEFAULT_MAX_LESSONS_BYTES;
  if (baseMaxBytes <= 0) return '';
  const maxBytes = applyDynamicCap(baseMaxBytes, cfg, input.modelContextTokens);

  const maxPerTier = cfg.max_per_tier ?? DEFAULT_MAX_PER_TIER;

  const candidates = gatherDbCandidates(input.db, input.tier, maxPerTier);
  const selected = await selectRelevantLessons(candidates, {
    taskText: input.taskText,
    embedder: input.embedder,
    failureType: input.failureType,
    limit: maxPerTier,
    minSimilarity: cfg.min_similarity ?? DEFAULT_MIN_SIMILARITY,
    semantic: cfg.semantic_injection !== false,
    db: input.db,
  });

  const manualTier = readManualLessons(input.kingdomDir, input.tier);
  const manualShared = readManualLessons(input.kingdomDir, 'shared');

  if (selected.length === 0 && !manualTier && !manualShared) return '';

  // PHASE4 (P4.1): record which lessons were injected into this job so the
  // outcome loop can later attribute success/failure back to them.
  if (input.jobId && selected.length > 0) {
    try {
      new LessonsRepository(input.db).recordInjection(
        input.jobId,
        selected.map((s) => s.lesson.id),
      );
    } catch {
      /* best-effort */
    }
  }

  return renderBlock(selected, manualTier, manualShared, maxBytes);
}

/**
 * Synchronous legacy-compatible entry point used by the packet assembler's
 * sync `assemble()` path. Identical output to the pre-Phase-4 injector
 * (frequency order, confidence gate applied to generated lessons, dynamic cap).
 * Use the async `buildLessonsBlock` when an embedder is available for
 * relevance ranking.
 */
export function buildLessonsBlockSync(input: LessonInjectionInput): string {
  if (process.env.KINGDOM_NO_LESSONS === '1') return '';

  const cfg = input.config ?? {};
  if (cfg.enabled === false) return '';

  const injectionTiers = cfg.injection_tiers ?? DEFAULT_INJECTION_TIERS;
  if (!injectionTiers.includes(input.tier)) return '';

  const baseMaxBytes = cfg.max_lessons_bytes ?? DEFAULT_MAX_LESSONS_BYTES;
  if (baseMaxBytes <= 0) return '';
  const maxBytes = applyDynamicCap(baseMaxBytes, cfg, input.modelContextTokens);

  const maxPerTier = cfg.max_per_tier ?? DEFAULT_MAX_PER_TIER;
  const candidates = gatherDbCandidates(input.db, input.tier, maxPerTier).slice(0, maxPerTier);

  const manualTier = readManualLessons(input.kingdomDir, input.tier);
  const manualShared = readManualLessons(input.kingdomDir, 'shared');

  if (candidates.length === 0 && !manualTier && !manualShared) return '';

  if (input.jobId && candidates.length > 0) {
    try {
      new LessonsRepository(input.db).recordInjection(
        input.jobId,
        candidates.map((l) => l.id),
      );
    } catch {
      /* best-effort */
    }
  }

  return renderBlock(
    candidates.map((lesson) => ({ lesson, similarity: null })),
    manualTier,
    manualShared,
    maxBytes,
  );
}

function renderBlock(
  selected: SelectedLesson[],
  manualTier: string | null,
  manualShared: string | null,
  maxBytes: number,
): string {
  const lines: string[] = [];
  lines.push('## Prior Lessons (from past runs)');
  lines.push(
    'These are distilled lessons from earlier runs. Treat them as strong hints, not absolute rules — but prefer the path they suggest unless this task clearly differs.',
  );
  lines.push('');
  for (const { lesson: l } of selected) {
    lines.push(`- **${l.title}** _(seen ${l.times_seen}×)_`);
    if (l.body) {
      for (const bodyLine of l.body.split('\n')) lines.push(`  ${bodyLine}`);
    }
  }
  if (manualTier) {
    lines.push('');
    lines.push('### Operator notes (tier-specific)');
    lines.push(manualTier);
  }
  if (manualShared) {
    lines.push('');
    lines.push('### Operator notes (shared)');
    lines.push(manualShared);
  }
  lines.push('');
  return truncateByBytes(lines.join('\n'), maxBytes);
}

interface SelectOpts {
  taskText?: string;
  embedder?: EmbeddingProvider;
  failureType?: string;
  limit: number;
  minSimilarity: number;
  semantic: boolean;
  db?: Database.Database;
}

/**
 * PHASE4 (P4.2): core selection. With a usable embedder + task text, ranks by
 * cosine similarity (failure-type matches always retained for the Healer);
 * otherwise returns the candidates in their incoming frequency order. Exported
 * for unit testing with a fake embedder and for the graceful-degrade test.
 */
export async function selectRelevantLessons(
  candidates: Lesson[],
  opts: SelectOpts,
): Promise<SelectedLesson[]> {
  const usable = candidates.slice();

  // Legacy / graceful-degrade path: no embedder or no task text.
  if (!opts.semantic || !opts.embedder || !opts.taskText || usable.length === 0) {
    return usable.slice(0, opts.limit).map((lesson) => ({ lesson, similarity: null }));
  }

  let taskVec: number[] | undefined;
  const bodyVecs = new Map<string, number[]>();
  try {
    const toEmbed = usable.map((l) => embedText(l));
    const vectors = await opts.embedder.embed([opts.taskText, ...toEmbed]);
    if (!Array.isArray(vectors) || vectors.length !== toEmbed.length + 1) {
      throw new Error('embedder returned mismatched vector count');
    }
    taskVec = vectors[0];
    for (let i = 0; i < usable.length; i++) bodyVecs.set(usable[i].id, vectors[i + 1]);
    // Best-effort cache write.
    if (opts.db) cacheEmbeddings(opts.db, opts.embedder.model, usable, bodyVecs);
  } catch {
    // Embedder failed → degrade to frequency order. Never break.
    return usable.slice(0, opts.limit).map((lesson) => ({ lesson, similarity: null }));
  }

  const scored: SelectedLesson[] = usable.map((lesson) => {
    const v = bodyVecs.get(lesson.id);
    const sim = v && taskVec ? cosineSimilarity(taskVec, v) : 0;
    return { lesson, similarity: sim };
  });

  // Healer hint: failure-type matches are always kept regardless of similarity.
  const failureMatch = (l: Lesson): boolean =>
    !!opts.failureType && l.matches_failure_type === opts.failureType;

  const filtered = scored.filter(
    (s) => failureMatch(s.lesson) || (s.similarity ?? 0) >= opts.minSimilarity,
  );

  filtered.sort((a, b) => {
    const af = failureMatch(a.lesson) ? 1 : 0;
    const bf = failureMatch(b.lesson) ? 1 : 0;
    if (af !== bf) return bf - af; // failure-type matches first
    return (b.similarity ?? 0) - (a.similarity ?? 0);
  });

  return filtered.slice(0, opts.limit);
}

/** Cosine similarity of two equal-length vectors. Returns 0 on degenerate input. */
export function cosineSimilarity(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  if (n === 0) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

function embedText(l: Lesson): string {
  return `${l.title}\n${l.body}`;
}

/**
 * Gather candidate DB lessons for a tier (+ shared), applying the PHASE4 (P4.1)
 * confidence gate to GENERATED lessons. Rule lessons pass through unchanged.
 */
function gatherDbCandidates(db: Database.Database, tier: string, limit: number): Lesson[] {
  try {
    const repo = new LessonsRepository(db);
    const perTier = repo.listActiveByTier(tier, limit);
    const shared = repo.listActiveByTier('shared', Math.max(1, Math.floor(limit / 2)));
    const all = [...perTier, ...shared];
    return all.filter(passesConfidenceGate);
  } catch {
    // Lessons table not present (pre-migration DB) — fail silent.
    return [];
  }
}

/**
 * PHASE4 (P4.1): generated lessons must clear the inject threshold before they
 * earn a prompt slot. A generated lesson with no outcomes yet uses its seed
 * confidence (set at upsert). Rule lessons and lessons on a pre-030 DB
 * (origin/confidence undefined) always pass.
 */
function passesConfidenceGate(l: Lesson): boolean {
  if (l.origin !== 'generated') return true;
  const conf = l.confidence ?? 0;
  return conf >= GENERATED_INJECT_THRESHOLD;
}

function applyDynamicCap(
  base: number,
  cfg: MemoryConfig,
  modelContextTokens?: number,
): number {
  if (!modelContextTokens) return base;
  const threshold = cfg.large_context_threshold_tokens ?? DEFAULT_LARGE_CONTEXT_THRESHOLD;
  const mult = cfg.large_context_cap_multiplier ?? DEFAULT_LARGE_CONTEXT_MULTIPLIER;
  return modelContextTokens >= threshold ? base * mult : base;
}

function cacheEmbeddings(
  db: Database.Database,
  model: string,
  lessons: Lesson[],
  vecs: Map<string, number[]>,
): void {
  try {
    const cols = db.prepare('PRAGMA table_info(lesson_embeddings)').all() as Array<{ name: string }>;
    if (cols.length === 0) return; // table absent (pre-031)
    const stmt = db.prepare(
      `INSERT OR REPLACE INTO lesson_embeddings (lesson_id, model, body_hash, dim, vector)
       VALUES (?, ?, ?, ?, ?)`,
    );
    const tx = db.transaction(() => {
      for (const l of lessons) {
        const v = vecs.get(l.id);
        if (!v) continue;
        const hash = createHash('sha1').update(embedText(l)).digest('hex').slice(0, 16);
        stmt.run(l.id, model, hash, v.length, JSON.stringify(v));
      }
    });
    tx();
  } catch {
    /* best-effort cache */
  }
}

function readManualLessons(kingdomDir: string, tier: string): string | null {
  const path = join(kingdomDir, 'memory', tier, 'lessons.md');
  if (!existsSync(path)) return null;
  try {
    const content = readFileSync(path, 'utf-8').trim();
    return content.length > 0 ? content : null;
  } catch {
    return null;
  }
}

function truncateByBytes(s: string, maxBytes: number): string {
  const bytes = Buffer.byteLength(s, 'utf-8');
  if (bytes <= maxBytes) return s;

  // Truncate on newline boundaries where possible so we don't slice a lesson
  // mid-sentence. Then append an elision marker.
  const marker = '\n… (truncated; remaining lessons omitted to respect prompt budget)\n';
  const markerBytes = Buffer.byteLength(marker, 'utf-8');
  const target = Math.max(0, maxBytes - markerBytes);

  const buf = Buffer.from(s, 'utf-8').subarray(0, target);
  let text = buf.toString('utf-8');
  // Drop possibly-mangled last UTF-8 codepoint by cutting at the last newline.
  const lastNl = text.lastIndexOf('\n');
  if (lastNl > 0) text = text.slice(0, lastNl);
  return text + marker;
}
