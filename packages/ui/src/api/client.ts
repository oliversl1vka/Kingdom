/**
 * Client-side API helpers for the KingdomOS UI.
 * All calls go to the Vite dev server (same origin) or the Fastify server.
 */

export interface KingdomConfig {
  project_name: string;
  providers: Record<string, ProviderConfig>;
  tiers: Record<string, TierConfig>;
  retention: { log_retention_days: number; heartbeat_retention_days: number };
  token_engine: { default_safety_margin_percent: number; max_concurrent_checks: number };
  mcp_servers?: Record<string, MCPServerConfig>;
}

export interface MCPServerConfig {
  transport: 'stdio' | 'sse';
  command?: string;
  args?: string[];
  url?: string;
  env?: Record<string, string>;
  enabled: boolean;
  allowed_methods?: string[];
}

export interface ProviderConfig {
  endpoint: string;
  api_key_name?: string;
  priority_order: number;
  enabled: boolean;
}

export interface TierConfig {
  model: string;
  max_retries: number;
  timeout_seconds: number;
}

export interface ModelInfo {
  id: string;
  name: string;
  owned_by?: string;
}

export async function fetchConfig(): Promise<KingdomConfig | null> {
  const r = await fetch('/api/config');
  if (!r.ok) throw new Error('Failed to fetch config');
  const data = await r.json();
  return data ?? null;
}

export async function saveConfig(config: KingdomConfig): Promise<void> {
  const r = await fetch('/api/config', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(config),
  });
  if (!r.ok) throw new Error('Failed to save config');
}

export async function setApiKey(provider: string, apiKey: string): Promise<void> {
  const r = await fetch('/api/credentials', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ provider, api_key: apiKey }),
  });
  if (!r.ok) throw new Error('Failed to set API key');
}

export async function fetchModels(provider: string): Promise<ModelInfo[]> {
  const r = await fetch(`/api/models/${encodeURIComponent(provider)}`);
  if (!r.ok) throw new Error(`Failed to fetch models for ${provider}`);
  const data = await r.json() as { models: ModelInfo[]; error?: string };
  if (data.error) throw new Error(data.error);
  return data.models;
}

export async function initKingdom(projectName: string): Promise<{ message: string }> {
  const r = await fetch('/api/init', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ project_name: projectName }),
  });
  if (!r.ok) throw new Error('Failed to init kingdom');
  return r.json();
}

export async function submitDecree(objective: string, priority?: number): Promise<{ objective_id: string }> {
  const r = await fetch('/api/decree', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ objective, priority: priority ?? 5 }),
  });
  if (!r.ok) throw new Error('Failed to submit decree');
  return r.json();
}

export async function summonKingdom(): Promise<{ message: string }> {
  const r = await fetch('/api/summon', { method: 'POST' });
  if (!r.ok) throw new Error('Failed to summon kingdom');
  return r.json();
}

export async function getStatus(): Promise<{
  initialized: boolean;
  running: boolean;
  activeJobs: number;
  queuedJobs: number;
  completedJobs: number;
  failedJobs: number;
}> {
  const r = await fetch('/api/status');
  if (!r.ok) throw new Error('Failed to get status');
  return r.json();
}
