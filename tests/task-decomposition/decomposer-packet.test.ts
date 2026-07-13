import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  TaskDecomposer,
  JobPacketAssembler,
  TaskRepository,
  ObjectiveRepository,
  JobRepository,
} from '@kingdomos/core';
import type {
  ProviderAdapter,
  CompletionRequest,
  CompletionResponse,
  TaskGraphNode,
} from '@kingdomos/core';

const MIGRATIONS_DIR = join(__dirname, '..', '..', 'packages', 'core', 'migrations');

function createDb(): Database.Database {
  const db = new Database(':memory:');
  for (const migration of [
    '001_initial.sql',
    '006_depends_on.sql',
    '007_parent_job_id.sql',
  ]) {
    db.exec(readFileSync(join(MIGRATIONS_DIR, migration), 'utf-8'));
  }
  const now = new Date().toISOString();
  db.prepare(
    'INSERT INTO projects (id, name, repository_path, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
  ).run('proj-1', 'Test Project', process.cwd(), now, now);
  db.prepare(
    `INSERT INTO objectives (id, project_id, description, priority, status, acceptance_criteria, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run('obj-1', 'proj-1', 'Test objective', 5, 'active', JSON.stringify([]), now, now);
  return db;
}

function makeProvider(responses: string[]): ProviderAdapter {
  let callIndex = 0;
  return {
    provider_id: 'mock',
    async complete(_req: CompletionRequest): Promise<CompletionResponse> {
      const content = responses[callIndex] ?? '{}';
      callIndex++;
      // If content starts with {, wrap in a decomposer plan format
      const finalContent = content.startsWith('{')
        ? content
        : content;
      return {
        content: finalContent,
        prompt_tokens: 10,
        completion_tokens: 20,
        total_tokens: 30,
        finish_reason: 'stop',
      };
    },
    async healthCheck() {
      return { status: 'healthy' };
    },
  };
}

function setupTemplatesDir(): string {
  const dir = join(tmpdir(), `kingdom-test-templates-${Date.now()}`);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  // Write minimal agent templates
  const tiers = ['king', 'nobility', 'knight', 'squire', 'judge', 'healer', 'blacksmith'];
  for (const tier of tiers) {
    writeFileSync(
      join(dir, `${tier}.md`),
      `# The ${tier} - Test\n\n## Tier\n${tier}\n\n## Role\nTest agent identity.\n`,
    );
  }
  return dir;
}

