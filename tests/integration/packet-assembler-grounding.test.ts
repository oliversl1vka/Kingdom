import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import {
  JobPacketAssembler, TaskRepository, ContextResolver,
  type ContextEngine, type Job, type TaskGraphNode,
} from '@kingdomos/core';

const MIGRATIONS_DIR = join(__dirname, '..', '..', 'packages', 'core', 'migrations');

function createDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  for (const m of ['001_initial.sql', '006_depends_on.sql']) db.exec(readFileSync(join(MIGRATIONS_DIR, m), 'utf-8'));
  const now = new Date().toISOString();
  db.prepare('INSERT INTO projects (id, name, repository_path, created_at, updated_at) VALUES (?,?,?,?,?)').run('proj', 'P', process.cwd(), now, now);
  db.prepare('INSERT INTO objectives (id, project_id, description, priority, status, acceptance_criteria, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)').run('obj', 'proj', 'o', 5, 'active', '[]', now, now);
  return db;
}

/** A seeded fake index: "real.ts" exists (40 lines), "ghost.ts" does not. */
function seededEngine(): ContextEngine {
  return {
    defaultContextDbPath: () => ':memory:',
    getContextStatus: () => ({ indexed: true, staleFileCount: 0, newFileCount: 0, missingFileCount: 0, warnings: [] }),
    indexContextProject: () => ({ status: 'completed', filesIndexed: 0, filesSkipped: 0, errors: [] }),
    searchContext: (req) => {
      const q = `${req.query} ${req.path ?? ''}`;
      if (q.includes('real.ts')) {
        return { projectId: 'p', warnings: [], results: [{ file: 'real.ts', startLine: 1, endLine: 40, title: 'real symbol', snippet: 'export const real = 1;', score: 9, chunkKind: 'symbol' }] };
      }
      if (q.includes('payment') || q.includes('checkout')) {
        return { projectId: 'p', warnings: [], results: [{ file: 'retrieved.ts', startLine: 5, endLine: 12, title: 'PaymentService', snippet: 'class PaymentService {}', score: 8, chunkKind: 'symbol' }] };
      }
      return { projectId: 'p', warnings: [], results: [] };
    },
  };
}

describe('JobPacketAssembler context grounding (P2.2)', () => {
  let dir: string;
  let db: Database.Database;
  let taskRepo: TaskRepository;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'kos-pkt-'));
    mkdirSync(join(dir, 'agents'), { recursive: true });
    writeFileSync(join(dir, 'real.ts'), Array.from({ length: 40 }, (_, i) => `line ${i + 1}`).join('\n'));
    db = createDb();
    taskRepo = new TaskRepository(db);
  });
  afterEach(() => { db.close(); rmSync(dir, { recursive: true, force: true }); });

  function makeTask(refs: TaskGraphNode['context_refs'], title = 'Add payment checkout'): TaskGraphNode {
    return taskRepo.create({
      objective_id: 'obj', level: 'subtask', title, description: 'do checkout work',
      type: 'code', assigned_tier: 'knight', reviewer_tier: 'judge',
      acceptance_criteria: ['works'], context_refs: refs, token_budget_estimate: 2048,
    });
  }

  function assembler(engine: ContextEngine | null) {
    return new JobPacketAssembler(db, taskRepo, {
      projectPath: dir, agentTemplatesDir: join(dir, 'agents'), outputDir: dir,
      contextResolver: new ContextResolver({ projectPath: dir, dbPath: ':memory:', engine }),
    });
  }

  const job = (): Job => ({ id: 'j1', task_id: 'task', model: 'gpt-4.1-mini', status: 'queued', worker_id: null, started_at: null, heartbeat_at: null, timeout_at: null, cancel_requested: false, cancel_reason: null, result_path: null, failure_type: null, token_estimate: 2048, tokens_used: null, delegating_supervisor_id: 's', created_at: new Date().toISOString() } as Job);

  it('drops a hallucinated ref and keeps the real one', async () => {
    const task = makeTask([
      { file: 'real.ts', startLine: 1, endLine: 80 },   // over-range; should clamp to 40
      { file: 'ghost.ts', startLine: 1, endLine: 10 },  // not in index; should drop
    ]);
    const grounded = await assembler(seededEngine()).resolveGroundedContext(task);
    expect(grounded?.indexHealthy).toBe(true);
    expect(grounded?.validatedRefs.map((r) => r.file)).toEqual(['real.ts']);
    expect(grounded?.validatedRefs[0].endLine).toBeLessThanOrEqual(40); // clamped
  });

  it('injects retrieved chunks into the packet user message', async () => {
    const task = makeTask([{ file: 'real.ts', startLine: 1, endLine: 5 }]);
    const packet = await assembler(seededEngine()).assembleForJobAsync(job(), task);
    const user = packet.messages.find((m) => m.role === 'user')!.content;
    expect(user).toContain('Retrieved Context');
    expect(user).toContain('retrieved.ts');
    expect(user).toContain('PaymentService');
  });

  it('degrades to raw slices with a notice when the index is unhealthy', async () => {
    const unhealthy: ContextEngine = { ...seededEngine(), getContextStatus: () => ({ indexed: false, staleFileCount: 0, newFileCount: 0, missingFileCount: 0, warnings: ['no index'] }) };
    const task = makeTask([{ file: 'real.ts', startLine: 1, endLine: 5 }]);
    const grounded = await assembler(unhealthy).resolveGroundedContext(task);
    expect(grounded?.indexHealthy).toBe(false);
    expect(grounded?.validatedRefs).toEqual(task.context_refs); // untouched
    const packet = await assembler(unhealthy).assembleForJobAsync(job(), task);
    expect(packet.messages.find((m) => m.role === 'user')!.content).toContain('Context Notice');
  });

  it('is identical to assembleForJob when no resolver is configured', async () => {
    const task = makeTask([{ file: 'real.ts', startLine: 1, endLine: 5 }]);
    const plain = new JobPacketAssembler(db, taskRepo, { projectPath: dir, agentTemplatesDir: join(dir, 'agents'), outputDir: dir });
    const a = plain.assembleForJob(job(), task);
    const b = await plain.assembleForJobAsync(job(), task);
    expect(b.messages).toEqual(a.messages);
  });
});
