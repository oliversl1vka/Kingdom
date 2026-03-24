import { Command } from 'commander';
import { cpus } from 'node:os';
import { theme } from '../theme.js';

export function registerSummonCommand(program: Command): void {
  program
    .command('summon')
    .description('Start the agent orchestration system')
    .option('--workers <n>', 'Max concurrent workers', String(cpus().length))
    .option('--no-ui', 'Headless mode, terminal output only')
    .option('--verbose', 'Verbose logging to stdout')
    .action(async (options: { workers: string; ui: boolean; verbose?: boolean }) => {
      const workerCount = parseInt(options.workers, 10);
      theme.banner();

      const { getDatabase, getConfig } = await import('@kingdomos/core');
      const { JobDispatcher } = await import('@kingdomos/core/src/job/dispatcher.js');
      const db = getDatabase();
      const config = getConfig();

      const dispatcher = new JobDispatcher(db, {
        maxConcurrentWorkers: workerCount,
        pollIntervalMs: 2000,
        assemblyOptions: {
          projectPath: process.cwd(),
          agentTemplatesDir: 'kingdom/agents',
          outputDir: 'kingdom/results',
        },
        defaultModel: config.tiers.knight?.model ?? 'gpt-4o-mini',
        supervisorId: 'sentinel',
      });

      dispatcher.start();

      theme.success(`Kingdom awakened. Sentinel watching. ${workerCount} workers standing by.`);

      // Handle graceful shutdown
      const shutdown = () => {
        theme.info('Farewell signal received. Dismissing workers...');
        dispatcher.stop();
        process.exit(0);
      };

      process.on('SIGINT', shutdown);
      process.on('SIGTERM', shutdown);
    });
}
