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
  | 'awaiting-redesign'
  | 'superseded'
  | 'needs-human';

export type JobStatus = TaskStatus;

export type ObjectiveStatus = 'draft' | 'planning' | 'active' | 'completed' | 'completed-with-warnings' | 'failed' | 'cancelled';
export type ObjectiveTerminalStatus = Exclude<ObjectiveStatus, 'draft' | 'planning' | 'active'>;

export interface ObjectiveCompletionSummary {
  total: number;
  succeeded: number;
  warnings: number;
  cancelled: number;
  failed: number;
  superseded: number;
}

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

export type FinishReason = 'stop' | 'length' | 'content_filter' | 'error' | 'tool_calls';

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
  /** Task IDs that must be in a terminal state before this task can be dispatched. */
  depends_on: string[];
  /**
   * PHASE3 (P3.2): optional per-task verification contract. When present the
   * dispatcher runs `test_command` (and optional `probe`) as an execution gate
   * after the diff is applied — a non-zero exit rolls the change back. Absent
   * ⇒ no per-task gate (global validationCommand/probes still apply).
   */
  verification?: TaskVerification | null;
  token_budget_estimate: number;
  status: TaskStatus;
  retry_count: number;
  max_retries: number;
  artifact_paths: string[];
  created_at: string;
  updated_at: string;
}

/**
 * PHASE3 (P3.2): a task-scoped, execution-based verification contract.
 * `test_command` is the authoritative gate — approval requires it to exit zero,
 * not merely an LLM opinion. `probe` is an optional secondary runtime assertion.
 * Both run with `cwd = workspace`, never the Kingdom repo, under a hard timeout.
 */
export interface TaskVerification {
  /** Shell command whose exit code is the gate (0 = pass). */
  test_command: string;
  /** Optional secondary runtime probe (also gated on exit 0). */
  probe?: string;
  /** Hard timeout for each command in seconds (default 60). */
  timeout_seconds?: number;
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
  /** ID of the job this job was retried/escalated from. Null for first attempts. */
  parent_job_id: string | null;
  /** ID of the job that superseded this one (i.e. the retry that replaced it). Null for active/terminal jobs. */
  superseded_by: string | null;
  /** Phase 1 (P1.3): OS PID of the worker process holding this job's lease. Null when not leased. */
  lease_owner_pid?: number | null;
  /** Phase 1 (P1.3): ISO time the lease expires; renewed by the heartbeat. Null when not leased. */
  lease_expires_at?: string | null;
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
  | { action: 'escalate'; message: string }
  // PHASE3 (P3.3): an execution-grounded healer can propose a concrete unified
  // diff that fixes the failure. The ActionExecutor applies it through the
  // blacksmith + the SAME validation/probe gate and only resolves the incident
  // when the gate is green (verify-before-resolve); otherwise it escalates.
  | { action: 'repair'; diff: string; rationale: string };

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
  /** Phase 1 (P1.3): monotonic fencing token; a late write from a zombie holder
   *  carrying an older token than the current lock's is rejected. */
  fencing_token?: number;
}

/**
 * A distilled, durable cross-run lesson. See migration 010_lessons.sql for the
 * underlying table. Lessons are produced by the rule-based distiller in
 * @kingdomos/scribe and consumed by the packet assembler / healer.
 */
export interface Lesson {
  id: string;
  tier: string;
  rule_id: string;
  signature: string;
  title: string;
  body: string;
  matches_failure_type: string | null;
  times_seen: number;
  first_seen_at: string;
  last_seen_at: string;
  source_task_id: string | null;
  source_run_id: string | null;
  source_incident_ids: string[];
  active: boolean;
  created_at: string;
  // PHASE4 (P4.1): outcome tracking + decay. All optional/defaulted so pre-030
  // rows and existing readers are unaffected.
  /** Running win-rate in [0,1]; null until outcomes accrue. */
  confidence?: number | null;
  /** Job ids this lesson was injected into (awaiting outcome attribution). */
  injected_job_ids?: string[];
  /** Resolved injected jobs that succeeded. */
  outcome_success?: number;
  /** Resolved injected jobs total. */
  outcome_total?: number;
  /** ISO timestamp set when the lesson decayed out (active flipped to 0). */
  decayed_at?: string | null;
  /** 'rule' (hardcoded R1–R5) or 'generated' (LLM-discovered). */
  origin?: 'rule' | 'generated';
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
  /** Capability flags used by the model selector. Null/absent = unknown — treated as "unverified". */
  capabilities?: ModelCapabilities | null;
  /** Friendly aliases like "best-reasoning", "cheap-coder". Used for quick lookup. */
  aliases?: string[];
}

