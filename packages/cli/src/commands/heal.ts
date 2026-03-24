import { Command } from 'commander';
import { theme } from '../theme.js';

export function registerHealCommand(program: Command): void {
  program
    .command('heal')
    .description('Manually trigger the Healer on a failed task')
    .argument('<task-id>', 'Task ID (ULID)')
    .option('--strategy <name>', 'Recovery strategy (retry|decompose|reassign)', 'auto')
    .action(async (taskId: string, options: { strategy: string }) => {
      const { getDatabase } = await import('@kingdomos/core');
      const db = getDatabase();

      const task = db.prepare('SELECT * FROM task_graph_nodes WHERE id = ?').get(taskId) as Record<string, unknown> | undefined;
      if (!task) {
        theme.error(`Task ${taskId} not found.`);
        process.exit(1);
      }

      const { IncidentReporter } = await import('@kingdomos/healer/src/incident-reporter.js');
      const reporter = new IncidentReporter(db);

      const incident = reporter.createIncident({
        task_id: taskId,
        severity: 'high',
        failure_type: String(task.status),
        symptoms: { manual_heal: true, strategy: options.strategy },
        context_summary: `Manual heal triggered for task: ${task.title}`,
        failure_history: [],
      });

      theme.info(`Healer activated for task ${taskId} with strategy: ${options.strategy}`);
      console.log(JSON.stringify({ incident_id: incident.id, action: options.strategy, new_tasks: [] }));
    });
}
