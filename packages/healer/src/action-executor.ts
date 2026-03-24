import type { HealerRecommendation, NewSubtaskSpec, AgentTier, TaskLevel } from '@kingdomos/core';
import { TaskRepository } from '@kingdomos/core';
import { IncidentReporter } from './incident-reporter.js';
import type Database from 'better-sqlite3';

export class ActionExecutor {
  private taskRepo: TaskRepository;
  private reporter: IncidentReporter;

  constructor(private db: Database.Database) {
    this.taskRepo = new TaskRepository(db);
    this.reporter = new IncidentReporter(db);
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
      case 'escalate':
        this.executeEscalate(incidentId, taskId, recommendation.message);
        break;
    }
  }

  private executeRetry(incidentId: string, taskId: string, modifications: string): void {
    const task = this.taskRepo.getById(taskId);
    if (!task) return;

    // Move task back to retrying
    this.taskRepo.updateStatus(taskId, 'retrying');
    this.reporter.resolve(incidentId, `Retry with modifications: ${modifications}`);
  }

  private executeDecompose(incidentId: string, taskId: string, subtasks: NewSubtaskSpec[]): void {
    const task = this.taskRepo.getById(taskId);
    if (!task) return;

    // Mark original task as awaiting-redesign
    this.taskRepo.updateStatus(taskId, 'awaiting-redesign');

    // Create new subtasks
    for (const spec of subtasks) {
      this.taskRepo.create({
        parent_id: taskId,
        objective_id: task.objective_id,
        level: 'subtask' as TaskLevel,
        title: spec.title,
        description: spec.description,
        type: spec.type as 'code' | 'test' | 'review' | 'research' | 'design',
        assigned_tier: 'squire' as AgentTier,
        reviewer_tier: 'knight' as AgentTier,
        acceptance_criteria: spec.acceptance_criteria,
        context_refs: spec.context_refs,
      });
    }

    this.reporter.resolve(incidentId, `Decomposed into ${subtasks.length} new subtasks`);
  }

  private executeReassign(incidentId: string, taskId: string, targetTier: string, reason: string): void {
    // Reassignment would update the task's assigned_tier
    // For now, we record the action
    this.reporter.resolve(incidentId, `Reassigned to ${targetTier}: ${reason}`);
  }

  private executeEscalate(incidentId: string, taskId: string, message: string): void {
    this.reporter.resolve(incidentId, `Escalated: ${message}`);
  }
}