describe('TaskDecomposer', () => {
  let db: Database.Database;
  let taskRepo: TaskRepository;
  let objectiveRepo: ObjectiveRepository;

  beforeEach(() => {
    db = createDb();
    taskRepo = new TaskRepository(db);
    objectiveRepo = new ObjectiveRepository(db);
  });

  it('should refuse to decompose a job-level task', async () => {
    const provider = makeProvider(['{}']);
    const decomposer = new TaskDecomposer(taskRepo, objectiveRepo, provider);
    const task = taskRepo.create({
      objective_id: 'obj-1',
      level: 'job',
      title: 'Cant decompose me',
      description: 'job level',
      type: 'code',
      assigned_tier: 'squire',
      reviewer_tier: 'knight',
      acceptance_criteria: [],
      context_refs: [],
    });

    await expect(decomposer.decompose(task.id)).rejects.toThrow(
      'Cannot decompose tasks at level: job',
    );
  });

  it('should return existing children if already decomposed', async () => {
    // Create a parent task
    const parent = taskRepo.create({
      objective_id: 'obj-1',
      level: 'epic',
      title: 'Already decomposed epic',
      description: 'has children',
      type: 'design',
      assigned_tier: 'nobility',
      reviewer_tier: 'king',
      acceptance_criteria: [],
      context_refs: [],
    });

    // Create child tasks manually
    const child1 = taskRepo.create({
      parent_id: parent.id,
      objective_id: 'obj-1',
      level: 'task',
      title: 'Child task 1',
      type: 'code',
      assigned_tier: 'knight',
      reviewer_tier: 'nobility',
      acceptance_criteria: [],
      context_refs: [],
    });
    const child2 = taskRepo.create({
      parent_id: parent.id,
      objective_id: 'obj-1',
      level: 'task',
      title: 'Child task 2',
      type: 'code',
      assigned_tier: 'knight',
      reviewer_tier: 'nobility',
      acceptance_criteria: [],
      context_refs: [],
    });

    // Provider should NOT be called since children already exist
    const provider = makeProvider(['SHOULD NOT BE USED']);
    const decomposer = new TaskDecomposer(taskRepo, objectiveRepo, provider);
    const result = await decomposer.decompose(parent.id);

    expect(result.parent_task.id).toBe(parent.id);
    expect(result.children.length).toBe(2);
    expect(result.children.map(c => c.id).sort()).toEqual(
      [child1.id, child2.id].sort(),
    );
  });

  it('should parse JSON response from LLM including code blocks', async () => {
    // This test exercises the private parsePlan method indirectly by providing
    // a JSON response wrapped in markdown code fences, which parsePlan must handle.
    const planJson = JSON.stringify({
      subtasks: [
        {
          title: 'Add login',
          description: 'Implement user login',
          type: 'code',
          acceptance_criteria: ['Users can log in'],
          context_refs: [],
          depends_on_indices: [],
          token_budget_estimate: 4000,
        },
      ],
    });
    const wrappedPlan = '```json\n' + planJson + '\n```';
    const provider = makeProvider([wrappedPlan]);
    const decomposer = new TaskDecomposer(taskRepo, objectiveRepo, provider);

    const parent = taskRepo.create({
      objective_id: 'obj-1',
      level: 'epic',
      title: 'Login feature epic',
      description: 'Add login functionality',
      type: 'design',
      assigned_tier: 'nobility',
      reviewer_tier: 'king',
      acceptance_criteria: [],
      context_refs: [],
    });

    const result = await decomposer.decompose(parent.id);

    expect(result.children.length).toBe(1);
    expect(result.children[0].title).toBe('Add login');
    expect(result.children[0].assigned_tier).toBe('knight');
    expect(result.children[0].reviewer_tier).toBe('nobility');
    expect(result.children[0].token_budget_estimate).toBe(4000);
  });

  it('should parse plain JSON response (no code blocks)', async () => {
    const planJson = JSON.stringify({
      subtasks: [
        {
          title: 'Build header',
          description: 'Create site header',
          type: 'code',
          acceptance_criteria: ['Header visible'],
          context_refs: [],
          depends_on_indices: [],
          token_budget_estimate: 2000,
        },
      ],
    });
    const provider = makeProvider([planJson]);
    const decomposer = new TaskDecomposer(taskRepo, objectiveRepo, provider);

    const parent = taskRepo.create({
      objective_id: 'obj-1',
      level: 'epic',
      title: 'UI epic',
      description: 'Build UI components',
      type: 'design',
      assigned_tier: 'nobility',
      reviewer_tier: 'king',
      acceptance_criteria: [],
      context_refs: [],
    });

    const result = await decomposer.decompose(parent.id);

    expect(result.children.length).toBe(1);
    expect(result.children[0].title).toBe('Build header');
    expect(result.children[0].token_budget_estimate).toBe(2000);
  });

  it('should assign correct tiers to child tasks', async () => {
    const planJson = JSON.stringify({
      subtasks: [
        {
          title: 'Task A',
          description: 'First task',
          type: 'code',
          acceptance_criteria: ['done'],
          context_refs: [],
          depends_on_indices: [],
          token_budget_estimate: 3000,
        },
        {
          title: 'Task B',
          description: 'Second task',
          type: 'test',
          acceptance_criteria: ['passed'],
          context_refs: [],
          depends_on_indices: [0],
          token_budget_estimate: 2000,
        },
      ],
    });
    const provider = makeProvider([planJson]);
    const decomposer = new TaskDecomposer(taskRepo, objectiveRepo, provider);

    const parent = taskRepo.create({
      objective_id: 'obj-1',
      level: 'epic',
      title: 'Epic with ordering',
      description: 'Tasks with deps',
      type: 'design',
      assigned_tier: 'nobility',
      reviewer_tier: 'king',
      acceptance_criteria: [],
      context_refs: [],
    });

    const result = await decomposer.decompose(parent.id);

    expect(result.children.length).toBe(2);
    // Epics decompose to tasks -> knight tier, reviewer is nobility
    for (const child of result.children) {
      expect(child.assigned_tier).toBe('knight');
      expect(child.reviewer_tier).toBe('nobility');
    }
    // Task B should depend on Task A
    const taskB = result.children.find(c => c.title === 'Task B')!;
    expect(taskB.depends_on.length).toBe(1);
    const taskA = result.children.find(c => c.title === 'Task A')!;
    expect(taskB.depends_on[0]).toBe(taskA.id);
  });
});

