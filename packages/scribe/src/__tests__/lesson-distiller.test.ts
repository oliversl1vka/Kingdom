import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  distill,
  mirrorLessonsToDisk,
  appendRunIndex,
  __internals,
} from '../lesson-distiller.js';
import { LessonsRepository } from '@kingdomos/core';
import { mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';

// ─── Test harness ────────────────────────────────────────────────────────
// We apply migrations from disk to a fresh in-memory DB, then seed fixture
// rows. This exercises the real schema (incl. the 010_lessons migration).

const MIGRATIONS_DIR = join(
  fileURLToPath(new URL('..', import.meta.url)),
  '..',
  '..',
  'core',
  'migrations',
);

function freshDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  for (const f of files) {
    db.exec(readFileSync(join(MIGRATIONS_DIR, f), 'utf-8'));
  }
  return db;
}

function seedObjective(db: Database.Database, id = 'OBJ01'): void {
  db.prepare(
    `INSERT INTO projects (id, name, repository_path) VALUES (?, ?, ?)`,
  ).run('PRJ01', 'test', '/tmp');
  db.prepare(
    `INSERT INTO objectives (id, project_id, description, status) VALUES (?, ?, ?, 'active')`,
  ).run(id, 'PRJ01', 'test objective');
}

function seedTask(
  db: Database.Database,
  opts: {
    id: string;
    objective_id?: string;
    title?: string;
    status?: string;
    tier?: string;
    retry_count?: number;
  },
): void {
  db.prepare(
    `INSERT INTO task_graph_nodes (id, parent_id, objective_id, level, type, title, description, status, assigned_tier, reviewer_tier, retry_count, context_refs, acceptance_criteria, token_budget_estimate)
     VALUES (?, NULL, ?, 'job', 'code', ?, '', ?, ?, 'judge', ?, '[]', '[]', 4096)`,
  ).run(
    opts.id,
    opts.objective_id ?? 'OBJ01',
    opts.title ?? 'task',
    opts.status ?? 'queued',
    opts.tier ?? 'knight',
    opts.retry_count ?? 0,
  );
}

function seedJob(
  db: Database.Database,
  opts: { id: string; task_id: string; status?: string; model?: string },
): void {
  db.prepare(
    `INSERT INTO jobs (id, task_id, model, status, token_estimate, delegating_supervisor_id)
     VALUES (?, ?, ?, ?, 1000, 'sentinel')`,
  ).run(opts.id, opts.task_id, opts.model ?? 'gpt-4o-mini', opts.status ?? 'queued');
}

