import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  LessonsRepository,
  computeWinRate,
  DECAY_THRESHOLD,
  MIN_OUTCOMES_FOR_DECAY,
  type LessonUpsert,
} from '@kingdomos/core';

const MIGRATIONS_DIR = join(__dirname, '..', '..', 'packages', 'core', 'migrations');

function setup(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  for (const f of [
    '001_initial.sql',
    '010_lessons.sql',
    '030_lessons_outcome_tracking.sql',
  ]) {
    db.exec(readFileSync(join(MIGRATIONS_DIR, f), 'utf-8'));
  }
  return db;
}

function lesson(over: Partial<LessonUpsert> = {}): LessonUpsert {
  return {
    tier: 'knight',
    rule_id: 'R1',
    signature: `sig-${Math.random().toString(36).slice(2)}`,
    title: 'A lesson title',
    body: 'A lesson body with enough length to matter.',
    ...over,
  };
}

describe('PHASE4 P4.1 — lesson outcome tracking + decay/promote', () => {
  let db: Database.Database;
  let repo: LessonsRepository;

  beforeEach(() => {
    db = setup();
    repo = new LessonsRepository(db);
  });
  afterEach(() => db.close());

  it('computeWinRate is Laplace-smoothed', () => {
    expect(computeWinRate(0, 0)).toBeCloseTo(0.5);
    expect(computeWinRate(1, 1)).toBeCloseTo(2 / 3);
    expect(computeWinRate(0, 4)).toBeCloseTo(1 / 6);
    expect(computeWinRate(4, 4)).toBeCloseTo(5 / 6);
  });

  it('records injection and attributes a successful outcome (promote path)', () => {
    const id = repo.upsert(lesson());
    repo.recordInjection('job-1', [id]);

    const decayed = repo.recordOutcome('job-1', true);
    expect(decayed).toEqual([]);

    const l = repo.getById(id)!;
    expect(l.outcome_total).toBe(1);
    expect(l.outcome_success).toBe(1);
    expect(l.confidence).toBeCloseTo(computeWinRate(1, 1));
    expect(l.injected_job_ids).toEqual([]); // job consumed
    expect(l.active).toBe(true);
  });

  it('decays a lesson that loses past the min-sample threshold', () => {
    const id = repo.upsert(lesson());
    // Inject + fail MIN_OUTCOMES_FOR_DECAY times.
    for (let i = 0; i < MIN_OUTCOMES_FOR_DECAY; i++) {
      const job = `job-${i}`;
      repo.recordInjection(job, [id]);
      repo.recordOutcome(job, false);
    }
    const l = repo.getById(id)!;
    expect(l.outcome_total).toBe(MIN_OUTCOMES_FOR_DECAY);
    expect(l.outcome_success).toBe(0);
    expect(l.confidence!).toBeLessThan(DECAY_THRESHOLD);
    expect(l.active).toBe(false);
    expect(l.decayed_at).toBeTruthy();
  });

  it('does not decay before enough outcomes accrue', () => {
    const id = repo.upsert(lesson());
    repo.recordInjection('j1', [id]);
    repo.recordOutcome('j1', false); // only 1 outcome
    const l = repo.getById(id)!;
    expect(l.active).toBe(true);
    expect(l.decayed_at).toBeNull();
  });

  it('crypt success is a positive signal across many jobs', () => {
    const id = repo.upsert(lesson());
    repo.recordInjection('a', [id]);
    repo.recordInjection('b', [id]);
    repo.recordCryptSuccess(['a', 'b']);
    const l = repo.getById(id)!;
    expect(l.outcome_success).toBe(2);
    expect(l.outcome_total).toBe(2);
  });

  it('promotes proven winners and excludes unproven', () => {
    const winner = repo.upsert(lesson({ signature: 'win' }));
    const cold = repo.upsert(lesson({ signature: 'cold' }));
    for (let i = 0; i < MIN_OUTCOMES_FOR_DECAY; i++) {
      const job = `w-${i}`;
      repo.recordInjection(job, [winner]);
      repo.recordOutcome(job, true);
    }
    const promoted = repo.listPromoted();
    const ids = promoted.map((l) => l.id);
    expect(ids).toContain(winner);
    expect(ids).not.toContain(cold);
  });

  it('outcome attribution ignores LIKE false-positives', () => {
    const id = repo.upsert(lesson());
    repo.recordInjection('job-100', [id]);
    // 'job-10' is a substring of 'job-100' — must NOT match.
    const decayed = repo.recordOutcome('job-10', false);
    expect(decayed).toEqual([]);
    const l = repo.getById(id)!;
    expect(l.outcome_total).toBe(0);
    expect(l.injected_job_ids).toEqual(['job-100']);
  });
});
