import { Command } from 'commander';
import { theme } from '../theme.js';

export function registerInspectCommand(program: Command): void {
  program
    .command('inspect')
    .description('Show detailed information about a task')
    .argument('<task-id>', 'Task ID (ULID)')
    .option('--json', 'Machine-readable output')
    .option('--full', 'Include heartbeat history and all review decisions')
    .action(async (taskId: string, options: { json?: boolean; full?: boolean }) => {
      const { getDatabase } = await import('@kingdomos/core');
      const db = getDatabase();

      const task = db.prepare('SELECT * FROM task_graph_nodes WHERE id = ?').get(taskId) as Record<string, unknown> | undefined;
      if (!task) {
        theme.error(`Task ${taskId} not found.`);
        process.exit(1);
      }

      const jobs = db.prepare('SELECT * FROM jobs WHERE task_id = ?').all(taskId);
      const reviews = db.prepare(
        'SELECT rd.* FROM review_decisions rd JOIN jobs j ON rd.job_id = j.id WHERE j.task_id = ?'
      ).all(taskId);

      const result: Record<string, unknown> = { task, jobs, reviews };

      if (options.full) {
        const heartbeats = db.prepare(
          'SELECT h.* FROM heartbeats h JOIN jobs j ON h.job_id = j.id WHERE j.task_id = ? ORDER BY h.timestamp DESC'
        ).all(taskId);
        result.heartbeats = heartbeats;
      }

      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        theme.info(`Task ${taskId} Inspection`);
        console.log(`  Title:    ${task.title}`);
        console.log(`  Level:    ${task.level}`);
        console.log(`  Status:   ${task.status}`);
        console.log(`  Tier:     ${task.assigned_tier}`);
        console.log(`  Retries:  ${task.retry_count}/${task.max_retries}`);
        console.log(`  Jobs:     ${(jobs as unknown[]).length}`);
        console.log(`  Reviews:  ${(reviews as unknown[]).length}`);
      }
    });
}