function seedReview(
  db: Database.Database,
  opts: {
    id: string;
    job_id: string;
    decision?: 'approved' | 'rejected';
    scope_check?: 'pass' | 'fail';
    format_check?: 'pass' | 'fail';
    security_check?: 'pass' | 'fail';
    criteria_check?: 'pass' | 'fail';
    feedback?: string;
    rejection_reasons?: string;
  },
): void {
  db.prepare(
    `INSERT INTO review_decisions (id, job_id, reviewer_agent_id, decision, scope_check, format_check, security_check, criteria_check, feedback, rejection_reasons)
     VALUES (?, ?, 'judge', ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    opts.id,
    opts.job_id,
    opts.decision ?? 'rejected',
    opts.scope_check ?? 'pass',
    opts.format_check ?? 'pass',
    opts.security_check ?? 'pass',
    opts.criteria_check ?? 'pass',
    opts.feedback ?? null,
    opts.rejection_reasons ?? null,
  );
}

function seedIncident(
  db: Database.Database,
  opts: { id: string; task_id: string; failure_type: string; history: Array<{ reason: string }>; severity?: string },
): void {
  db.prepare(
    `INSERT INTO incidents (id, task_id, severity, failure_type, symptoms, context_summary, failure_history)
     VALUES (?, ?, ?, ?, '{}', '', ?)`,
  ).run(
    opts.id,
    opts.task_id,
    opts.severity ?? 'medium',
    opts.failure_type,
    JSON.stringify(opts.history.map((h, i) => ({ attempt: i + 1, reason: h.reason, timestamp: new Date().toISOString() }))),
  );
}

// ─── Rule tests ─────────────────────────────────────────────────────────

describe('distiller · R1 test-file-scope-trap', () => {
  let db: Database.Database;
  beforeEach(() => {
    db = freshDb();
    seedObjective(db);
  });

  it('fires once when ≥2 rejections cite .test. files', () => {
    seedTask(db, { id: 'T1' });
    seedJob(db, { id: 'J1', task_id: 'T1' });
    seedJob(db, { id: 'J2', task_id: 'T1' });
    seedReview(db, {
      id: 'R1',
      job_id: 'J1',
      scope_check: 'fail',
      feedback: 'Modified src/foo.test.ts which is not in allowed_files',
    });
    seedReview(db, {
      id: 'R2',
      job_id: 'J2',
      scope_check: 'fail',
      feedback: 'Wrote to bar.spec.ts outside scope',
    });

    const result = distill(db, 'OBJ01');
    expect(result.firedRules).toContain('R1');
    const lessons = new LessonsRepository(db).listActiveByTier('knight');
    expect(lessons.length).toBeGreaterThan(0);
    expect(lessons[0].rule_id).toBe('R1');
  });

  it('does NOT fire on a single rejection', () => {
    seedTask(db, { id: 'T1' });
    seedJob(db, { id: 'J1', task_id: 'T1' });
    seedReview(db, {
      id: 'R1',
      job_id: 'J1',
      scope_check: 'fail',
      feedback: 'Wrote foo.test.ts outside scope',
    });
    const result = distill(db, 'OBJ01');
    expect(result.firedRules).not.toContain('R1');
  });

  it('fires when a test-scope task is already retrying after one rejection', () => {
    seedTask(db, { id: 'T1', status: 'running', retry_count: 1 });
    seedJob(db, { id: 'J1', task_id: 'T1', status: 'failed-review' });
    seedReview(db, {
      id: 'R1',
      job_id: 'J1',
      scope_check: 'fail',
      feedback: 'Modified src/doctor.test.ts which is not in allowed_files',
    });
    const result = distill(db, 'OBJ01');
    expect(result.firedRules).toContain('R1');
  });

  it('dedup: second distill on same data bumps times_seen, does not insert a new row', () => {
    seedTask(db, { id: 'T1' });
    seedJob(db, { id: 'J1', task_id: 'T1' });
    seedJob(db, { id: 'J2', task_id: 'T1' });
    seedReview(db, { id: 'R1', job_id: 'J1', scope_check: 'fail', feedback: 'foo.test.ts' });
    seedReview(db, { id: 'R2', job_id: 'J2', scope_check: 'fail', feedback: 'bar.spec.ts' });

    distill(db, 'OBJ01');
    const after1 = new LessonsRepository(db).listActiveByTier('knight');
    expect(after1).toHaveLength(1);
    expect(after1[0].times_seen).toBe(1);

    distill(db, 'OBJ01');
    const after2 = new LessonsRepository(db).listActiveByTier('knight');
    expect(after2).toHaveLength(1);
    expect(after2[0].id).toBe(after1[0].id);
    expect(after2[0].times_seen).toBe(2);
  });
});

describe('distiller · R2 setup-task-on-existing-project', () => {
  let db: Database.Database;
  beforeEach(() => {
    db = freshDb();
    seedObjective(db);
  });

  it('fires when setup task failed on an existing project', () => {
    seedTask(db, { id: 'T1', title: 'Project Setup: scaffold monorepo', status: 'awaiting-healer', tier: 'king' });
    const result = distill(db, 'OBJ01', { workspaceIsNonEmpty: true });
    expect(result.firedRules).toContain('R2');
  });

  it('does NOT fire when workspace is empty (greenfield)', () => {
    seedTask(db, { id: 'T1', title: 'Initialize project', status: 'failed-review', tier: 'king' });
    const result = distill(db, 'OBJ01', { workspaceIsNonEmpty: false });
    expect(result.firedRules).not.toContain('R2');
  });

  it('does NOT fire when setup task completed cleanly', () => {
    seedTask(db, { id: 'T1', title: 'Scaffold project', status: 'completed', tier: 'king' });
    const result = distill(db, 'OBJ01', { workspaceIsNonEmpty: true });
    expect(result.firedRules).not.toContain('R2');
  });

  it('fires when a setup task is already retrying after Judge rejection', () => {
    seedTask(db, {
      id: 'T1',
      title: 'Initialize project with pnpm workspace and TypeScript configuration',
      status: 'running',
      tier: 'squire',
      retry_count: 1,
    });
    seedJob(db, { id: 'J1', task_id: 'T1', status: 'failed-review' });
    seedReview(db, {
      id: 'R1',
      job_id: 'J1',
      decision: 'rejected',
      scope_check: 'fail',
      feedback: 'All criteria passed.',
      rejection_reasons: 'Diff modifies files outside allowed scope: pnpm-workspace.yaml',
    });
    const result = distill(db, 'OBJ01', { workspaceIsNonEmpty: true });
    expect(result.firedRules).toContain('R2');
  });
});

describe('distiller · R3 squire-token-overflow', () => {
  let db: Database.Database;
  beforeEach(() => {
    db = freshDb();
    seedObjective(db);
  });

  it('fires with ≥2 squire jobs failing with token-overflow', () => {
    seedTask(db, { id: 'T1', tier: 'squire' });
    seedTask(db, { id: 'T2', tier: 'squire' });
    seedJob(db, { id: 'J1', task_id: 'T1', status: 'failed-token-overflow' });
    seedJob(db, { id: 'J2', task_id: 'T2', status: 'failed-token-overflow' });
    const result = distill(db, 'OBJ01');
    expect(result.firedRules).toContain('R3');
    const lessons = new LessonsRepository(db).listActiveByTier('nobility');
    expect(lessons[0].matches_failure_type).toBe('token-overflow');
  });

  it('does NOT fire when the tier is knight', () => {
    seedTask(db, { id: 'T1', tier: 'knight' });
    seedTask(db, { id: 'T2', tier: 'knight' });
    seedJob(db, { id: 'J1', task_id: 'T1', status: 'failed-token-overflow' });
    seedJob(db, { id: 'J2', task_id: 'T2', status: 'failed-token-overflow' });
    const result = distill(db, 'OBJ01');
    expect(result.firedRules).not.toContain('R3');
  });
});

describe('distiller · R4 healer-repeats-same-recommendation', () => {
  let db: Database.Database;
  beforeEach(() => {
    db = freshDb();
    seedObjective(db);
  });

  it('fires when an incident has 3+ very similar failure reasons', () => {
    seedTask(db, { id: 'T1' });
    seedIncident(db, {
      id: 'I1',
      task_id: 'T1',
      failure_type: 'invalid-output',
      history: [
        { reason: 'Diff failed to parse: unexpected @@ header format' },
        { reason: 'Diff failed to parse: malformed @@ header format' },
        { reason: 'Diff failed to parse again — @@ header is malformed' },
      ],
    });
    const result = distill(db, 'OBJ01');
    expect(result.firedRules).toContain('R4');
  });

  it('does NOT fire when reasons are semantically distinct', () => {
    seedTask(db, { id: 'T1' });
    seedIncident(db, {
      id: 'I1',
      task_id: 'T1',
      failure_type: 'invalid-output',
      history: [
        { reason: 'model emitted JSON when diff expected' },
        { reason: 'timeout while streaming response' },
        { reason: 'provider returned 429 rate-limit' },
      ],
    });
    const result = distill(db, 'OBJ01');
    expect(result.firedRules).not.toContain('R4');
  });
});

describe('distiller · R5 security-reject-pattern', () => {
  let db: Database.Database;
  beforeEach(() => {
    db = freshDb();
    seedObjective(db);
  });

  it('fires with ≥2 security rejections and classifies the family', () => {
    seedTask(db, { id: 'T1' });
    seedJob(db, { id: 'J1', task_id: 'T1' });
    seedJob(db, { id: 'J2', task_id: 'T1' });
    seedReview(db, {
      id: 'R1', job_id: 'J1', security_check: 'fail',
      feedback: 'Hardcoded api_key in source',
    });
    seedReview(db, {
      id: 'R2', job_id: 'J2', security_check: 'fail',
      feedback: 'Another api_key literal committed',
    });
    const result = distill(db, 'OBJ01');
    expect(result.firedRules).toContain('R5');
    const lessons = new LessonsRepository(db).listActiveByTier('knight');
    const r5 = lessons.find((l) => l.rule_id === 'R5')!;
    expect(r5.title).toMatch(/hardcoded-credential/);
  });
});

// ─── Helper tests ───────────────────────────────────────────────────────

describe('distiller · internal helpers', () => {
  it('jaccard returns 1.0 for identical token sets', () => {
    const a = __internals.tokenize('foo bar baz');
    const b = __internals.tokenize('foo bar baz');
    expect(__internals.jaccard(a, b)).toBe(1);
  });

  it('hasSemanticRepeat detects overlap above threshold', () => {
    const reasons = [
      'Diff failed to parse: @@ header malformed',
      'Diff failed to parse: @@ header missing numbers',
      'completely unrelated thing happened',
    ];
    expect(__internals.hasSemanticRepeat(reasons, 0.5)).toBe(true);
  });

  it('classifySecurityFamily picks credential over destructive', () => {
    expect(__internals.classifySecurityFamily('api_key found inline')).toBe(
      'hardcoded-credential',
    );
    expect(__internals.classifySecurityFamily('rm -rf / issued by diff')).toBe(
      'destructive-command',
    );
    expect(__internals.classifySecurityFamily('eval(req.body)')).toBe('unsafe-exec');
  });
});

describe('mirrorLessonsToDisk', () => {
  it('writes lessons.md per tier from active DB rows', () => {
    const db = freshDb();
    const repo = new LessonsRepository(db);
    repo.upsert({
      tier: 'king',
      rule_id: 'R2',
      signature: 'abc',
      title: 'no setup on existing project',
      body: 'body text',
    });
    const tmp = mkdtempSync(join(tmpdir(), 'kingdom-mirror-'));
    mirrorLessonsToDisk(db, tmp);
    const path = join(tmp, 'memory', 'king', 'lessons.md');
    expect(existsSync(path)).toBe(true);
    const content = readFileSync(path, 'utf-8');
    expect(content).toMatch(/no setup on existing project/);
    expect(content).toMatch(/rule.*R2/);
  });
});

describe('appendRunIndex', () => {
  it('appends one line per call and creates header on first call', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'kingdom-index-'));
    appendRunIndex(tmp, {
      objective: 'build pixel frontend',
      totalTasks: 47,
      healerIncidents: 3,
      newLessonCount: 2,
      firedRules: ['R1', 'R5'],
      totalTokens: 312000,
    });
    appendRunIndex(tmp, {
      objective: 'fix test suite',
      totalTasks: 5,
      healerIncidents: 0,
      newLessonCount: 0,
      firedRules: [],
      totalTokens: 42000,
    });
    const path = join(tmp, 'memory', 'INDEX.md');
    const content = readFileSync(path, 'utf-8');
    expect(content).toMatch(/# KingdomOS Run Index/);
    expect(content).toMatch(/build pixel frontend/);
    expect(content).toMatch(/fix test suite/);
    expect(content).toMatch(/\+2 lessons \(R1,R5\)/);
    expect(content).toMatch(/no new lessons/);
  });
});
