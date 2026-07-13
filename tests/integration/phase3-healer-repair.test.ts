import { beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { TaskRepository, type TaskGraphNode, type ProviderAdapter, type ModelCapabilities } from '@kingdomos/core';
import { ActionExecutor, IncidentReporter, HealerWorker, runAgenticDiagnosis, isCommandWhitelisted } from '@kingdomos/healer';

const MIGRATIONS_DIR = join(__dirname, '..', '..', 'packages', 'core', 'migrations');
const MIGRATIONS = ['001_initial.sql', '006_depends_on.sql'];

function createDb(): Database.Database {
  const db = new Database(':memory:');
  for (const m of MIGRATIONS) db.exec(readFileSync(join(MIGRATIONS_DIR, m), 'utf-8'));
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO projects (id, name, repository_path, created_at, updated_at) VALUES (?,?,?,?,?)`)
    .run('proj', 'P', process.cwd(), now, now);
  db.prepare(`INSERT INTO objectives (id, project_id, description, priority, status, acceptance_criteria, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)`)
    .run('obj', 'proj', 'Heal', 5, 'active', '[]', now, now);
  return db;
}

function awaitingHealerTask(taskRepo: TaskRepository): TaskGraphNode {
  const task = taskRepo.create({
    objective_id: 'obj', level: 'task', title: 'Fix it', description: 'broken',
    type: 'code', assigned_tier: 'knight', reviewer_tier: 'judge', acceptance_criteria: ['works'], context_refs: [],
  });
  taskRepo.updateStatus(task.id, 'preparing-context');
  taskRepo.updateStatus(task.id, 'awaiting-budget-check');
  taskRepo.updateStatus(task.id, 'running');
  taskRepo.updateStatus(task.id, 'failed-review');
  taskRepo.updateStatus(task.id, 'awaiting-healer');
  return taskRepo.getById(task.id)!;
}

const SAMPLE_DIFF = '--- a/x.ts\n+++ b/x.ts\n@@ -1 +1 @@\n-old\n+new\n';

describe('PHASE3 (P3.3) healer repair — verify-before-resolve', () => {
  let db: Database.Database;
  let taskRepo: TaskRepository;
  let reporter: IncidentReporter;

  beforeEach(() => {
    db = createDb();
    taskRepo = new TaskRepository(db);
    reporter = new IncidentReporter(db);
  });

  it('resolves the incident only when the gate is GREEN after applying the patch', () => {
    const task = awaitingHealerTask(taskRepo);
    const incidentId = reporter.createIncident({
      task_id: task.id, severity: 'high', failure_type: 'review-rejection',
      symptoms: {}, context_summary: 'x', failure_history: [],
    }).id;

    const applyDiff = vi.fn(() => ({ success: true, appliedFiles: ['x.ts'], failedFiles: [], errors: [] }));
    const verify = vi.fn(() => ({ passed: true, output: '' }));
    const rollback = vi.fn();

    const executor = new ActionExecutor(db, { workspacePath: '/ws', applyDiff, verify, rollback });
    executor.execute(incidentId, task.id, { action: 'repair', diff: SAMPLE_DIFF, rationale: 'fix the bug' });

    expect(applyDiff).toHaveBeenCalledOnce();
    expect(verify).toHaveBeenCalledOnce();
    expect(rollback).not.toHaveBeenCalled();
    expect(taskRepo.getById(task.id)?.status).toBe('completed-with-warnings');

    const incident = db.prepare('SELECT action_taken, resolved_at FROM incidents WHERE id = ?').get(incidentId) as { action_taken: string; resolved_at: string | null };
    expect(incident.action_taken).toMatch(/VERIFIED green/);
    expect(incident.resolved_at).toBeTruthy();
  });

  it('rolls back and escalates when the gate is RED', () => {
    const task = awaitingHealerTask(taskRepo);
    const incidentId = reporter.createIncident({
      task_id: task.id, severity: 'high', failure_type: 'review-rejection',
      symptoms: {}, context_summary: 'x', failure_history: [],
    }).id;

    const applyDiff = vi.fn(() => ({ success: true, appliedFiles: ['x.ts'], failedFiles: [], errors: [] }));
    const verify = vi.fn(() => ({ passed: false, output: 'tests failed' }));
    const rollback = vi.fn();

    const executor = new ActionExecutor(db, { workspacePath: '/ws', applyDiff, verify, rollback });
    executor.execute(incidentId, task.id, { action: 'repair', diff: SAMPLE_DIFF, rationale: 'fix' });

    expect(rollback).toHaveBeenCalledWith(['x.ts']);
    expect(taskRepo.getById(task.id)?.status).toBe('needs-human');
    const incident = db.prepare('SELECT action_taken FROM incidents WHERE id = ?').get(incidentId) as { action_taken: string };
    expect(incident.action_taken).toMatch(/verification FAILED/);
  });

  it('escalates when the patch does not apply', () => {
    const task = awaitingHealerTask(taskRepo);
    const incidentId = reporter.createIncident({
      task_id: task.id, severity: 'high', failure_type: 'review-rejection',
      symptoms: {}, context_summary: 'x', failure_history: [],
    }).id;

    const applyDiff = vi.fn(() => ({ success: false, appliedFiles: [], failedFiles: ['x.ts'], errors: ['hunk failed'] }));
    const verify = vi.fn(() => ({ passed: true, output: '' }));

    const executor = new ActionExecutor(db, { workspacePath: '/ws', applyDiff, verify });
    executor.execute(incidentId, task.id, { action: 'repair', diff: SAMPLE_DIFF, rationale: 'fix' });

    expect(verify).not.toHaveBeenCalled();
    expect(taskRepo.getById(task.id)?.status).toBe('needs-human');
  });

  it('escalates when no repair capability is wired', () => {
    const task = awaitingHealerTask(taskRepo);
    const incidentId = reporter.createIncident({
      task_id: task.id, severity: 'high', failure_type: 'review-rejection',
      symptoms: {}, context_summary: 'x', failure_history: [],
    }).id;
    const executor = new ActionExecutor(db); // no repair hooks
    executor.execute(incidentId, task.id, { action: 'repair', diff: SAMPLE_DIFF, rationale: 'fix' });
    expect(taskRepo.getById(task.id)?.status).toBe('needs-human');
  });
});

describe('PHASE3 (P3.3) agentic healer — tool loop', () => {
  it('whitelists only the test/validation command, git diff, and grep/rg', () => {
    const ctx = { workspacePath: '/ws', testCommand: 'npm test', validationCommand: 'npm run build' };
    expect(isCommandWhitelisted('npm test', ctx)).toBe(true);
    expect(isCommandWhitelisted('npm run build', ctx)).toBe(true);
    expect(isCommandWhitelisted('git diff', ctx)).toBe(true);
    expect(isCommandWhitelisted('grep -r foo .', ctx)).toBe(true);
    expect(isCommandWhitelisted('rm -rf /', ctx)).toBe(false);
    expect(isCommandWhitelisted('npm test && rm x', ctx)).toBe(false);
    expect(isCommandWhitelisted('curl evil.com', ctx)).toBe(false);
  });

  it('reproduces, then proposes a verified repair patch', async () => {
    // Model: first calls run_command, then proposes a patch.
    let turn = 0;
    const provider: ProviderAdapter = {
      provider_id: 'mock',
      healthCheck: vi.fn(async () => ({ status: 'healthy' })),
      complete: vi.fn(async () => {
        turn++;
        if (turn === 1) {
          return toolResp('run_command', { command: 'git diff' });
        }
        return toolResp('propose_patch', {
          diff: SAMPLE_DIFF, rationale: 'corrected the off-by-one', probable_cause: 'off-by-one', confidence: 0.9,
        });
      }),
    };

    const incident = {
      id: 'inc1', task_id: 't1', job_id: null, severity: 'high' as const, failure_type: 'review-rejection',
      symptoms: {}, context_summary: 'broke', failure_history: [],
      probable_cause: null, healer_confidence: null, healer_recommendation: null, action_taken: null, resolved_at: null, created_at: 'now',
    };

    const diag = await runAgenticDiagnosis(
      incident,
      { workspacePath: process.cwd(), testCommand: 'npm test' },
      { provider, model: 'gpt-4.1-mini' },
    );

    expect(diag.recommendation.action).toBe('repair');
    expect(provider.complete).toHaveBeenCalledTimes(2);
    if (diag.recommendation.action === 'repair') {
      expect(diag.recommendation.diff).toContain('+new');
    }
  });
});

describe('PHASE3 (P3.3) HealerWorker — agentic options wired on the live path', () => {
  let db: Database.Database;
  let taskRepo: TaskRepository;
  let reporter: IncidentReporter;

  beforeEach(() => {
    db = createDb();
    taskRepo = new TaskRepository(db);
    reporter = new IncidentReporter(db);
  });

  const toolCaps: ModelCapabilities = { tool_use: true } as ModelCapabilities;
  const noToolCaps: ModelCapabilities = { tool_use: false } as ModelCapabilities;

  async function drive(worker: HealerWorker): Promise<void> {
    await (worker as unknown as { processIncidents(): Promise<void> }).processIncidents();
  }

  it('routes a tool-capable healer model through the agentic loop and applies a verified repair', async () => {
    const task = awaitingHealerTask(taskRepo);
    reporter.createIncident({
      task_id: task.id, severity: 'high', failure_type: 'review-rejection',
      symptoms: {}, context_summary: 'x', failure_history: [],
    });

    // Tool-capable model: investigate then propose_patch (the agentic path).
    let turn = 0;
    const provider: ProviderAdapter = {
      provider_id: 'mock',
      healthCheck: vi.fn(async () => ({ status: 'healthy' })),
      complete: vi.fn(async () => {
        turn++;
        if (turn === 1) return toolResp('run_command', { command: 'git diff' });
        return toolResp('propose_patch', { diff: SAMPLE_DIFF, rationale: 'fix', probable_cause: 'bug', confidence: 0.9 });
      }),
    };

    const applyDiff = vi.fn(() => ({ success: true, appliedFiles: ['x.ts'], failedFiles: [], errors: [] }));
    const verify = vi.fn(() => ({ passed: true, output: '' }));

    const worker = new HealerWorker(db, provider, {
      model: 'tool-model',
      capabilitiesResolver: () => toolCaps,
      agenticContext: { workspacePath: process.cwd(), validationCommand: 'npm run build' },
      repair: { workspacePath: '/ws', applyDiff, verify, rollback: vi.fn() },
    });

    await drive(worker);

    // Agentic loop ran (>=2 completes), patch applied + verified, task resolved.
    expect(provider.complete).toHaveBeenCalledTimes(2);
    expect(applyDiff).toHaveBeenCalledOnce();
    expect(verify).toHaveBeenCalledOnce();
    expect(taskRepo.getById(task.id)?.status).toBe('completed-with-warnings');
  });

  it('keeps a non-tool-use healer model on the one-shot classifier path', async () => {
    const task = awaitingHealerTask(taskRepo);
    reporter.createIncident({
      task_id: task.id, severity: 'high', failure_type: 'review-rejection',
      symptoms: {}, context_summary: 'x', failure_history: [],
    });

    // Non-tool model: a single classifier completion returning JSON. No tool_calls.
    const provider: ProviderAdapter = {
      provider_id: 'mock',
      healthCheck: vi.fn(async () => ({ status: 'healthy' })),
      complete: vi.fn(async () => ({
        content: '{"probable_cause":"flaky","confidence":0.9,"recommendation":{"action":"retry","modifications":"rerun"}}',
        prompt_tokens: 1, completion_tokens: 1, total_tokens: 2, finish_reason: 'stop' as const,
      })),
    };

    const worker = new HealerWorker(db, provider, {
      model: 'weak-model',
      capabilitiesResolver: () => noToolCaps,
      agenticContext: { workspacePath: process.cwd(), validationCommand: 'npm run build' },
      repair: { workspacePath: '/ws', applyDiff: vi.fn(), verify: vi.fn(() => ({ passed: true, output: '' })) },
    });

    await drive(worker);

    // Exactly one classifier call — never entered the agentic loop. Retry executed.
    expect(provider.complete).toHaveBeenCalledTimes(1);
    expect(provider.complete).toHaveBeenCalledWith(expect.not.objectContaining({ tools: expect.anything() }));
  });
});

function toolResp(name: string, args: Record<string, unknown>) {
  return {
    content: '',
    prompt_tokens: 1,
    completion_tokens: 1,
    total_tokens: 2,
    finish_reason: 'tool_calls' as const,
    tool_calls: [{ id: 'c1', name, arguments: args }],
  };
}
