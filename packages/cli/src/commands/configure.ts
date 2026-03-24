import { Command } from 'commander';
import { theme } from '../theme.js';

export function registerConfigureCommand(program: Command): void {
  program
    .command('configure')
    .description('View or update KingdomOS configuration')
    .argument('[key]', 'Config key (dot-notation)')
    .argument('[value]', 'New value')
    .option('--list', 'Show all current config values')
    .option('--reset <key>', 'Reset to default')
    .option('--json', 'Machine-readable output')
    .option('--set-key <provider>', 'Set API key for a provider (will prompt)')
    .action(async (key: string | undefined, value: string | undefined, options: { list?: boolean; reset?: string; json?: boolean; setKey?: string }) => {
      const { getConfig, setConfig } = await import('@kingdomos/core');

      const config = getConfig();

      if (options.list || (!key && !value)) {
        if (options.json) {
          console.log(JSON.stringify(config, null, 2));
        } else {
          theme.info('Kingdom Configuration');
          console.log(JSON.stringify(config, null, 2));
        }
        return;
      }

      if (key && value) {
        // Set nested config value using dot notation
        const keys = key.split('.');
        let obj: Record<string, unknown> = config as unknown as Record<string, unknown>;
        for (let i = 0; i < keys.length - 1; i++) {
          if (!(keys[i] in obj) || typeof obj[keys[i]] !== 'object') {
            obj[keys[i]] = {};
          }
          obj = obj[keys[i]] as Record<string, unknown>;
        }
        obj[keys[keys.length - 1]] = value;
        setConfig(config);
        theme.success(`Configuration updated: ${key} = ${value}`);
      } else if (key) {
        // Get config value
        const keys = key.split('.');
        let obj: unknown = config;
        for (const k of keys) {
          if (obj && typeof obj === 'object' && k in obj) {
            obj = (obj as Record<string, unknown>)[k];
          } else {
            theme.error(`Configuration key "${key}" not found.`);
            process.exit(1);
          }
        }
        console.log(options.json ? JSON.stringify(obj) : String(obj));
      }
    });
}
