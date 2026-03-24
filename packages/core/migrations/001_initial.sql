-- KingdomOS Initial Schema
-- Migration 001: Create all core tables

-- Schema version tracking
CREATE TABLE IF NOT EXISTS schema_version (
  version INTEGER NOT NULL,
  applied_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO schema_version (version) VALUES (1);

-- Projects (Kingdoms)
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  repository_path TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Objectives
CREATE TABLE IF NOT EXISTS objectives (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  description TEXT NOT NULL,
  priority INTEGER NOT NULL DEFAULT 5 CHECK (priority >= 1 AND priority <= 10),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'planning', 'active', 'completed', 'failed', 'cancelled')),
  assigned_king TEXT,
  acceptance_criteria TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Task Graph Nodes
CREATE TABLE IF NOT EXISTS task_graph_nodes (
  id TEXT PRIMARY KEY,
  parent_id TEXT REFERENCES task_graph_nodes(id),
  objective_id TEXT NOT NULL REFERENCES objectives(id),
  level TEXT NOT NULL CHECK (level IN ('epic', 'task', 'subtask', 'job')),
  title TEXT NOT NULL,
  description TEXT,
  priority INTEGER NOT NULL DEFAULT 5 CHECK (priority >= 1 AND priority <= 10),
  type TEXT NOT NULL DEFAULT 'code' CHECK (type IN ('code', 'test', 'review', 'research', 'design')),
  assigned_tier TEXT NOT NULL CHECK (assigned_tier IN ('king', 'nobility', 'knight', 'squire', 'healer', 'sentinel', 'scribe', 'judge', 'blacksmith')),
  reviewer_tier TEXT NOT NULL CHECK (reviewer_tier IN ('king', 'nobility', 'knight', 'squire', 'healer', 'sentinel', 'scribe', 'judge', 'blacksmith')),
  acceptance_criteria TEXT NOT NULL DEFAULT '[]',
  context_refs TEXT NOT NULL DEFAULT '[]',
  token_budget_estimate INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'queued',
  retry_count INTEGER NOT NULL DEFAULT 0,
  max_retries INTEGER NOT NULL DEFAULT 3,
  artifact_paths TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Jobs
CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES task_graph_nodes(id),
  worker_id TEXT,
  model TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  started_at TEXT,
  heartbeat_at TEXT,
  timeout_at TEXT,
  cancel_requested INTEGER NOT NULL DEFAULT 0,
  cancel_reason TEXT,
  result_path TEXT,
  failure_type TEXT CHECK (failure_type IS NULL OR failure_type IN ('token-overflow', 'timeout', 'runtime-crash', 'invalid-output', 'review-rejection')),
  token_estimate INTEGER NOT NULL,
  tokens_used INTEGER,
  delegating_supervisor_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Heartbeats
CREATE TABLE IF NOT EXISTS heartbeats (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id TEXT NOT NULL REFERENCES jobs(id),
  worker_id TEXT NOT NULL,
  timestamp TEXT NOT NULL DEFAULT (datetime('now')),
  status TEXT NOT NULL DEFAULT 'healthy' CHECK (status IN ('healthy', 'slow', 'finishing')),
  progress TEXT,
  tokens_generated INTEGER NOT NULL DEFAULT 0
);

-- Incident Reports
CREATE TABLE IF NOT EXISTS incidents (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES task_graph_nodes(id),
  job_id TEXT REFERENCES jobs(id),
  severity TEXT NOT NULL CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  failure_type TEXT NOT NULL,
  symptoms TEXT NOT NULL DEFAULT '{}',
  context_summary TEXT,
  failure_history TEXT NOT NULL DEFAULT '[]',
  probable_cause TEXT,
  healer_confidence REAL,
  healer_recommendation TEXT,
  action_taken TEXT,
  resolved_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Review Decisions
CREATE TABLE IF NOT EXISTS review_decisions (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES jobs(id),
  reviewer_agent_id TEXT NOT NULL,
  decision TEXT NOT NULL CHECK (decision IN ('approved', 'rejected')),
  rejection_reasons TEXT,
  scope_check TEXT NOT NULL CHECK (scope_check IN ('pass', 'fail')),
  format_check TEXT NOT NULL CHECK (format_check IN ('pass', 'fail')),
  security_check TEXT NOT NULL CHECK (security_check IN ('pass', 'fail')),
  criteria_check TEXT NOT NULL CHECK (criteria_check IN ('pass', 'fail')),
  feedback TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- File Locks
CREATE TABLE IF NOT EXISTS file_locks (
  file_path TEXT PRIMARY KEY,
  owning_job_id TEXT NOT NULL REFERENCES jobs(id),
  owning_supervisor_id TEXT NOT NULL,
  locked_at TEXT NOT NULL DEFAULT (datetime('now')),
  lock_type TEXT NOT NULL DEFAULT 'exclusive' CHECK (lock_type IN ('exclusive')),
  max_duration_seconds INTEGER NOT NULL DEFAULT 600
);

-- Model Configurations
CREATE TABLE IF NOT EXISTS model_configs (
  model_id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  display_name TEXT NOT NULL,
  context_window INTEGER NOT NULL,
  safe_input_budget INTEGER NOT NULL,
  output_reservation INTEGER NOT NULL,
  safety_margin_percent REAL NOT NULL DEFAULT 0.12,
  tokenizer_type TEXT NOT NULL CHECK (tokenizer_type IN ('tiktoken', 'huggingface', 'character-estimate')),
  tokenizer_config TEXT,
  tier_assignment TEXT
);

-- Provider Health
CREATE TABLE IF NOT EXISTS provider_health (
  provider_id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'unavailable' CHECK (status IN ('healthy', 'degraded', 'unavailable', 'rate-limited', 'cooldown')),
  last_error TEXT,
  last_error_at TEXT,
  cooldown_until TEXT,
  requests_today INTEGER NOT NULL DEFAULT 0,
  rate_limit_remaining INTEGER,
  priority_order INTEGER NOT NULL
);

-- Agent Configurations
CREATE TABLE IF NOT EXISTS agent_configs (
  agent_name TEXT PRIMARY KEY,
  tier TEXT NOT NULL CHECK (tier IN ('king', 'nobility', 'knight', 'squire', 'healer', 'sentinel', 'scribe', 'judge', 'blacksmith')),
  model_id TEXT NOT NULL REFERENCES model_configs(model_id),
  active INTEGER NOT NULL DEFAULT 1,
  config_json TEXT
);

-- Crypt Entries (permanent, never deleted)
CREATE TABLE IF NOT EXISTS crypt_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  success INTEGER NOT NULL,
  completed_at TEXT NOT NULL
);

-- Indexes per data-model.md
CREATE INDEX IF NOT EXISTS idx_task_graph_nodes_parent_id ON task_graph_nodes(parent_id);
CREATE INDEX IF NOT EXISTS idx_task_graph_nodes_status ON task_graph_nodes(status);
CREATE INDEX IF NOT EXISTS idx_task_graph_nodes_assigned_tier ON task_graph_nodes(assigned_tier);
CREATE INDEX IF NOT EXISTS idx_task_graph_nodes_objective_id ON task_graph_nodes(objective_id);
CREATE INDEX IF NOT EXISTS idx_jobs_task_id ON jobs(task_id);
CREATE INDEX IF NOT EXISTS idx_jobs_status_heartbeat ON jobs(status, heartbeat_at);
CREATE INDEX IF NOT EXISTS idx_jobs_delegating_supervisor ON jobs(delegating_supervisor_id);
CREATE INDEX IF NOT EXISTS idx_heartbeats_job_timestamp ON heartbeats(job_id, timestamp);
CREATE INDEX IF NOT EXISTS idx_incidents_task_id ON incidents(task_id);
CREATE INDEX IF NOT EXISTS idx_crypt_entries_completed_at ON crypt_entries(completed_at);
