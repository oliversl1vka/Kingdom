import type Database from 'better-sqlite3';
import type { ReviewDecision } from '../types.js';
import { TaskRepository } from '../repositories/task-repo.js';
import { JobRepository } from '../repositories/job-repo.js';

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
      return { action: 'escalate', taskId: task.id };
    }

    // Retry: transition task through proper lifecycle (failed-review → retrying)
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
}
