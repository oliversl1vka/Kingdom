import { Command } from 'commander';
import { theme } from '../theme.js';

export function registerSentinelCommand(program: Command): void {
  const sentinel = program
    .command('sentinel')
    .description('Direct control of the Sentinel monitoring process');

  sentinel
    .command('status')
    .description('Show Sentinel health and poll metrics')
    .option('--json', 'Machine-readable output')
    .action(async (options: { json?: boolean }) => {
      const { getSentinelState } = await import('@kingdomos/sentinel');
      const state = getSentinelState();
      const uptime = state.startedAt
        ? Math.floor((Date.now() - new Date(state.startedAt).getTime()) / 1000)
        : 0;
      const result = {
        status: state.status,
        uptime_seconds: uptime,
        polls: state.polls,
        stale_detected: state.staleDetected,
        locks_released: state.locksReleased,
      };
      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        theme.info('Sentinel Status');
        console.log(`  Status:         ${result.status}`);
        console.log(`  Uptime:         ${result.uptime_seconds}s`);
        console.log(`  Polls:          ${result.polls}`);
        console.log(`  Stale detected: ${result.stale_detected}`);
        console.log(`  Locks released: ${result.locks_released}`);
      }
    });

  sentinel
    .command('restart')
    .description('Restart the Sentinel process')
    .action(async () => {
      const { getDatabase } = await import('@kingdomos/core');
      const { stopSentinel, startSentinel } = await import('@kingdomos/sentinel');
      stopSentinel();
      startSentinel(getDatabase());
      theme.success('Sentinel restarted.');
    });

  sentinel
    .command('logs')
    .description('Tail Sentinel log output')
    .option('--lines <n>', 'Number of log lines', '50')
    .action(async (_options: { lines: string }) => {
      theme.info('Sentinel logs (placeholder)');
    });
}
