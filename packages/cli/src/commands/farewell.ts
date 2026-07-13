import { Command } from 'commander';
import { theme } from '../theme.js';

export function registerFarewellCommand(program: Command): void {
  program
    .command('farewell')
    .description('Gracefully shut down all running agents and services')
    .option('--force', 'Kill workers without waiting for in-progress jobs')
    .option('--timeout <seconds>', 'Wait this long for graceful shutdown', '30')
    .action(async (options: { force?: boolean; timeout: string }) => {
      const { getDatabase, closeDatabase } = await import('@kingdomos/core');
      const { stopSentinel } = await import('@kingdomos/sentinel');
      const db = getDatabase();
      const timeoutMs = parseInt(options.timeout, 10) * 1000;

      theme.info('Sending farewell to all workers...');

      // Stop sentinel first
      stopSentinel(db);

      // Set cancel_requested on all active jobs
      const reason = options.force ? 'Forced shutdown' : 'Graceful shutdown';
      db.prepare(
        "UPDATE jobs SET cancel_requested = 1, cancel_reason = ? WHERE status IN ('queued', 'running', 'streaming', 'preparing-context', 'awaiting-budget-check')"
      ).run(reason);

      if (!options.force) {
        theme.info(`Waiting up to ${options.timeout}s for workers to finish...`);
        const start = Date.now();
        while (Date.now() - start < timeoutMs) {
          const active = db.prepare(
            "SELECT COUNT(*) as count FROM jobs WHERE status IN ('running', 'streaming')"
          ).get() as { count: number };
          if (active.count === 0) break;
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
      }

      // Force-cancel any remaining
      db.prepare(
        "UPDATE jobs SET status = 'cancelled' WHERE status IN ('queued', 'running', 'streaming', 'cancel-requested', 'preparing-context', 'awaiting-budget-check')"
      ).run();

      closeDatabase();
      theme.success('Kingdom rests. All agents dismissed.');
    });
}
