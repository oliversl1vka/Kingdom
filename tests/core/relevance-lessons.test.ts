import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  JobPacketAssembler,
  TaskRepository,
  LessonsRepository,
  buildLessonsBlockSync,
  type EmbeddingProvider,
  type Job,
  type TaskGraphNode,
  type PacketAssemblyOptions,
} from '@kingdomos/core';

const MIGRATIONS_DIR = join(__dirname, '..', '..', 'packages', 'core', 'migrations');

function createDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  for (const m of [
    '001_initial.sql',
    '006_depends_on.sql',
    '010_lessons.sql',
    '030_lessons_outcome_tracking.sql',
    '031_lesson_embeddings.sql',
  ]) {
    db.exec(readFileSync(join(MIGRATIONS_DIR, m), 'utf-8'));
  }
  const now = new Date().toISOString();
  db.prepare('INSERT INTO projects (id, name, repository_path, created_at, updated_at) VALUES (?,?,?,?,?)').run('proj', 'P', process.cwd(), now, now);
  db.prepare('INSERT INTO objectives (id, project_id, description, priority, status, acceptance_criteria, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)').run('obj', 'proj', 'o', 5, 'active', '[]', now, now);
  return db;
}

/**
 * Deterministic fake embedder: one-hot bag-of-keywords over a fixed vocabulary,
 * so cosine similarity reflects keyword overlap. No network.
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

function throwingEmbedder(): EmbeddingProvider {
  return {
    model: 'boom',
    async embed(): Promise<number[][]> {
      throw new Error('endpoint down');
    },
  };
}

const job = (id = 'j1'): Job =>
  ({
    id,
    task_id: 'task',
    model: 'gpt-4.1-mini',
    status: 'queued',
    worker_id: null,
    started_at: null,
    heartbeat_at: null,
    timeout_at: null,
    cancel_requested: false,
    cancel_reason: null,
    result_path: null,
    failure_type: null,
    token_estimate: 2048,
    tokens_used: null,
    delegating_supervisor_id: 's',
    created_at: new Date().toISOString(),
  } as Job);

describe('DEFERRAL2 — relevance-ranked lesson injection on the async assembly path', () => {
  let dir: string;
  let db: Database.Database;
  let taskRepo: TaskRepository;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'kos-rel-'));
    mkdirSync(join(dir, 'agents'), { recursive: true });
    writeFileSync(join(dir, 'agents', 'nobility.md'), 'You are the Nobility.');
    writeFileSync(join(dir, 'agents', 'knight.md'), 'You are a Knight.');
    db = createDb();
    taskRepo = new TaskRepository(db);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  function seed(tier: string, title: string, body: string): void {
    new LessonsRepository(db).upsert({ tier, rule_id: 'R1', signature: title, title, body });
  }

  function makeTask(opts: { title?: string; tier?: string; ac?: string[] } = {}): TaskGraphNode {
    return taskRepo.create({
      objective_id: 'obj',
      level: 'task',
      title: opts.title ?? 'Decompose the epic',
      description: 'work',
      type: 'design',
      assigned_tier: opts.tier ?? 'nobility',
      reviewer_tier: 'judge',
      acceptance_criteria: opts.ac ?? ['done'],
      context_refs: [],
      token_budget_estimate: 2048,
    });
  }

  function assembler(extra: Partial<PacketAssemblyOptions> = {}): JobPacketAssembler {
    return new JobPacketAssembler(db, taskRepo, {
      projectPath: dir,
      agentTemplatesDir: join(dir, 'agents'),
      outputDir: dir,
      memory: { injection_tiers: ['nobility', 'healer'] },
      ...extra,
    });
  }

  function systemContent(packet: { messages: { role: string; content: string }[] }): string {
    return packet.messages.find((m) => m.role === 'system')?.content ?? '';
  }

  // ── §5: S0 golden — sync path byte-identical ────────────────────────────
  it('sync assembleForJob still injects the frequency-ordered lessons block (golden)', () => {
    seed('nobility', 'Plan small', 'Keep epics small.');
    const packet = assembler().assembleForJob(job(), makeTask());
    const system = systemContent(packet);
    expect(system).toContain('Prior Lessons');
    expect(system).toContain('Plan small');
    const expected = buildLessonsBlockSync({
      db,
      kingdomDir: process.cwd(),
      tier: 'nobility',
      config: { injection_tiers: ['nobility', 'healer'] },
    });
    expect(system).toContain(expected.trimEnd());
  });

  // ── §5: relevance ordering ──────────────────────────────────────────────
  it('ranks the keyword-relevant lesson first when an embedder + taskText are supplied', async () => {
    seed('nobility', 'Alpha lesson', 'memoize react component renders'); // {react, component} → 1.0
    seed('nobility', 'Gamma lesson', 'a hint about react only');          // {react}            → 0.707
    seed('nobility', 'Delta lesson', 'avoid sql in the database layer');  // {sql, database}    → 0.0 (filtered)

    const task = makeTask({ title: 'Build the react component view', ac: ['render fast'] });
    const packet = await assembler({ embedder: fakeEmbedder() }).assembleForJobAsync(job(), task);
    const block = systemContent(packet);

    const idxAlpha = block.indexOf('Alpha lesson');
    const idxGamma = block.indexOf('Gamma lesson');
    expect(idxAlpha).toBeGreaterThan(-1);
    expect(idxGamma).toBeGreaterThan(-1);
    expect(idxAlpha).toBeLessThan(idxGamma);          // most-relevant first
    expect(block).not.toContain('Delta lesson');       // below min similarity → dropped
  });

  // ── §5: graceful degrade (no embedder) == frequency order ───────────────
  it('with NO embedder the async block equals the sync frequency-ordered block', async () => {
    seed('nobility', 'First', 'one');
    seed('nobility', 'Second', 'two');
    const task = makeTask();

    const asyncSystem = systemContent(await assembler().assembleForJobAsync(job(), task));
    const syncSystem = systemContent(assembler().assembleForJob(job(), task));
    expect(asyncSystem).toBe(syncSystem);
    expect(asyncSystem).toContain('Prior Lessons');
  });

  // ── §5: embedder error → fall back, no exception escapes assembly ───────
  it('falls back to frequency order when the embedder throws (no throw escapes)', async () => {
    seed('nobility', 'First', 'one');
    seed('nobility', 'Second', 'two');
    const task = makeTask();

    const withThrow = systemContent(await assembler({ embedder: throwingEmbedder() }).assembleForJobAsync(job(), task));
    const freq = systemContent(assembler().assembleForJob(job(), task));
    expect(withThrow).toBe(freq); // identical to frequency ordering
    expect(withThrow).toContain('First');
    expect(withThrow).toContain('Second');
  });

  // ── §5: dynamic cap ─────────────────────────────────────────────────────
  it('raises the byte cap for large-context models so more lessons survive', async () => {
    for (let i = 0; i < 40; i++) {
      seed('nobility', `Lesson number ${i} with a long descriptive title`, 'A fairly long body sentence that consumes prompt budget so the cap matters.');
    }
    const memory: PacketAssemblyOptions['memory'] = {
      injection_tiers: ['nobility'],
      max_lessons_bytes: 600,
      max_per_tier: 40,
      large_context_threshold_tokens: 32000,
      large_context_cap_multiplier: 4,
    };
    const task = makeTask();

    const small = systemContent(
      await assembler({ memory, modelContextResolver: () => 8000 }).assembleForJobAsync(job(), task),
    );
    const large = systemContent(
      await assembler({ memory, modelContextResolver: () => 128000 }).assembleForJobAsync(job(), task),
    );

    expect(Buffer.byteLength(large, 'utf-8')).toBeGreaterThan(Buffer.byteLength(small, 'utf-8'));
    // A lesson truncated at the base cap survives under the multiplied cap.
    const present = (block: string, i: number): boolean => block.includes(`Lesson number ${i} `);
    let survivesOnlyLarge = false;
    for (let i = 0; i < 40; i++) {
      if (present(large, i) && !present(small, i)) {
        survivesOnlyLarge = true;
        break;
      }
    }
    expect(survivesOnlyLarge).toBe(true);
  });

  // ── §5: injection recorded once with job.id + selected ids ──────────────
  it('records the injection exactly once with the job id and selected lesson ids', async () => {
    seed('nobility', 'Alpha lesson', 'memoize react component renders');
    seed('nobility', 'Gamma lesson', 'a hint about react only');
    const idByTitle = new Map(
      (db.prepare('SELECT id, title FROM lessons').all() as Array<{ id: string; title: string }>).map((r) => [r.title, r.id]),
    );

    const spy = vi.spyOn(LessonsRepository.prototype, 'recordInjection');
    const task = makeTask({ title: 'Build the react component view', ac: ['render fast'] });
    await assembler({ embedder: fakeEmbedder() }).assembleForJobAsync(job('job-xyz'), task);

    expect(spy).toHaveBeenCalledTimes(1);
    const [calledJobId, calledIds] = spy.mock.calls[0];
    expect(calledJobId).toBe('job-xyz');
    expect(calledIds).toContain(idByTitle.get('Alpha lesson'));
  });

  // ── §5: non-injection tier injects nothing ──────────────────────────────
  it('injects nothing for a non-injection tier (knight)', async () => {
    seed('knight', 'Should not appear', 'no injection on knight');
    const spy = vi.spyOn(LessonsRepository.prototype, 'recordInjection');
    const task = makeTask({ tier: 'knight', title: 'do a code thing' });

    const packet = await assembler({ embedder: fakeEmbedder() }).assembleForJobAsync(job(), task);
    expect(systemContent(packet)).not.toContain('Prior Lessons');
    expect(spy).not.toHaveBeenCalled();
  });
});
