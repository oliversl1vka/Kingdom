import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { computeCalibration, calibrateConfidence } from '@kingdomos/healer';

const MIGRATIONS_DIR = join(__dirname, '..', '..', 'packages', 'core', 'migrations');

function setup(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = OFF');
  db.exec(readFileSync(join(MIGRATIONS_DIR, '001_initial.sql'), 'utf-8'));
  return db;
}

function addIncident(db: Database.Database, id: string, confidence: number, resolved: boolean): void {
  db.prepare(
    `INSERT INTO incidents (id, task_id, severity, failure_type, symptoms, failure_history,
       healer_confidence, resolved_at, created_at)
     VALUES (?, 't', 'high', 'runtime-crash', '{}', '[]', ?, ?, datetime('now'))`,
  ).run(id, confidence, resolved ? new Date().toISOString() : null);
}

describe('PHASE4 P4.5 — Healer confidence calibration (additive hook)', () => {
  let db: Database.Database;
  beforeEach(() => (db = setup()));
  afterEach(() => db.close());

  it('returns a neutral multiplier with too little history', () => {
    addIncident(db, 'i1', 0.9, true);
    const stats = computeCalibration(db);
    expect(stats.multiplier).toBe(1);
    expect(calibrateConfidence(db, 0.8)).toBeCloseTo(0.8);
  });

  it('shrinks confidence when the Healer is historically over-confident', () => {
    // 6 incidents at reported 0.9, only 2 actually resolved → over-confident.
    for (let i = 0; i < 6; i++) addIncident(db, `i${i}`, 0.9, i < 2);
    const stats = computeCalibration(db);
    expect(stats.sample).toBe(6);
    expect(stats.empiricalAccuracy).toBeCloseTo(2 / 6, 2);
    expect(stats.multiplier).toBeLessThan(1);
    expect(calibrateConfidence(db, 0.9)).toBeLessThan(0.9);
  });

  it('leaves a well-calibrated Healer roughly unchanged', () => {
    // reported ~0.5, resolved ~half → multiplier ~1.
    for (let i = 0; i < 8; i++) addIncident(db, `i${i}`, 0.5, i % 2 === 0);
    const stats = computeCalibration(db);
    expect(stats.multiplier).toBeGreaterThan(0.8);
  });
});
