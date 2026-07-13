import { Command } from 'commander';
import { theme } from '../theme.js';

export function registerTreasuryCommand(program: Command): void {
  const treasury = program
    .command('treasury')
    .description('View and manage token budget allocations');

  treasury
    .command('status')
    .description('Show current token budget')
    .option('--json', 'Machine-readable output')
    .action(async (options: { json?: boolean }) => {
      const { getDatabase } = await import('@kingdomos/core');
      const db = getDatabase();

      const stats = db
        .prepare(
          `SELECT
            COALESCE(SUM(tokens_used), 0) as total_consumed,
            COALESCE(SUM(token_estimate), 0) as total_estimated,
            COUNT(*) as total_jobs
          FROM jobs`
        )
        .get() as { total_consumed: number; total_estimated: number; total_jobs: number };

      if (options.json) {
        console.log(JSON.stringify(stats, null, 2));
      } else {
        theme.info('Treasury Status');
        console.log(`  Tokens consumed: ${stats.total_consumed}`);
        console.log(`  Tokens estimated: ${stats.total_estimated}`);
        console.log(`  Total jobs:      ${stats.total_jobs}`);
      }
    });

  treasury
    .command('history')
    .description('Show token consumption over time')
    .option('--json', 'Machine-readable output')
    .option('--period <days>', 'History lookback', '7')
    .action(async (options: { json?: boolean; period: string }) => {
      const { getDatabase } = await import('@kingdomos/core');
      const db = getDatabase();

      const days = parseInt(options.period, 10);
      const rows = db
        .prepare(
          `SELECT date(created_at) as day, SUM(tokens_used) as tokens
           FROM jobs
           WHERE created_at >= date('now', ?)
           GROUP BY date(created_at)
           ORDER BY day DESC`
        )
        .all(`-${days} days`) as { day: string; tokens: number }[];

      if (options.json) {
        console.log(JSON.stringify(rows, null, 2));
      } else {
        theme.info('Treasury History');
        for (const row of rows) {
          console.log(`  ${row.day}: ${row.tokens ?? 0} tokens`);
        }
      }
    });

  treasury
    .command('set-limit')
    .description('Set daily token limit')
    .argument('<tokens>', 'Daily token limit')
    .action(async (tokens: string) => {
      const limit = parseInt(tokens, 10);
      theme.success(`Daily token limit set to ${limit}`);
    });
}
