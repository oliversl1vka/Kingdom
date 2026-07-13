import type Database from 'better-sqlite3';

export type EventType =
  | 'model_invocation'
  | 'task_transition'
  | 'review_decision'
  | 'cancellation'
  | 'retry'
  | 'incident'
  | 'heartbeat'
  | 'lock_acquired'
  | 'lock_released'
  | 'crypt_entry';

export interface LogEntry {
  timestamp: string;
  agent_id: string | null;
  event_type: EventType;
  job_id: string | null;
  task_id: string | null;
  details: Record<string, unknown>;
}

export class Logger {
  private db: Database.Database | null = null;
  private consoleEnabled = true;

  constructor(options?: { db?: Database.Database; console?: boolean }) {
    this.db = options?.db ?? null;
    this.consoleEnabled = options?.console ?? true;
  }

  log(entry: Omit<LogEntry, 'timestamp'>): void {
    const fullEntry: LogEntry = {
      timestamp: new Date().toISOString(),
      ...entry,
    };

    if (this.consoleEnabled) {
      const prefix = `[${fullEntry.timestamp}] [${fullEntry.event_type}]`;
      const context = fullEntry.job_id ? ` job=${fullEntry.job_id}` : '';
      const task = fullEntry.task_id ? ` task=${fullEntry.task_id}` : '';
      console.log(`${prefix}${context}${task} ${JSON.stringify(fullEntry.details)}`);
    }

    if (this.db) {
      this.db
        .prepare(
          `INSERT INTO event_log (timestamp, agent_id, event_type, job_id, task_id, details)
           VALUES (?, ?, ?, ?, ?, ?)`
        )
        .run(
          fullEntry.timestamp,
          fullEntry.agent_id,
          fullEntry.event_type,
          fullEntry.job_id,
          fullEntry.task_id,
          JSON.stringify(fullEntry.details)
        );
    }
  }

  modelInvocation(jobId: string, agentId: string, details: Record<string, unknown>): void {
    this.log({ agent_id: agentId, event_type: 'model_invocation', job_id: jobId, task_id: null, details });
  }

  taskTransition(taskId: string, fromStatus: string, toStatus: string): void {
    this.log({ agent_id: null, event_type: 'task_transition', job_id: null, task_id: taskId, details: { from: fromStatus, to: toStatus } });
  }

  reviewDecision(jobId: string, taskId: string, verdict: string): void {
    this.log({ agent_id: null, event_type: 'review_decision', job_id: jobId, task_id: taskId, details: { verdict } });
  }

  cancellation(taskId: string, reason: string): void {
    this.log({ agent_id: null, event_type: 'cancellation', job_id: null, task_id: taskId, details: { reason } });
  }

  retry(jobId: string, taskId: string, attempt: number): void {
    this.log({ agent_id: null, event_type: 'retry', job_id: jobId, task_id: taskId, details: { attempt } });
  }

  incident(taskId: string, jobId: string, severity: string): void {
    this.log({ agent_id: null, event_type: 'incident', job_id: jobId, task_id: taskId, details: { severity } });
  }
}