describe('JobPacketAssembler', () => {
  let db: Database.Database;
  let taskRepo: TaskRepository;
  let jobRepo: JobRepository;
  let templatesDir: string;

  beforeEach(() => {
    db = createDb();
    taskRepo = new TaskRepository(db);
    jobRepo = new JobRepository(db);
    templatesDir = setupTemplatesDir();
  });

  function createAssembler(overrides: Record<string, unknown> = {}) {
    return new JobPacketAssembler(db, taskRepo, {
      projectPath: process.cwd(),
      agentTemplatesDir: templatesDir,
      outputDir: '/tmp/kingdom-results',
      ...overrides,
    });
  }

  it('should set output_format to unified-diff for code tasks', () => {
    const task = taskRepo.create({
      objective_id: 'obj-1',
      level: 'subtask',
      title: 'Code task',
      type: 'code',
      assigned_tier: 'knight',
      reviewer_tier: 'nobility',
      acceptance_criteria: [],
      context_refs: [],
    });

    const job = jobRepo.create({
      task_id: task.id,
      model: 'test-model',
      token_estimate: 100,
      delegating_supervisor_id: 'test',
    });

    const assembler = createAssembler();
    const packet = assembler.assembleForJob(job, task);

    expect(packet.output_format).toBe('unified-diff');
  });

  it('should set output_format to markdown for research tasks', () => {
    const task = taskRepo.create({
      objective_id: 'obj-1',
      level: 'subtask',
      title: 'Research something',
      type: 'research',
      assigned_tier: 'knight',
      reviewer_tier: 'nobility',
      acceptance_criteria: [],
      context_refs: [],
    });

    const job = jobRepo.create({
      task_id: task.id,
      model: 'test-model',
      token_estimate: 100,
      delegating_supervisor_id: 'test',
    });

    const assembler = createAssembler();
    const packet = assembler.assembleForJob(job, task);

    expect(packet.output_format).toBe('markdown');
  });

  it('should include agent identity as system message', () => {
    const task = taskRepo.create({
      objective_id: 'obj-1',
      level: 'subtask',
      title: 'Test task',
      type: 'code',
      assigned_tier: 'knight',
      reviewer_tier: 'nobility',
      acceptance_criteria: [],
      context_refs: [],
    });

    const job = jobRepo.create({
      task_id: task.id,
      model: 'test-model',
      token_estimate: 100,
      delegating_supervisor_id: 'test',
    });

    const assembler = createAssembler();
    const packet = assembler.assembleForJob(job, task);

    // The first message should be a system message from the agent identity
    expect(packet.messages.length).toBeGreaterThanOrEqual(1);
    expect(packet.messages[0].role).toBe('system');
    expect(packet.messages[0].content).toContain('Test agent identity');
  });

  it('should reject tasks that are not job/subtask/task level', () => {
    const task = taskRepo.create({
      objective_id: 'obj-1',
      level: 'epic',
      title: 'Epic cannot be assembled',
      type: 'design',
      assigned_tier: 'nobility',
      reviewer_tier: 'king',
      acceptance_criteria: [],
      context_refs: [],
    });

    const job = jobRepo.create({
      task_id: task.id,
      model: 'test-model',
      token_estimate: 100,
      delegating_supervisor_id: 'test',
    });

    const assembler = createAssembler();
    expect(() => assembler.assembleForJob(job, task)).toThrow(
      'Cannot create job packet for task level: epic',
    );
  });

  it('should include context from referenced files', () => {
    const task = taskRepo.create({
      objective_id: 'obj-1',
      level: 'subtask',
      title: 'Modify a file',
      type: 'code',
      assigned_tier: 'knight',
      reviewer_tier: 'nobility',
      acceptance_criteria: [],
      context_refs: [{ file: 'package.json', startLine: 0, endLine: 0 }],
    });

    const job = jobRepo.create({
      task_id: task.id,
      model: 'test-model',
      token_estimate: 100,
      delegating_supervisor_id: 'test',
    });

    const assembler = createAssembler();
    const packet = assembler.assembleForJob(job, task);

    // The user message should include the context file
    const userMsg = packet.messages.find(m => m.role === 'user');
    expect(userMsg).toBeDefined();
    expect(userMsg!.content).toContain('package.json');
  });
});