/**
 * Kinds of work a model can be picked for. Keeps model selection decoupled from
 * agent-tier identity (a Knight might use the "implementation" profile today and
 * "review" tomorrow without the orchestration code caring).
 */
export type TaskKind =
  | 'decomposition'
  | 'implementation'
  | 'review'
  | 'healing'
  | 'summarization'
  | 'orchestration';

export type TierClass = 'premium' | 'balanced' | 'cheap';
export type LatencyClass = 'fast' | 'balanced' | 'thorough';

export interface ModelCapabilities {
  /** Task kinds this model is known to perform well. */
  strengths: TaskKind[];
  tool_use: boolean;
  structured_output: boolean;
  multimodal: boolean;
  streaming: boolean;
  tier_class: TierClass;
  latency_class: LatencyClass;
  /** ISO timestamp of the last time we verified these capabilities in our own eval. */
  verified_at?: string;
}

/**
 * Capability-based request. Instead of naming a model, callers describe what
 * they need and `resolveModel()` picks the best match from the registry.
 */
export interface CapabilityProfile {
  task_kind: TaskKind;
  /** Minimum input context required (tokens). Filters out models with too small a window. */
  min_context_tokens?: number;
  needs_tool_use?: boolean;
  needs_structured_output?: boolean;
  needs_multimodal?: boolean;
  latency_preference?: LatencyClass;
  cost_preference?: TierClass;
  /** Prefer local providers (LM Studio) over cloud APIs. */
  prefer_local?: boolean;
}

/**
 * A closure returning a `model_id` string. Components like `ReviewEngine`,
 * `TaskDecomposer`, `Diagnostician`, and `HealerWorker` accept these so
 * capability-based selection can be wired in without those components
 * needing to import `@kingdomos/token-engine` (which would cycle).
 *
 * Implementations should be side-effect free. They are called lazily, once
 * per LLM invocation, so a fresh resolver call always reflects the current
 * state of the model registry.
 */
export type ModelResolver = () => string;

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
  warnings?: string[];
}

// Provider interfaces (from internal-interfaces.md §2)

/**
 * Permissive JSON Schema alias. We do not validate the schema ourselves —
 * it is forwarded verbatim to the provider (OpenAI `json_schema`, Anthropic
 * tool `input_schema`, Gemini `responseSchema`, llama.cpp `json_schema`).
 */
export type JSONSchema = Record<string, unknown>;

/**
 * A callable tool exposed to the model. `parameters` is a JSON Schema object
 * describing the tool's arguments. Maps to OpenAI `function`, Anthropic
 * `tool`, Gemini `functionDeclaration`.
 */
export interface ToolDefinition {
  name: string;
  description: string;
  parameters: JSONSchema;
}

/**
 * A single tool invocation requested by the model. `arguments` is the parsed
 * JSON object (adapters JSON-parse the raw string before populating this).
 */
export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

/**
 * Controls whether / which tool the model may call.
 *   - 'auto'     — model decides (provider default)
 *   - 'none'     — disable tool calling for this turn
 *   - 'required' — model MUST call some tool
 *   - {name}     — force a specific tool
 */
export type ToolChoice = 'auto' | 'none' | 'required' | { name: string };

