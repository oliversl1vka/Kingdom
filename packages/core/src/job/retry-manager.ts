import type Database from 'better-sqlite3';
import type { Job, ReviewDecision, TaskGraphNode } from '../types.js';
import { TaskRepository } from '../repositories/task-repo.js';
import { JobRepository } from '../repositories/job-repo.js';
import { generateUlid } from '../ulid.js';

export class RetryManager {
  private taskRepo: TaskRepository;
  private jobRepo: JobRepository;

  constructor(private db: Database.Database) {
    this.taskRepo = new TaskRepository(db);
    this.jobRepo = new JobRepository(db);
  }

  handleRejection(review: ReviewDecision): { action: 'retry' | 'escalate'; taskId: string } {
    const job = this.jobRepo.getById(review.job_id);
    if (!job) throw new Error(`Job not found: ${review.job_id}`);

    const task = this.taskRepo.getById(job.task_id);
    if (!task) throw new Error(`Task not found: ${job.task_id}`);

    // Mark job as failed-review
    this.jobRepo.updateStatus(job.id, 'failed-review');

    // Transition task to failed-review first (running → failed-review is valid)
    this.taskRepo.updateStatus(task.id, 'failed-review');

    const newRetryCount = this.taskRepo.incrementRetry(task.id);

    if (newRetryCount >= task.max_retries) {
      // Exhausted retries → escalate to healer (failed-review → awaiting-healer)
      this.taskRepo.updateStatus(task.id, 'awaiting-healer');
      this.createReviewRejectionIncident(review, task, job, newRetryCount);
      return { action: 'escalate', taskId: task.id };
    }

    // Retry: transition task through proper lifecycle (failed-review → retrying)
    this.appendReviewFeedback(task, review);
    this.taskRepo.updateStatus(task.id, 'retrying');

    // Create a new queued job for the retry attempt
    this.jobRepo.create({
      task_id: task.id,
      model: job.model,
      token_estimate: job.token_estimate,
      delegating_supervisor_id: job.delegating_supervisor_id,
    });

    return { action: 'retry', taskId: task.id };
  }

  private appendReviewFeedback(task: TaskGraphNode, review: ReviewDecision): void {
    const reasons = review.rejection_reasons?.join('; ') || 'review rejected';
    const feedback = review.feedback ? `\n${review.feedback}` : '';
    const currentDescription = task.description ?? '';
    const stripped = currentDescription.replace(/\n\n--- Judge retry feedback ---[\s\S]*$/u, '');

    this.db.prepare('UPDATE task_graph_nodes SET description = ?, updated_at = ? WHERE id = ?').run(
      `${stripped}\n\n--- Judge retry feedback ---\n${reasons}${feedback}`,
      new Date().toISOString(),
      task.id,
    );
  }

  private createReviewRejectionIncident(
    review: ReviewDecision,
    task: TaskGraphNode,
    job: Job,
    retryCount: number,
  ): void {
    const reasons = review.rejection_reasons ?? [];
    const now = new Date().toISOString();

    this.db.prepare(
      `INSERT INTO incidents (
        id, task_id, job_id, severity, failure_type, symptoms, context_summary, failure_history, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      generateUlid(),
      task.id,
      job.id,
      'high',
      'review-rejection',
      JSON.stringify({
        retry_count: retryCount,
        max_retries: task.max_retries,
        rejection_reasons: reasons,
        feedback: review.feedback,
      }),
      `Task "${task.title}" exhausted review retries and was escalated to healer.`,
      JSON.stringify([{ attempt: retryCount, reason: reasons.join('; ') || review.feedback || 'review rejected', timestamp: now }]),
      now,
    );
  }
}
