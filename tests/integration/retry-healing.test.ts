import { beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  JobRepository,
  RetryManager,
  TaskRepository,
  type CompletionResponse,
  type ProviderAdapter,
  type ReviewDecision,
  type TaskGraphNode,
} from '@kingdomos/core';
import { ActionExecutor, Diagnostician, IncidentReporter } from '@kingdomos/healer';

const MIGRATIONS_DIR = join(__dirname, '..', '..', 'packages', 'core', 'migrations');
const MIGRATIONS = ['001_initial.sql', '006_depends_on.sql', '007_parent_job_id.sql'];

function createDb(): Database.Database {
  const db = new Database(':memory:');
  for (const migration of MIGRATIONS) {
    db.exec(readFileSync(join(MIGRATIONS_DIR, migration), 'utf-8'));
  }

  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO projects (id, name, repository_path, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run('proj', 'Test Project', process.cwd(), now, now);
  db.prepare(
    `INSERT INTO objectives (id, project_id, description, priority, status, acceptance_criteria, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run('obj', 'proj', 'Retry and healing objective', 5, 'active', JSON.stringify([]), now, now);

  return db;
}

function providerWith(content: string): ProviderAdapter {
  const complete = vi.fn(async (): Promise<CompletionResponse> => ({
    content,
    prompt_tokens: 10,
    completion_tokens: 10,
    total_tokens: 20,
    finish_reason: 'stop',
  }));

  return {
    provider_id: 'mock',
    complete,
    healthCheck: vi.fn(async () => ({ status: 'healthy' })),
  };
}

function createRunningTask(db: Database.Database): { task: TaskGraphNode; jobId: string } {
  const taskRepo = new TaskRepository(db);
  const jobRepo = new JobRepository(db);
  const task = taskRepo.create({
    objective_id: 'obj',
    level: 'subtask',
    title: 'Rejected task',
    description: 'Original description.',
    type: 'code',
    assigned_tier: 'knight',
    reviewer_tier: 'judge',
    acceptance_criteria: ['passes review'],
    context_refs: [],
  });
  taskRepo.updateStatus(task.id, 'preparing-context');
  taskRepo.updateStatus(task.id, 'awaiting-budget-check');
  taskRepo.updateStatus(task.id, 'running');

  const job = jobRepo.create({
    task_id: task.id,
    model: 'mock-model',
    token_estimate: 100,
    delegating_supervisor_id: 'judge',
  });
  jobRepo.setStarted(job.id, 'worker-1');

  return { task: taskRepo.getById(task.id)!, jobId: job.id };
}

function review(jobId: string): ReviewDecision {
  return {
    id: 'review-1',
    job_id: jobId,
    reviewer_agent_id: 'judge',
    decision: 'rejected',
    rejection_reasons: ['missing acceptance criterion'],
    scope_check: 'pass',
    format_check: 'pass',
    security_check: 'pass',
    criteria_check: 'fail',
    feedback: 'Add the required behavior before retrying.',
    created_at: new Date().toISOString(),
  };
}

function createAwaitingHealerTask(db: Database.Database): TaskGraphNode {
  const taskRepo = new TaskRepository(db);
  const { task, jobId } = createRunningTask(db);
  new RetryManager(db).handleRejection(review(jobId));
  taskRepo.updateStatus(task.id, 'running');
  db.prepare('UPDATE task_graph_nodes SET max_retries = 1, retry_count = 0 WHERE id = ?').run(task.id);
  const retryJob = new JobRepository(db).getByTask(task.id)[0];
  new RetryManager(db).handleRejection(review(retryJob.id));
  return taskRepo.getById(task.id)!;
}

describe('Retry Manager', () => {
  let db: Database.Database;
  let taskRepo: TaskRepository;
  let jobRepo: JobRepository;

  beforeEach(() => {
    db = createDb();
    taskRepo = new TaskRepository(db);
    jobRepo = new JobRepository(db);
  });

  it('increments retry_count on rejection', () => {
    const { task, jobId } = createRunningTask(db);

    new RetryManager(db).handleRejection(review(jobId));

    expect(taskRepo.getById(task.id)?.retry_count).toBe(1);
  });

  it('re-queues job with feedback appended', () => {
    const { task, jobId } = createRunningTask(db);

    const result = new RetryManager(db).handleRejection(review(jobId));

    expect(result).toEqual({ action: 'retry', taskId: task.id });
    expect(taskRepo.getById(task.id)?.status).toBe('retrying');
    expect(taskRepo.getById(task.id)?.description).toContain('--- Judge retry feedback ---');
    expect(jobRepo.getByTask(task.id)).toHaveLength(2);
    expect(jobRepo.getByTask(task.id).map((job) => job.status)).toContain('queued');
  });

  it('escalates to healer when retries are exhausted', () => {
    const { task, jobId } = createRunningTask(db);
    db.prepare('UPDATE task_graph_nodes SET max_retries = 1 WHERE id = ?').run(task.id);

    const result = new RetryManager(db).handleRejection(review(jobId));

    expect(result).toEqual({ action: 'escalate', taskId: task.id });
    expect(taskRepo.getById(task.id)?.status).toBe('awaiting-healer');
  });

  it('creates incident report on escalation', () => {
    const { task, jobId } = createRunningTask(db);
    db.prepare('UPDATE task_graph_nodes SET max_retries = 1 WHERE id = ?').run(task.id);

    new RetryManager(db).handleRejection(review(jobId));

    const incident = db.prepare('SELECT task_id, job_id, failure_type, severity, symptoms FROM incidents').get() as {
      task_id: string;
      job_id: string;
      failure_type: string;
      severity: string;
      symptoms: string;
    };
    expect(incident).toMatchObject({
      task_id: task.id,
      job_id: jobId,
      failure_type: 'review-rejection',
      severity: 'high',
    });
    expect(JSON.parse(incident.symptoms).rejection_reasons).toEqual(['missing acceptance criterion']);
  });
});

describe('Healer Diagnosis Flow', () => {
  let db: Database.Database;
  let reporter: IncidentReporter;

  beforeEach(() => {
    db = createDb();
    reporter = new IncidentReporter(db);
  });

  it('produces valid HealerDiagnosis with cause and confidence', async () => {
    const task = createAwaitingHealerTask(db);
    const incident = reporter.createIncident({
      task_id: task.id,
      severity: 'high',
      failure_type: 'runtime-crash',
      symptoms: { error: 'boom' },
      context_summary: 'worker crashed',
      failure_history: [],
    });
    const provider = providerWith(JSON.stringify({
      probable_cause: 'Transient provider error',
      confidence: 0.8,
      recommendation: { action: 'retry', modifications: 'Retry with narrower scope' },
    }));

    const diagnosis = await new Diagnostician(db, provider, 'healer-model').diagnose(incident);

    expect(diagnosis).toMatchObject({
      incident_id: incident.id,
      probable_cause: 'Transient provider error',
      confidence: 0.8,
      recommendation: { action: 'retry', modifications: 'Retry with narrower scope' },
    });
  });

  it('forces escalate when confidence is below 0.5', async () => {
    const task = createAwaitingHealerTask(db);
    const incident = reporter.createIncident({
      task_id: task.id,
      severity: 'high',
      failure_type: 'runtime-crash',
      symptoms: { error: 'unclear' },
      context_summary: 'unclear failure',
      failure_history: [],
    });
    const provider = providerWith(JSON.stringify({
      probable_cause: 'Maybe scope issue',
      confidence: 0.25,
      recommendation: { action: 'retry', modifications: 'Try again' },
    }));

    const diagnosis = await new Diagnostician(db, provider, 'healer-model').diagnose(incident);

    expect(diagnosis.recommendation).toMatchObject({ action: 'escalate' });
  });

  it('persists diagnosis to incidents table', async () => {
    const task = createAwaitingHealerTask(db);
    const incident = reporter.createIncident({
      task_id: task.id,
      severity: 'high',
      failure_type: 'runtime-crash',
      symptoms: { error: 'boom' },
      context_summary: 'worker crashed',
      failure_history: [],
    });
    const provider = providerWith(JSON.stringify({
      probable_cause: 'Transient provider error',
      confidence: 0.8,
      recommendation: { action: 'retry', modifications: 'Retry with narrower scope' },
    }));

    await new Diagnostician(db, provider, 'healer-model').diagnose(incident);

    const row = db.prepare('SELECT probable_cause, healer_confidence, healer_recommendation FROM incidents WHERE id = ?').get(incident.id) as {
      probable_cause: string;
      healer_confidence: number;
      healer_recommendation: string;
    };
    expect(row.probable_cause).toBe('Transient provider error');
    expect(row.healer_confidence).toBe(0.8);
    expect(JSON.parse(row.healer_recommendation)).toMatchObject({ action: 'retry' });
  });
});

describe('Action Executor', () => {
  let db: Database.Database;
  let reporter: IncidentReporter;

  beforeEach(() => {
    db = createDb();
    reporter = new IncidentReporter(db);
  });

  it('executes retry action by moving task to running and creating a child job', () => {
    const task = createAwaitingHealerTask(db);
    const incident = reporter.createIncident({
      task_id: task.id,
      severity: 'high',
      failure_type: 'review-rejection',
      symptoms: {},
      context_summary: 'retry requested',
      failure_history: [],
    });

    new ActionExecutor(db).execute(incident.id, task.id, { action: 'retry', modifications: 'Use smaller edit' });

    expect(new TaskRepository(db).getById(task.id)?.status).toBe('running');
    expect(new JobRepository(db).getByTask(task.id)[0].delegating_supervisor_id).toBe('healer');
  });

  it('executes decompose by creating new subtasks', () => {
    const task = createAwaitingHealerTask(db);
    const incident = reporter.createIncident({
      task_id: task.id,
      severity: 'high',
      failure_type: 'review-rejection',
      symptoms: {},
      context_summary: 'decompose requested',
      failure_history: [],
    });

    new ActionExecutor(db).execute(incident.id, task.id, {
      action: 'decompose',
      new_subtasks: [{
        title: 'Smaller replacement',
        description: 'Do a smaller edit.',
        type: 'code',
        acceptance_criteria: ['done'],
        context_refs: [],
      }],
    });

    const repo = new TaskRepository(db);
    expect(repo.getById(task.id)?.status).toBe('superseded');
    expect(repo.getChildren(task.id)).toHaveLength(1);
  });

  it('executes escalate by resolving incident and marking task needs-human', () => {
    const task = createAwaitingHealerTask(db);
    const incident = reporter.createIncident({
      task_id: task.id,
      severity: 'high',
      failure_type: 'review-rejection',
      symptoms: {},
      context_summary: 'escalate requested',
      failure_history: [],
    });

    new ActionExecutor(db).execute(incident.id, task.id, { action: 'escalate', message: 'manual decision required' });

    expect(new TaskRepository(db).getById(task.id)?.status).toBe('needs-human');
    expect(db.prepare('SELECT resolved_at FROM incidents WHERE id = ?').get(incident.id)).toMatchObject({ resolved_at: expect.any(String) });
  });
});