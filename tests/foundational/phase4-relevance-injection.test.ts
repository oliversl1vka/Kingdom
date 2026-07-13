import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  LessonsRepository,
  selectRelevantLessons,
  buildLessonsBlock,
  cosineSimilarity,
  type EmbeddingProvider,
  type Lesson,
} from '@kingdomos/core';

const MIGRATIONS_DIR = join(__dirname, '..', '..', 'packages', 'core', 'migrations');

function setup(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  for (const f of [
    '001_initial.sql',
    '010_lessons.sql',
    '030_lessons_outcome_tracking.sql',
    '031_lesson_embeddings.sql',
  ]) {
    db.exec(readFileSync(join(MIGRATIONS_DIR, f), 'utf-8'));
  }
  return db;
}

/**
 * Deterministic fake embedder: a tiny bag-of-keywords vector over a fixed
 * vocabulary, so similarity reflects keyword overlap. No network.
 */
const VOCAB = ['database', 'sql', 'react', 'component', 'auth', 'token'];
function fakeEmbedder(): EmbeddingProvider {
  return {
    model: 'fake-embed',
    async embed(texts: string[]): Promise<number[][]> {
      return texts.map((t) => {
        const lower = t.toLowerCase();
        return VOCAB.map((w) => (lower.includes(w) ? 1 : 0));
      });
    },
  };
}

function lessonRow(title: string, body: string): Lesson {
  return {
    id: `id-${title}`,
    tier: 'knight',
    rule_id: 'R1',
    signature: title,
    title,
    body,
    matches_failure_type: null,
    times_seen: 1,
    first_seen_at: 'x',
    last_seen_at: 'x',
    source_task_id: null,
    source_run_id: null,
    source_incident_ids: [],
    active: true,
    created_at: 'x',
  };
}

describe('PHASE4 P4.2 — relevance-ranked lesson injection', () => {
  it('cosineSimilarity basics', () => {
    expect(cosineSimilarity([1, 0], [1, 0])).toBeCloseTo(1);
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0);
    expect(cosineSimilarity([], [])).toBe(0);
  });

  it('ranks by relevance to the task with an embedder', async () => {
    const dbLesson = lessonRow('SQL lesson', 'avoid N+1 queries in the database layer');
    const reactLesson = lessonRow('React lesson', 'memoize expensive react component renders');
    const authLesson = lessonRow('Auth lesson', 'never log an auth token');

    const selected = await selectRelevantLessons([authLesson, dbLesson, reactLesson], {
      taskText: 'optimize the sql database access path',
      embedder: fakeEmbedder(),
      limit: 2,
      minSimilarity: 0.01,
      semantic: true,
    });

    expect(selected[0].lesson.id).toBe('id-SQL lesson');
    expect(selected[0].similarity).toBeGreaterThan(0);
    expect(selected.length).toBeLessThanOrEqual(2);
  });

  it('keeps a failure-type match even when similarity is low (Healer)', async () => {
    const matching = { ...lessonRow('overflow', 'unrelated words zebra'), matches_failure_type: 'token-overflow' };
    const other = lessonRow('react', 'react component memoization');

    const selected = await selectRelevantLessons([matching, other], {
      taskText: 'react component performance',
      embedder: fakeEmbedder(),
      failureType: 'token-overflow',
      limit: 5,
      minSimilarity: 0.5,
      semantic: true,
    });

    expect(selected.map((s) => s.lesson.id)).toContain('id-overflow');
    // failure-type match should be ranked first
    expect(selected[0].lesson.id).toBe('id-overflow');
  });

  it('gracefully degrades to frequency order with NO embedder', async () => {
    const a = lessonRow('a', 'sql');
    const b = lessonRow('b', 'react');
    const selected = await selectRelevantLessons([a, b], {
      taskText: 'anything',
      embedder: undefined,
      limit: 5,
      minSimilarity: 0.1,
      semantic: true,
    });
    expect(selected.map((s) => s.lesson.id)).toEqual(['id-a', 'id-b']);
    expect(selected.every((s) => s.similarity === null)).toBe(true);
  });

  it('gracefully degrades when the embedder throws', async () => {
    const throwingEmbedder: EmbeddingProvider = {
      model: 'boom',
      async embed() {
        throw new Error('endpoint down');
      },
    };
    const a = lessonRow('a', 'sql');
    const selected = await selectRelevantLessons([a], {
      taskText: 'x',
      embedder: throwingEmbedder,
      limit: 5,
      minSimilarity: 0.1,
      semantic: true,
    });
    expect(selected).toHaveLength(1);
    expect(selected[0].similarity).toBeNull();
  });
});

describe('PHASE4 P4.2 — buildLessonsBlock integration + dynamic cap', () => {
  let db: Database.Database;
  beforeEach(() => (db = setup()));
  afterEach(() => db.close());

  it('renders a block and degrades without an embedder (async API)', async () => {
    const repo = new LessonsRepository(db);
    repo.upsert({ tier: 'king', rule_id: 'R1', signature: 's1', title: 'Plan small', body: 'Keep epics small.' });

    const block = await buildLessonsBlock({
      db,
      kingdomDir: '/nonexistent',
      tier: 'king',
      config: { injection_tiers: ['king'] },
    });
    expect(block).toContain('Prior Lessons');
    expect(block).toContain('Plan small');
  });

  it('raises the byte cap for large-context models', async () => {
    const repo = new LessonsRepository(db);
    // Many lessons so the small cap truncates but the large cap does not.
    for (let i = 0; i < 40; i++) {
      repo.upsert({
        tier: 'king',
        rule_id: 'R1',
        signature: `s${i}`,
        title: `Lesson number ${i} with a reasonably long descriptive title`,
        body: 'A fairly long body sentence that consumes prompt budget so the cap matters.',
      });
    }

    const small = await buildLessonsBlock({
      db,
      kingdomDir: '/nonexistent',
      tier: 'king',
      config: { injection_tiers: ['king'], max_lessons_bytes: 600, max_per_tier: 40 },
      modelContextTokens: 8000,
    });
    const large = await buildLessonsBlock({
      db,
      kingdomDir: '/nonexistent',
      tier: 'king',
      config: {
        injection_tiers: ['king'],
        max_lessons_bytes: 600,
        max_per_tier: 40,
        large_context_threshold_tokens: 32000,
        large_context_cap_multiplier: 4,
      },
      modelContextTokens: 128000,
    });

    expect(Buffer.byteLength(large, 'utf-8')).toBeGreaterThan(Buffer.byteLength(small, 'utf-8'));
  });

  it('gates a generated lesson below the confidence threshold out of injection', async () => {
    const repo = new LessonsRepository(db);
    // Generated lesson seeded at 0.5 → passes (>= GENERATED_INJECT_THRESHOLD).
    repo.upsert({
      tier: 'king',
      rule_id: 'GEN',
      signature: 'gpass',
      title: 'Generated passing lesson',
      body: 'body body',
      origin: 'generated',
      seed_confidence: 0.6,
    });
    // Generated lesson explicitly below threshold → withheld.
    repo.upsert({
      tier: 'king',
      rule_id: 'GEN',
      signature: 'gfail',
      title: 'Generated low-confidence lesson',
      body: 'body body',
      origin: 'generated',
      seed_confidence: 0.1,
    });

    const block = await buildLessonsBlock({
      db,
      kingdomDir: '/nonexistent',
      tier: 'king',
      config: { injection_tiers: ['king'] },
    });
    expect(block).toContain('Generated passing lesson');
    expect(block).not.toContain('Generated low-confidence lesson');
  });
});
