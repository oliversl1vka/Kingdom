import type { HealerRecommendation, NewSubtaskSpec, AgentTier, TaskLevel } from '@kingdomos/core';
import { TaskRepository, JobRepository } from '@kingdomos/core';
import { IncidentReporter } from './incident-reporter.js';
import type Database from 'better-sqlite3';

/**
 * PHASE3 (P3.3): applies a unified diff to the workspace. Mirrors the
 * dispatcher's BlacksmithCallback shape so the same blacksmith can be reused.
 */
export type RepairApplyDiff = (diffText: string, projectPath: string) => {
  success: boolean;
  appliedFiles: string[];
  failedFiles: string[];
  errors: string[];
};

/**
 * PHASE3 (P3.3): runs the SAME validation/probe pipeline the dispatcher uses
 * after a diff is applied. Returns whether the workspace is green plus any
 * captured output. Injected so the healer package needs no execSync coupling.
 */
export type RepairVerifier = () => { passed: boolean; output: string };

/**
 * PHASE5 (§5.8): isolated-worktree repair outcome. When the workspace is a git
 * repo, the healer's patch is applied + verified + merged inside a throwaway
 * worktree (same safety relocation as agentic dispatch). The integration branch
 * is untouched unless `merged` is true — INV-1.
 */
export interface WorktreeRepairResult {
  applied: boolean;
  verified: boolean;
  merged: boolean;
  output: string;
  appliedFiles: string[];
}

/** PHASE3 (P3.3): hooks enabling the verify-before-resolve `repair` action. */
export interface ActionExecutorOptions {
  workspacePath?: string;
  applyDiff?: RepairApplyDiff;
  verify?: RepairVerifier;
  /** Rollback applied files if verification fails (best-effort). */
  rollback?: (appliedFiles: string[]) => void;
  /**
   * PHASE5 (§5.8): when wired (git workspace + agentic dispatch), the repair is
   * applied/verified/merged in an isolated worktree instead of in-place. Takes
   * precedence over `applyDiff`/`verify`/`rollback`. Falls back to the in-place
   * path for non-git workspaces (hook absent).
   */
  worktreeRepair?: (diff: string, repairId: string) => WorktreeRepairResult;
  verbose?: boolean;
}

export class ActionExecutor {
  private taskRepo: TaskRepository;
  private jobRepo: JobRepository;
  private reporter: IncidentReporter;
  private opts: ActionExecutorOptions;

  constructor(private db: Database.Database, options: ActionExecutorOptions = {}) {
    this.taskRepo = new TaskRepository(db);
    this.jobRepo = new JobRepository(db);
    this.reporter = new IncidentReporter(db);
    this.opts = options;
  }

  execute(incidentId: string, taskId: string, recommendation: HealerRecommendation): void {
    switch (recommendation.action) {
      case 'retry':
        this.executeRetry(incidentId, taskId, recommendation.modifications);
        break;
      case 'decompose':
        this.executeDecompose(incidentId, taskId, recommendation.new_subtasks);
        break;
      case 'reassign':
        this.executeReassign(incidentId, taskId, recommendation.target_tier, recommendation.reason);
        break;
      case 'repair':
        this.executeRepair(incidentId, taskId, recommendation.diff, recommendation.rationale);
        break;
      case 'escalate':
        this.executeEscalate(incidentId, taskId, recommendation.message);
        break;
    }
  }

