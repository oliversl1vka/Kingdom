import { generateUlid } from '../../core/src/ulid.js';
export class IncidentReporter {
    db;
    constructor(db) {
        this.db = db;
    }
    createIncident(submission) {
        const id = generateUlid();
        const now = new Date().toISOString();
        this.db
            .prepare(`INSERT INTO incidents (id, task_id, job_id, severity, failure_type, symptoms, context_summary, failure_history, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
            .run(id, submission.task_id, submission.job_id ?? null, submission.severity, submission.failure_type, JSON.stringify(submission.symptoms), submission.context_summary, JSON.stringify(submission.failure_history), now);
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
    getUndiagnosed() {
        const rows = this.db
            .prepare('SELECT * FROM incidents WHERE probable_cause IS NULL ORDER BY created_at')
            .all();
        return rows.map(this.mapRow);
    }
    updateDiagnosis(id, cause, confidence, recommendation) {
        this.db
            .prepare('UPDATE incidents SET probable_cause = ?, healer_confidence = ?, healer_recommendation = ? WHERE id = ?')
            .run(cause, confidence, JSON.stringify(recommendation), id);
    }
    resolve(id, actionTaken) {
        this.db
            .prepare('UPDATE incidents SET action_taken = ?, resolved_at = ? WHERE id = ?')
            .run(actionTaken, new Date().toISOString(), id);
    }
    mapRow(row) {
        return {
            id: row.id,
            task_id: row.task_id,
            job_id: row.job_id,
            severity: row.severity,
            failure_type: row.failure_type,
            symptoms: JSON.parse(row.symptoms),
            context_summary: row.context_summary,
            failure_history: JSON.parse(row.failure_history),
            probable_cause: row.probable_cause,
            healer_confidence: row.healer_confidence,
            healer_recommendation: row.healer_recommendation ? JSON.parse(row.healer_recommendation) : null,
            action_taken: row.action_taken,
            resolved_at: row.resolved_at,
            created_at: row.created_at,
        };
    }
}
//# sourceMappingURL=incident-reporter.js.map