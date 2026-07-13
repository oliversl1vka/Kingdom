import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  TaskDecomposer, TaskRepository, ObjectiveRepository,
  type ProviderAdapter, type CompletionResponse, type ModelCapabilities, type RepoReader, type PlannerOptions,
} from '@kingdomos/core';

const MIGRATIONS_DIR = join(__dirname, '..', '..', 'packages', 'core', 'migrations');
const MIGRATIONS = ['001_initial.sql', '006_depends_on.sql', '013_task_dependencies.sql'];

function createDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  for (const m of MIGRATIONS) db.exec(readFileSync(join(MIGRATIONS_DIR, m), 'utf-8'));
  const now = new Date().toISOString();
  db.prepare('INSERT INTO projects (id, name, repository_path, created_at, updated_at) VALUES (?,?,?,?,?)').run('proj', 'P', process.cwd(), now, now);
  db.prepare('INSERT INTO objectives (id, project_id, description, priority, status, acceptance_criteria, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)').run('obj', 'proj', 'Add a feature', 5, 'active', '[]', now, now);
  return db;
}

const TOOL_CAPS: ModelCapabilities = { strengths: ['decomposition'], tool_use: true, structured_output: true, multimodal: false, streaming: false, tier_class: 'balanced', latency_class: 'standard' };
const WEAK_CAPS: ModelCapabilities = { strengths: ['decomposition'], tool_use: false, structured_output: false, multimodal: false, streaming: false, tier_class: 'cheap', latency_class: 'standard' };

const EMIT_PLAN = {
  subtasks: [
    { title: 'Implement feature', description: '## What to do\nimpl', type: 'code', acceptance_criteria: ['done'], context_refs: [{ file: 'src/feature.ts', startLine: 1, endLine: 10 }], depends_on_indices: [], token_budget_estimate: 2000 },
    { title: 'Wire it up', description: '## What to do\nwire', type: 'code', acceptance_criteria: ['wired'], context_refs: [], depends_on_indices: [0], token_budget_estimate: 1500 },
  ],
};

function repoReader(): RepoReader {
  return {
    listFiles: vi.fn(() => ['src/feature.ts', 'src/index.ts']),
    readFile: vi.fn(() => 'export const feature = 1;'),
    grep: vi.fn(() => ['src/feature.ts:1: export const feature = 1;']),
  };
}

describe('repo-grounded tool-using planner (P2.3 / P2.4)', () => {
  let db: Database.Database;
  let taskRepo: TaskRepository;
  let objectiveRepo: ObjectiveRepository;
  beforeEach(() => { db = createDb(); taskRepo = new TaskRepository(db); objectiveRepo = new ObjectiveRepository(db); });
  afterEach(() => db.close());

  function makeTaskLevel(): string {
    const t = taskRepo.create({ objective_id: 'obj', level: 'task', title: 'Build feature', description: 'd', type: 'code', assigned_tier: 'knight', reviewer_tier: 'nobility', acceptance_criteria: [], context_refs: [], token_budget_estimate: 8000 });
    return t.id;
  }

  it('grounds via read-only tools then emits the graph via emit_task_graph', async () => {
    const reader = repoReader();
    let call = 0;
    const provider: ProviderAdapter = {
      provider_id: 'mock',
      complete: vi.fn(async (): Promise<CompletionResponse> => {
        call += 1;
        if (call === 1) {
          return { content: '', prompt_tokens: 1, completion_tokens: 1, total_tokens: 2, finish_reason: 'tool_calls', tool_calls: [{ id: 'g', name: 'grep', arguments: { pattern: 'feature' } }] };
        }
        return { content: '', prompt_tokens: 1, completion_tokens: 1, total_tokens: 2, finish_reason: 'tool_calls', tool_calls: [{ id: 'e', name: 'emit_task_graph', arguments: EMIT_PLAN }] };
      }),
      healthCheck: vi.fn(async () => ({ status: 'healthy' })),
    };
    const planner: PlannerOptions = { capabilities: () => TOOL_CAPS, repoReader: reader };
    const decomposer = new TaskDecomposer(taskRepo, objectiveRepo, provider, undefined, 'gpt-4.1-mini', planner);

    const result = await decomposer.decompose(makeTaskLevel());

    expect(reader.grep).toHaveBeenCalled();
    expect(result.children).toHaveLength(2);
    expect(result.children[0].title).toBe('Implement feature');
    // dependency wiring survived the structured emit
    expect(result.children[1].depends_on).toContain(result.children[0].id);
  });

  it('uses response_format (structured output) when the model lacks tool_use but supports structured_output', async () => {
    const structuredCaps: ModelCapabilities = { ...WEAK_CAPS, structured_output: true };
    const provider: ProviderAdapter = {
      provider_id: 'mock',
      complete: vi.fn(async (): Promise<CompletionResponse> => ({ content: JSON.stringify(EMIT_PLAN), prompt_tokens: 1, completion_tokens: 1, total_tokens: 2, finish_reason: 'stop' })),
      healthCheck: vi.fn(async () => ({ status: 'healthy' })),
    };
    const planner: PlannerOptions = { capabilities: () => structuredCaps };
    const decomposer = new TaskDecomposer(taskRepo, objectiveRepo, provider, undefined, 'gpt-4.1-mini', planner);

    const result = await decomposer.decompose(makeTaskLevel());
    expect(result.children).toHaveLength(2);
    // structured path passes a response_format
    const reqArg = (provider.complete as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(reqArg.response_format?.type).toBe('json_schema');
  });

  it('keeps the legacy blind prose path for non-capable models', async () => {
    const provider: ProviderAdapter = {
      provider_id: 'mock',
      complete: vi.fn(async (): Promise<CompletionResponse> => ({ content: '```json\n' + JSON.stringify(EMIT_PLAN) + '\n```', prompt_tokens: 1, completion_tokens: 1, total_tokens: 2, finish_reason: 'stop' })),
      healthCheck: vi.fn(async () => ({ status: 'healthy' })),
    };
    // No planner options at all → behaves exactly as before.
    const decomposer = new TaskDecomposer(taskRepo, objectiveRepo, provider, undefined, 'qwen2.5-coder-7b');

    const result = await decomposer.decompose(makeTaskLevel());
    expect(result.children).toHaveLength(2);
    const reqArg = (provider.complete as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(reqArg.tools).toBeUndefined();
    expect(reqArg.response_format).toBeUndefined();
  });
});
