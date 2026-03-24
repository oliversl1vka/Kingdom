// Status enums and lifecycle types

export type TaskStatus =
  | 'queued'
  | 'preparing-context'
  | 'awaiting-budget-check'
  | 'budget-rejected'
  | 'running'
  | 'streaming'
  | 'stalled'
  | 'cancel-requested'
  | 'cancelled'
  | 'completed'
  | 'completed-with-warnings'
  | 'failed-token-overflow'
  | 'failed-timeout'
  | 'failed-runtime-crash'
  | 'failed-invalid-output'
  | 'failed-review'
  | 'retrying'
  | 'awaiting-healer'
  | 'awaiting-redesign';

export type JobStatus = TaskStatus;

export type ObjectiveStatus = 'draft' | 'planning' | 'active' | 'completed' | 'failed' | 'cancelled';

export type Severity = 'low' | 'medium' | 'high' | 'critical';

export type FailureType =
  | 'token-overflow'
  | 'timeout'
  | 'runtime-crash'
  | 'invalid-output'
  | 'review-rejection';

export type TaskLevel = 'epic' | 'task' | 'subtask' | 'job';

export type TaskType = 'code' | 'test' | 'review' | 'research' | 'design';

export type AgentTier =
  | 'king'
  | 'nobility'
  | 'knight'
  | 'squire'
  | 'healer'
  | 'sentinel'
  | 'scribe'
  | 'judge'
  | 'blacksmith';

export type TokenizerType = 'tiktoken' | 'huggingface' | 'character-estimate';

export type ProviderStatus = 'healthy' | 'degraded' | 'unavailable' | 'rate-limited' | 'cooldown';

export type LockType = 'exclusive';

export type ReviewCheckResult = 'pass' | 'fail';

export type ReviewVerdict = 'approved' | 'rejected';

export type IncidentState = 'open' | 'diagnosing' | 'diagnosed' | 'resolved' | 'escalated';

export type HeartbeatStatus = 'healthy' | 'slow' | 'finishing';

export type FinishReason = 'stop' | 'length' | 'content_filter' | 'error';

export type OutputFormat = 'unified-diff' | 'markdown' | 'json' | 'free-text';

// Entity interfaces

