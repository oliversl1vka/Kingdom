#!/usr/bin/env node

import { Command } from 'commander';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { registerInitCommand } from './commands/init.js';

import { registerDecreeCommand } from './commands/decree.js';
import { registerSummonCommand } from './commands/summon.js';
import { registerFarewellCommand } from './commands/farewell.js';
import { registerStatusCommand } from './commands/status.js';
import { registerTreasuryCommand } from './commands/treasury.js';
import { registerCryptCommand } from './commands/crypt.js';
import { registerHealCommand } from './commands/heal.js';
import { registerCancelCommand } from './commands/cancel.js';
import { registerInspectCommand } from './commands/inspect.js';
import { registerDryRunCommand } from './commands/dry-run.js';
import { registerConfigureCommand } from './commands/configure.js';
import { registerSentinelCommand } from './commands/sentinel.js';
import { registerDoctorCommand } from './commands/doctor.js';
import { registerResumeCommand } from './commands/resume.js';
import { registerPauseCommand } from './commands/pause.js';
import { registerStatsCommand } from './commands/stats.js';
import { registerLessonsCommand } from './commands/lessons.js';
import { registerContextCommand } from './commands/context.js';
import { registerDashboardCommand } from './commands/dashboard.js';
import { registerEvalCommand } from './commands/eval.js';

// Load .env from the current directory so credentials like OPENAI_API_KEY can
// live there, as the quickstart documents. Uses Node's native loader; already-set
// environment variables always take precedence, and a malformed .env is ignored.
if (typeof process.loadEnvFile === 'function' && existsSync('.env')) {
  try {
    process.loadEnvFile('.env');
  } catch {
    /* unreadable or malformed .env — fall back to the ambient environment */
  }
}

const program = new Command();

program
  .name('kingdom')
  .description('KingdomOS — Autonomous Hierarchical Agent Orchestration System')
  .version('0.1.0')
  .option('--no-color', 'Disable color output')
  .option('--config <path>', 'Override config file path');

program.hook('preAction', (thisCommand) => {
  const opts = thisCommand.optsWithGlobals() as { config?: string };
  if (opts.config) {
    process.env.KINGDOM_CONFIG_PATH = resolve(opts.config);
  }
});

registerInitCommand(program);

registerDecreeCommand(program);
registerSummonCommand(program);
registerFarewellCommand(program);
registerStatusCommand(program);
registerTreasuryCommand(program);
registerCryptCommand(program);
registerHealCommand(program);
registerCancelCommand(program);
registerInspectCommand(program);
registerDryRunCommand(program);
registerConfigureCommand(program);
registerSentinelCommand(program);
registerDoctorCommand(program);
registerResumeCommand(program);
registerPauseCommand(program);
registerStatsCommand(program);
registerLessonsCommand(program);
registerContextCommand(program);
registerDashboardCommand(program);
registerEvalCommand(program);

program.parseAsync(process.argv);
