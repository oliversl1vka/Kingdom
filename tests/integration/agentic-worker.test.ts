import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { executeWorker, type AgenticOptions, type ProviderAdapter, type JobPacket, type ModelCapabilities, type CompletionResponse, type ToolCall } from '@kingdomos/core';
import { applyEdit } from '@kingdomos/blacksmith';

const MIGRATIONS_DIR = join(__dirname, '..', '..', 'packages', 'core', 'migrations');

function createDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(readFileSync(join(MIGRATIONS_DIR, '001_initial.sql'), 'utf-8'));
  const now = new Date().toISOString();
  db.prepare('INSERT INTO projects (id, name, repository_path, created_at, updated_at) VALUES (?,?,?,?,?)').run('proj', 'P', process.cwd(), now, now);
  db.prepare('INSERT INTO objectives (id, project_id, description, priority, status, acceptance_criteria, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)').run('obj', 'proj', 'o', 5, 'active', '[]', now, now);
  db.prepare('INSERT INTO task_graph_nodes (id, objective_id, level, title, description, priority, type, status, assigned_tier, reviewer_tier, acceptance_criteria, context_refs, token_budget_estimate, max_retries, retry_count, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .run('task', 'obj', 'subtask', 't', 'd', 5, 'code', 'running', 'knight', 'judge', '[]', '[]', 2048, 3, 0, now, now);
  db.prepare('INSERT INTO jobs (id, task_id, model, status, token_estimate, delegating_supervisor_id, created_at, cancel_requested) VALUES (?,?,?,?,?,?,?,0)').run('job1', 'task', 'gpt-4.1-mini', 'queued', 2048, 'sentinel', now);
  return db;
}

function caps(toolUse: boolean): ModelCapabilities {
  return { strengths: ['implementation'], tool_use: toolUse, structured_output: true, multimodal: false, streaming: false, tier_class: 'balanced', latency_class: 'standard' };
}

function writePacket(workspace: string, resultDir: string): string {
  const packet: JobPacket = {
    job_id: 'job1', task_id: 'task', agent_identity_path: '', model_id: 'gpt-4.1-mini',
    messages: [{ role: 'user', content: 'edit a.ts' }],
    allowed_files: ['a.ts'], scope_mode: 'planned-files', output_format: 'unified-diff',
    acceptance_criteria: [], max_tokens: 1024, timeout_seconds: 30,
    result_path: join(resultDir, 'job1.result.json'),
  };
  const p = join(workspace, 'packet.json');
  writeFileSync(p, JSON.stringify(packet));
  return p;
}

function mockToolProvider(turns: Array<{ tool_calls?: ToolCall[]; content?: string }>): ProviderAdapter {
  let i = 0;
  return {
    provider_id: 'mock',
    complete: vi.fn(async (): Promise<CompletionResponse> => {
      const turn = turns[Math.min(i, turns.length - 1)];
      i += 1;
      return {
        content: turn.content ?? '',
        prompt_tokens: 10, completion_tokens: 10, total_tokens: 20,
        finish_reason: turn.tool_calls && turn.tool_calls.length > 0 ? 'tool_calls' : 'stop',
        ...(turn.tool_calls ? { tool_calls: turn.tool_calls } : {}),
      };
    }),
    healthCheck: vi.fn(async () => ({ status: 'healthy' })),
  };
}

describe('agentic Knight worker loop (P2.1)', () => {
  let dir: string;
  let db: Database.Database;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'kos-agent-')); db = createDb(); });
  afterEach(() => { db.close(); rmSync(dir, { recursive: true, force: true }); });

  function agenticOpts(toolUse: boolean): AgenticOptions {
    return { capabilities: caps(toolUse), workspace: dir, applyEdit, maxIterations: 4 };
  }

  it('happy path: applies an edit then finishes', async () => {
    writeFileSync(join(dir, 'a.ts'), 'const v = 1;\n');
    const packet = writePacket(dir, dir);
    const provider = mockToolProvider([
      { tool_calls: [{ id: '1', name: 'apply_edit', arguments: { path: 'a.ts', old_string: 'const v = 1;', new_string: 'const v = 2;' } }] },
      { tool_calls: [{ id: '2', name: 'finish', arguments: { summary: 'changed v to 2' } }] },
    ]);

    const result = await executeWorker(db, provider, packet, 'w1', agenticOpts(true));

    expect(result.success).toBe(true);
    expect(result.agentic).toBe(true);
    expect(result.finish_reason).toBe('stop');
    expect(result.applied_files).toEqual(['a.ts']);
    expect(readFileSync(join(dir, 'a.ts'), 'utf-8')).toContain('const v = 2;');
    expect(existsSync(join(dir, 'job1.result.json'))).toBe(true);
    expect(db.prepare('SELECT status FROM jobs WHERE id = ?').get('job1')).toEqual({ status: 'completed' });
  });

  it('respects the iteration cap when the model never finishes', async () => {
    writeFileSync(join(dir, 'a.ts'), 'x\n');
    const packet = writePacket(dir, dir);
    // Always returns a read_file call → never finishes.
    const provider = mockToolProvider([
      { tool_calls: [{ id: 'r', name: 'read_file', arguments: { path: 'a.ts' } }] },
    ]);

    const result = await executeWorker(db, provider, packet, 'w1', agenticOpts(true));

    expect(result.agentic).toBe(true);
    expect(result.finish_reason).toBe('length'); // hit the cap
    expect((provider.complete as ReturnType<typeof vi.fn>).mock.calls.length).toBe(4); // maxIterations
  });

  it('falls back to the one-shot path when the model has no tool_use', async () => {
    const packet = writePacket(dir, dir);
    const provider: ProviderAdapter = {
      provider_id: 'mock',
      complete: vi.fn(async () => ({ content: '--- a/x\n+++ b/x', prompt_tokens: 1, completion_tokens: 1, total_tokens: 2, finish_reason: 'stop' as const })),
      healthCheck: vi.fn(async () => ({ status: 'healthy' })),
    };

    const result = await executeWorker(db, provider, packet, 'w1', agenticOpts(false));

    expect(result.agentic).toBeUndefined();
    expect(result.content).toBe('--- a/x\n+++ b/x');
    // One-shot: complete called exactly once, no tools passed.
    expect((provider.complete as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1);
    expect((provider.complete as ReturnType<typeof vi.fn>).mock.calls[0][0].tools).toBeUndefined();
  });

  it('falls back to one-shot when no agentic options are provided at all', async () => {
    const packet = writePacket(dir, dir);
    const provider = mockToolProvider([{ content: 'plain output' }]);
    const result = await executeWorker(db, provider, packet, 'w1');
    expect(result.agentic).toBeUndefined();
    expect((provider.complete as ReturnType<typeof vi.fn>).mock.calls[0][0].tools).toBeUndefined();
  });
});
