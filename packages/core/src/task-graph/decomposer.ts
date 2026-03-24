import type {
  TaskGraphNode,
  TaskLevel,
  AgentTier,
  ContextRef,
  Message,
  CompletionRequest,
  CompletionResponse,
  ProviderAdapter,
} from '../types.js';
import { generateUlid } from '../ulid.js';
import type { TaskRepository } from '../repositories/task-repo.js';
import type { ObjectiveRepository } from '../repositories/objective-repo.js';

export interface DecompositionResult {
  parent_task: TaskGraphNode;
  children: TaskGraphNode[];
}

export interface DecompositionPlan {
  subtasks: Array<{
    title: string;
    description: string;
    type: 'code' | 'test' | 'review' | 'research' | 'design';
    acceptance_criteria: string[];
    context_refs: ContextRef[];
    token_budget_estimate: number;
  }>;
}

const CHILD_LEVEL: Record<string, TaskLevel> = {
  epic: 'task',
  task: 'subtask',
  subtask: 'job',
};

const TIER_FOR_LEVEL: Record<TaskLevel, AgentTier> = {
  epic: 'nobility',
  task: 'knight',
  subtask: 'squire',
  job: 'squire',
};

const REVIEWER_FOR_TIER: Record<AgentTier, AgentTier> = {
  king: 'king',
  nobility: 'king',
  knight: 'nobility',
  squire: 'knight',
  healer: 'king',
  sentinel: 'king',
  scribe: 'knight',
  judge: 'nobility',
  blacksmith: 'knight',
};

export class TaskDecomposer {
  constructor(
    private taskRepo: TaskRepository,
    private objectiveRepo: ObjectiveRepository,
    private provider: ProviderAdapter
  ) {}

  async decompose(taskId: string): Promise<DecompositionResult> {
    const task = this.taskRepo.getById(taskId);
    if (!task) throw new Error(`Task not found: ${taskId}`);

    const childLevel = CHILD_LEVEL[task.level];
    if (!childLevel) throw new Error(`Cannot decompose tasks at level: ${task.level}`);

    const objective = this.objectiveRepo.getById(task.objective_id);
    if (!objective) throw new Error(`Objective not found: ${task.objective_id}`);

    const existingChildren = this.taskRepo.getChildren(taskId);
    if (existingChildren.length > 0) {
      return { parent_task: task, children: existingChildren };
    }

    const plan = await this.planDecomposition(task, objective.description);

    const children: TaskGraphNode[] = [];
    for (const subtask of plan.subtasks) {
      const assignedTier = TIER_FOR_LEVEL[childLevel];
      const reviewerTier = REVIEWER_FOR_TIER[assignedTier];

      const child = this.taskRepo.create({
        parent_id: taskId,
        objective_id: task.objective_id,
        level: childLevel,
        title: subtask.title,
        description: subtask.description,
        priority: task.priority,
        type: subtask.type,
        assigned_tier: assignedTier,
        reviewer_tier: reviewerTier,
        acceptance_criteria: subtask.acceptance_criteria,
        context_refs: subtask.context_refs,
        token_budget_estimate: subtask.token_budget_estimate,
      });
      children.push(child);
    }

    return { parent_task: task, children };
  }

  private async planDecomposition(
    task: TaskGraphNode,
    objectiveDescription: string
  ): Promise<DecompositionPlan> {
    const childLevel = CHILD_LEVEL[task.level];
    const systemPrompt = `You are a task decomposition engine for a software development project.
Decompose the given ${task.level}-level task into ${childLevel}-level subtasks.

Rules:
- Each subtask must have a clear, actionable title
- Each subtask must have acceptance criteria
- Subtask types: code, test, review, research, design
- Context refs should specify relevant files and line ranges
- Token budget estimates should be reasonable for the subtask scope

Respond with valid JSON matching this schema:
{
  "subtasks": [
    {
      "title": "string",
      "description": "string",
      "type": "code|test|review|research|design",
      "acceptance_criteria": ["string"],
      "context_refs": [{"file": "string", "startLine": 0, "endLine": 0}],
      "token_budget_estimate": 0
    }
  ]
}`;

    const userMessage = `Objective: ${objectiveDescription}

Task to decompose:
- Title: ${task.title}
- Description: ${task.description ?? 'No description'}
- Level: ${task.level} → decompose into ${childLevel}
- Acceptance Criteria: ${JSON.stringify(task.acceptance_criteria)}
- Context refs: ${JSON.stringify(task.context_refs)}`;

    const request: CompletionRequest = {
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
      max_tokens: 4000,
      temperature: 0.3,
    };

    const response: CompletionResponse = await this.provider.complete(request);

    return this.parsePlan(response.content);
  }

  private parsePlan(content: string): DecompositionPlan {
    // Extract JSON from the response, handling potential markdown code blocks
    const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/) ?? [null, content];
    const jsonStr = (jsonMatch[1] ?? content).trim();

    const parsed = JSON.parse(jsonStr);

    if (!Array.isArray(parsed.subtasks)) {
      throw new Error('Decomposition plan missing subtasks array');
    }

    return {
      subtasks: parsed.subtasks.map((s: Record<string, unknown>) => ({
        title: String(s.title ?? ''),
        description: String(s.description ?? ''),
        type: String(s.type ?? 'code'),
        acceptance_criteria: Array.isArray(s.acceptance_criteria)
          ? s.acceptance_criteria.map(String)
          : [],
        context_refs: Array.isArray(s.context_refs)
          ? s.context_refs.map((r: Record<string, unknown>) => ({
              file: String(r.file ?? ''),
              startLine: Number(r.startLine ?? 0),
              endLine: Number(r.endLine ?? 0),
            }))
          : [],
        token_budget_estimate: Number(s.token_budget_estimate ?? 4000),
      })),
    };
  }
}