export interface Project {
  id: string;
  name: string;
  description?: string;
  repository_path: string;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface Objective {
  id: string;
  project_id: string;
  description: string;
  priority: number;
  status: ObjectiveStatus;
  assigned_king?: string;
  acceptance_criteria: string[];
  created_at: string;
  updated_at: string;
}

export interface TaskGraphNode {
  id: string;
  parent_id: string | null;
  objective_id: string;
  level: TaskLevel;
  title: string;
  description?: string;
  priority: number;
  type: TaskType;
  assigned_tier: AgentTier;
  reviewer_tier: AgentTier;
  acceptance_criteria: string[];
  context_refs: ContextRef[];
  token_budget_estimate: number;
  status: TaskStatus;
  retry_count: number;
  max_retries: number;
  artifact_paths: string[];
  created_at: string;
  updated_at: string;
}

export interface ContextRef {
  file: string;
  startLine: number;
  endLine: number;
}

export interface Job {
  id: string;
  task_id: string;
  worker_id: string | null;
  model: string;
  status: JobStatus;
  started_at: string | null;
  heartbeat_at: string | null;
  timeout_at: string | null;
  cancel_requested: boolean;
  cancel_reason: string | null;
  result_path: string | null;
  failure_type: FailureType | null;
  token_estimate: number;
  tokens_used: number | null;
  delegating_supervisor_id: string;
  created_at: string;
}

export interface Heartbeat {
  id: number;
  job_id: string;
  worker_id: string;
  timestamp: string;
  status: HeartbeatStatus;
  progress: string | null;
  tokens_generated: number;
}

export interface IncidentReport {
  id: string;
  task_id: string;
  job_id: string | null;
  severity: Severity;
  failure_type: string;
  symptoms: Record<string, unknown>;
  context_summary: string;
  failure_history: FailureHistoryEntry[];
  probable_cause: string | null;
  healer_confidence: number | null;
  healer_recommendation: HealerRecommendation | null;
  action_taken: string | null;
  resolved_at: string | null;
  created_at: string;
}

export interface FailureHistoryEntry {
  attempt: number;
  reason: string;
  timestamp: string;
}

export type HealerRecommendation =
  | { action: 'retry'; modifications: string }
  | { action: 'decompose'; new_subtasks: NewSubtaskSpec[] }
  | { action: 'reassign'; target_tier: string; reason: string }
  | { action: 'escalate'; message: string };

export interface NewSubtaskSpec {
  title: string;
  description: string;
  type: string;
  acceptance_criteria: string[];
  context_refs: ContextRef[];
}

export interface ReviewDecision {
  id: string;
  job_id: string;
  reviewer_agent_id: string;
  decision: ReviewVerdict;
  rejection_reasons: string[] | null;
  scope_check: ReviewCheckResult;
  format_check: ReviewCheckResult;
  security_check: ReviewCheckResult;
  criteria_check: ReviewCheckResult;
  feedback: string | null;
  created_at: string;
}

export interface FileLock {
  file_path: string;
  owning_job_id: string;
  owning_supervisor_id: string;
  locked_at: string;
  lock_type: LockType;
  max_duration_seconds: number;
}

export interface ModelConfig {
  model_id: string;
  provider: string;
  display_name: string;
  context_window: number;
  safe_input_budget: number;
  output_reservation: number;
  safety_margin_percent: number;
  tokenizer_type: TokenizerType;
  tokenizer_config: Record<string, unknown> | null;
  tier_assignment: AgentTier | null;
}

export interface ProviderHealth {
  provider_id: string;
  display_name: string;
  endpoint: string;
  status: ProviderStatus;
  last_error: string | null;
  last_error_at: string | null;
  cooldown_until: string | null;
  requests_today: number;
  rate_limit_remaining: number | null;
  priority_order: number;
}

export interface AgentConfig {
  agent_name: string;
  tier: AgentTier;
  model_id: string;
  active: boolean;
  config_json: Record<string, unknown> | null;
}

export interface CryptEntry {
  id: number;
  task_id: string;
  title: string;
  summary: string;
  success: boolean;
  completed_at: string;
}

export interface AgentIdentity {
  tier: AgentTier;
  model_class: string;
  role: string;
  goals: string[];
  allowed_tools: string[];
  forbidden_behaviors: string[];
  output_format: string;
  escalation_rules: string[];
  delegation_rules?: string[];
  review_standards?: string[];
  token_limits: number;
}

export interface AgentMemoryFile {
  agent_name: string;
  file_path: string;
  content: string;
  last_modified: string;
}

// Token engine interfaces (from internal-interfaces.md §1)

export interface ContextSegment {
  label: string;
  content: string;
  required: boolean;
  priority: number;
}

export interface TokenBudgetCheckRequest {
  job_id: string;
  model_id: string;
  context_segments: ContextSegment[];
  output_reservation: number;
}

export interface TokenBudgetCheckResult {
  approved: boolean;
  total_tokens: number;
  budget_limit: number;
  headroom: number;
  segment_counts: { label: string; tokens: number; included: boolean }[];
  trimmed_segments?: string[];
  counting_strategy: 'exact' | 'estimate';
}

// Provider interfaces (from internal-interfaces.md §2)

export interface CompletionRequest {
  model: string;
  messages: Message[];
  max_tokens: number;
  temperature?: number;
  stop?: string[];
  system?: string;
}

export interface Message {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface CompletionResponse {
  content: string;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  finish_reason: FinishReason;
  metadata?: Record<string, unknown>;
}

export interface ProviderHealthStatus {
  status: 'healthy' | 'degraded' | 'unavailable' | 'rate-limited' | 'cooldown';
  latency_ms?: number;
  error?: string;
  last_error?: string;
}

export interface ProviderAdapter {
  readonly provider_id: string;
  complete(request: CompletionRequest): Promise<CompletionResponse>;
  healthCheck(): Promise<ProviderHealthStatus>;
}

// Job packet (from internal-interfaces.md §3)

export interface JobPacket {
  job_id: string;
  task_id: string;
  agent_identity_path: string;
  model_id: string;
  messages: Message[];
  allowed_files: string[];
  output_format: OutputFormat;
  acceptance_criteria: string[];
  max_tokens: number;
  timeout_seconds: number;
  result_path: string;
}

// Incident submission (from internal-interfaces.md §5)

export interface IncidentSubmission {
  task_id: string;
  job_id?: string;
  severity: Severity;
  failure_type: string;
  symptoms: Record<string, unknown>;
  context_summary: string;
  failure_history: FailureHistoryEntry[];
}

export interface HealerDiagnosis {
  incident_id: string;
  probable_cause: string;
  confidence: number;
  recommendation: HealerRecommendation;
}

// Credential encryption (from internal-interfaces.md §7)

export interface EncryptedCredential {
  iv: string;
  ciphertext: string;
  auth_tag: string;
  salt: string;
  iterations: number;
}

// Configuration schema

export interface KingdomConfig {
  project_name: string;
  workspace_path?: string;
  providers: Record<string, ProviderConfig>;
  tiers: Record<string, TierConfig>;
  retention: RetentionConfig;
  token_engine: TokenEngineConfig;
  mcp_servers?: Record<string, MCPServerConfig>;
}

export interface MCPServerConfig {
  /** Transport type: 'stdio' for local process, 'sse' for remote HTTP */
  transport: 'stdio' | 'sse';
  /** For stdio: the command to run (e.g. 'npx', 'node', 'python') */
  command?: string;
  /** For stdio: arguments passed to the command */
  args?: string[];
  /** For sse: the server URL */
  url?: string;
  /** Environment variables to pass to the process */
  env?: Record<string, string>;
  /** Whether this server is enabled */
  enabled: boolean;
  /** Allowed MCP methods (empty = allow all boundary-approved methods) */
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

export interface RetentionConfig {
  log_retention_days: number;
  heartbeat_retention_days: number;
}

export interface TokenEngineConfig {
  default_safety_margin_percent: number;
  max_concurrent_checks: number;
}
