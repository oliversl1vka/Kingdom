import type { IncidentSubmission, IncidentReport, Severity, FailureHistoryEntry } from '@kingdomos/core';
import type Database from 'better-sqlite3';
import { generateUlid } from '@kingdomos/core';

export class IncidentReporter {
  constructor(private db: Database.Database) {}

  createIncident(submission: IncidentSubmission): IncidentReport {
    const id = generateUlid();
    const now = new Date().toISOString();

    this.db
      .prepare(
        `INSERT INTO incidents (id, task_id, job_id, severity, failure_type, symptoms, context_summary, failure_history, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        submission.task_id,
        submission.job_id ?? null,
        submission.severity,
        submission.failure_type,
        JSON.stringify(submission.symptoms),
        submission.context_summary,
        JSON.stringify(submission.failure_history),
        now
      );

    return {
      id,
      task_id: submission.task_id,
      job_id: submission.job_id ?? null,
      severity: submission.severity,
      failure_type: submission.failure_type,
      symptoms: submission.symptoms,
      context_summary: submission.context_summary,
      failure_history: submission.failure_history,
      probable_cause: null,
      healer_confidence: null,
      healer_recommendation: null,
      action_taken: null,
      resolved_at: null,
      created_at: now,
    };
  }

  getUndiagnosed(): IncidentReport[] {
    const rows = this.db
      .prepare('SELECT * FROM incidents WHERE probable_cause IS NULL ORDER BY created_at')
      .all() as Record<string, unknown>[];
    return rows.map(this.mapRow);
  }

  updateDiagnosis(id: string, cause: string, confidence: number, recommendation: unknown): void {
    this.db
      .prepare('UPDATE incidents SET probable_cause = ?, healer_confidence = ?, healer_recommendation = ? WHERE id = ?')
      .run(cause, confidence, JSON.stringify(recommendation), id);
  }

  resolve(id: string, actionTaken: string): void {
    this.db
      .prepare('UPDATE incidents SET action_taken = ?, resolved_at = ? WHERE id = ?')
      .run(actionTaken, new Date().toISOString(), id);
  }

  private mapRow(row: Record<string, unknown>): IncidentReport {
    return {
      id: row.id as string,
      task_id: row.task_id as string,
      job_id: row.job_id as string | null,
      severity: row.severity as Severity,
      failure_type: row.failure_type as string,
      symptoms: JSON.parse(row.symptoms as string),
      context_summary: row.context_summary as string,
      failure_history: JSON.parse(row.failure_history as string),
      probable_cause: row.probable_cause as string | null,
      healer_confidence: row.healer_confidence as number | null,
      healer_recommendation: row.healer_recommendation ? JSON.parse(row.healer_recommendation as string) : null,
      action_taken: row.action_taken as string | null,
      resolved_at: row.resolved_at as string | null,
      created_at: row.created_at as string,
    };
  }
}
