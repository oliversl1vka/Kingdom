import { Command } from 'commander';
import { theme } from '../theme.js';

export interface ResumeObjectiveRow {
  id: string;
  description: string;
  status: string;
}

export function selectResumeObjectives(db: { prepare(sql: string): { all(...params: unknown[]): unknown[] } }, objectiveId?: string): ResumeObjectiveRow[] {
  const objectiveFilter = objectiveId ? 'AND id = ?' : '';
  const params = objectiveId ? [objectiveId] : [];
  return db
    .prepare(
      `SELECT id, description, status FROM objectives
       WHERE status IN ('active', 'failed', 'planning')
       ${objectiveFilter}
       ORDER BY priority DESC`
    )
    .all(...params) as ResumeObjectiveRow[];
}

export function registerResumeCommand(program: Command): void {
  program
    .command('resume')
    .description('Resume a run by re-queuing failed/stuck tasks while skipping checkpointed ones')
    .option('--objective <id>', 'Resume a specific objective (default: all active/failed objectives)')
    .option('--dry-run', 'Show what would be re-queued without making changes')
    .option('--json', 'Machine-readable output')
    .action(async (options: { objective?: string; dryRun?: boolean; json?: boolean }) => {
      const { getDatabase } = await import('@kingdomos/core');
      const db = getDatabase();

      // Find objectives to resume
      const objectives = selectResumeObjectives(db, options.objective);

      if (objectives.length === 0) {
        theme.info('No active or failed objectives to resume.');
        return;
      }

      // Collect tasks that already have checkpoints (successfully applied diffs).
      // Guard against pre-migration databases that may not have the run_checkpoints table yet.
      let checkpointedTaskIds = new Set<string>();
      try {
        checkpointedTaskIds = new Set<string>(
          (db
            .prepare('SELECT DISTINCT task_id FROM run_checkpoints')
            .all() as Array<{ task_id: string }>).map(r => r.task_id)
        );
      } catch {
        // Table not yet created — treat as empty (no checkpoints)
      }

      const results: Array<{
        objective_id: string;
        description: string;
        tasks_skipped: number;
        tasks_requeued: number;
        tasks_requeued_list: string[];
      }> = [];

      for (const obj of objectives) {
        // Find tasks that are stuck/failed and NOT checkpointed
        const failedTasks = db
          .prepare(
            `SELECT id, title, status, assigned_tier, retry_count, token_budget_estimate
             FROM task_graph_nodes
             WHERE objective_id = ?
             AND status IN (
               'awaiting-healer', 'failed-runtime-crash', 'failed-review',
               'failed-invalid-output', 'failed-token-overflow', 'stalled', 'retrying'
             )
             ORDER BY priority DESC`
          )
          .all(obj.id) as Array<{
            id: string; title: string; status: string;
            assigned_tier: string; retry_count: number; token_budget_estimate: number;
          }>;

        const tasksToRequeue = failedTasks.filter(t => !checkpointedTaskIds.has(t.id));
        const tasksSkipped = failedTasks.filter(t => checkpointedTaskIds.has(t.id));

        if (!options.dryRun) {
          for (const task of tasksToRequeue) {
            // Reset retry count and re-queue the task
            db.prepare(
              `UPDATE task_graph_nodes
               SET status = 'queued', retry_count = 0, updated_at = ?
               WHERE id = ?`
            ).run(new Date().toISOString(), task.id);

            // Cancel any dangling jobs for this task
            db.prepare(
              `UPDATE jobs SET status = 'cancelled'
               WHERE task_id = ? AND status IN ('queued', 'running', 'stalled', 'retrying')`
            ).run(task.id);
          }

          // Ensure the objective is back to active
          if (tasksToRequeue.length > 0) {
            db.prepare(`UPDATE objectives SET status = 'active', updated_at = ? WHERE id = ?`)
              .run(new Date().toISOString(), obj.id);
          }
        }

        results.push({
          objective_id: obj.id,
          description: obj.description,
          tasks_skipped: tasksSkipped.length,
          tasks_requeued: tasksToRequeue.length,
          tasks_requeued_list: tasksToRequeue.map(t => t.title),
        });
      }

      if (options.json) {
        console.log(JSON.stringify({ dry_run: !!options.dryRun, objectives: results }, null, 2));
        return;
      }

      const prefix = options.dryRun ? '[DRY RUN] ' : '';
      for (const r of results) {
        theme.info(`${prefix}Objective: ${r.description.slice(0, 80)}`);
        console.log(`  Skipped (checkpointed): ${r.tasks_skipped}`);
        console.log(`  Re-queued:              ${r.tasks_requeued}`);
        if (r.tasks_requeued_list.length > 0) {
          for (const title of r.tasks_requeued_list) {
            console.log(`    • ${title.slice(0, 70)}`);
          }
        }
      }

      if (!options.dryRun) {
        const totalRequeued = results.reduce((s, r) => s + r.tasks_requeued, 0);
        if (totalRequeued > 0) {
          theme.success(`Resumed ${totalRequeued} task(s). Run 'kingdom summon' to start processing.`);
        } else {
          theme.info('Nothing to resume — all failed tasks have checkpoints (already applied).');
        }
      }
    });
}
