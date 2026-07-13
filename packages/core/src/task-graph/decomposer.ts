import type {
  TaskGraphNode,
  TaskLevel,
  AgentTier,
  ContextRef,
  Message,
  CompletionRequest,
  CompletionResponse,
  ProviderAdapter,
  TechStack,
  ModelResolver,
} from '../types.js';
import { generateUlid } from '../ulid.js';
import type { TaskRepository } from '../repositories/task-repo.js';
import type { ObjectiveRepository } from '../repositories/objective-repo.js';
// PHASE2 (P2.3/P2.4): repo-grounded planner + structured emit support.
import { PLANNER_READ_TOOLS, emitTaskGraphSchema, type PlannerOptions } from './planner-tools.js';

export interface DecompositionResult {
  parent_task: TaskGraphNode;
  children: TaskGraphNode[];
}

interface DecompositionPlan {
  subtasks: Array<{
    title: string;
    description: string;
    type: 'code' | 'test' | 'review' | 'research' | 'design';
    acceptance_criteria: string[];
    context_refs: ContextRef[];
    /** Zero-based indices of subtasks in this same list that must complete first. */
    depends_on_indices: number[];
    token_budget_estimate: number;
    /**
     * PHASE3 (P3.2): optional task-scoped test command the planner emits when a
     * deterministic check can prove the subtask. Becomes the task's verification
     * gate (test-execution-as-gate) when present.
     */
    test_command?: string;
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
  private techStack: TechStack | undefined;
  private readonly staticModel: string;
  private readonly resolver?: ModelResolver;
  // PHASE2 (P2.3/P2.4): optional repo-grounded planner + structured emit.
  private readonly plannerOptions?: PlannerOptions;

  constructor(
    private taskRepo: TaskRepository,
    private objectiveRepo: ObjectiveRepository,
    private provider: ProviderAdapter,
    techStack?: TechStack,
    modelOrResolver: string | ModelResolver = 'gpt-4o',
    plannerOptions?: PlannerOptions,
  ) {
    this.techStack = techStack;
    if (typeof modelOrResolver === 'function') {
      this.resolver = modelOrResolver;
      this.staticModel = 'gpt-4o'; // fallback if resolver throws
    } else {
      this.staticModel = modelOrResolver;
    }
    this.plannerOptions = plannerOptions;
  }

  /** Capabilities of the model this decomposer will use next, if a lookup is wired. */
  private capabilities() {
    return this.plannerOptions?.capabilities?.(this.model) ?? null;
  }

  /**
   * The model id this decomposer will use on the *next* LLM call. Honors
   * the resolver first, then falls back to the static id. Useful for
   * observability — dry-run CLIs can print what would actually run.
   */
  getEffectiveModel(): string {
    if (this.resolver) {
      try { return this.resolver(); } catch { /* fall through */ }
    }
    return this.staticModel;
  }

  /** Internal alias kept so existing `this.model` readers compile. */
  private get model(): string { return this.getEffectiveModel(); }

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

    // First pass: create all tasks to get their IDs
    const children: TaskGraphNode[] = [];
    const idByIndex: string[] = [];

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
        // depends_on resolved in second pass below
        token_budget_estimate: subtask.token_budget_estimate,
        // PHASE3 (P3.2): attach the verification gate when the planner emitted a test command.
        verification: subtask.test_command ? { test_command: subtask.test_command } : null,
      });
      children.push(child);
      idByIndex.push(child.id);
    }

    // Second pass: wire depends_on IDs now that all sibling IDs are known
    for (let i = 0; i < plan.subtasks.length; i++) {
      const indices = plan.subtasks[i].depends_on_indices ?? [];
      if (indices.length === 0) continue;
      const depIds = indices
        .filter(idx => idx >= 0 && idx < idByIndex.length && idx !== i)
        .map(idx => idByIndex[idx]);
      if (depIds.length > 0) {
        this.taskRepo.updateDependsOn(children[i].id, depIds);
        children[i] = this.taskRepo.getById(children[i].id)!;
      }
    }

    return { parent_task: task, children };
  }

  /**
   * PHASE3 (P3.1): replan a stuck node. Supersedes the node's existing subtree
   * (roll-up via supersedeSubtree) and re-decomposes the node afresh with the
   * failure `reason` injected into the planning context so the new plan avoids
   * the cause that stalled the old one. Additive entry — does not touch the
   * normal `decompose()` path. Returns the freshly created children.
   *
   * The caller (orchestration replan phase) is responsible for the per-objective
   * replan budget; this method just performs one replan.
   */
  async replanNode(taskId: string, reason: string): Promise<DecompositionResult> {
    const task = this.taskRepo.getById(taskId);
    if (!task) throw new Error(`Task not found: ${taskId}`);

    const childLevel = CHILD_LEVEL[task.level];
    if (!childLevel) throw new Error(`Cannot replan a node at level: ${task.level}`);

    const objective = this.objectiveRepo.getById(task.objective_id);
    if (!objective) throw new Error(`Objective not found: ${task.objective_id}`);

    // Roll up the old subtree as superseded so its (failed/stuck) children no
    // longer block completion and are clearly traceable as replaced.
    for (const child of this.taskRepo.getChildren(taskId)) {
      this.taskRepo.supersedeSubtree(child.id, `replan: ${reason}`);
    }

    // Re-decompose with the failure reason folded into the objective context.
    const replanContext = `${objective.description}\n\n[REPLAN] A previous decomposition of "${task.title}" got stuck. Reason: ${reason}. Produce a DIFFERENT plan that avoids this failure — break the work down differently, add explicit ordering, or narrow scope.`;
    const plan = await this.planDecomposition(task, replanContext);

    const children: TaskGraphNode[] = [];
    const idByIndex: string[] = [];
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
        verification: subtask.test_command ? { test_command: subtask.test_command } : null,
      });
      children.push(child);
      idByIndex.push(child.id);
    }

    for (let i = 0; i < plan.subtasks.length; i++) {
      const indices = plan.subtasks[i].depends_on_indices ?? [];
      if (indices.length === 0) continue;
      const depIds = indices
        .filter(idx => idx >= 0 && idx < idByIndex.length && idx !== i)
        .map(idx => idByIndex[idx]);
      if (depIds.length > 0) {
        this.taskRepo.updateDependsOn(children[i].id, depIds);
        children[i] = this.taskRepo.getById(children[i].id)!;
      }
    }

    return { parent_task: task, children };
  }

  private async planDecomposition(
    task: TaskGraphNode,
    objectiveDescription: string
  ): Promise<DecompositionPlan> {
    const childLevel = CHILD_LEVEL[task.level];

    // Build tech stack constraint block
    let techStackBlock = '';
    if (this.techStack) {
      const parts: string[] = [];
      parts.push(`Language: ${this.techStack.language}`);
      if (this.techStack.framework) parts.push(`Framework: ${this.techStack.framework}`);
      if (this.techStack.build_tool) parts.push(`Build tool: ${this.techStack.build_tool}`);
      if (this.techStack.test_framework) parts.push(`Test framework: ${this.techStack.test_framework}`);
      if (this.techStack.package_manager) parts.push(`Package manager: ${this.techStack.package_manager}`);
      if (this.techStack.extras?.length) parts.push(`Additional: ${this.techStack.extras.join(', ')}`);
      techStackBlock = `\n\nTechnology Stack (MANDATORY — all code MUST use these, never drift to other frameworks/languages):\n${parts.join('\n')}`;
    }

    // Scaffolding is opt-in per objective. When the objective reads as greenfield
    // (new project, from scratch, scaffold, bootstrap…), we prepend a setup
    // subtask. For every other objective we assume the project already exists —
    // the prior "always scaffold" default repeatedly corrupted existing files
    // (duplicate exports, prepended stubs) on Kingdom-on-Kingdom runs.
    let scaffoldingInstruction = '';
    if (task.level === 'epic' && looksLikeGreenfield(objectiveDescription, task.title)) {
      scaffoldingInstruction = `\n\nIMPORTANT — Project Scaffolding:
The FIRST subtask MUST be a "code" type task titled "Project Setup and Scaffolding" that creates the project skeleton:
- Package manifest (package.json / pyproject.toml / Cargo.toml / go.mod / etc.)
- Configuration files (tsconfig.json / vite.config.ts / .eslintrc / etc.)
- Entry point file (main.tsx / main.py / main.go / etc.)
- HTML shell if applicable (index.html)
- Folder structure setup
This task must produce ALL files needed to install dependencies and run the project before any feature code is added.
${this.techStack ? `Use ONLY the specified tech stack: ${this.techStack.language}${this.techStack.framework ? ' + ' + this.techStack.framework : ''}${this.techStack.build_tool ? ' + ' + this.techStack.build_tool : ''}.` : ''}`;
    } else if (task.level === 'epic') {
      scaffoldingInstruction = `\n\nIMPORTANT — Existing Project:
The project already exists. DO NOT include a setup/scaffolding/initialize subtask. DO NOT recreate package manifests, config files, or entry points. Only decompose into the changes required by this objective; preserve all existing files except those explicitly being modified.`;
    }

    const systemPrompt = `You are a task decomposition engine for a software development project.
Decompose the given ${task.level}-level task into ${childLevel}-level subtasks.${techStackBlock}

Rules:
- Each subtask must have a clear, actionable title
- Each subtask must have acceptance criteria
- Subtask types: code, test, review, research, design — prefer "code" for concrete work
- Context refs should specify relevant files and line ranges (use 0,0 if the whole file applies)
- Token budget estimates should be reasonable for the subtask scope
- ALL code and test subtasks MUST use the specified technology stack — never use a different language, framework, or library

Scope discipline (follow strictly):
- Emit the FEWEST subtasks that cover the objective. For a 1–2 file change, 1–3 subtasks. For a moderate change, 3–6. Never exceed 8 at this level unless the parent task genuinely spans many independent areas.
- Do NOT emit separate "analyze", "research", "design", "review", or "plan" subtasks for simple or well-specified work. Reviewing happens automatically via the Judge agent; research is only warranted when the objective explicitly requires investigation.
- Do NOT emit a separate test subtask for every code subtask. One combined code-plus-test subtask is preferred unless tests must run against a finished feature.
- Combine closely related edits into a single subtask that touches multiple files, rather than one subtask per file.${scaffoldingInstruction}

IMPORTANT — Structured descriptions:
Each subtask description MUST use the following section format so the executing agent understands its scope precisely:

## What to do
<concise explanation of the change or feature to implement>

## Files to touch
<list of files that will be created or modified, one per line, with relative paths>

## What not to change
<files or behaviors that must remain untouched — prevents scope creep>

IMPORTANT — Dependency ordering:
Use depends_on_indices to enforce execution order. Reference subtasks by their 0-based position in the subtasks array.
Example: if subtask 1 must run after subtask 0, set subtask 1's depends_on_indices to [0].
Scaffolding and setup tasks always have depends_on_indices: []. Feature tasks that need the scaffold should depend on it.

IMPORTANT — Verification (test-execution-as-gate):
When a subtask's correctness can be proven by a deterministic command, set "test_command" to the SHORTEST command that exits 0 only when the subtask is correctly implemented${this.techStack?.test_framework ? ` (this project uses ${this.techStack.test_framework})` : ''}. It runs in the project root after the change is applied; a non-zero exit rolls the change back. Omit "test_command" when no cheap deterministic check exists (e.g. pure design/research subtasks) — never invent a command that won't exist. Do NOT use "npm test" unless the project has a real test suite; prefer "npm run build" or "npx tsc --build" for code subtasks, or omit entirely.

Respond with valid JSON matching this schema:
{
  "subtasks": [
    {
      "title": "string",
      "description": "## What to do\\n...\\n\\n## Files to touch\\n...\\n\\n## What not to change\\n...",
      "type": "code|test|review|research|design",
      "acceptance_criteria": ["string"],
      "context_refs": [{"file": "string", "startLine": 0, "endLine": 0}],
      "depends_on_indices": [],
      "token_budget_estimate": 0,
      "test_command": "optional shell command proving this subtask, or omit"
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

    const caps = this.capabilities();

    // PHASE2 (P2.3): repo-grounded, tool-using planner. When the model supports
    // tool_use and a repo reader is wired, run a bounded read-only agent session
    // that inspects the repo, then forces a structured emit_task_graph call.
    if (caps?.tool_use && this.plannerOptions?.repoReader) {
      const grounded = await this.planGrounded(task, systemPrompt, userMessage);
      if (grounded) return grounded;
      // fall through to blind path on any failure
    }

    // PHASE2 (P2.4): structured-output decomposition when supported.
    if (caps?.structured_output) {
      const structured = await this.planStructured(systemPrompt, userMessage);
      if (structured) return structured;
      // fall through to prose path on failure
    }

    // ── Legacy blind prose + JSON.parse path (unchanged) ──
    const request: CompletionRequest = {
      model: this.model,
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

  /** PHASE2 (P2.4): one structured json_schema call. Returns null to allow fallback. */
  private async planStructured(systemPrompt: string, userMessage: string): Promise<DecompositionPlan | null> {
    try {
      const response = await this.provider.complete({
        model: this.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage },
        ],
        max_tokens: 4000,
        temperature: 0.3,
        response_format: { type: 'json_schema', name: 'task_graph', schema: emitTaskGraphSchema(), strict: false },
      });
      return this.parsePlan(response.content);
    } catch {
      return null;
    }
  }

  /**
   * PHASE2 (P2.3): bounded read-only agent session over the repo, terminating in a
   * forced `emit_task_graph` tool call. Returns null to allow fallback.
   */
  private async planGrounded(task: TaskGraphNode, systemPrompt: string, userMessage: string): Promise<DecompositionPlan | null> {
    const reader = this.plannerOptions?.repoReader;
    if (!reader) return null;
    const maxIterations = this.plannerOptions?.maxIterations ?? 6;

    const messages: Message[] = [
      { role: 'system', content: `${systemPrompt}\n\nYou have read-only tools to inspect the repository. Use them to GROUND your plan in real files and line numbers before emitting. When ready, call emit_task_graph exactly once.` },
      { role: 'user', content: userMessage },
    ];

    try {
      for (let i = 0; i < maxIterations; i++) {
        // Force emit on the final iteration to guarantee termination.
        const forceEmit = i === maxIterations - 1;
        const response = await this.provider.complete({
          model: this.model,
          messages,
          max_tokens: 4000,
          temperature: 0.3,
          tools: PLANNER_READ_TOOLS,
          tool_choice: forceEmit ? { name: 'emit_task_graph' } : 'auto',
        });

        const calls = response.tool_calls ?? [];
        if (calls.length === 0) {
          // Model answered in prose — try to parse it, else keep nudging.
          try { return this.parsePlan(response.content); } catch { /* keep looping */ }
          messages.push({ role: 'assistant', content: response.content || '' });
          messages.push({ role: 'user', content: 'Continue grounding, then call emit_task_graph.' });
          continue;
        }

        const emit = calls.find((c) => c.name === 'emit_task_graph');
        if (emit) {
          return this.parsePlanObject(emit.arguments);
        }

        // Execute read-only tool calls and feed results back.
        messages.push({ role: 'assistant', content: `Calling: ${calls.map((c) => c.name).join(', ')}` });
        const results: string[] = [];
        for (const call of calls) {
          results.push(`[${call.name}] ${this.runPlannerTool(call.name, call.arguments, task, reader)}`);
        }
        messages.push({ role: 'user', content: `Tool results:\n${results.join('\n')}` });
      }
      return null;
    } catch {
      return null;
    }
  }

  private runPlannerTool(name: string, args: Record<string, unknown>, task: TaskGraphNode, reader: import('./planner-tools.js').RepoReader): string {
    try {
      switch (name) {
        case 'list_files': {
          const files = reader.listFiles(args.dir ? String(args.dir) : undefined);
          return files.slice(0, 200).join('\n');
        }
        case 'read_file': {
          const content = reader.readFile(String(args.path ?? ''));
          return content === null ? `error: not found: ${args.path}` : content.slice(0, 6000);
        }
        case 'grep': {
          const hits = reader.grep(String(args.pattern ?? ''), { glob: args.glob ? String(args.glob) : undefined });
          return hits.slice(0, 100).join('\n') || '(no matches)';
        }
        case 'get_task_graph': {
          const siblings = this.taskRepo.getChildren(task.parent_id ?? '').map((c) => `- ${c.title}`);
          return `Parent: ${task.title}\nExisting siblings:\n${siblings.join('\n') || '(none)'}`;
        }
        default:
          return `error: unknown tool ${name}`;
      }
    } catch (err) {
      return `error: ${err instanceof Error ? err.message : String(err)}`;
    }
  }

  /** Normalize an already-parsed plan object (from a structured tool call). */
  private parsePlanObject(parsed: unknown): DecompositionPlan {
    const obj = parsed as { subtasks?: unknown };
    if (!Array.isArray(obj.subtasks)) {
      throw new Error('emit_task_graph missing subtasks array');
    }
    return this.normalizeSubtasks(obj.subtasks as Array<Record<string, unknown>>);
  }

  private parsePlan(content: string): DecompositionPlan {
    // Extract JSON from the response, handling potential markdown code blocks
    const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/) ?? [null, content];
    const jsonStr = (jsonMatch[1] ?? content).trim();

    const parsed = JSON.parse(jsonStr);

    if (!Array.isArray(parsed.subtasks)) {
      throw new Error('Decomposition plan missing subtasks array');
    }

    return this.normalizeSubtasks(parsed.subtasks as Array<Record<string, unknown>>);
  }

  /** Shared subtask coercion used by both the prose and structured paths. */
  private normalizeSubtasks(subtasks: Array<Record<string, unknown>>): DecompositionPlan {
    return {
      subtasks: subtasks.map((s: Record<string, unknown>) => ({
        title: String(s.title ?? ''),
        description: String(s.description ?? ''),
        type: String(s.type ?? 'code') as DecompositionPlan['subtasks'][number]['type'],
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
        depends_on_indices: Array.isArray(s.depends_on_indices)
          ? s.depends_on_indices.map(Number).filter(n => Number.isFinite(n))
          : [],
        token_budget_estimate: Number(s.token_budget_estimate ?? 4000),
        // PHASE3 (P3.2): optional task-scoped verification command.
        test_command: typeof s.test_command === 'string' && s.test_command.trim()
          ? s.test_command.trim()
          : undefined,
      })),
    };
  }
}

/**
 * Heuristic: does this objective look like a new-project request? Matches the
 * common greenfield phrasings that need a scaffolding subtask. Conservative
 * by design — existing-project objectives far outnumber greenfield ones, and
 * a false-positive scaffolds over real files (the bug we're preventing).
 */
function looksLikeGreenfield(objective: string, title: string): boolean {
  const hay = `${objective} ${title}`.toLowerCase();
  const patterns = [
    /\bnew project\b/,
    /\bfrom scratch\b/,
    /\bbootstrap\b/,
    /\bscaffold\b/,
    /\binitialize (?:a |the )?(?:new |repo|project|codebase)/,
    /\bcreate (?:a |the )?new (?:app|application|project|repo|codebase)/,
    /\bstart (?:a |the )?new (?:app|application|project|repo|codebase)/,
    /\bgreenfield\b/,
  ];
  return patterns.some(p => p.test(hay));
}
