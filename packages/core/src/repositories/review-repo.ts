import type { ReviewDecision, ReviewVerdict, ReviewCheckResult } from '../types.js';
import type Database from 'better-sqlite3';

export class ReviewRepository {
  constructor(private db: Database.Database) {}

  getById(id: string): ReviewDecision | null {
    const row = this.db.prepare('SELECT * FROM review_decisions WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    return row ? this.mapRow(row) : null;
  }

  getByJob(jobId: string): ReviewDecision[] {
    const rows = this.db
      .prepare('SELECT * FROM review_decisions WHERE job_id = ? ORDER BY created_at DESC')
      .all(jobId) as Record<string, unknown>[];
    return rows.map(this.mapRow);
  }

  getLatestByJob(jobId: string): ReviewDecision | null {
    const row = this.db
      .prepare('SELECT * FROM review_decisions WHERE job_id = ? ORDER BY created_at DESC LIMIT 1')
      .get(jobId) as Record<string, unknown> | undefined;
    return row ? this.mapRow(row) : null;
  }

  private mapRow(row: Record<string, unknown>): ReviewDecision {
    return {
      id: row.id as string,
      job_id: row.job_id as string,
      reviewer_agent_id: row.reviewer_agent_id as string,
      decision: row.decision as ReviewVerdict,
      rejection_reasons: row.rejection_reasons ? JSON.parse(row.rejection_reasons as string) : null,
      scope_check: row.scope_check as ReviewCheckResult,
      format_check: row.format_check as ReviewCheckResult,
      security_check: row.security_check as ReviewCheckResult,
      criteria_check: row.criteria_check as ReviewCheckResult,
      feedback: row.feedback as string | null,
      created_at: row.created_at as string,
    };
  }
}
