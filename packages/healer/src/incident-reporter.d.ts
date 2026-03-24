import type { IncidentSubmission, IncidentReport } from '@kingdomos/core';
import type Database from 'better-sqlite3';
export declare class IncidentReporter {
    private db;
    constructor(db: Database.Database);
    createIncident(submission: IncidentSubmission): IncidentReport;
    getUndiagnosed(): IncidentReport[];
    updateDiagnosis(id: string, cause: string, confidence: number, recommendation: unknown): void;
    resolve(id: string, actionTaken: string): void;
    private mapRow;
}
//# sourceMappingURL=incident-reporter.d.ts.map