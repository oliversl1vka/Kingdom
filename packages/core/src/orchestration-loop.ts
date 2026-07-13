import type Database from 'better-sqlite3';
import type {
  ContextRef,
  IncidentSubmission,
  ObjectiveCompletionSummary,
  ObjectiveTerminalStatus,
  ProviderAdapter,
  TechStack,
  MilestoneCallback,
  TaskGraphNode,
} from './types.js';
import { ObjectiveRepository } from './repositories/objective-repo.js';
import { TaskRepository } from './repositories/task-repo.js';
import { JobRepository } from './repositories/job-repo.js';
import { TaskDecomposer } from './task-graph/decomposer.js';
import type { PlannerOptions } from './task-graph/planner-tools.js';
import { generateUlid } from './ulid.js';
import { posix as pathPosix } from 'node:path';

export interface OrchestrationConfig {
  pollIntervalMs: number;
  defaultModel: string;
  verbose: boolean;
  /** Technology stack constraints passed to the decomposer. */
  techStack?: TechStack;
  /** Model used for task decomposition. Defaults to defaultModel if not set. */
  decomposerModel?: string;
  /**
   * Resolve the model for a given tier. When provided, initial job creation
   * routes by task.assigned_tier instead of always using defaultModel —
   * without it, squire/knight/nobility jobs all carried knight's model.
   */
  tierModelResolver?: (tier: string) => string;
  /** Legacy callback fired only when an objective completes cleanly and no terminal callback is registered. */
  onObjectiveComplete?: (objectiveId: string, description: string) => void;
  /** Callback fired when an objective reaches any terminal status. */
  onObjectiveTerminal?: (
    objectiveId: string,
    description: string,
    finalStatus: ObjectiveTerminalStatus,
    summary: ObjectiveCompletionSummary,
  ) => void;
  /** High-signal milestone callback — fires on objective_complete and run_failed events. */
  onMilestone?: MilestoneCallback;
  /** Callback used by runtime owners to persist healer-visible incidents. */
  onIncident?: (incident: IncidentSubmission) => void;
  /** Optional context engine hook used to enrich task file refs before job creation. */
  contextHydrator?: {
    hydrateTaskContext(task: TaskGraphNode): Promise<ContextRef[]>;
  };
  // PHASE2 (P2.2): optional run-time context index lifecycle. When provided, the
  // loop performs a one-shot incremental index at startup so the packet assembler's
  // ref-validation/retrieval has a fresh index to query. After-apply re-indexing is
  // driven by the dispatcher's blacksmith path (wired in summon.ts), not here.
  contextIndexLifecycle?: {
    indexAtStart(): Promise<boolean>;
    hasIndexed(): boolean;
  };
  // PHASE2 (P2.3/P2.4): repo-grounded tool-using planner + structured emit options
  // forwarded to the TaskDecomposer.
  plannerOptions?: PlannerOptions;
  /**
   * PHASE3 (P3.1): max automatic replans per objective. The replan phase
   * re-decomposes stuck subtrees; this caps churn from a confused planner.
   * 0 disables replanning entirely. Default 2.
   */
  replanBudgetPerObjective?: number;
}

function mergeContextRefs(refs: ContextRef[]): ContextRef[] {
  const order: string[] = [];
  const byFile = new Map<string, ContextRef[]>();

  for (const ref of refs) {
    const normalized = normalizeContextRef(ref);
    if (!normalized) continue;
    if (!byFile.has(normalized.file)) {
      order.push(normalized.file);
      byFile.set(normalized.file, []);
    }
    byFile.get(normalized.file)!.push(normalized);
  }

  const merged: ContextRef[] = [];
  for (const file of order) {
    const ranges = byFile.get(file)!.sort((a, b) => a.startLine - b.startLine || a.endLine - b.endLine);
    for (const range of ranges) {
      const previous = merged[merged.length - 1];
      if (previous?.file === file && range.startLine <= previous.endLine + 1) {
        previous.endLine = Math.max(previous.endLine, range.endLine);
      } else {
        merged.push({ ...range });
      }
    }
  }

  return merged;
}

