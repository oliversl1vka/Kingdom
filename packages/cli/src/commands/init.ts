import { Command } from 'commander';
import { mkdirSync, existsSync, copyFileSync, readdirSync } from 'node:fs';
import { join, basename } from 'node:path';
import { configExists, createDefaultConfig, setConfig } from '@kingdomos/core';
import { getDatabaseForPath } from '@kingdomos/core';
import { theme } from '../theme.js';

export function registerInitCommand(program: Command): void {
  program
    .command('init')
    .alias('setup')
    .description('Initialize a new KingdomOS project in the current directory')
    .argument('[project-name]', 'Name for the kingdom (defaults to directory name)')
    .option('--force', 'Overwrite existing configuration')
    .action(async (projectName: string | undefined, options: { force?: boolean }) => {
      const basePath = process.cwd();
      const name = projectName ?? basename(basePath);

      if (configExists(basePath) && !options.force) {
        theme.error(
          `A kingdom already exists at ${basePath}. Use --force to overthrow the existing configuration.`
        );
        process.exit(1);
      }

      // Create kingdom directory structure
      const kingdomDir = join(basePath, 'kingdom');
      const dirs = [
        kingdomDir,
        join(kingdomDir, 'agents'),
        join(kingdomDir, 'memory'),
        join(kingdomDir, 'memory', 'shared'),
      ];

      for (const dir of dirs) {
        mkdirSync(dir, { recursive: true });
      }

      // Create configuration
      const config = createDefaultConfig(name);
      setConfig(config, basePath);

      // Initialize database
      const dbPath = join(kingdomDir, 'kingdom.db');
      const db = getDatabaseForPath(dbPath);
      db.close();

      // Copy agent identity templates if available
      try {
        const templatesDir = join(basePath, 'packages', 'agents', 'templates');
        if (existsSync(templatesDir)) {
          const templates = readdirSync(templatesDir).filter((f) => f.endsWith('.md'));
          for (const template of templates) {
            copyFileSync(
              join(templatesDir, template),
              join(kingdomDir, 'agents', template)
            );
          }
        }
      } catch {
        // Templates not available yet, skip silently
      }

      theme.success(`Kingdom '${name}' established at ${basePath}`);
    });
}
