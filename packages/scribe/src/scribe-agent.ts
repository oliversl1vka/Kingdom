import type Database from 'better-sqlite3';
import { LessonsRepository } from '@kingdomos/core';
import { CryptWriter } from './crypt-writer.js';
import { Logger, type EventType } from './logger.js';
import { writeFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface ScribeAgentConfig {
  db: Database.Database;
  projectPath: string;
  verbose?: boolean;
}

/**
 * The Scribe Agent — meaningful chronicler of the Kingdom.
 *
 * Responsibilities:
 * 1. Logs every pipeline event to the event_log (structured audit trail)
 * 2. Writes Crypt entries for every completed task (eternal archive)
 * 3. Maintains a CHANGELOG.md in the project directory
 * 4. Generates a run summary when an objective completes
 */
export class ScribeAgent {
  private crypt: CryptWriter;
  private logger: Logger;
  private projectPath: string;
  private verbose: boolean;
  private changelogEntries: string[] = [];
  private db: Database.Database; // PHASE4 (P4.1): for lesson outcome attribution

  constructor(config: ScribeAgentConfig) {
    this.db = config.db;
    this.crypt = new CryptWriter(config.db);
    this.logger = new Logger({ db: config.db, console: config.verbose });
    this.projectPath = config.projectPath;
    this.verbose = config.verbose ?? false;
  }

  /** Log a pipeline event (delegate to Logger). */
  logEvent(event: {
    type: string;
    agentId: string;
    jobId?: string;
    taskId?: string;
    details: Record<string, unknown>;
  }): void {
    this.logger.log({
      agent_id: event.agentId,
      event_type: event.type as EventType,
      job_id: event.jobId ?? null,
      task_id: event.taskId ?? null,
      details: event.details,
    });
  }

  /**
   * Record a task completion in the Crypt of Kings.
   * Called when a task reaches a terminal state (completed, completed-with-warnings).
   */
  recordTaskCompletion(taskId: string, title: string, success: boolean, details?: string): void {
    const summary = success
      ? `Task completed successfully.${details ? ' ' + details : ''}`
      : `Task completed with issues.${details ? ' ' + details : ''}`;

    this.crypt.writeFromTask(taskId, title, summary, success);

    // PHASE4 (P4.1): attribute this task's outcome back to any lessons injected
    // into its jobs (closed-loop outcome tracking + crypt success as positive
    // signal). Best-effort and additive — never blocks the crypt write.
    try {
      this.recordLessonOutcomesForTask(taskId, success);
    } catch {
      /* outcome tracking is best-effort */
    }

    if (this.verbose) {
      const icon = success ? '📜✅' : '📜⚠️';
      console.log(`[Scribe] ${icon} Crypt entry written for: ${title.slice(0, 60)}`);
    }
  }

  /**
   * PHASE4 (P4.1): for every job that ran for this task, record the resolved
   * outcome against the lessons that were injected into that job. A successful
   * task is the crypt's positive signal; a failed one is a negative signal.
   */
  private recordLessonOutcomesForTask(taskId: string, success: boolean): void {
    const repo = new LessonsRepository(this.db);
    const jobs = this.db
      .prepare('SELECT id FROM jobs WHERE task_id = ?')
      .all(taskId) as Array<{ id: string }>;
    for (const j of jobs) repo.recordOutcome(j.id, success);
  }

  /**
   * Track a file change for the changelog.
   * Called when Blacksmith applies a diff or creates a file.
   */
  trackFileChange(action: 'created' | 'modified', filePaths: string[], taskTitle: string): void {
    const timestamp = new Date().toISOString().slice(0, 19).replace('T', ' ');
    for (const fp of filePaths) {
      this.changelogEntries.push(`- [${timestamp}] ${action}: \`${fp}\` (${taskTitle})`);
    }
  }

  /**
   * Generate a run summary when an objective completes.
   * Writes CHANGELOG.md and RUN_SUMMARY.md to the project directory.
   */
  generateRunSummary(objectiveDescription: string, stats: RunStats): void {
    this.writeChangelog(objectiveDescription);
    this.writeRunSummary(objectiveDescription, stats);
  }

  recordObjectiveTerminal(objectiveId: string, objectiveDescription: string, finalStatus: 'completed' | 'completed-with-warnings' | 'failed' | 'cancelled'): void {
    const success = finalStatus === 'completed' || finalStatus === 'completed-with-warnings';
    const summary = finalStatus === 'completed'
      ? 'Objective reached completed state.'
      : `Objective reached terminal state: ${finalStatus}.`;
    this.crypt.writeFromTask(objectiveId, `Objective: ${objectiveDescription.slice(0, 120)}`, summary, success);
  }

  private writeChangelog(objectiveDescription: string): void {
    const changelogPath = join(this.projectPath, 'CHANGELOG.md');
    const date = new Date().toISOString().slice(0, 10);

    let existingContent = '';
    if (existsSync(changelogPath)) {
      existingContent = readFileSync(changelogPath, 'utf-8');
    }

    const newSection = `## [${date}] ${objectiveDescription.slice(0, 80)}

### Files Changed
${this.changelogEntries.length > 0 ? this.changelogEntries.join('\n') : '- No file changes recorded'}

---

`;

    const content = existingContent
      ? existingContent.replace(/^(# Changelog\n\n)/, `$1${newSection}`)
      : `# Changelog\n\n${newSection}`;

    writeFileSync(changelogPath, content, 'utf-8');

    if (this.verbose) {
      console.log(`[Scribe] 📜 CHANGELOG.md written with ${this.changelogEntries.length} entries`);
    }
  }

  private writeRunSummary(objectiveDescription: string, stats: RunStats): void {
    const summaryPath = join(this.projectPath, 'RUN_SUMMARY.md');
    const timestamp = new Date().toISOString();

    const content = `# KingdomOS Run Summary

**Generated**: ${timestamp}
**Objective**: ${objectiveDescription}

## Results

| Metric | Value |
|---|---|
| Total Tasks | ${stats.totalTasks} |
| Completed | ${stats.completed} |
| Completed w/ Warnings | ${stats.completedWithWarnings} |
| Awaiting Healer | ${stats.awaitingHealer} |
| Total Model Invocations | ${stats.totalInvocations} |
| Total Reviews | ${stats.totalReviews} |
| Approved on First Try | ${stats.approvedFirstTry} |
| Escalations | ${stats.escalations} |
| Files Created/Modified | ${stats.filesChanged} |
| Duration (minutes) | ${stats.durationMinutes.toFixed(1)} |

## Tier Breakdown

| Tier | Tasks | Completed |
|---|---|---|
| Squire | ${stats.tierBreakdown.squire.total} | ${stats.tierBreakdown.squire.completed} |
| Knight | ${stats.tierBreakdown.knight.total} | ${stats.tierBreakdown.knight.completed} |
| Nobility | ${stats.tierBreakdown.nobility.total} | ${stats.tierBreakdown.nobility.completed} |

## Crypt Entries

${stats.cryptEntryCount} tasks archived in the Crypt of Kings.
`;

    writeFileSync(summaryPath, content, 'utf-8');

    if (this.verbose) {
      console.log(`[Scribe] 📜 RUN_SUMMARY.md written to ${summaryPath}`);
    }
  }

  /**
   * Collect run statistics from the database for summary generation.
   */
  collectStats(db: Database.Database, objectiveId: string): RunStats {
    const tasks = db.prepare(
      `SELECT * FROM task_graph_nodes WHERE objective_id = ? AND level IN ('subtask', 'job')`
    ).all(objectiveId) as Array<Record<string, unknown>>;

    const totalTasks = tasks.length;
    const completed = tasks.filter(t => t.status === 'completed').length;
    const completedWithWarnings = tasks.filter(t => t.status === 'completed-with-warnings').length;
    const awaitingHealer = tasks.filter(t => t.status === 'awaiting-healer').length;

    const invocations = db.prepare(
      `SELECT COUNT(*) as cnt FROM event_log WHERE event_type = 'model_invocation' AND task_id IN (SELECT id FROM task_graph_nodes WHERE objective_id = ?)`
    ).get(objectiveId) as { cnt: number };

    const reviews = db.prepare(
      `SELECT COUNT(*) as cnt FROM review_decisions WHERE job_id IN (SELECT id FROM jobs WHERE task_id IN (SELECT id FROM task_graph_nodes WHERE objective_id = ?))`
    ).get(objectiveId) as { cnt: number };

    const escalations = db.prepare(
      `SELECT COUNT(*) as cnt FROM event_log WHERE event_type = 'task_transition' AND details LIKE '%escalate%' AND task_id IN (SELECT id FROM task_graph_nodes WHERE objective_id = ?)`
    ).get(objectiveId) as { cnt: number };

    const firstApproved = db.prepare(
      `SELECT COUNT(DISTINCT t.id) as cnt FROM task_graph_nodes t WHERE t.objective_id = ? AND t.status = 'completed' AND t.retry_count = 0`
    ).get(objectiveId) as { cnt: number };

    const cryptCount = db.prepare(
      `SELECT COUNT(*) as cnt FROM crypt_entries WHERE task_id IN (SELECT id FROM task_graph_nodes WHERE objective_id = ?)`
    ).get(objectiveId) as { cnt: number };

    // Timing
    const timing = db.prepare(
      `SELECT MIN(created_at) as start_time, MAX(updated_at) as end_time FROM task_graph_nodes WHERE objective_id = ?`
    ).get(objectiveId) as { start_time: string; end_time: string };

    const durationMs = timing.start_time && timing.end_time
      ? new Date(timing.end_time).getTime() - new Date(timing.start_time).getTime()
      : 0;

    // Tier breakdown
    const tierStats = (tier: string) => {
      const total = tasks.filter(t => t.assigned_tier === tier).length;
      const done = tasks.filter(t => t.assigned_tier === tier && (t.status === 'completed' || t.status === 'completed-with-warnings')).length;
      return { total, completed: done };
    };

    return {
      totalTasks,
      completed,
      completedWithWarnings,
      awaitingHealer,
      totalInvocations: invocations.cnt,
      totalReviews: reviews.cnt,
      approvedFirstTry: firstApproved.cnt,
      escalations: escalations.cnt,
      filesChanged: this.changelogEntries.length,
      durationMinutes: durationMs / 60000,
      cryptEntryCount: cryptCount.cnt,
      tierBreakdown: {
        squire: tierStats('squire'),
        knight: tierStats('knight'),
        nobility: tierStats('nobility'),
      },
    };
  }
}

export interface RunStats {
  totalTasks: number;
  completed: number;
  completedWithWarnings: number;
  awaitingHealer: number;
  totalInvocations: number;
  totalReviews: number;
  approvedFirstTry: number;
  escalations: number;
  filesChanged: number;
  durationMinutes: number;
  cryptEntryCount: number;
  tierBreakdown: {
    squire: { total: number; completed: number };
    knight: { total: number; completed: number };
    nobility: { total: number; completed: number };
  };
}