  /**
   * PHASE3 (P3.3) — verify-before-resolve. Apply the healer's proposed diff
   * through the blacksmith, run the SAME validation/probe gate, and only resolve
   * the incident (task → completed-with-warnings) when the gate is GREEN. If the
   * patch fails to apply or the gate is red, roll back and escalate — the healer
   * never marks a fix done without proof it works.
   */
  private executeRepair(incidentId: string, taskId: string, diff: string, rationale: string): void {
    const task = this.taskRepo.getById(taskId);
    if (!task) return;

    // PHASE5 (§5.8): isolated-worktree repair when wired (git workspace). Same
    // verify-before-resolve contract, but the patch lives in a throwaway worktree
    // and reaches the integration branch only after verify passes + a clean merge.
    if (this.opts.worktreeRepair && diff.trim()) {
      const r = this.opts.worktreeRepair(diff, `heal-${incidentId}`);
      if (!r.applied || r.appliedFiles.length === 0) {
        this.taskRepo.updateStatus(taskId, 'needs-human');
        this.reporter.resolve(incidentId, `Healer repair failed to apply in isolated worktree — discarded, escalated. ${r.output.slice(0, 200)}`);
        return;
      }
      if (!r.verified) {
        this.taskRepo.updateStatus(taskId, 'needs-human');
        this.reporter.resolve(incidentId, `Healer repair verification FAILED in isolated worktree — discarded (integration untouched), escalated. Output: ${r.output.slice(0, 200)}`);
        return;
      }
      if (!r.merged) {
        this.taskRepo.updateStatus(taskId, 'needs-human');
        this.reporter.resolve(incidentId, `Healer repair verified but merge-back conflicted — discarded (integration untouched), escalated. ${r.output.slice(0, 200)}`);
        return;
      }
      this.resolveRepairGreen(incidentId, taskId, r.appliedFiles, `${rationale} (isolated worktree)`);
      return;
    }

    if (!this.opts.applyDiff || !this.opts.verify || !this.opts.workspacePath || !diff.trim()) {
      // No repair capability wired (or empty diff) — fall back to escalation.
      this.taskRepo.updateStatus(taskId, 'needs-human');
      this.reporter.resolve(incidentId, `Repair requested but no apply/verify capability available — escalated. (${rationale})`);
      return;
    }

    const apply = this.opts.applyDiff(diff, this.opts.workspacePath);
    if (!apply.success || apply.appliedFiles.length === 0) {
      this.opts.rollback?.(apply.appliedFiles);
      this.taskRepo.updateStatus(taskId, 'needs-human');
      this.reporter.resolve(incidentId, `Healer repair failed to apply (${apply.errors.slice(0, 2).join('; ')}) — escalated`);
      return;
    }

    const verdict = this.opts.verify();
    if (!verdict.passed) {
      this.opts.rollback?.(apply.appliedFiles);
      this.taskRepo.updateStatus(taskId, 'needs-human');
      this.reporter.resolve(incidentId, `Healer repair applied but verification FAILED — rolled back, escalated. Output: ${verdict.output.slice(0, 200)}`);
      return;
    }

    // Green gate — the fix is PROVEN. Resolve the task as completed-with-warnings
    // (a healer-applied repair, not a clean worker pass) and resolve the incident.
    this.resolveRepairGreen(incidentId, taskId, apply.appliedFiles, rationale);
  }

  /** Route a verified+landed repair to completed-with-warnings + resolve the incident. */
  private resolveRepairGreen(incidentId: string, taskId: string, appliedFiles: string[], rationale: string): void {
    try {
      const cur = this.taskRepo.getById(taskId)?.status;
      // Route through the valid lifecycle to reach a completed state.
      if (cur === 'awaiting-healer' || cur === 'failed-review' ||
          cur === 'failed-runtime-crash' || cur === 'failed-invalid-output' ||
          cur === 'failed-timeout' || cur === 'failed-token-overflow') {
        this.taskRepo.updateStatus(taskId, 'retrying');
        this.taskRepo.updateStatus(taskId, 'running');
      } else if (cur === 'stalled') {
        this.taskRepo.updateStatus(taskId, 'running');
      }
      this.taskRepo.updateStatus(taskId, 'completed-with-warnings');
    } catch {
      // Task already transitioned — leave it.
    }
    this.reporter.resolve(incidentId, `Healer repair applied and VERIFIED green (${appliedFiles.join(', ')}). ${rationale}`);
  }