function normalizeContextRef(ref: ContextRef): ContextRef | null {
  const rawFile = ref.file?.replace(/\\/g, '/').trim();
  if (!rawFile || rawFile.startsWith('/') || /^[A-Za-z]:\//.test(rawFile)) return null;

  const file = pathPosix.normalize(rawFile);
  if (file === '.' || file.startsWith('../') || file.includes('/../')) return null;

  const startLine = Math.max(0, Math.floor(Number(ref.startLine) || 0));
  const endLine = Math.max(startLine, Math.floor(Number(ref.endLine) || startLine));
  return { file, startLine, endLine };
}

/**
 * Orchestration loop that bridges Objectives → Task Decomposition → Job Creation.
 * This fills the gap between 'decree' (creates objective) and the JobDispatcher (dispatches jobs).
 */
export class OrchestrationLoop {
  private timer: ReturnType<typeof setInterval> | null = null;
  private objectiveRepo: ObjectiveRepository;
  private taskRepo: TaskRepository;
  private jobRepo: JobRepository;
  private decomposer: TaskDecomposer;
  private processing = false;
  private terminalHooksFired = new Set<string>();

  constructor(
    private db: Database.Database,
    private provider: ProviderAdapter,
    private config: OrchestrationConfig
  ) {
    this.objectiveRepo = new ObjectiveRepository(db);
    this.taskRepo = new TaskRepository(db);
    this.jobRepo = new JobRepository(db);
    this.decomposer = new TaskDecomposer(this.taskRepo, this.objectiveRepo, provider, config.techStack, config.decomposerModel ?? config.defaultModel, config.plannerOptions);
  }

  start(): void {
    // PHASE2 (P2.2): fire a one-shot incremental index at run start (best-effort;
    // failure degrades the assembler to raw slices). Intentionally not awaited so
    // the loop begins immediately; the assembler tolerates an in-flight/missing index.
    if (this.config.contextIndexLifecycle && !this.config.contextIndexLifecycle.hasIndexed()) {
      void this.config.contextIndexLifecycle.indexAtStart().catch((err) => {
        if (this.config.verbose) console.error('[Orchestration] context index-at-start failed:', (err as Error).message);
      });
    }
    this.timer = setInterval(() => this.tick(), this.config.pollIntervalMs);
    this.tick();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private async tick(): Promise<void> {
    if (this.processing) return;
    this.processing = true;
    try {
      await this.processDraftObjectives();
      await this.decomposeQueuedTasks();
      await this.replanStuckSubtrees(); // PHASE3 (P3.1): re-decompose stuck subtrees within budget
      await this.createJobsForLeafTasks();
      this.propagateCompletions();
      this.checkObjectiveCompletion();
      this.checkCancelledObjectives();
    } catch (err) {
      if (this.config.verbose) {
        console.error('[Orchestration] Error in tick:', (err as Error).message);
      }
    } finally {
      this.processing = false;
    }
  }

  /**
   * Phase 1: Pick up draft objectives, create an epic-level root task, transition to active.
   */
  private async processDraftObjectives(): Promise<void> {
    const allObjectives = this.db
      .prepare("SELECT * FROM objectives WHERE status = 'draft' ORDER BY priority DESC")
      .all() as Array<Record<string, unknown>>;

    for (const row of allObjectives) {
      const objId = row.id as string;
      const description = row.description as string;
      const priority = row.priority as number;

      if (this.config.verbose) {
        console.log(`[Orchestration] 👑 King processing objective: ${description.slice(0, 80)}...`);
      }

      // Transition: draft → planning
      this.objectiveRepo.updateStatus(objId, 'planning');

      // Create the root epic task from the objective
      const epicTask = this.taskRepo.create({
        parent_id: null,
        objective_id: objId,
        level: 'epic',
        title: `Epic: ${description.slice(0, 150)}`,
        description,
        priority,
        type: 'design',
        assigned_tier: 'nobility',
        reviewer_tier: 'king',
        acceptance_criteria: JSON.parse(row.acceptance_criteria as string || '[]'),
        context_refs: [],
        token_budget_estimate: 16000,
      });

      if (this.config.verbose) {
        console.log(`[Orchestration] 📜 Created root epic: ${epicTask.id} — ${epicTask.title}`);
      }

      // Transition: planning → active
      this.objectiveRepo.updateStatus(objId, 'active');
    }
  }

  /**
   * Phase 2: Find tasks that need decomposition (epic, task levels with no children)
   * and decompose them using the LLM provider.
   */
  private async decomposeQueuedTasks(): Promise<void> {
    // Find epic-level and task-level tasks that are still 'queued' and have no children
    const decomposable = this.db
      .prepare(
        `SELECT t.* FROM task_graph_nodes t
         WHERE t.status = 'queued'
         AND t.level IN ('epic', 'task')
         AND NOT EXISTS (SELECT 1 FROM task_graph_nodes c WHERE c.parent_id = t.id)
         ORDER BY t.priority DESC
         LIMIT 5`
      )
      .all() as Array<Record<string, unknown>>;

    for (const row of decomposable) {
      const taskId = row.id as string;
      const level = row.level as string;
      const title = row.title as string;

      if (this.config.verbose) {
        console.log(`[Orchestration] 🔨 Decomposing ${level}: ${title}`);
      }

      try {
        const result = await this.decomposer.decompose(taskId);

        if (this.config.verbose) {
          console.log(`[Orchestration] ✅ Decomposed into ${result.children.length} children:`);
          for (const child of result.children) {
            console.log(`  → [${child.level}] ${child.title} (tier: ${child.assigned_tier})`);
          }
        }
      } catch (err) {
        if (this.config.verbose) {
          console.error(`[Orchestration] ❌ Decomposition failed for ${taskId}: ${(err as Error).message}`);
        }
        this.handleDecompositionFailure(row, err);
      }
    }
  }

  private handleDecompositionFailure(row: Record<string, unknown>, err: unknown): void {
    const taskId = row.id as string;
    const title = row.title as string;
    const level = row.level as string;
    const maxRetries = Number(row.max_retries ?? 3);
    const message = err instanceof Error ? err.message : String(err);
    const retryCount = this.taskRepo.incrementRetry(taskId);
    const exhausted = retryCount > maxRetries;
    const timestamp = new Date().toISOString();

    this.recordIncident({
      task_id: taskId,
      severity: exhausted ? 'high' : 'medium',
      failure_type: 'decomposition-failure',
      symptoms: {
        error: message,
        task_title: title,
        task_level: level,
        retry_count: retryCount,
        max_retries: maxRetries,
        exhausted,
      },
      context_summary: exhausted
        ? `Decomposition for ${level} "${title}" failed ${retryCount} time(s) and has been handed to healer.`
        : `Decomposition for ${level} "${title}" failed; retry ${retryCount}/${maxRetries} will remain visible on the queued task.`,
      failure_history: [
        {
          attempt: retryCount,
          reason: message,
          timestamp,
        },
      ],
    });

    if (exhausted) {
      this.taskRepo.updateStatus(taskId, 'awaiting-healer');
      this.config.onMilestone?.({
        type: 'task_stuck',
        taskId,
        taskTitle: title,
        details: {
          reason: 'decomposition-failure',
          retry_count: retryCount,
          max_retries: maxRetries,
        },
      });
    }
  }

  /**
   * PHASE3 (P3.1) — Replan phase. Finds parent nodes (epic/task) that are stuck
   * because a child reached `awaiting-healer` (repeated failure the retry/escalate
   * ladder couldn't resolve), and re-decomposes the parent afresh — superseding
   * the failed subtree. Guarded by a per-objective replan budget so a confused
   * planner can't churn the graph forever; once the budget is spent the stuck
   * child is moved to the terminal `awaiting-redesign` state (wiring the
   * previously-dormant state).
   *
   * Additive: this never runs against healthy graphs and is bounded to one
   * replan per tick.
   */
  private async replanStuckSubtrees(): Promise<void> {
    const budget = this.config.replanBudgetPerObjective ?? 2;
    if (budget <= 0) return;
    if (!this.hasColumn('objectives', 'replan_count')) return; // pre-028 DB

    // A node is a replan candidate when it is itself awaiting-healer and is a
    // decomposable level (epic/task) — i.e. its decomposition produced work that
    // got stuck, or it has a child stuck in awaiting-healer.
    const candidates = this.db
      .prepare(
        `SELECT DISTINCT p.id, p.objective_id, p.title, p.level
         FROM task_graph_nodes p
         WHERE p.level IN ('epic','task')
           AND EXISTS (
             SELECT 1 FROM task_graph_nodes c
             WHERE c.parent_id = p.id AND c.status = 'awaiting-healer'
           )
         ORDER BY p.priority DESC
         LIMIT 1`,
      )
      .all() as Array<{ id: string; objective_id: string; title: string; level: string }>;

    for (const cand of candidates) {
      const obj = this.db
        .prepare('SELECT replan_count FROM objectives WHERE id = ?')
        .get(cand.objective_id) as { replan_count: number } | undefined;
      const used = obj?.replan_count ?? 0;

      const stuckChildren = this.db
        .prepare("SELECT id, title FROM task_graph_nodes WHERE parent_id = ? AND status = 'awaiting-healer'")
        .all(cand.id) as Array<{ id: string; title: string }>;
      const reason = `stuck child(ren): ${stuckChildren.map(c => c.title).slice(0, 3).join('; ')}`;

      if (used >= budget) {
        // Budget exhausted — mark the stuck children terminal (awaiting-redesign).
        for (const child of stuckChildren) {
          try { this.taskRepo.updateStatus(child.id, 'awaiting-redesign'); } catch { /* already terminal */ }
        }
        if (this.config.verbose) {
          console.log(`[Orchestration] 🧭 Replan budget (${budget}) exhausted for objective ${cand.objective_id} — ${stuckChildren.length} child(ren) → awaiting-redesign`);
        }
        continue;
      }

      try {
        if (this.config.verbose) {
          console.log(`[Orchestration] 🧭 Replanning ${cand.level} "${cand.title}" (replan ${used + 1}/${budget}) — ${reason}`);
        }
        const result = await this.decomposer.replanNode(cand.id, reason);
        this.db.prepare('UPDATE objectives SET replan_count = replan_count + 1, updated_at = ? WHERE id = ?')
          .run(new Date().toISOString(), cand.objective_id);

        this.config.onMilestone?.({
          type: 'task_stuck',
          taskId: cand.id,
          taskTitle: cand.title,
          details: { action: 'replan', replan_number: used + 1, new_children: result.children.length, reason },
        });
      } catch (err) {
        if (this.config.verbose) {
          console.error(`[Orchestration] ⚠️ Replan failed for ${cand.id}: ${(err as Error).message}`);
        }
        // On replan failure, push the stuck children to terminal so the run can finish.
        for (const child of stuckChildren) {
          try { this.taskRepo.updateStatus(child.id, 'awaiting-redesign'); } catch { /* already terminal */ }
        }
      }
    }
  }

  /** PHASE3: tolerant column probe so replan/verification stay no-ops on old DBs. */
  private hasColumn(table: string, column: string): boolean {
    try {
      const cols = this.db.prepare(`PRAGMA table_info('${table}')`).all() as Array<{ name: string }>;
      return cols.some((c) => c.name === column);
    } catch {
      return false;
    }
  }

  private recordIncident(incident: IncidentSubmission): void {
    if (this.config.onIncident) {
      this.config.onIncident(incident);
      return;
    }

    this.db.prepare(
      `INSERT INTO incidents (
        id, task_id, job_id, severity, failure_type, symptoms, context_summary, failure_history
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      generateUlid(),
      incident.task_id,
      incident.job_id ?? null,
      incident.severity,
      incident.failure_type,
      JSON.stringify(incident.symptoms ?? {}),
      incident.context_summary,
      JSON.stringify(incident.failure_history ?? []),
    );
  }

  /**
   * Phase 3: Create Job records for leaf-level tasks (subtask/job level) that don't have jobs yet.
   * Respects task_dependencies: a task is only dispatched once all dependencies are terminal.
   */
  private async createJobsForLeafTasks(): Promise<void> {
    const terminalStatusSql = [
      'completed',
      'completed-with-warnings',
      'cancelled',
      'awaiting-healer',
      'awaiting-redesign',
      'superseded',
      'needs-human',
    ].map((status) => `'${status}'`).join(', ');

    // Find subtask/job leaf tasks whose dependency rows all point to terminal tasks.
    const leafTasks = this.db
      .prepare(
        `SELECT t.* FROM task_graph_nodes t
         WHERE t.status = 'queued'
         AND t.level IN ('subtask', 'job')
         AND NOT EXISTS (SELECT 1 FROM jobs j WHERE j.task_id = t.id AND j.status IN ('queued','running'))
         AND NOT EXISTS (
           SELECT 1
           FROM task_dependencies td
           LEFT JOIN task_graph_nodes dep ON dep.id = td.depends_on_task_id
           WHERE td.task_id = t.id
             AND (dep.id IS NULL OR dep.status NOT IN (${terminalStatusSql}))
         )
         ORDER BY t.priority DESC
         LIMIT 10`
      )
      .all() as Array<Record<string, unknown>>;

    for (const row of leafTasks) {
      const taskId = row.id as string;
      const title = row.title as string;
      const tier = row.assigned_tier as string;
      const tokenEstimate = (row.token_budget_estimate as number) || 4000;
      const task = this.taskRepo.getById(taskId);
      if (!task) continue;

      if (this.config.contextHydrator) {
        await this.hydrateTaskContext(task);
      }

      const jobModel = this.config.tierModelResolver?.(tier) ?? this.config.defaultModel;
      const job = this.jobRepo.create({
        task_id: taskId,
        model: jobModel,
        token_estimate: tokenEstimate,
        delegating_supervisor_id: 'sentinel',
      });

      if (this.config.verbose) {
        console.log(`[Orchestration] 📋 Created job ${job.id} for leaf task: ${title}`);
      }
    }
  }

  private async hydrateTaskContext(task: TaskGraphNode): Promise<void> {
    if (!this.config.contextHydrator) return;

    try {
      const hydratedRefs = await this.config.contextHydrator.hydrateTaskContext(task);
      const mergedRefs = mergeContextRefs([...task.context_refs, ...hydratedRefs]);
      if (JSON.stringify(mergedRefs) === JSON.stringify(task.context_refs)) return;

      this.db
        .prepare('UPDATE task_graph_nodes SET context_refs = ?, updated_at = ? WHERE id = ?')
        .run(JSON.stringify(mergedRefs), new Date().toISOString(), task.id);
    } catch (err) {
      if (this.config.verbose) {
        console.error(`[Orchestration] Context hydration failed for ${task.id}: ${(err as Error).message}`);
      }
    }
  }

  /**
   * Phase 4: Propagate completions upward — when all children of a parent task
   * are in terminal state, mark the parent accordingly.
  * Terminal states: completed, completed-with-warnings, cancelled, awaiting-healer, awaiting-redesign, superseded, needs-human
   * NOT terminal (still processing): running, retrying, queued, failed-* (will be retried)
   */
  private propagateCompletions(): void {
    // Find parent tasks (epic/task level) whose children are ALL in a terminal state
    const parents = this.db
      .prepare(
        `SELECT t.id, t.level, t.title, t.status FROM task_graph_nodes t
         WHERE t.status IN ('queued', 'running')
         AND t.level IN ('epic', 'task')
         AND EXISTS (SELECT 1 FROM task_graph_nodes c WHERE c.parent_id = t.id)
         AND NOT EXISTS (
           SELECT 1 FROM task_graph_nodes c
           WHERE c.parent_id = t.id
           AND c.status NOT IN ('completed', 'completed-with-warnings',
             'cancelled', 'awaiting-healer', 'awaiting-redesign', 'superseded', 'needs-human',
             'stalled', 'failed-runtime-crash', 'failed-invalid-output', 'failed-review')
         )`
      )
      .all() as Array<Record<string, unknown>>;

    for (const row of parents) {
      const taskId = row.id as string;
      const title = row.title as string;
      const level = row.level as string;

      // Check how many children completed cleanly, completed with warnings, or got stuck.
      const stats = this.db
        .prepare(
          `SELECT
             COUNT(*) as total,
             SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as ok,
             SUM(CASE WHEN status = 'completed-with-warnings' THEN 1 ELSE 0 END) as warnings,
             SUM(CASE WHEN status IN ('awaiting-healer','awaiting-redesign','needs-human','cancelled') THEN 1 ELSE 0 END) as stuck
           FROM task_graph_nodes WHERE parent_id = ?`
        )
        .get(taskId) as { total: number; ok: number; warnings: number; stuck: number };

      // Transition through state machine: queued → preparing-context → awaiting-budget-check → running → completed
      try {
        if (row.status === 'queued') {
          this.taskRepo.updateStatus(taskId, 'preparing-context');
          this.taskRepo.updateStatus(taskId, 'awaiting-budget-check');
          this.taskRepo.updateStatus(taskId, 'running');
        }

        const successful = (stats.ok ?? 0) + (stats.warnings ?? 0);

        if (stats.stuck > 0 && successful > 0) {
          this.taskRepo.updateStatus(taskId, 'completed-with-warnings');
        } else if (stats.stuck === stats.total) {
          // All children are stuck/cancelled — escalate to healer
          this.taskRepo.updateStatus(taskId, 'failed-review');
          this.taskRepo.updateStatus(taskId, 'awaiting-healer');
        } else if ((stats.warnings ?? 0) > 0) {
          this.taskRepo.updateStatus(taskId, 'completed-with-warnings');
        } else {
          this.taskRepo.updateStatus(taskId, 'completed');
        }

        if (this.config.verbose) {
          console.log(`[Orchestration] 🏁 [${level}] ${title.slice(0, 60)} — ${stats.ok}/${stats.total} completed, ${stats.warnings} warnings, ${stats.stuck} stuck`);
        }
      } catch (err) {
        if (this.config.verbose) {
          console.error(`[Orchestration] ⚠️ Could not propagate completion for ${taskId}: ${(err as Error).message}`);
        }
      }
    }
  }

  /**
   * Phase 5: Check if all tasks for an objective are complete and mark the objective done.
   */
  private checkObjectiveCompletion(): void {
    const activeObjectives = this.db
      .prepare("SELECT * FROM objectives WHERE status = 'active'")
      .all() as Array<Record<string, unknown>>;

    for (const row of activeObjectives) {
      const objId = row.id as string;

      // Check if any tasks are still in-progress. `awaiting-healer` is NOT
      // terminal — the healer is expected to emit a recovery plan that puts
      // the task back into motion, so we keep the objective active while that
      // is pending. `awaiting-redesign` and `needs-human` are terminal failures;
      // `superseded` is terminal-neutral because replacement children carry the work.
      const pending = this.db
        .prepare(
          `SELECT COUNT(*) as cnt FROM task_graph_nodes
           WHERE objective_id = ?
           AND status NOT IN ('completed', 'completed-with-warnings',
             'cancelled', 'awaiting-redesign', 'superseded', 'needs-human')`
        )
        .get(objId) as { cnt: number };

      if (pending.cnt === 0) {
        const summary = this.buildObjectiveSummary(objId);
        const finalStatus = this.decideObjectiveFinalStatus(summary);

        this.objectiveRepo.updateStatus(objId, finalStatus);
        if (this.config.verbose) {
          const icon = finalStatus === 'failed' ? '💀' : '👑';
          console.log(`[Orchestration] ${icon} Objective ${objId} marked as ${finalStatus} — ${JSON.stringify(summary)}`);
        }

        const description = row.description as string;
        this.emitObjectiveTerminal(objId, description, finalStatus, summary);
      }
    }

    // Stop the loop when all objectives are finished to prevent spin-loop at end of run.
    // Only stop if at least one objective exists (don't stop on an empty system).
    const totals = this.db
      .prepare('SELECT COUNT(*) as total, SUM(CASE WHEN status IN (\'active\',\'draft\') THEN 1 ELSE 0 END) as pending, SUM(CASE WHEN status = \'failed\' THEN 1 ELSE 0 END) as failed FROM objectives')
      .get() as { total: number; pending: number; failed: number };
    if (totals.total > 0 && totals.pending === 0) {
      if (this.config.verbose) {
        console.log('[Orchestration] 🎉 All objectives complete — stopping orchestration loop');
      }
      // Fire run_failed if all objectives ended in failed state (none completed)
      const allFailed = (totals.failed ?? 0) === totals.total;
      if (allFailed) {
        this.config.onMilestone?.({
          type: 'run_failed',
          details: { total_objectives: totals.total, failed: totals.failed },
        });
      }
      this.stop();
    }
  }

  private buildObjectiveSummary(objectiveId: string): ObjectiveCompletionSummary {
    const row = this.db
      .prepare(
        `SELECT
           COUNT(*) as total,
           SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as succeeded,
           SUM(CASE WHEN status = 'completed-with-warnings' THEN 1 ELSE 0 END) as warnings,
           SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) as cancelled,
           SUM(CASE WHEN status IN ('awaiting-redesign','needs-human') THEN 1 ELSE 0 END) as failed,
           SUM(CASE WHEN status = 'superseded' THEN 1 ELSE 0 END) as superseded
         FROM task_graph_nodes WHERE objective_id = ?`,
      )
      .get(objectiveId) as Record<string, number | null>;

    return {
      total: row.total ?? 0,
      succeeded: row.succeeded ?? 0,
      warnings: row.warnings ?? 0,
      cancelled: row.cancelled ?? 0,
      failed: row.failed ?? 0,
      superseded: row.superseded ?? 0,
    };
  }

  private decideObjectiveFinalStatus(summary: ObjectiveCompletionSummary): ObjectiveTerminalStatus {
    const successful = summary.succeeded + summary.warnings;
    if (summary.failed > 0 || successful === 0) return 'failed';
    if (summary.warnings > 0 || summary.cancelled > 0) return 'completed-with-warnings';
    return 'completed';
  }

  private emitObjectiveTerminal(
    objectiveId: string,
    description: string,
    finalStatus: ObjectiveTerminalStatus,
    summary: ObjectiveCompletionSummary,
  ): void {
    const key = `${objectiveId}:${finalStatus}`;
    if (this.terminalHooksFired.has(key)) return;
    this.terminalHooksFired.add(key);

    if (this.config.onObjectiveTerminal) {
      this.config.onObjectiveTerminal(objectiveId, description, finalStatus, summary);
    } else if (finalStatus === 'completed') {
      this.config.onObjectiveComplete?.(objectiveId, description);
    }

    this.config.onMilestone?.({
      type: 'objective_terminal',
      objectiveId,
      details: { description: description.slice(0, 120), final_status: finalStatus, summary },
    });

    if (finalStatus === 'completed') {
      this.config.onMilestone?.({
        type: 'objective_complete',
        objectiveId,
        details: { description: description.slice(0, 120), summary },
      });
    }
  }

  private checkCancelledObjectives(): void {
    const cancelled = this.db
      .prepare(
        `SELECT o.id, o.description
           FROM objectives o
          WHERE o.status = 'cancelled'
            AND NOT EXISTS (
              SELECT 1 FROM crypt_entries c WHERE c.task_id = o.id
            )`,
      )
      .all() as Array<{ id: string; description: string }>;

    for (const row of cancelled) {
      this.emitObjectiveTerminal(row.id, row.description, 'cancelled', this.buildObjectiveSummary(row.id));
      if (this.config.verbose) {
        console.log(`[Orchestration] 📴 Objective ${row.id} observed in cancelled state — terminal hooks fired`);
      }
    }
  }
}