/**
 * Request a structured (JSON-schema-constrained) response. The model output is
 * guaranteed to conform to `schema`. On providers without native json_schema
 * response_format (Anthropic) the adapter synthesizes a single forced tool
 * whose input schema IS `schema` and surfaces the result as `content`.
 */
export interface ResponseFormat {
  type: 'json_schema';
  schema: JSONSchema;
  name?: string;
  strict?: boolean;
}

export interface CompletionRequest {
  model: string;
  messages: Message[];
  max_tokens: number;
  temperature?: number;
  stop?: string[];
  system?: string;
  signal?: AbortSignal;
  timeout_ms?: number;
  /** Native tool definitions. Absent ⇒ today's prose-only path (unchanged). */
  tools?: ToolDefinition[];
  /** Tool-selection policy. Only meaningful when `tools` is set. */
  tool_choice?: ToolChoice;
  /** Request a schema-constrained JSON response. */
  response_format?: ResponseFormat;
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
  /** Populated when the model requested one or more tool calls. */
  tool_calls?: ToolCall[];
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
  scope_mode: 'planned-files' | 'greenfield' | 'missing-planned-files';
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



// Configuration schema

export interface KingdomConfig {
  project_name: string;
  workspace_path?: string;
  providers: Record<string, ProviderConfig>;
  tiers: Record<string, TierConfig>;
  retention: RetentionConfig;
  token_engine: TokenEngineConfig;
  mcp_servers?: Record<string, MCPServerConfig>;
  /** Technology stack constraints — enforced across decomposition and code generation. */
  tech_stack?: TechStack;
  /** Sentinel heartbeat monitoring configuration. */
  sentinel?: SentinelConfig;
  /** Telegram bot configuration for remote control. */
  telegram?: TelegramConfig;
  /** Memory-palace / lesson-injection configuration. */
  memory?: MemoryConfig;
  // PHASE5: agentic dispatch via isolated worktrees.
  /** Agentic-dispatch (worktree) configuration. Absent ⇒ disabled (legacy one-shot). */
  agentic_dispatch?: AgenticDispatchConfig;
}

/**
 * PHASE5 (§9): controls agentic dispatch — running tool-capable coding jobs as a
 * read→edit→run→self-correct loop inside an isolated git worktree, merged onto
 * the integration branch only after review + compile + tests pass.
 *
 * Gating (all required to route a job agentically): `enabled` true AND the
 * packet's output_format is 'unified-diff' AND the model has tool_use AND the
 * workspace is a git repo AND the worktree manager + applyEdit are wired. Any
 * miss falls back to the byte-identical legacy one-shot pipeline.
 *
 * Env override: `KINGDOM_AGENTIC_DISPATCH=0` force-OFF (config is the source of
 * truth; env can only force off, mirroring `KINGDOM_NO_LESSONS`).
 */
export interface AgenticDispatchConfig {
  /** Master flag. Default false until Phase 5 M6. */
  enabled: boolean;
  /** Max agentic tool iterations per job. Default 8. */
  max_iterations?: number;
  /** Junction/symlink base node_modules into each worktree. Default true. */
  link_node_modules?: boolean;
  /** Re-run validation on the integration branch after merge; revert on failure. Default true. */
  post_merge_validation?: boolean;
  /** Root dir for worktrees (relative to workspace). Default '.kingdom-worktrees'. */
  worktree_root?: string;
}

/**
 * Controls the cross-run lesson-injection system. Lessons are distilled
 * post-run from incidents and review decisions and injected into future
 * prompts for the tiers listed in `injection_tiers`.
 *
 * Everything here is optional — sensible defaults apply:
 *   - enabled:          true
 *   - max_lessons_bytes: 4096
 *   - injection_tiers:   ['king', 'nobility', 'healer']
 *   - max_per_tier:      20
 */
export interface MemoryConfig {
  /** Master switch. When false, no reads and no writes of lessons happen. */
  enabled?: boolean;
  /** Hard byte cap on the injected `## Prior Lessons` block. Default 4096. */
  max_lessons_bytes?: number;
  /** Tiers whose prompts receive the lesson block. Default: king/nobility/healer. */
  injection_tiers?: string[];
  /** Max active lessons rendered per tier before truncation. Default 20. */
  max_per_tier?: number;
  // PHASE4 (P4.2): relevance-ranked semantic injection.
  /**
   * When true and an EmbeddingProvider is supplied, lessons are ranked by
   * cosine similarity to the current task instead of `times_seen DESC`.
   * Defaults to true; with no embedder configured it transparently degrades
   * to the legacy frequency-ordered path.
   */
  semantic_injection?: boolean;
  /**
   * Minimum cosine similarity for a lesson to be injected under semantic mode.
   * Lessons below this are dropped (a lesson irrelevant to the task is noise).
   * Default 0.1.
   */
  min_similarity?: number;
  /**
   * Dynamic cap: when the resolved model's context window (safe input budget,
   * tokens) is at least this large, the byte cap is multiplied so big-context
   * models get more lessons. Default 32000.
   */
  large_context_threshold_tokens?: number;
  /** Multiplier applied to max_lessons_bytes for large-context models. Default 4. */
  large_context_cap_multiplier?: number;
}

export interface TelegramConfig {
  /** Telegram bot token from @BotFather. Required to enable Telegram integration. */
  bot_token: string;
  /** Comma-separated chat IDs or array of chat IDs allowed to control this Kingdom. */
  allowed_chat_ids?: number[];
}

export interface SentinelConfig {
  /**
   * How long (seconds) a job can go without a heartbeat before being marked stalled.
   * Default: 90. Applies to all tiers unless overridden by stale_threshold_per_tier.
   */
  stale_threshold_seconds?: number;
  /**
   * Per-tier stale thresholds (seconds). Higher tiers (king, nobility) tend to take
   * longer per token, so they benefit from a higher threshold.
   * Example: { king: 300, nobility: 180, knight: 120, squire: 60 }
   */
  stale_threshold_per_tier?: Partial<Record<AgentTier, number>>;
}

export interface TechStack {
  /** Primary language (e.g. 'TypeScript', 'Python', 'Go', 'Rust') */
  language: string;
  /** Framework (e.g. 'React', 'Next.js', 'FastAPI', 'Express') */
  framework?: string;
  /** Build tool (e.g. 'Vite', 'Webpack', 'esbuild', 'cargo') */
  build_tool?: string;
  /** Test framework (e.g. 'Vitest', 'Jest', 'pytest') */
  test_framework?: string;
  /** Package manager (e.g. 'pnpm', 'npm', 'pip', 'cargo') */
  package_manager?: string;
  /** Additional libraries or constraints */
  extras?: string[];
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
  /** Concrete model ID. Legacy path — still fully supported and useful for pinning. */
  model: string;
  /** Optional explicit provider route. When set, summon must use this provider or fail preflight. */
  provider?: string;
  /**
   * Optional capability profile. When present, `resolveModel()` consults the
   * registry and may pick a different model than `model`. The `model` field
   * acts as the final fallback if no profile match is found.
   */
  profile?: CapabilityProfile;
  /**
   * Ordered fallback chain. Each entry is either a concrete model ID or another
   * capability profile. Used when the primary selection is unavailable.
   */
  fallback_chain?: (string | CapabilityProfile)[];
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

// Milestone events — high-signal events that warrant operator attention
// (distinct from the verbose Scribe event stream which captures everything).

export type MilestoneEventType =
  | 'escalation'       // Task escalated to a higher tier
  | 'task_stuck'       // Task has exhausted all tiers — needs manual intervention
  | 'objective_complete' // All tasks for an objective finished
  | 'objective_terminal' // Objective reached completed|failed|cancelled and post-run hooks fired
  | 'run_failed';      // All objectives failed or stuck (no more work to do)

export interface MilestoneEvent {
  type: MilestoneEventType;
  taskId?: string;
  taskTitle?: string;
  objectiveId?: string;
  details: Record<string, unknown>;
}

export type MilestoneCallback = (event: MilestoneEvent) => void;