  private executeRetry(incidentId: string, taskId: string, modifications: string): void {
    const task = this.taskRepo.getById(taskId);
    if (!task) return;

    // Transition: awaiting-healer → retrying → running, then create a queued job.
    // The healer appends its modification note to the task description so the
    // next worker attempt has actionable context.
    this.taskRepo.updateStatus(taskId, 'retrying');

    const currentDesc = task.description ?? '';
    const stripped = currentDesc.replace(/\n\n--- Healer modification.*$/s, '');
    this.db.prepare('UPDATE task_graph_nodes SET description = ? WHERE id = ?')
      .run(stripped + `\n\n--- Healer modification ---\n${modifications}`, taskId);

    this.taskRepo.updateStatus(taskId, 'running');

    // Use the same model as the previous attempt; fall back to tier name if no history
    const parentJob = this.jobRepo.getByTask(taskId)[0];
    const model = parentJob?.model ?? task.assigned_tier;
    this.jobRepo.create({
      task_id: taskId,
      model,
      token_estimate: task.token_budget_estimate || 4096,
      delegating_supervisor_id: 'healer',
      parent_job_id: parentJob?.id ?? null,
    });

    this.reporter.resolve(incidentId, `Healer retry with modifications: ${modifications}`);
  }

  private executeDecompose(incidentId: string, taskId: string, subtasks: NewSubtaskSpec[]): void {
    const task = this.taskRepo.getById(taskId);
    if (!task) return;

    if (subtasks.length === 0) {
      this.taskRepo.updateStatus(taskId, 'needs-human');
      this.reporter.resolve(incidentId, 'Healer requested decomposition but produced no replacement subtasks');
      return;
    }

    const childLevel = this.childLevelFor(task.level);

    const replaceTask = this.db.transaction(() => {
      for (const spec of subtasks) {
        this.taskRepo.create({
          parent_id: taskId,
          objective_id: task.objective_id,
          level: childLevel,
          title: spec.title,
          description: spec.description,
          type: spec.type as 'code' | 'test' | 'review' | 'research' | 'design',
          assigned_tier: 'squire' as AgentTier,
          reviewer_tier: 'knight' as AgentTier,
          acceptance_criteria: spec.acceptance_criteria,
          context_refs: spec.context_refs,
        });
      }

      this.taskRepo.updateStatus(taskId, 'superseded');
    });

    replaceTask();

    this.reporter.resolve(incidentId, `Decomposed into ${subtasks.length} new subtasks`);
  }

  private childLevelFor(level: TaskLevel): TaskLevel {
    if (level === 'epic') return 'task';
    if (level === 'task') return 'subtask';
    return 'job';
  }

  private executeReassign(incidentId: string, taskId: string, targetTier: string, reason: string): void {
    const task = this.taskRepo.getById(taskId);
    if (!task) return;

    // Update tier and re-queue so the dispatcher picks it up with the right provider
    this.db.prepare(
      'UPDATE task_graph_nodes SET assigned_tier = ?, retry_count = 0, updated_at = ? WHERE id = ?'
    ).run(targetTier, new Date().toISOString(), taskId);

    this.taskRepo.updateStatus(taskId, 'retrying');
    this.taskRepo.updateStatus(taskId, 'running');

    const parentJob = this.jobRepo.getByTask(taskId)[0];
    this.jobRepo.create({
      task_id: taskId,
      model: parentJob?.model ?? targetTier,
      token_estimate: task.token_budget_estimate || 4096,
      delegating_supervisor_id: 'healer',
      parent_job_id: parentJob?.id ?? null,
    });

    this.reporter.resolve(incidentId, `Reassigned to ${targetTier}: ${reason}`);
  }

  private executeEscalate(incidentId: string, taskId: string, message: string): void {
    const task = this.taskRepo.getById(taskId);
    if (!task) return;

    this.taskRepo.updateStatus(taskId, 'needs-human');
    this.reporter.resolve(incidentId, `Escalated: ${message}`);
  }
}
