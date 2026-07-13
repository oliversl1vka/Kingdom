import { Command } from 'commander';
import { writeFileSync, unlinkSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { theme } from '../theme.js';

const PAUSE_FILE = join(process.cwd(), 'kingdom', '.dispatch-paused');

export function registerPauseCommand(program: Command): void {
  program
    .command('pause')
    .description('Pause job dispatch without stopping the Kingdom process')
    .action(() => {
      if (existsSync(PAUSE_FILE)) {
        theme.info('Dispatch is already paused.');
        return;
      }
      writeFileSync(PAUSE_FILE, new Date().toISOString(), 'utf-8');
      theme.success('Dispatch paused. Running jobs will complete; no new jobs will start.');
      theme.info('Run `kingdom unpause` to resume.');
    });

  program
    .command('unpause')
    .description('Resume job dispatch after a pause')
    .action(() => {
      if (!existsSync(PAUSE_FILE)) {
        theme.info('Dispatch is not currently paused.');
        return;
      }
      unlinkSync(PAUSE_FILE);
      theme.success('Dispatch resumed. The Kingdom will pick up queued jobs on its next poll cycle.');
    });
}
