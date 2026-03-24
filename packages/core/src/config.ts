import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { KingdomConfig } from './types.js';

const CONFIG_FILENAME = 'kingdom.config.json';

function defaultConfig(projectName: string): KingdomConfig {
  return {
    project_name: projectName,
    providers: {
      openai: {
        endpoint: 'https://api.openai.com',
        api_key_name: 'openai',
        priority_order: 1,
        enabled: true,
      },
    },
    tiers: {
      king: { model: 'gpt-4o-mini', max_retries: 3, timeout_seconds: 120 },
      nobility: { model: 'gpt-4o-mini', max_retries: 3, timeout_seconds: 90 },
      knight: { model: 'gpt-4o-mini', max_retries: 3, timeout_seconds: 120 },
      squire: { model: 'gpt-4o-mini', max_retries: 3, timeout_seconds: 60 },
    },
    retention: {
      log_retention_days: 7,
      heartbeat_retention_days: 3,
    },
    token_engine: {
      default_safety_margin_percent: 0.12,
      max_concurrent_checks: 10,
    },
  };
}

export function getConfigPath(basePath?: string): string {
  return join(basePath ?? process.cwd(), CONFIG_FILENAME);
}

export function configExists(basePath?: string): boolean {
  return existsSync(getConfigPath(basePath));
}

export function getConfig(basePath?: string): KingdomConfig {
  const configPath = getConfigPath(basePath);
  if (!existsSync(configPath)) {
    throw new Error(`No kingdom configuration found at ${configPath}. Run "kingdom init" first.`);
  }
  const raw = readFileSync(configPath, 'utf-8');
  return JSON.parse(raw) as KingdomConfig;
}

export function setConfig(config: KingdomConfig, basePath?: string): void {
  const configPath = getConfigPath(basePath);
  writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n', 'utf-8');
}

export function resetConfig(projectName: string, basePath?: string): KingdomConfig {
  const config = defaultConfig(projectName);
  setConfig(config, basePath);
  return config;
}

export function createDefaultConfig(projectName: string): KingdomConfig {
  return defaultConfig(projectName);
}
