#!/usr/bin/env node

import { Command } from 'commander';
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

const program = new Command();

program
  .name('kingdom')
  .description('KingdomOS — Autonomous Hierarchical Agent Orchestration System')
  .version('0.1.0')
  .option('--no-color', 'Disable color output')
  .option('--config <path>', 'Override config file path');

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

program.parseAsync(process.argv);
