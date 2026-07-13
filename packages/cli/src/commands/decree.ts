import { Command } from 'commander';
import { theme } from '../theme.js';

export function registerDecreeCommand(program: Command): void {
  program
    .command('decree')
    .description('Submit a new high-level objective for the King to decompose')
    .argument('<objective>', 'The objective to decree (max 2000 chars)')
    .option('--priority <n>', 'Priority (1-10)', '5')
    .option('--dry-run', 'Show plan without executing')
    .option('--criteria <file>', 'Path to acceptance criteria JSON')
    .action(async (objective: string, options: { priority: string; dryRun?: boolean; criteria?: string }) => {
      const priority = parseInt(options.priority, 10);
      if (priority < 1 || priority > 10) {
        theme.error('Priority must be between 1 and 10.');
        process.exit(1);
      }

      const { getDatabase, ProjectRepository, ObjectiveRepository } = await import('@kingdomos/core');
      const db = getDatabase();
      const projectRepo = new ProjectRepository(db);
      const objectiveRepo = new ObjectiveRepository(db);

      let acceptanceCriteria: string[] = [];

      if (options.criteria) {
        const { readFileSync } = await import('node:fs');
        const raw = readFileSync(options.criteria, 'utf-8');
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) acceptanceCriteria = parsed;
      }

      // Get first active project
      const projects = projectRepo.getActive();
      if (projects.length === 0) {
        theme.error('No active kingdom found. Run "kingdom init" first.');
        process.exit(1);
      }

      if (options.dryRun) {
        theme.info(`[Dry Run] Would create objective: "${objective}" with priority ${priority}`);
        console.log(JSON.stringify({ objective_id: 'DRY_RUN', task_count: 0, estimated_tokens: 0 }));
        return;
      }

      const obj = objectiveRepo.create({
        project_id: projects[0].id,
        description: objective,
        priority,
        acceptance_criteria: acceptanceCriteria,
      });

      theme.decree(objective);
      console.log(JSON.stringify({ objective_id: obj.id, task_count: 0, estimated_tokens: 0 }));
    });
}
