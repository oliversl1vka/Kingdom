import { Command } from 'commander';
import { theme } from '../theme.js';

export function registerStatusCommand(program: Command): void {
  program
    .command('status')
    .description('Display current system status')
    .option('--json', 'Machine-readable output')
    .option('--watch', 'Live-updating terminal display')
    .option('--jobs', 'Show only active jobs')
    .option('--agents', 'Show only agent statuses')
    .action(async (options: { json?: boolean; watch?: boolean; jobs?: boolean; agents?: boolean }) => {
      const { getDatabase } = await import('@kingdomos/core');
      const db = getDatabase();

      const jobStats = db
        .prepare(
          `SELECT
            COUNT(CASE WHEN status = 'running' THEN 1 END) as running,
            COUNT(CASE WHEN status = 'queued' THEN 1 END) as queued,
            COUNT(CASE WHEN status = 'completed' AND created_at >= date('now') THEN 1 END) as completed_today,
            COUNT(CASE WHEN status LIKE 'failed-%' AND created_at >= date('now') THEN 1 END) as failed_today
          FROM jobs`
        )
        .get() as { running: number; queued: number; completed_today: number; failed_today: number };

      const tokenStats = db
        .prepare(`SELECT COALESCE(SUM(tokens_used), 0) as consumed_today FROM jobs WHERE created_at >= date('now')`)
        .get() as { consumed_today: number };

      const result = {
        kingdom: { name: 'KingdomOS', uptime_seconds: 0 },
        sentinel: { pid: process.pid, status: 'idle' },
        workers: { active: jobStats.running, max: 4 },
        jobs: jobStats,
        token_budget: { estimated_remaining: 0, consumed_today: tokenStats.consumed_today },
      };

      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        theme.info('Kingdom Status Report');
        console.log(`  Jobs running:  ${jobStats.running}`);
        console.log(`  Jobs queued:   ${jobStats.queued}`);
        console.log(`  Completed:     ${jobStats.completed_today}`);
        console.log(`  Failed:        ${jobStats.failed_today}`);
        console.log(`  Tokens today:  ${tokenStats.consumed_today}`);
      }
    });
}
