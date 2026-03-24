import { Command } from 'commander';
import { theme } from '../theme.js';

export function registerCancelCommand(program: Command): void {
  program
    .command('cancel')
    .description('Request cancellation of a task and its descendants')
    .argument('<task-id>', 'Task ID (ULID)')
    .option('--force', 'Attempt immediate kill of worker process')
    .option('--reason <text>', 'Cancellation reason')
    .action(async (taskId: string, options: { force?: boolean; reason?: string }) => {
      const { getDatabase } = await import('@kingdomos/core');
      const db = getDatabase();

      const task = db.prepare('SELECT * FROM task_graph_nodes WHERE id = ?').get(taskId);
      if (!task) {
        theme.error(`Task ${taskId} not found.`);
        process.exit(1);
      }

      // Count descendants using recursive CTE
      const descendants = db.prepare(
        `WITH RECURSIVE desc AS (
          SELECT id FROM task_graph_nodes WHERE parent_id = ?
          UNION ALL
          SELECT t.id FROM task_graph_nodes t JOIN desc d ON t.parent_id = d.id
        )
        SELECT COUNT(*) as count FROM desc`
      ).get(taskId) as { count: number };

      const { cascadeCancel } = await import('@kingdomos/core');
      const reason = options.reason ?? 'User requested cancellation';
      const result = cascadeCancel(db, taskId, reason);

      theme.success(`Cancellation requested for task ${taskId} and ${descendants.count} descendants.`);
      console.log(`  Tasks cancelled: ${result.cancelledTasks}`);
      console.log(`  Jobs cancelled:  ${result.cancelledJobs}`);
    });
}
