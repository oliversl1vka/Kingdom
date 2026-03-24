import { Command } from 'commander';
import { theme } from '../theme.js';

export function registerDryRunCommand(program: Command): void {
  program
    .command('dry-run')
    .description('Simulate objective decomposition without executing')
    .argument('<objective>', 'The objective to simulate')
    .option('--depth <n>', 'Decomposition depth (1-3)', '1')
    .option('--json', 'Machine-readable output')
    .action(async (objective: string, options: { depth?: string; json?: boolean }) => {
      const { getDatabase, TaskRepository } = await import('@kingdomos/core');
      const db = getDatabase();

      const taskRepo = new TaskRepository(db);

      // Count existing tasks related to sample decomposition
      const depth = parseInt(options.depth ?? '1', 10);

      theme.info(`[Dry Run] Simulating decomposition of: "${objective}"`);
      theme.info(`  Depth: ${depth} level(s)`);
      theme.info('  Note: Full simulation requires an active LLM provider.');

      // Estimate based on typical decomposition ratios
      const tasksPerLevel = [1, 5, 15, 45]; // epic → task → subtask → job
      const estimatedTasks = tasksPerLevel.slice(0, depth + 1).reduce((a, b) => a + b, 0);
      const estimatedTokens = estimatedTasks * 4000;

      const result = {
        objective,
        simulated: true,
        depth,
        estimated_tasks: estimatedTasks,
        estimated_tokens: estimatedTokens,
        task_breakdown: {
          epics: depth >= 0 ? tasksPerLevel[0] : 0,
          tasks: depth >= 1 ? tasksPerLevel[1] : 0,
          subtasks: depth >= 2 ? tasksPerLevel[2] : 0,
          jobs: depth >= 3 ? tasksPerLevel[3] : 0,
        },
      };

      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        console.log(`  Estimated epics:    ${result.task_breakdown.epics}`);
        console.log(`  Estimated tasks:    ${result.task_breakdown.tasks}`);
        console.log(`  Estimated subtasks: ${result.task_breakdown.subtasks}`);
        console.log(`  Estimated jobs:     ${result.task_breakdown.jobs}`);
        console.log(`  Total tasks:        ${result.estimated_tasks}`);
        console.log(`  Estimated tokens:   ${result.estimated_tokens}`);
      }
    });
}
