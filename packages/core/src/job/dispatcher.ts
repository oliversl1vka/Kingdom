import type Database from 'better-sqlite3';
import type { Job, TaskGraphNode, TaskStatus, JobPacket, ProviderAdapter, ReviewDecision, MilestoneCallback, CompletionRequest, CompletionResponse, ModelCapabilities, AgenticDispatchConfig, FailureType } from '../types.js';
import type { CommandPolicy } from '../worker/command-sandbox.js';
import { JobRepository } from '../repositories/job-repo.js';
import { TaskRepository } from '../repositories/task-repo.js';
import { buildScopePlan, normalizePlannedFilePath, JobPacketAssembler, type PacketAssemblyOptions } from '../job/packet-assembler.js';
import { ReviewEngine, type ReviewContext } from '../review/reviewer.js';
import { runVerificationGate } from '../verification/verification-gate.js'; // PHASE3 (P3.2)
import { computeFailureSignature, isFeedbackIdentical } from '../verification/loop-detector.js'; // PHASE3 (P3.4)
import { FileLockManager } from '../locks/file-lock-manager.js';
import { HeartbeatWriter } from '../worker/heartbeat-writer.js';
import { extractJsonObject, type JsonObject } from '../json/extractor.js';
import { readFileSync, writeFileSync, mkdirSync, existsSync, unlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { execSync, execFileSync } from 'node:child_process';
import { generateUlid } from '../ulid.js';
// PHASE5: agentic dispatch — exported loop + injected worktree contracts.
import { runAgenticLoop, type ApplyEditFn } from '../worker/worker-main.js';
import type { IntegrationGate } from './integration-gate.js';
import { WorktreeRepository } from '../repositories/worktree-repo.js';

// ── PHASE5 (§5.3): structural injection contracts for the worktree manager /
// session. Core never statically depends on @kingdomos/blacksmith — summon wires
// the real WorktreeManager, which satisfies these shapes structurally; tests
// inject a fake. ──────────────────────────────────────────────────────────────
export interface WorktreeRunResultLike { code: number; stdout: string; stderr: string; timedOut: boolean; }
export interface MergeBackResultLike {
  success: boolean; conflict: boolean; conflictingFiles: string[];
  mergedSha?: string; feedback: string[]; errors: string[];
}
export interface WorktreeSessionLike {
  readonly jobId: string;
  readonly path: string;
  readonly branch: string;
  readonly baseSha: string;
  readonly integrationBranch: string;
  diff(): string;
  changedFiles(): string[];
  run(command: string, opts?: { timeoutMs?: number; env?: Record<string, string> }): WorktreeRunResultLike;
  commit(message: string): boolean;
  mergeBack(): MergeBackResultLike;
  discard(): void;
}
export interface WorktreeManagerLike {
  openSession(jobId: string, opts?: { baseRef?: string; linkNodeModules?: boolean }): WorktreeSessionLike;
  integrationHead(): string;
  resetIntegrationTo(sha: string): void;
}

/** PHASE5: lightweight git-repo probe (avoids a static blacksmith dependency). */
function dispatcherIsGitRepo(dir: string): boolean {
  try {
    const out = execFileSync('git', ['rev-parse', '--is-inside-work-tree'], {
      cwd: dir, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'],
    }).toString().trim();
    return out === 'true';
  } catch {
    return false;
  }
}

/** Callback for logging events (Scribe integration) */
export type ScribeCallback = (event: {
  type: string;
  agentId: string;
  jobId?: string;
  taskId?: string;
  details: Record<string, unknown>;
}) => void;

/** Callback for Scribe crypt entries on task completion */
export type ScribeCryptCallback = (taskId: string, title: string, success: boolean, details?: string) => void;

/** Callback for Scribe file change tracking */
export type ScribeFileChangeCallback = (action: 'created' | 'modified', filePaths: string[], taskTitle: string) => void;

/** Callback for applying diffs (Blacksmith integration) */
export type BlacksmithCallback = (diffText: string, projectPath: string) => {
  success: boolean;
  appliedFiles: string[];
  failedFiles: string[];
  errors: string[];
};

/** Callback for incident reporting (Healer integration) */
export type HealerCallback = (incident: {
  task_id: string;
  job_id: string;
  severity: string;
  failure_type: string;
  symptoms: Record<string, unknown>;
  context_summary: string;
}) => void;

export interface DispatcherConfig {
  maxConcurrentWorkers: number;
  pollIntervalMs: number;
  assemblyOptions: PacketAssemblyOptions;
  defaultModel: string;
  supervisorId: string;
  verbose?: boolean;
  /** Max retries at same tier before escalation (default: 2) */
  maxRetriesPerTier?: number;
  /** Shell command run after a successful diff apply to verify the workspace compiles.
   *  Executes with cwd=projectPath. Non-zero exit triggers automatic rollback via .bak
   *  files and a retry with the compiler output injected as feedback. */
  validationCommand?: string;
  /** Behavioural probes — shell commands run AFTER validationCommand succeeds to
   *  assert the applied change actually works at runtime (e.g. `node dist/index.js foo --help`).
   *  A probe is considered passing iff it exits 0. Non-zero exit triggers rollback +
   *  healer, identical to validationCommand failure. Each probe's combined stdout/stderr
   *  (truncated) is fed into healer feedback so the next retry sees the runtime signature. */
  behavioralProbes?: string[];
  /** Override the tier escalation path. Default: squire→knight, knight→nobility.
   *  Map of { fromTier: toTier }. Tiers not listed use the built-in default. */
  escalationPath?: Record<string, string>;
  // ── PHASE5: agentic dispatch via isolated worktrees (all optional; absent ⇒
  // legacy one-shot pipeline only). ───────────────────────────────────────────
  /** Master flag + tuning for agentic dispatch. */
  agenticDispatch?: AgenticDispatchConfig;
  /** Injected worktree manager (summon wires the real blacksmith one). null ⇒ no agentic. */
  worktreeManager?: WorktreeManagerLike;
  /** Structured-edit applicator (blacksmith). Required for the agentic loop. */
  applyEdit?: ApplyEditFn;
  /** Resolve a model's capabilities (tool_use gate). null result ⇒ legacy path. */
  capabilitiesResolver?: (modelId: string) => ModelCapabilities | null;
  /** Process-level merge serialiser. Created by summon; tests may inject. */
  integrationGate?: IntegrationGate;
}

/** Default escalation path: tier → next higher tier for retry.
 *  Knight intentionally does NOT escalate to nobility — nobility's agent prompt
 *  targets decomposition, not diff production, so escalated implementation jobs
 *  consistently fail review. Exhausted knight jobs go straight to awaiting-healer. */
const DEFAULT_ESCALATION_PATH: Record<string, string> = {
  squire: 'knight',
};

class DispatcherCancellationError extends Error {
  constructor(readonly stage: string) {
    super(`Job cancelled during ${stage}`);
    this.name = 'DispatcherCancellationError';
  }
}

const CANCELLABLE_JOB_STATES = ['queued', 'preparing-context', 'awaiting-budget-check', 'running', 'streaming', 'cancel-requested'];
const CANCELLABLE_TASK_STATES = ['queued', 'preparing-context', 'awaiting-budget-check', 'running', 'streaming', 'stalled', 'cancel-requested', 'retrying'];

interface RollbackResult {
  restored: string[];
  removed: string[];
  failed: string[];
}

interface ParsedDesignReview {
  pass: boolean;
  feedback?: string;
}

export function parseDesignReviewResponse(content: string): ParsedDesignReview | null {
  return extractJsonObject<ParsedDesignReview & JsonObject>(content, isDesignReviewObject);
}

export class JobDispatcher {
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private jobRepo: JobRepository;
  private taskRepo: TaskRepository;
  private assembler: JobPacketAssembler;
  private activeJobs = 0;

  // File lock manager — prevents concurrent jobs from modifying the same file
  private fileLockManager: FileLockManager;

  // Provider routing: tier → provider
  private providers = new Map<string, ProviderAdapter>();
  private defaultProvider: ProviderAdapter | null = null;

  // Model routing: tier → model name
  private tierModels = new Map<string, string>();

  // PHASE3 (P3.4): consecutive same-root-cause failure streak per task. Drives
  // strategy escalation (route to healer) when a task loops on one cause.
  private stuckStreaks = new Map<string, number>();

  // Timeout routing: tier → timeout seconds
  private tierTimeouts = new Map<string, number>();

  // Review engine (Judge)
  private reviewEngine: ReviewEngine | null = null;
  private judgeProvider: ProviderAdapter | null = null;

  // Agent hooks
  private scribe: ScribeCallback | null = null;
  private scribeCrypt: ScribeCryptCallback | null = null;
  private scribeFileChange: ScribeFileChangeCallback | null = null;
  private blacksmith: BlacksmithCallback | null = null;
  private healer: HealerCallback | null = null;
  private milestone: MilestoneCallback | null = null;

  // PHASE5: durable per-job worktree ledger (crash recovery).
  private worktreeRepo: WorktreeRepository;

  constructor(private db: Database.Database, private config: DispatcherConfig) {
    this.jobRepo = new JobRepository(db);
    this.taskRepo = new TaskRepository(db);
    this.assembler = new JobPacketAssembler(db, this.taskRepo, config.assemblyOptions);
    this.fileLockManager = new FileLockManager(db);
    this.worktreeRepo = new WorktreeRepository(db);
  }

  /** Set the default provider for all job execution. */
  setProvider(provider: ProviderAdapter): void {
    this.defaultProvider = provider;
  }

  /** Register a provider for a specific agent tier. */
  setTierProvider(tier: string, provider: ProviderAdapter): void {
    this.providers.set(tier, provider);
  }

  /** Register the model name used by a specific tier. */
  setTierModel(tier: string, model: string): void {
    this.tierModels.set(tier, model);
  }

  /** Register the configured request timeout used by a specific tier. */
  setTierTimeout(tier: string, timeoutSeconds: number): void {
    if (Number.isFinite(timeoutSeconds) && timeoutSeconds > 0) {
      this.tierTimeouts.set(tier, timeoutSeconds);
    }
  }

  /** Get the timeout for a tier (falls back to packet/default 120s). */
  private getTimeoutForTier(tier: string): number {
    return this.tierTimeouts.get(tier) ?? this.config.assemblyOptions.timeoutSecondsResolver?.(tier) ?? 120;
  }

  /** Get the model name for a tier (falls back to config default). */
  private getModelForTier(tier: string): string {
    return this.tierModels.get(tier) ?? this.config.defaultModel;
  }

  /** Set up the Judge review engine. */
  setJudgeProvider(provider: ProviderAdapter, model?: string): void {
    this.judgeProvider = provider;
    this.reviewEngine = new ReviewEngine(this.db, provider, model);
  }

  /** Set the Scribe logging callback. */
  setScribe(cb: ScribeCallback): void { this.scribe = cb; }

  /** Set the Scribe crypt entry callback (task completion archival). */
  setScribeCrypt(cb: ScribeCryptCallback): void { this.scribeCrypt = cb; }

  /** Set the Scribe file change tracking callback. */
  setScribeFileChange(cb: ScribeFileChangeCallback): void { this.scribeFileChange = cb; }

  /** Set the Blacksmith diff application callback. */
  setBlacksmith(cb: BlacksmithCallback): void { this.blacksmith = cb; }

  /** Set the Healer incident reporting callback. */
  setHealer(cb: HealerCallback): void { this.healer = cb; }

  /** Set the Milestone callback for high-signal operator events (escalations, stuck tasks, failures). */
  setMilestoneCallback(cb: MilestoneCallback): void { this.milestone = cb; }

  /** Resolve the correct provider for a task's assigned tier. */
  private getProviderForTier(tier: string): ProviderAdapter | null {
    return this.providers.get(tier) ?? this.defaultProvider;
  }

  start(): void {
    this.pollTimer = setInterval(() => {
      this.dispatchPending();
    }, this.config.pollIntervalMs);
    this.dispatchPending();
  }

  stop(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  private dispatchPending(): void {
    // Honour the pause flag file — allows an operator to freeze dispatch without
    // killing the process. The file is created by `kingdom pause` and deleted by
    // `kingdom unpause`. We check on every cycle so the response is near-instant.
    const pauseFile = join(process.cwd(), 'kingdom', '.dispatch-paused');
    if (existsSync(pauseFile)) {
      if (this.config.verbose) console.log('[Dispatcher] ⏸️  Dispatch paused (kingdom/.dispatch-paused exists)');
      return;
    }

    const available = this.config.maxConcurrentWorkers - this.activeJobs;
    if (available <= 0) return;

    // Build the dispatch batch while ensuring no two jobs in the same batch
    // claim the same file. Without this, parallel jobs that share context_refs
    // files generate conflicting diffs from the same base state even though the
    // file lock system would eventually defer one — it's better to never start
    // two jobs that will race on the same file in the first place.
    const filesInBatch = new Set<string>();
    const toDispatch: Job[] = [];

    // Tasks in these states will never execute — any queued job against them is orphaned.
    const ORPHAN_TASK_STATES = new Set([
      'completed', 'completed-with-warnings', 'cancelled',
      'awaiting-healer', 'awaiting-redesign', 'superseded', 'needs-human',
    ]);

    // getQueuedByPriority joins with task_graph_nodes and sorts by priority DESC so
    // high-priority tasks are dispatched first rather than strict FIFO (Issue 11).
    for (const job of this.jobRepo.getQueuedByPriority()) {
      if (toDispatch.length >= available) break;
      const task = this.taskRepo.getById(job.task_id);
      if (!task) continue;

      // Cancel orphan jobs whose task was completed/cancelled out-of-band. Without
      // this, their files poison filesInBatch and every other queued job defers
      // against a batch that will never dispatch — the deadlock seen in practice.
      if (ORPHAN_TASK_STATES.has(task.status)) {
        this.jobRepo.updateStatus(job.id, 'cancelled');
        if (this.config.verbose) {
          console.log(`[Dispatcher] 🧹 Cancelling orphan job ${job.id} — task in terminal state: ${task.status}`);
        }
        continue;
      }

      const jobFiles = buildScopePlan(task).allowedFiles;
      if (jobFiles.some(f => filesInBatch.has(f))) {
        // File overlap — defer to next poll cycle so the currently-selected
        // job finishes and releases locks before we start a competing job.
        if (this.config.verbose) {
          console.log(`[Dispatcher] ⏭️  Deferring job ${job.id} — file overlap with current dispatch batch`);
        }
        continue;
      }

      toDispatch.push(job);
      jobFiles.forEach(f => filesInBatch.add(f));
    }

    for (const job of toDispatch) {
      this.dispatchJob(job);
    }
  }

  private dispatchJob(job: Job): void {
    const task = this.taskRepo.getById(job.task_id);
    if (!task) return;

    const provider = this.getProviderForTier(task.assigned_tier);
    if (!provider) {
      if (this.config.verbose) {
        console.error(`[Dispatcher] No provider for tier ${task.assigned_tier} — skipping job ${job.id}`);
      }
      return;
    }

    // Resolve files this job will touch from the explicit scope plan. This includes
    // files that do not exist yet, so planned creates contend correctly too.
    // We acquire locks BEFORE reading file content so no two jobs read the same
    // stale snapshot and race to apply conflicting diffs (Issues 1 & 2).
    const filesToLock = buildScopePlan(task).allowedFiles;

    // PHASE1 (P1.2): Atomic, all-or-nothing batch lock acquisition. Replaces the
    // old per-file acquire loop that could hold a partial subset and livelock.
    // If ANY file is held by another job the whole batch fails and we defer —
    // no partial holds, no rollback loop.
    const lockTokens = this.fileLockManager.acquireBatch(
      filesToLock,
      job.id,
      this.config.supervisorId,
      this.getTimeoutForTier(task.assigned_tier) + 60,
    );
    if (lockTokens === null) {
      if (this.config.verbose) {
        console.log(`[Dispatcher] 🔒 Deferring job ${job.id} — one or more scope files locked by another job`);
      }
      return; // Will be picked up on the next poll cycle
    }
    const lockedFiles: string[] = Object.keys(lockTokens);

    // PHASE1 (P1.1): Non-throwing atomic transition replaces the throwing
    // updateStatus + swallowed try/catch. A losing race returns false (not a
    // throw) so we simply cancel the orphan and release locks.
    if (task.status === 'running') {
      // Task is already running from retryOrEscalate() — no transition needed
      if (this.config.verbose) {
        console.log(`[Dispatcher] 🔄 Retry dispatch for job ${job.id} — task already running`);
      }
    } else {
      // Atomically claim the task: only from 'queued' (single-step to running via
      // the recovery-style guarded transition). If it isn't queued anymore, the
      // job is orphaned — cancel it and release locks.
      const claimed = this.taskRepo.tryTransition(job.task_id, ['queued'], 'running', 'dispatch', 'sentinel');
      if (!claimed) {
        this.jobRepo.tryTransition(job.id, ['queued', 'preparing-context', 'awaiting-budget-check'], 'cancelled', 'orphan: task not queued', 'sentinel');
        if (this.config.verbose) {
          console.log(`[Dispatcher] 🧹 Cancelling orphan job ${job.id} — task not in queued state: ${task.status}`);
        }
        for (const f of lockedFiles) this.fileLockManager.release(f, this.config.supervisorId);
        return;
      }
      this.scribe?.({ type: 'task_transition', agentId: 'sentinel', taskId: job.task_id, details: { from: 'queued', to: 'running' } });
    }

    const workerId = `${task.assigned_tier}-${generateUlid().slice(-8)}`;
    this.jobRepo.setStarted(job.id, workerId, this.getTimeoutForTier(task.assigned_tier));
    // PHASE1 (P1.3): Record the worker lease. The full spawn-per-job model is
    // deferred (see TODO below) so the lease owner is the dispatcher process for
    // now; this still lets the reconciler detect a dead dispatcher and lets
    // cancellation kill by PID. lease_expires_at is renewed by the heartbeat.
    // TODO(PHASE1): swap the in-process executeJob() promise for spawnWorker()
    // (worker/spawner.ts) so each job runs in its own child process; set the
    // lease PID to the child's PID and renew lease_expires_at from the child's
    // heartbeat. Deferred to keep the green build (process-model swap is high-risk).
    this.jobRepo.setLease(job.id, process.pid, this.getTimeoutForTier(task.assigned_tier) + 120);
    this.activeJobs++;

    // Start heartbeat writer so Sentinel doesn't mark us stale.
    // PHASE1 (P1.3): pass the lease window so the heartbeat renews lease_expires_at.
    const heartbeat = new HeartbeatWriter(this.db, job.id, workerId, this.getTimeoutForTier(task.assigned_tier) + 120);
    heartbeat.start();

    if (this.config.verbose) {
      console.log(`[Dispatcher] 🚀 [${task.assigned_tier}] Executing job ${job.id} — ${task.title.slice(0, 55)}`);
    }

    // Packet is assembled INSIDE executeJob so file content is read fresh after
    // locks are held — preventing stale context from racing jobs (Issue 2).
    // lockedFiles is passed by reference so the groom step can expand the lock
    // set and have those additional locks released in this same finally block.
    this.executeJob(job, task, provider, lockedFiles).finally(() => {
      heartbeat.stop();
      this.activeJobs--;
      // PHASE1 (P1.3): clear the lease — the job is no longer in flight, so the
      // reconciler must not consider its (now stale) lease.
      try {
        this.db.prepare('UPDATE jobs SET lease_owner_pid = NULL, lease_expires_at = NULL WHERE id = ?').run(job.id);
      } catch { /* lease columns absent in legacy DBs — non-fatal */ }
      // Release all file locks held by this job
      for (const f of lockedFiles) {
        this.fileLockManager.release(f, this.config.supervisorId);
      }
    });
  }

  /**
   * Cheap pre-flight LLM call for diff-producing jobs that asks the model which
   * files it plans to modify — before spending tokens on the full diff generation.
   * If any planned file is outside the task's allowed scope, the job is failed+retried immediately.
   *
   * Returns:
   *   { ok: true, confirmedFiles }  — groom passed, use confirmedFiles for prompt injection
   *   { ok: false, reasons }        — groom failed, caller should mark failed + retryOrEscalate
   *   null                          — groom skipped or errored non-fatally; caller proceeds normally
   */
  private async runGroomStep(
    job: Job,
    task: TaskGraphNode,
    packet: JobPacket,
    provider: ProviderAdapter
  ): Promise<{ ok: true; confirmedFiles: string } | { ok: false; reasons: string[] } | null> {
    // Greenfield tasks with no planned file set cannot be groomed against a path allow-list.
    if (packet.allowed_files.length === 0) return null;

    // Build a minimal groom prompt from the system identity + condensed task
    const systemMessages = packet.messages.filter(m => m.role === 'system');
    const groomMessages = [
      ...systemMessages,
      {
        role: 'user' as const,
        content: `Task: ${task.title}\n\n${task.description?.split('## What not to change')[0] ?? ''}\n\nList ONLY the file paths (relative to project root) that you will modify or create to complete this task. One path per line. No code, no explanation, no markdown. Just paths.`,
      },
    ];

    try {
      const groomResp = await this.completeWithCancellation(job, task, provider, 'groom', {
        model: packet.model_id,
        messages: groomMessages,
        max_tokens: 200,
        temperature: 0,
        timeout_ms: packet.timeout_seconds * 1000,
      });
      if (!groomResp) return null;

      // Parse file paths: lines that contain '.' and '/' or look like paths
      const filePaths = groomResp.content
        .split('\n')
        .map(l => normalizePlannedFilePath(l))
        .filter((l): l is string => !!l);

      if (filePaths.length === 0) return null; // Can't parse paths — skip groom

      // Validate that planned files exist (excluding files the task is allowed to create)
      const existingAllowed = new Set(packet.allowed_files);
      const missing = filePaths.filter(f => !existingAllowed.has(f));

      if (missing.length > 0) {
        if (this.config.verbose) {
          console.log(`[Dispatcher] 🌱 [groom] Job ${job.id} planned non-existent files: ${missing.join(', ')}`);
        }
        // Return failure reasons — caller handles setFailed + retryOrEscalate OUTSIDE
        // the try-catch so it isn't swallowed by the groom error handler.
        return {
          ok: false,
          reasons: ['Groom pre-flight failed: planned files are outside the allowed scope.', ...missing.map(f => `Groom pre-flight: file "${f}" is not listed in the task scope`)],
        };
      }

      if (this.config.verbose) {
        console.log(`[Dispatcher] 🌱 [groom] Job ${job.id} pre-flight OK — will touch: ${filePaths.join(', ')}`);
      }

      return { ok: true, confirmedFiles: filePaths.join('\n') };
    } catch {
      // Groom errors (network, parse, etc.) are non-fatal — silently skip
      return null;
    }
  }

  /** Write a checkpoint after a validated diff task reaches completed state. */
  private writeCheckpoint(job: Job, task: TaskGraphNode, appliedFiles: string[]): void {
    // Capture git HEAD — non-fatal if the project isn't a git repo
    let gitSha: string | null = null;
    try {
      gitSha = execSync('git rev-parse HEAD', {
        cwd: this.config.assemblyOptions.projectPath,
        timeout: 3000,
        stdio: ['ignore', 'pipe', 'ignore'],
      }).toString().trim();
    } catch {
      // Not a git repo or git not installed — checkpoints still work without SHA
    }

    try {
      this.db
        .prepare(
          `INSERT OR REPLACE INTO run_checkpoints
           (id, objective_id, task_id, job_id, git_sha, applied_files, checkpoint_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          `ckpt-${job.id}`,
          task.objective_id,
          task.id,
          job.id,
          gitSha,
          JSON.stringify(appliedFiles),
          new Date().toISOString()
        );

      if (this.config.verbose) {
        console.log(`[Dispatcher] 🔖 Checkpoint saved for task ${task.id}${gitSha ? ` @ ${gitSha.slice(0, 8)}` : ''}`);
      }
    } catch (err) {
      // Checkpoint write failure is non-fatal — log and continue
      if (this.config.verbose) {
        console.error(`[Dispatcher] ⚠️ Checkpoint write failed: ${(err as Error).message}`);
      }
    }
  }

  private getCancellationState(jobId: string, taskId: string): { requested: boolean; reason: string | null } {
    const row = this.db
      .prepare(
        `SELECT j.cancel_requested, j.cancel_reason, j.status as job_status, t.status as task_status
         FROM jobs j
         JOIN task_graph_nodes t ON t.id = j.task_id
         WHERE j.id = ? AND t.id = ?`
      )
      .get(jobId, taskId) as { cancel_requested: number; cancel_reason: string | null; job_status: string; task_status: string } | undefined;

    if (!row) return { requested: false, reason: null };
    const requested = row.cancel_requested === 1 || row.job_status === 'cancel-requested' || row.job_status === 'cancelled' || row.task_status === 'cancelled';
    return { requested, reason: row.cancel_reason };
  }

  private deleteCheckpoint(jobId: string, taskId: string): void {
    try {
      this.db.prepare('DELETE FROM run_checkpoints WHERE job_id = ? OR task_id = ?').run(jobId, taskId);
    } catch {
      // Pre-checkpoint databases should not turn rollback into a runtime crash.
    }
  }

  private rollbackAppliedFiles(appliedFiles: string[]): RollbackResult {
    const result: RollbackResult = { restored: [], removed: [], failed: [] };
    const projectPath = this.config.assemblyOptions.projectPath;

    for (const file of appliedFiles) {
      const filePath = join(projectPath, file);
      const bakPath = `${filePath}.bak`;
      try {
        if (existsSync(bakPath)) {
          writeFileSync(filePath, readFileSync(bakPath, 'utf-8'), 'utf-8');
          result.restored.push(file);
        } else if (existsSync(filePath)) {
          unlinkSync(filePath);
          result.removed.push(file);
        }
      } catch {
        result.failed.push(file);
      }
    }

    return result;
  }

  private cancelJobIfRequested(job: Job, task: TaskGraphNode, stage: string, appliedFiles: string[] = []): boolean {
    const cancellation = this.getCancellationState(job.id, task.id);
    if (!cancellation.requested) return false;

    const rollback = appliedFiles.length > 0 ? this.rollbackAppliedFiles(appliedFiles) : undefined;
    if (appliedFiles.length > 0) this.deleteCheckpoint(job.id, task.id);

    const now = new Date().toISOString();
    const jobPlaceholders = CANCELLABLE_JOB_STATES.map(() => '?').join(', ');
    this.db
      .prepare(`UPDATE jobs SET status = 'cancelled' WHERE id = ? AND status IN (${jobPlaceholders})`)
      .run(job.id, ...CANCELLABLE_JOB_STATES);

    const taskPlaceholders = CANCELLABLE_TASK_STATES.map(() => '?').join(', ');
    this.db
      .prepare(`UPDATE task_graph_nodes SET status = 'cancelled', updated_at = ? WHERE id = ? AND status IN (${taskPlaceholders})`)
      .run(now, task.id, ...CANCELLABLE_TASK_STATES);

    this.scribe?.({
      type: 'task_transition',
      agentId: 'sentinel',
      jobId: job.id,
      taskId: task.id,
      details: { action: 'cancel', stage, reason: cancellation.reason, rollback },
    });

    if (this.config.verbose) {
      console.log(`[Dispatcher] 🛑 Job ${job.id} cancelled at ${stage}${rollback ? ` — rolled back ${appliedFiles.length} applied file(s)` : ''}`);
    }

    return true;
  }

  private async runWithCancellation<T>(
    job: Job,
    task: TaskGraphNode,
    stage: string,
    operation: (signal: AbortSignal) => Promise<T>
  ): Promise<T | null> {
    if (this.cancelJobIfRequested(job, task, `before-${stage}`)) return null;

    const controller = new AbortController();
    let pollTimer: ReturnType<typeof setInterval> | null = null;
    const cancellationPromise = new Promise<never>((_resolve, reject) => {
      const poll = () => {
        if (this.getCancellationState(job.id, task.id).requested) {
          controller.abort();
          reject(new DispatcherCancellationError(stage));
        }
      };
      pollTimer = setInterval(poll, 250);
      poll();
    });

    const operationPromise = operation(controller.signal);
    operationPromise.catch(() => { /* consumed by Promise.race while cancellation may win */ });

    try {
      return await Promise.race([operationPromise, cancellationPromise]);
    } catch (err) {
      if (err instanceof DispatcherCancellationError || this.getCancellationState(job.id, task.id).requested) {
        controller.abort();
        this.cancelJobIfRequested(job, task, stage);
        return null;
      }
      throw err;
    } finally {
      if (pollTimer) clearInterval(pollTimer);
    }
  }

  private completeWithCancellation(
    job: Job,
    task: TaskGraphNode,
    provider: ProviderAdapter,
    stage: string,
    request: Omit<CompletionRequest, 'signal'>
  ): Promise<CompletionResponse | null> {
    return this.runWithCancellation(job, task, stage, (signal) => provider.complete({ ...request, signal }));
  }

  /**
   * PHASE1 (P1.1): Non-throwing task → failure transition. Replaces the
   * `try { updateStatus } catch {}` swallow pattern. Handles the stalled→running
   * recovery hop atomically and accepts the failure from any active state. Returns
   * false on a losing race (another path already moved the task) without throwing.
   */
  private transitionTaskToFailed(taskId: string, failedStatus: TaskStatus): boolean {
    // If the task was marked stalled by the sentinel, hop it back to running first.
    this.taskRepo.tryTransition(taskId, ['stalled'], 'running', 'recover-stalled', 'sentinel');
    return this.taskRepo.tryTransition(
      taskId,
      ['running', 'streaming'],
      failedStatus,
      'job failed',
      'sentinel',
    );
  }

  private failAppliedDiff(
    job: Job,
    task: TaskGraphNode,
    appliedFiles: string[],
    stage: string,
    compilerOutput: string,
    feedbackHead: string,
    symptoms: Record<string, unknown>,
    severity: 'medium' | 'high' = 'medium'
  ): void {
    const rollback = this.rollbackAppliedFiles(appliedFiles);
    this.deleteCheckpoint(job.id, task.id);

    if (this.config.verbose) {
      console.log(`[Dispatcher] 🧱 [${stage}] Rolling back ${appliedFiles.length} file(s)`);
    }

    this.healer?.({
      task_id: task.id,
      job_id: job.id,
      severity,
      failure_type: 'invalid-output',
      symptoms: { ...symptoms, applied_files: appliedFiles, rollback },
      context_summary: `${stage} failed after applying diff for "${task.title}"`,
    });

    this.jobRepo.setFailed(job.id, 'invalid-output');
    // PHASE1 (P1.1): atomic non-throwing transition replaces swallowed try/catch.
    this.transitionTaskToFailed(job.task_id, 'failed-review');

    this.retryOrEscalate(task, [feedbackHead, compilerOutput].filter(Boolean));
  }

  private async executeJob(job: Job, task: TaskGraphNode, provider: ProviderAdapter, lockedFiles: string[]): Promise<void> {
    if (this.cancelJobIfRequested(job, task, 'before-context-assembly')) return;

    // Assemble the packet fresh here — after file locks are acquired in dispatchJob —
    // so the LLM always sees the latest file state, never a stale pre-lock snapshot.
    // PHASE2 (P2.2): grounded assembly. assembleForJobAsync validates/repairs
    // context_refs and appends retrieved chunks when a contextResolver + healthy
    // index are configured; degrades to identical raw-slice output otherwise.
    const packet = await this.assembler.assembleForJobAsync(job, task);
    packet.timeout_seconds = this.getTimeoutForTier(task.assigned_tier);

    if (this.cancelJobIfRequested(job, task, 'after-context-assembly')) return;

    // === GROOM: Pre-flight path validation for code/test jobs ===
    // Run before the expensive main call to catch hallucinated file paths early.
    if (packet.output_format === 'unified-diff') {
      const groomResult = await this.runGroomStep(job, task, packet, provider);
      if (this.cancelJobIfRequested(job, task, 'after-groom')) return;
      if (groomResult !== null && !groomResult.ok) {
        this.jobRepo.setFailed(job.id, 'invalid-output');
        this.transitionTaskToFailed(task.id, 'failed-review'); // PHASE1 (P1.1)
        this.retryOrEscalate(task, groomResult.reasons);
        return;
      }
      if (groomResult?.ok && groomResult.confirmedFiles) {
        // Expand file locks to cover every file the model plans to touch.
        // context_refs only locks the files we KNEW about at dispatch time.
        // The groom step now tells us the full set — so we acquire any additional
        // locks here, before spending tokens on the main LLM call.
        // If another job currently holds one of these files, we fail fast and
        // retry. The retry will assemble fresh context after the concurrent job
        // finishes — which is exactly what we want.
        for (const file of groomResult.confirmedFiles.split('\n').filter(Boolean)) {
          if (lockedFiles.includes(file)) continue; // already held by this job
          if (!this.fileLockManager.acquire(file, job.id, this.config.supervisorId, packet.timeout_seconds + 60)) {
            this.jobRepo.setFailed(job.id, 'invalid-output');
            this.transitionTaskToFailed(job.task_id, 'failed-review'); // PHASE1 (P1.1)
            if (this.config.verbose) {
              console.log(`[Dispatcher] ⏳ [groom] Deferring job ${job.id} — "${file}" is locked by a concurrent task`);
            }
            this.retryOrEscalate(task, [
              `File "${file}" is currently being modified by a concurrent task.`,
              'Retrying when the file is available — context will be refreshed with the latest state.',
            ]);
            return;
          }
          lockedFiles.push(file); // tracked in dispatchJob's finally block for release
        }

        // Inject confirmed file list into the main user message as pre-flight context
        const lastMsg = packet.messages[packet.messages.length - 1];
        lastMsg.content += `\n\n## Pre-flight Check\nYou confirmed you will modify these files:\n${groomResult.confirmedFiles.split('\n').map((f: string) => `- ${f}`).join('\n')}\nProduce the unified diff for exactly these files.`;
      }
    }

    // ── PHASE5 (§5.3): agentic dispatch routing. When the flag + capability +
    // git-repo + wiring gates ALL pass, a tool-using model runs a read→edit→run→
    // self-correct loop inside an isolated worktree and merges back only after
    // review + gates pass. Any miss falls through to the legacy one-shot path. ──
    if (this.shouldUseAgenticDispatch(packet)) {
      const caps = this.config.capabilitiesResolver!(packet.model_id)!;
      await this.executeAgenticJob(job, task, provider, packet, caps);
      return;
    }

    try {
      // === KNIGHT/SQUIRE: Execute LLM call ===
      this.scribe?.({ type: 'model_invocation', agentId: task.assigned_tier, jobId: job.id, taskId: task.id, details: { model: packet.model_id, max_tokens: packet.max_tokens } });

      const response = await this.completeWithCancellation(job, task, provider, 'model-call', {
        model: packet.model_id,
        messages: packet.messages,
        max_tokens: packet.max_tokens,
        temperature: 0.7,
        timeout_ms: packet.timeout_seconds * 1000,
      });
      if (!response) return;

      this.scribe?.({ type: 'model_invocation', agentId: task.assigned_tier, jobId: job.id, taskId: task.id, details: { model: packet.model_id, tokens: response.total_tokens, finish_reason: response.finish_reason } });

      if (this.cancelJobIfRequested(job, task, 'after-model-call')) return;

      // Write result to file
      const resultPath = packet.result_path;
      mkdirSync(dirname(resultPath), { recursive: true });

      const result = {
        job_id: job.id,
        task_id: job.task_id,
        model: packet.model_id,
        output_format: packet.output_format,
        content: response.content,
        prompt_tokens: response.prompt_tokens,
        completion_tokens: response.completion_tokens,
        total_tokens: response.total_tokens,
        finish_reason: response.finish_reason,
        completed_at: new Date().toISOString(),
      };

      writeFileSync(resultPath, JSON.stringify(result, null, 2), 'utf-8');

      if (this.cancelJobIfRequested(job, task, 'after-result-write')) return;

      // === JUDGE: Review the output (for code/test tasks that produce diffs) ===
      let reviewDecision: ReviewDecision | null = null;
      if (this.reviewEngine && (packet.output_format === 'unified-diff')) {
        if (this.cancelJobIfRequested(job, task, 'before-review')) return;

        if (this.config.verbose) {
          console.log(`[Dispatcher] ⚖️  [judge] Reviewing job ${job.id}...`);
        }

        const reviewerModel = this.getModelForTier(task.reviewer_tier ?? 'knight');
        const reviewCtx: ReviewContext = {
          job,
          diffText: response.content,
          allowedFiles: packet.allowed_files,
          acceptanceCriteria: packet.acceptance_criteria,
          reviewerModel,
          // Always run the criteria check — squire output is precisely the case
          // that most needs grading. The new prompt is per-criterion and strict,
          // so a stronger reviewer can no longer silently over-reject on style.
          skipCriteriaCheck: false,
          // Give the Judge the target workspace so it can simulate the diff
          // in-memory and grade the RESULTING code (catches unreachable
          // branches, duplicate logic, unused imports).
          projectPath: this.config.assemblyOptions.projectPath,
          allowEmptyScope: packet.scope_mode === 'greenfield',
          timeout_ms: this.getTimeoutForTier(task.reviewer_tier ?? 'judge') * 1000,
          // PHASE3 (P3.2): let the Judge know an executable gate backs the criteria.
          verificationEvidence: task.verification?.test_command
            ? { test_command: task.verification.test_command, probe: task.verification.probe }
            : undefined,
        };

        reviewDecision = await this.runWithCancellation(job, task, 'review', (signal) => this.reviewEngine!.review({ ...reviewCtx, abortSignal: signal }));
        if (!reviewDecision) return;

        if (this.cancelJobIfRequested(job, task, 'after-review')) return;

        this.scribe?.({
          type: 'review_decision', agentId: 'judge', jobId: job.id, taskId: task.id,
          details: { verdict: reviewDecision.decision, scope: reviewDecision.scope_check, format: reviewDecision.format_check, security: reviewDecision.security_check, criteria: reviewDecision.criteria_check },
        });

        if (this.config.verbose) {
          const emoji = reviewDecision.decision === 'approved' ? '✅' : '❌';
          console.log(`[Dispatcher] ⚖️  [judge] ${emoji} ${reviewDecision.decision} — scope:${reviewDecision.scope_check} fmt:${reviewDecision.format_check} sec:${reviewDecision.security_check} criteria:${reviewDecision.criteria_check}`);
          if (reviewDecision.rejection_reasons?.length) {
            for (const r of reviewDecision.rejection_reasons) console.log(`    ↳ ${r}`);
          }
        }
      }

      // === DESIGN REVIEW: For design tasks, a higher-tier model reviews architectural decisions ===
      if (this.judgeProvider && task.type === 'design' && !reviewDecision) {
        if (this.cancelJobIfRequested(job, task, 'before-design-review')) return;

        const reviewerModel = this.getModelForTier(task.reviewer_tier ?? 'nobility');

        if (this.config.verbose) {
          console.log(`[Dispatcher] 🏛️  [judge] Design review for job ${job.id} using ${reviewerModel}...`);
        }

        try {
          const designReview = await this.completeWithCancellation(job, task, this.judgeProvider, 'design-review', {
            model: reviewerModel,
            messages: [{
              role: 'user',
              content: `Review this design output for architectural quality and consistency.

Task: ${task.title}
Acceptance Criteria:
${task.acceptance_criteria.map((c, i) => `${i + 1}. ${c}`).join('\n')}

Design Output:
${response.content}

Check for:
1. Does the design meet all acceptance criteria?
2. Are there any bad architectural decisions (wrong patterns, unnecessary complexity, inconsistent naming)?
3. Does the design align with the project's technology constraints?

Respond with JSON: {"pass": true/false, "feedback": "explanation of issues if any"}`,
            }],
            max_tokens: 500,
            temperature: 0.1,
            timeout_ms: this.getTimeoutForTier(task.reviewer_tier ?? 'judge') * 1000,
          });
          if (!designReview) return;

          if (this.cancelJobIfRequested(job, task, 'after-design-review')) return;

          const parsed = parseDesignReviewResponse(designReview.content);
          if (!parsed || !parsed.pass) {
              // Design rejected — trigger retry/escalation
              const reviewId = generateUlid();
              const feedback = parsed?.feedback ?? 'Design review returned no valid JSON object with a boolean pass field';
              reviewDecision = {
                id: reviewId,
                job_id: job.id,
                reviewer_agent_id: 'judge',
                decision: 'rejected',
                rejection_reasons: [feedback],
                scope_check: 'pass',
                format_check: 'pass',
                security_check: 'pass',
                criteria_check: 'fail',
                feedback,
                created_at: new Date().toISOString(),
              };

              this.scribe?.({
                type: 'review_decision', agentId: 'judge', jobId: job.id, taskId: task.id,
                details: { verdict: 'rejected', review_type: 'design', feedback },
              });

              if (this.config.verbose) {
                console.log(`[Dispatcher] 🏛️  [judge] ❌ Design rejected: ${feedback}`);
              }
            } else {
              this.scribe?.({
                type: 'review_decision', agentId: 'judge', jobId: job.id, taskId: task.id,
                details: { verdict: 'approved', review_type: 'design' },
              });

              if (this.config.verbose) {
                console.log(`[Dispatcher] 🏛️  [judge] ✅ Design approved`);
              }
            }
        } catch (err) {
          const feedback = `Design review errored: ${(err as Error).message}`;
          reviewDecision = {
            id: generateUlid(),
            job_id: job.id,
            reviewer_agent_id: 'judge',
            decision: 'rejected',
            rejection_reasons: [feedback],
            scope_check: 'pass',
            format_check: 'pass',
            security_check: 'pass',
            criteria_check: 'fail',
            feedback,
            created_at: new Date().toISOString(),
          };
          if (this.config.verbose) {
            console.error(`[Dispatcher] 🏛️  [judge] Design review error: ${(err as Error).message}`);
          }
        }
      }

      // If Judge rejected, fail the task and trigger retry/escalation
      if (reviewDecision && reviewDecision.decision === 'rejected') {
        this.jobRepo.setFailed(job.id, 'review-rejection');
        this.transitionTaskToFailed(job.task_id, 'failed-review'); // PHASE1 (P1.1)

        this.scribe?.({ type: 'task_transition', agentId: 'judge', taskId: task.id, details: { from: 'running', to: 'failed-review', reasons: reviewDecision.rejection_reasons } });

        // Report to healer
        this.healer?.({
          task_id: task.id,
          job_id: job.id,
          severity: 'medium',
          failure_type: 'review-rejection',
          symptoms: { rejection_reasons: reviewDecision.rejection_reasons, scope_check: reviewDecision.scope_check, format_check: reviewDecision.format_check, security_check: reviewDecision.security_check },
          context_summary: `Judge rejected job ${job.id} for task "${task.title}": ${reviewDecision.rejection_reasons?.join('; ')}`,
        });

        // Trigger retry or escalation
        this.retryOrEscalate(task, reviewDecision.rejection_reasons ?? []);
        return;
      }

      let appliedFilesForCheckpoint: string[] = [];

      // PHASE5 (§8): serialise the legacy in-place apply + gates + completion under
      // the SAME IntegrationGate as worktree merges, so a legacy in-place write can
      // never race a concurrent worktree merge on the integration branch. No-op
      // (runs inline; gate not acquired) when agentic dispatch is disabled.
      const legacyGateGuard = this.config.agenticDispatch?.enabled === true && !!this.config.integrationGate;
      const releaseLegacyGate = legacyGateGuard ? await this.config.integrationGate!.acquire() : null;
      try {

      // === BLACKSMITH: Apply diff to project files (for approved code/test tasks) ===
      if (this.blacksmith && packet.output_format === 'unified-diff' && response.content.trim()) {
        if (this.cancelJobIfRequested(job, task, 'before-blacksmith')) return;

        const projectPath = this.config.assemblyOptions.projectPath;
        const applyResult = this.blacksmith(response.content, projectPath);

        this.scribe?.({
          type: 'task_transition', agentId: 'blacksmith', jobId: job.id, taskId: task.id,
          details: { action: 'apply_diff', success: applyResult.success, applied: applyResult.appliedFiles, failed: applyResult.failedFiles },
        });

        if (this.config.verbose) {
          if (applyResult.success && applyResult.appliedFiles.length > 0) {
            console.log(`[Dispatcher] 🔨 [blacksmith] Applied diff to ${applyResult.appliedFiles.length} files: ${applyResult.appliedFiles.join(', ')}`);
          } else if (applyResult.failedFiles.length > 0) {
            console.log(`[Dispatcher] 🔨 [blacksmith] ⚠️ Diff apply failed for: ${applyResult.failedFiles.join(', ')}`);
            for (const e of applyResult.errors) console.log(`    ↳ ${e}`);
          }
        }

        if (this.cancelJobIfRequested(job, task, 'after-blacksmith', applyResult.appliedFiles)) return;

        if (!applyResult.success && applyResult.appliedFiles.length === 0) {
          // Total failure — no files were modified. This covers both the normal
          // "hunks did not apply" case and the degenerate parsePatch-returns-empty
          // case, so the job never silently flips to completed on a malformed diff.
          const failedPaths = applyResult.failedFiles.length > 0
            ? applyResult.failedFiles
            : ['<no target file in diff>'];
          const pathFeedback = failedPaths.map(f => {
            if (f === '<no target file in diff>' || f === '<unknown>') {
              return 'The diff is malformed — no valid file target was parsed. Re-emit the diff with proper "--- a/path" and "+++ b/path" headers and a well-formed "@@ -N,M +N,M @@" hunk header on its own line.';
            }
            const exists = existsSync(join(projectPath, f));
            return exists
              ? `File "${f}" exists but hunks did not apply cleanly — check line numbers and ensure @@ headers end with "@@" on their own line`
              : `File "${f}" does not exist in the workspace — verify the path is correct`;
          });

          this.healer?.({
            task_id: task.id,
            job_id: job.id,
            severity: 'medium',
            failure_type: 'invalid-output',
            symptoms: { failed_files: failedPaths, errors: applyResult.errors },
            context_summary: `Blacksmith failed to apply any hunks for job ${job.id}: ${applyResult.errors.slice(0, 2).join('; ')}`,
          });

          this.jobRepo.setFailed(job.id, 'invalid-output');
          this.transitionTaskToFailed(job.task_id, 'failed-review'); // PHASE1 (P1.1)

          this.retryOrEscalate(task, [
            'Diff application failed — no files were modified.',
            ...pathFeedback,
            ...applyResult.errors.slice(0, 2),
          ]);
          return;
        }

        if (!applyResult.success && applyResult.failedFiles.length > 0) {
          this.failAppliedDiff(
            job,
            task,
            applyResult.appliedFiles,
            'partial-apply',
            [
              `Failed files: ${applyResult.failedFiles.join(', ')}`,
              ...applyResult.errors,
            ].join('\n').slice(0, 800),
            'Diff application partially failed — some files applied but at least one target failed. The applied files were rolled back.',
            { failed_files: applyResult.failedFiles, errors: applyResult.errors },
            'high',
          );
          return;
        }

        if (applyResult.appliedFiles.length > 0) {
          if (this.cancelJobIfRequested(job, task, 'before-validation', applyResult.appliedFiles)) return;

          // === VALIDATION: Run post-apply build check to catch compilation errors ===
          if (this.config.validationCommand) {
            try {
              execSync(this.config.validationCommand, {
                cwd: this.config.assemblyOptions.projectPath,
                timeout: 30_000,
                stdio: ['ignore', 'pipe', 'pipe'],
              });
              if (this.config.verbose) {
                console.log(`[Dispatcher] ✓ [validation] Post-apply check passed`);
              }
            } catch (validationErr) {
              if (this.cancelJobIfRequested(job, task, 'validation-failed', applyResult.appliedFiles)) return;
              const e = validationErr as { stdout?: Buffer; stderr?: Buffer };
              const compilerOutput = [
                e.stdout?.toString('utf-8') ?? '',
                e.stderr?.toString('utf-8') ?? '',
              ].join('\n').trim().slice(0, 600) || 'Compilation failed (no output captured).';
              this.failAppliedDiff(
                job,
                task,
                applyResult.appliedFiles,
                'validation',
                compilerOutput,
                'Post-apply compilation check failed — the diff introduced a build error.',
                { validation_output: compilerOutput },
              );
              return;
            }
          }

          if (this.cancelJobIfRequested(job, task, 'after-validation', applyResult.appliedFiles)) return;

          // === PHASE3 (P3.2) VERIFICATION GATE: per-task test-execution-as-gate ===
          // Runs the task-scoped test_command (+ optional probe) AFTER the global
          // build check and BEFORE the global behavioural probes. A non-zero exit
          // rolls the diff back via failAppliedDiff with the test output as feedback.
          if (task.verification?.test_command) {
            if (this.cancelJobIfRequested(job, task, 'before-verification-gate', applyResult.appliedFiles)) return;
            const gate = runVerificationGate(task.verification, {
              projectPath: this.config.assemblyOptions.projectPath,
            });
            if (gate.ran && !gate.passed) {
              if (this.cancelJobIfRequested(job, task, 'verification-gate-failed', applyResult.appliedFiles)) return;
              this.failAppliedDiff(
                job,
                task,
                applyResult.appliedFiles,
                'verification-gate',
                gate.output,
                `Per-task verification gate failed — running "${gate.command}" exited non-zero. The change does not satisfy the task's test contract.`,
                { verification_command: gate.command, verification_output: gate.output },
                'high',
              );
              return;
            }
            if (gate.ran && this.config.verbose) {
              console.log(`[Dispatcher] ✓ [verification-gate] ${gate.command} passed`);
            }
          }

          // === BEHAVIORAL PROBES: Run each probe command; non-zero exit means the
          // applied change compiled but broke at runtime (e.g. missing require, bad
          // command registration, import error). Exit code IS the criterion. ===
          if (this.config.behavioralProbes?.length) {
            for (const probe of this.config.behavioralProbes) {
              if (this.cancelJobIfRequested(job, task, 'before-probe', applyResult.appliedFiles)) return;
              try {
                const out = execSync(probe, {
                  cwd: this.config.assemblyOptions.projectPath,
                  timeout: 20_000,
                  stdio: ['ignore', 'pipe', 'pipe'],
                });
                if (this.config.verbose) {
                  const preview = out.toString('utf-8').trim().split('\n').slice(0, 3).join(' | ').slice(0, 160);
                  console.log(`[Dispatcher] ✓ [probe] ${probe} — ${preview}`);
                }
              } catch (probeErr) {
                if (this.cancelJobIfRequested(job, task, 'probe-failed', applyResult.appliedFiles)) return;
                const e = probeErr as { stdout?: Buffer; stderr?: Buffer };
                const probeOutput = [
                  `$ ${probe}`,
                  e.stdout?.toString('utf-8') ?? '',
                  e.stderr?.toString('utf-8') ?? '',
                ].join('\n').trim().slice(0, 800) || `Probe exited non-zero with no output: ${probe}`;
                this.failAppliedDiff(
                  job,
                  task,
                  applyResult.appliedFiles,
                  'probe',
                  probeOutput,
                  `Behavioural probe failed — after apply, running "${probe}" exited non-zero. The code compiled but crashed at runtime.`,
                  { probe_output: probeOutput, probe },
                );
                return;
              }
            }
          }

          if (this.cancelJobIfRequested(job, task, 'after-probes', applyResult.appliedFiles)) return;

          appliedFilesForCheckpoint = applyResult.appliedFiles;
          this.scribeFileChange?.('modified', appliedFilesForCheckpoint, task.title);
        }
      }

      // === Mark completed ===
      if (this.cancelJobIfRequested(job, task, 'before-completion', appliedFilesForCheckpoint)) return;

      this.jobRepo.setCompleted(job.id, resultPath, response.total_tokens);

      // PHASE1 (P1.1): atomic non-throwing completion. The stalled→running hop and
      // the running/streaming→completed move are guarded atomic transitions; a
      // concurrent terminal transition (e.g. review rejection) simply yields
      // changed===false instead of throwing (replaces the swallowed try/catch).
      this.taskRepo.tryTransition(job.task_id, ['stalled'], 'running', 'recover-stalled', 'sentinel');
      const taskCompleted = this.taskRepo.tryTransition(job.task_id, ['running', 'streaming'], 'completed', 'job completed', task.assigned_tier);

      if (appliedFilesForCheckpoint.length > 0 && taskCompleted) {
        this.writeCheckpoint(job, task, appliedFilesForCheckpoint);
      }

      // === SCRIBE: Record task completion in the Crypt of Kings ===
      this.scribeCrypt?.(task.id, task.title, true, `${response.total_tokens} tokens used`);

      this.scribe?.({ type: 'task_transition', agentId: task.assigned_tier, taskId: task.id, details: { from: 'running', to: 'completed', tokens: response.total_tokens } });

      if (this.config.verbose) {
        console.log(`[Dispatcher] ✅ [${task.assigned_tier}] Job ${job.id} completed (${response.total_tokens} tokens) — ${task.title.slice(0, 50)}`);
      }
      } finally {
        // PHASE5 (§8): release the integration gate held for the legacy apply path
        // (no-op when it was never acquired). Runs on every exit, including returns.
        releaseLegacyGate?.();
      }
    } catch (err) {
      if (err instanceof DispatcherCancellationError || this.cancelJobIfRequested(job, task, 'error-handler')) return;

      const message = (err as Error).message;
      this.jobRepo.setFailed(job.id, 'runtime-crash');

      // PHASE1 (P1.1): atomic non-throwing failure transition (handles stalled
      // recovery first); replaces the swallowed try/catch.
      this.transitionTaskToFailed(job.task_id, 'failed-runtime-crash');

      this.scribe?.({ type: 'incident', agentId: 'sentinel', jobId: job.id, taskId: job.task_id, details: { error: message, failure_type: 'runtime-crash' } });

      // Report to healer
      this.healer?.({
        task_id: job.task_id,
        job_id: job.id,
        severity: 'high',
        failure_type: 'runtime-crash',
        symptoms: { error: message },
        context_summary: `Runtime crash in job ${job.id}: ${message}`,
      });

      if (this.config.verbose) {
        console.error(`[Dispatcher] ❌ [${job.id}] Failed: ${message}`);
      }

      // Trigger retry or escalation for runtime crashes too
      const freshTask = this.taskRepo.getById(job.task_id);
      if (freshTask) {
        this.retryOrEscalate(freshTask, [`Runtime crash: ${message}`]);
      }
    }
  }

  // ── PHASE5 (§5.3): agentic dispatch ─────────────────────────────────────────

  /** All gates required to route a job agentically (any miss ⇒ legacy one-shot). */
  private shouldUseAgenticDispatch(packet: JobPacket): boolean {
    const cfg = this.config.agenticDispatch;
    if (!cfg?.enabled) return false;
    // Env can only force OFF (config is the source of truth — mirrors KINGDOM_NO_LESSONS).
    if (process.env.KINGDOM_AGENTIC_DISPATCH === '0') return false;
    if (packet.output_format !== 'unified-diff') return false;
    if (!this.config.worktreeManager || !this.config.applyEdit || !this.config.capabilitiesResolver) return false;
    if (this.config.capabilitiesResolver(packet.model_id)?.tool_use !== true) return false;
    if (!dispatcherIsGitRepo(this.config.assemblyOptions.projectPath)) return false;
    return true;
  }

  /** Run the *land* critical section under the integration merge gate (if wired). */
  private runLandExclusive<T>(fn: () => Promise<T>): Promise<T> {
    return this.config.integrationGate ? this.config.integrationGate.runExclusive(fn) : fn();
  }

  /**
   * PHASE5 (§4): agentic analogue of {@link failAppliedDiff}. Same DB effects
   * (setFailed, transitionTaskToFailed, healer incident, retryOrEscalate) but the
   * rollback is implicit — nothing on the integration branch was touched, so the
   * worktree is simply discarded (in the `finally` of executeAgenticJob). INV-1
   * holds on every call.
   */
  private failAgentic(
    job: Job,
    task: TaskGraphNode,
    stage: string,
    output: string,
    feedbackHead: string,
    symptoms: Record<string, unknown>,
    severity: 'medium' | 'high' = 'medium',
    failureType: FailureType = 'invalid-output',
    taskFailedStatus: TaskStatus = 'failed-review',
  ): void {
    this.deleteCheckpoint(job.id, task.id);

    if (this.config.verbose) {
      console.log(`[Dispatcher] 🧹 [agentic ${stage}] Discarding worktree for job ${job.id} (integration untouched)`);
    }

    this.healer?.({
      task_id: task.id,
      job_id: job.id,
      severity,
      failure_type: failureType,
      symptoms: { ...symptoms, stage, agentic: true },
      context_summary: `Agentic ${stage} failed for "${task.title}" — change discarded, integration branch untouched.`,
    });

    this.jobRepo.setFailed(job.id, failureType);
    this.transitionTaskToFailed(job.task_id, taskFailedStatus);
    this.retryOrEscalate(task, [feedbackHead, output].filter(Boolean));
  }

  /**
   * PHASE5 (§4): execute a tool-capable coding job as a read→edit→run→self-correct
   * agentic loop inside an isolated git worktree, merging back onto the integration
   * branch ONLY after review + compile + tests + a clean merge all pass.
   *
   * INV-1: the integration HEAD captured at open() (== session.baseSha) is the
   * branch's value on EVERY non-success exit (empty diff, review reject, gate fail,
   * merge conflict, cancellation, crash). The change lands iff the full gauntlet
   * passes and the merge is clean.
   */
  private async executeAgenticJob(
    job: Job,
    task: TaskGraphNode,
    provider: ProviderAdapter,
    packet: JobPacket,
    caps: ModelCapabilities,
  ): Promise<void> {
    const mgr = this.config.worktreeManager!;
    const cfg = this.config.agenticDispatch!;
    let session: WorktreeSessionLike | undefined;

    try {
      // ── open ── capture H0 = integration HEAD (the INV-1 anchor == baseSha).
      session = mgr.openSession(job.id, { linkNodeModules: cfg.link_node_modules ?? true });
      this.worktreeRepo.open({
        jobId: job.id, branch: session.branch, worktreePath: session.path,
        integrationBranch: session.integrationBranch, baseSha: session.baseSha,
      });
      this.scribe?.({
        type: 'agentic_session_open', agentId: task.assigned_tier, jobId: job.id, taskId: task.id,
        details: { branch: session.branch, base_sha: session.baseSha, worktree: session.path },
      });

      if (this.cancelJobIfRequested(job, task, 'agentic-before-loop')) return;

      // ── agentic loop (cancellable; edits land INSIDE session.path) ──
      const commandPolicy: CommandPolicy = { validationCommand: this.config.validationCommand, timeoutMs: 30_000 };
      const sess = session;
      const loopResult = await this.runWithCancellation(job, task, 'agentic-loop', (signal) =>
        runAgenticLoop(provider, packet, {
          capabilities: caps,
          workspace: sess.path,
          applyEdit: this.config.applyEdit!,
          maxIterations: cfg.max_iterations ?? 8,
          commandPolicy,
          signal,
          verbose: this.config.verbose,
        }),
      );
      if (!loopResult) return; // cancelled — cancelJobIfRequested already fired; finally discards

      this.scribe?.({
        type: 'model_invocation', agentId: task.assigned_tier, jobId: job.id, taskId: task.id,
        details: { model: packet.model_id, tokens: loopResult.tokens_used, finish_reason: loopResult.finish_reason, agentic: true },
      });

      // Durable step output (resume/exactly-once): write the result file.
      mkdirSync(dirname(packet.result_path), { recursive: true });
      writeFileSync(packet.result_path, JSON.stringify({
        job_id: job.id, task_id: job.task_id, model: packet.model_id, output_format: packet.output_format,
        content: loopResult.content, applied_files: loopResult.applied_files ?? [],
        tokens_used: loopResult.tokens_used, finish_reason: loopResult.finish_reason, agentic: true,
        completed_at: new Date().toISOString(),
      }, null, 2), 'utf-8');

      if (this.cancelJobIfRequested(job, task, 'agentic-after-loop')) return;

      // ── propose ── compute the resulting diff (working tree vs base).
      const diff = session.diff();
      if (!diff.trim()) {
        this.failAgentic(job, task, 'empty-diff', '',
          'The agentic loop produced no change to the workspace. Inspect the code and make the required edits with apply_edit.',
          { applied_files: loopResult.applied_files ?? [], finish_reason: loopResult.finish_reason });
        return;
      }

      // ── review ── grade the ACTUAL agent change against the worktree base.
      if (this.reviewEngine) {
        if (this.cancelJobIfRequested(job, task, 'agentic-before-review')) return;
        const reviewerModel = this.getModelForTier(task.reviewer_tier ?? 'knight');
        const reviewCtx: ReviewContext = {
          job,
          diffText: diff,
          allowedFiles: packet.allowed_files,
          acceptanceCriteria: packet.acceptance_criteria,
          reviewerModel,
          skipCriteriaCheck: false,
          projectPath: session.path,
          allowEmptyScope: packet.scope_mode === 'greenfield',
          timeout_ms: this.getTimeoutForTier(task.reviewer_tier ?? 'judge') * 1000,
          verificationEvidence: task.verification?.test_command
            ? { test_command: task.verification.test_command, probe: task.verification.probe }
            : undefined,
        };
        const reviewDecision = await this.runWithCancellation(job, task, 'agentic-review', (signal) =>
          this.reviewEngine!.review({ ...reviewCtx, abortSignal: signal }));
        if (!reviewDecision) return;

        this.scribe?.({
          type: 'review_decision', agentId: 'judge', jobId: job.id, taskId: task.id,
          details: { verdict: reviewDecision.decision, scope: reviewDecision.scope_check, format: reviewDecision.format_check, security: reviewDecision.security_check, criteria: reviewDecision.criteria_check, agentic: true },
        });
        if (this.cancelJobIfRequested(job, task, 'agentic-after-review')) return;

        if (reviewDecision.decision === 'rejected') {
          this.failAgentic(job, task, 'review-rejection',
            (reviewDecision.rejection_reasons ?? []).join('\n'),
            `Judge rejected the agentic change for "${task.title}": ${reviewDecision.rejection_reasons?.join('; ')}`,
            { rejection_reasons: reviewDecision.rejection_reasons, scope_check: reviewDecision.scope_check, format_check: reviewDecision.format_check, security_check: reviewDecision.security_check },
            'medium', 'review-rejection');
          return;
        }
      }

      // ── gates (run INSIDE the worktree; node_modules junctioned) ──
      if (this.cancelJobIfRequested(job, task, 'agentic-before-validation')) return;
      if (this.config.validationCommand) {
        const r = session.run(this.config.validationCommand, { timeoutMs: 30_000 });
        if (r.code !== 0) {
          const out = [r.stdout, r.stderr].join('\n').trim().slice(0, 600) || 'Compilation failed (no output captured).';
          this.failAgentic(job, task, 'validation', out,
            'Post-edit compilation check failed in the isolated worktree — the change introduced a build error.',
            { validation_output: out });
          return;
        }
        if (this.config.verbose) console.log('[Dispatcher] ✓ [agentic validation] passed in worktree');
      }

      if (this.cancelJobIfRequested(job, task, 'agentic-after-validation')) return;
      if (task.verification?.test_command) {
        const r = session.run(task.verification.test_command, { timeoutMs: 30_000 });
        if (r.code !== 0) {
          const out = [r.stdout, r.stderr].join('\n').trim().slice(0, 800) || 'Verification gate exited non-zero with no output.';
          this.failAgentic(job, task, 'verification-gate', out,
            `Per-task verification gate failed — running "${task.verification.test_command}" exited non-zero in the worktree.`,
            { verification_command: task.verification.test_command, verification_output: out }, 'high');
          return;
        }
        if (task.verification.probe) {
          const pr = session.run(task.verification.probe, { timeoutMs: 20_000 });
          if (pr.code !== 0) {
            const out = [pr.stdout, pr.stderr].join('\n').trim().slice(0, 800) || 'Verification probe exited non-zero with no output.';
            this.failAgentic(job, task, 'verification-gate', out,
              `Per-task verification probe failed — running "${task.verification.probe}" exited non-zero in the worktree.`,
              { verification_probe: task.verification.probe, verification_output: out }, 'high');
            return;
          }
        }
      }

      if (this.config.behavioralProbes?.length) {
        for (const probe of this.config.behavioralProbes) {
          if (this.cancelJobIfRequested(job, task, 'agentic-before-probe')) return;
          const r = session.run(probe, { timeoutMs: 20_000 });
          if (r.code !== 0) {
            const out = [`$ ${probe}`, r.stdout, r.stderr].join('\n').trim().slice(0, 800) || `Probe exited non-zero: ${probe}`;
            this.failAgentic(job, task, 'probe', out,
              `Behavioural probe failed — after the agentic edit, running "${probe}" exited non-zero in the worktree.`,
              { probe, probe_output: out });
            return;
          }
        }
      }

      if (this.cancelJobIfRequested(job, task, 'agentic-before-land')) return;

      // ── land (exclusive) ── commit on the job branch, merge back + post-merge
      // re-validate under the gate. Post-merge validation catches a textually-clean
      // but semantically-broken merge; on failure the merge commit is reverted
      // (reset --hard to the pre-merge HEAD), restoring INV-1.
      const changedFiles = session.changedFiles();
      const sessForLand = session;
      const mgrForLand = mgr;
      const projectPath = this.config.assemblyOptions.projectPath;
      const postMergeValidation = (cfg.post_merge_validation ?? true) && !!this.config.validationCommand;
      const landed = await this.runLandExclusive(async () => {
        if (!sessForLand.commit(`job ${job.id}: agentic change`)) {
          return { ok: false as const, reason: 'empty-commit' as const };
        }
        this.worktreeRepo.setMerging(job.id);
        const preMergeHead = mgrForLand.integrationHead();
        const merge = sessForLand.mergeBack();
        if (!merge.success) {
          return { ok: false as const, reason: 'merge-conflict' as const, merge };
        }
        // Post-merge re-validation on the integration branch working tree.
        if (postMergeValidation) {
          try {
            execSync(this.config.validationCommand!, { cwd: projectPath, timeout: 30_000, stdio: ['ignore', 'pipe', 'pipe'] });
          } catch (pmErr) {
            const e = pmErr as { stdout?: Buffer; stderr?: Buffer };
            const out = [e.stdout?.toString('utf-8') ?? '', e.stderr?.toString('utf-8') ?? ''].join('\n').trim().slice(0, 600)
              || 'Post-merge validation failed (no output captured).';
            mgrForLand.resetIntegrationTo(preMergeHead); // revert this job's merge only — INV-1 restored
            return { ok: false as const, reason: 'post-merge-validation' as const, output: out };
          }
        }
        this.worktreeRepo.setMerged(job.id, merge.mergedSha!);
        return { ok: true as const, mergedSha: merge.mergedSha! };
      });

      if (!landed.ok) {
        if (landed.reason === 'merge-conflict') {
          this.failAgentic(job, task, 'merge-conflict',
            (landed.merge?.feedback ?? []).join('\n'),
            'Merge-back into the integration branch conflicted — another job changed the same lines. Retrying will re-base on the latest integration HEAD.',
            { conflicting_files: landed.merge?.conflictingFiles ?? [] }, 'high');
        } else if (landed.reason === 'post-merge-validation') {
          this.failAgentic(job, task, 'post-merge-validation', landed.output ?? '',
            'The change merged cleanly but failed validation on the integration branch — the merge was reverted.',
            { post_merge_output: landed.output ?? '' }, 'high');
        } else {
          this.failAgentic(job, task, 'empty-diff', '',
            'Nothing to commit inside the isolated worktree.', {});
        }
        return;
      }

      // ── success — the ONLY path that advances integration HEAD ──
      this.jobRepo.setCompleted(job.id, packet.result_path, loopResult.tokens_used);
      this.taskRepo.tryTransition(job.task_id, ['stalled'], 'running', 'recover-stalled', 'sentinel');
      const taskCompleted = this.taskRepo.tryTransition(job.task_id, ['running', 'streaming'], 'completed', 'job completed', task.assigned_tier);
      if (changedFiles.length > 0 && taskCompleted) {
        this.writeCheckpoint(job, task, changedFiles);
      }
      this.scribeFileChange?.('modified', changedFiles, task.title);
      this.scribeCrypt?.(task.id, task.title, true, `${loopResult.tokens_used} tokens used (agentic)`);
      this.scribe?.({
        type: 'task_transition', agentId: task.assigned_tier, taskId: task.id,
        details: { from: 'running', to: 'completed', tokens: loopResult.tokens_used, agentic: true, merged_sha: landed.mergedSha },
      });
      if (this.config.verbose) {
        console.log(`[Dispatcher] ✅ [${task.assigned_tier}] Agentic job ${job.id} merged @ ${landed.mergedSha.slice(0, 8)} — ${task.title.slice(0, 50)}`);
      }
    } catch (err) {
      if (err instanceof DispatcherCancellationError || this.cancelJobIfRequested(job, task, 'agentic-error-handler')) return;
      const message = (err as Error).message;
      this.jobRepo.setFailed(job.id, 'runtime-crash');
      this.transitionTaskToFailed(job.task_id, 'failed-runtime-crash');
      this.scribe?.({ type: 'incident', agentId: 'sentinel', jobId: job.id, taskId: job.task_id, details: { error: message, failure_type: 'runtime-crash', agentic: true } });
      this.healer?.({
        task_id: job.task_id, job_id: job.id, severity: 'high', failure_type: 'runtime-crash',
        symptoms: { error: message, agentic: true },
        context_summary: `Agentic runtime crash in job ${job.id}: ${message}`,
      });
      if (this.config.verbose) console.error(`[Dispatcher] ❌ [agentic ${job.id}] Failed: ${message}`);
      const freshTask = this.taskRepo.getById(job.task_id);
      if (freshTask) this.retryOrEscalate(freshTask, [`Agentic runtime crash: ${message}`]);
    } finally {
      // Best-effort throwaway cleanup. On success the branch was merged; on every
      // failure/cancel/crash the worktree is removed and the integration branch is
      // left exactly at its open()-time HEAD. Idempotent.
      if (session) {
        session.discard();
        const row = this.worktreeRepo.get(job.id);
        if (row && row.status !== 'merged' && row.status !== 'discarded') {
          this.worktreeRepo.setDiscarded(job.id);
        }
      }
    }
  }

  // PHASE3 (P3.4): per-task consecutive same-root-cause streak counters.
  private bumpStuckStreak(taskId: string): number {
    const next = (this.stuckStreaks.get(taskId) ?? 0) + 1;
    this.stuckStreaks.set(taskId, next);
    return next;
  }
  private resetStuckStreak(taskId: string): number {
    this.stuckStreaks.set(taskId, 0);
    return 0;
  }

  /**
   * Retry a failed task at the same tier, or escalate to a higher tier if retries exhausted.
   * Flow: failed-* → retrying → queued (new job created in orchestration loop)
   */
  private retryOrEscalate(task: TaskGraphNode, feedbackReasons: string[]): void {
    const maxRetries = this.config.maxRetriesPerTier ?? 2;
    const retryCount = this.taskRepo.incrementRetry(task.id);

    // PHASE3 (P3.4): semantic loop-breaking. Compute a normalized ROOT-CAUSE
    // signature for this failure, compare it to the previous attempt's signature
    // (persisted on the prior job), and count how many consecutive attempts share
    // the same cause. The lexical overlap check is the fallback when no prior
    // signature exists.
    const currentSignature = computeFailureSignature(feedbackReasons);
    const recentJobs = this.jobRepo.getByTask(task.id); // DESC order (most recent first)

    // Read the most recent prior failure signature straight from the column
    // (mapRow doesn't surface it). Tolerant of pre-026 DBs that lack the column.
    let priorSignature: string | undefined;
    try {
      const row = this.db
        .prepare("SELECT failure_signature FROM jobs WHERE task_id = ? AND failure_signature IS NOT NULL ORDER BY created_at DESC LIMIT 1")
        .get(task.id) as { failure_signature?: string } | undefined;
      priorSignature = row?.failure_signature ?? undefined;
    } catch { /* pre-026 DB: column absent */ }

    // Record this attempt's signature on the most recent failed job for this task.
    const latestFailed = recentJobs.find(j => j.status?.startsWith('failed') || j.failure_type);
    if (latestFailed) {
      try {
        this.db.prepare('UPDATE jobs SET failure_signature = ? WHERE id = ?').run(currentSignature, latestFailed.id);
      } catch { /* pre-026 DB: column absent — skip */ }
    }

    const previousFeedback = extractPreviousFeedback(task.description ?? '');
    const currentFeedback = feedbackReasons.map(r => r.trim().toLowerCase());
    const sameRootCause = priorSignature
      ? priorSignature === currentSignature
      : isFeedbackIdentical(previousFeedback, currentFeedback);
    const semanticallyStuck = sameRootCause;

    // Track the consecutive same-cause streak via the task's stored count.
    const stuckStreak = sameRootCause ? this.bumpStuckStreak(task.id) : this.resetStuckStreak(task.id);

    if (semanticallyStuck && this.config.verbose) {
      console.log(`[Dispatcher] 🔁 Semantic stuck detected for task ${task.id} (streak ${stuckStreak}) — same root cause repeated`);
    }

    // PHASE3 (P3.4): when stuck on the SAME root cause for >=2 attempts, escalate
    // the STRATEGY (hand to the healer to heal/decompose) rather than burning the
    // tier ladder — the healer can read files, run commands, or replan.
    if (stuckStreak >= 2) {
      if (this.config.verbose) {
        console.log(`[Dispatcher] 🧭 Strategy escalation for task ${task.id} — same root cause x${stuckStreak}; routing to healer`);
      }
      try { this.taskRepo.updateStatus(task.id, 'awaiting-healer'); } catch { /* already terminal */ }
      this.healer?.({
        task_id: task.id,
        job_id: latestFailed?.id ?? '',
        severity: 'high',
        failure_type: 'semantic-loop',
        symptoms: { signature: currentSignature, streak: stuckStreak, reasons: feedbackReasons },
        context_summary: `Task "${task.title}" repeated the same root-cause failure ${stuckStreak}× — strategy escalation (heal/decompose) required.`,
      });
      this.milestone?.({
        type: 'task_stuck',
        taskId: task.id,
        taskTitle: task.title,
        details: { reason: 'semantic-loop', signature: currentSignature, streak: stuckStreak, tier: task.assigned_tier },
      });
      return;
    }

    if (retryCount <= maxRetries && !semanticallyStuck) {
      // === RETRY at same tier ===
      if (this.config.verbose) {
        console.log(`[Dispatcher] 🔄 Retrying task ${task.id} (attempt ${retryCount}/${maxRetries}) at tier ${task.assigned_tier}`);
      }

      // Transition: failed-* → retrying
      this.taskRepo.updateStatus(task.id, 'retrying');

      // Store rejection feedback — replace any previous feedback section so the
      // description doesn't grow unboundedly across retries (Issue 10).
      const baseDesc = stripFeedbackSections(task.description ?? '');
      this.db.prepare(
        'UPDATE task_graph_nodes SET description = ? WHERE id = ?'
      ).run(
        baseDesc + `\n\n--- Feedback from previous attempt (attempt ${retryCount}) ---\n` +
        feedbackReasons.map(r => `- ${r}`).join('\n') +
        '\nPlease fix these issues in your next attempt.\n',
        task.id
      );

      // Transition: retrying → running, then create a new queued job.
      // We record the failed job as parent for retry lineage tracking.
      this.taskRepo.updateStatus(task.id, 'running');
      const model = this.getModelForTier(task.assigned_tier);
      const parentJob = this.jobRepo.getByTask(task.id)[0]; // most recent (DESC order)
      const newJob = this.jobRepo.create({
        task_id: task.id,
        model,
        token_estimate: task.token_budget_estimate || 4096,
        delegating_supervisor_id: 'sentinel',
        parent_job_id: parentJob?.id ?? null,
      });
      // Mark the parent job as superseded so the lineage chain is doubly-linked
      if (parentJob) this.jobRepo.markSuperseded(parentJob.id, newJob.id);

      this.scribe?.({ type: 'task_transition', agentId: 'healer', taskId: task.id, details: { action: 'retry', attempt: retryCount, tier: task.assigned_tier, new_job: newJob.id } });

    } else {
      // === ESCALATE to higher tier ===
      // Config-supplied path takes precedence; fall back to built-in default.
      const escalationPath = { ...DEFAULT_ESCALATION_PATH, ...this.config.escalationPath };
      const nextTier = escalationPath[task.assigned_tier];

      if (nextTier) {
        if (this.config.verbose) {
          console.log(`[Dispatcher] ⬆️ Escalating task ${task.id} from ${task.assigned_tier} → ${nextTier} (${retryCount} retries exhausted)`);
        }

        // Transition: failed-* → retrying
        this.taskRepo.updateStatus(task.id, 'retrying');

        // Update the assigned tier
        this.db.prepare(
          'UPDATE task_graph_nodes SET assigned_tier = ?, retry_count = 0, updated_at = ? WHERE id = ?'
        ).run(nextTier, new Date().toISOString(), task.id);

        // Append escalation context — strip old feedback first (Issue 10)
        const baseDescEsc = stripFeedbackSections(task.description ?? '');
        const escalationHeader = semanticallyStuck
          ? `Stuck: same failures repeated at ${task.assigned_tier} — escalating early after attempt ${retryCount}. Issues:\n`
          : `Previous tier failed after ${retryCount} attempts. Issues:\n`;
        this.db.prepare(
          'UPDATE task_graph_nodes SET description = ? WHERE id = ?'
        ).run(
          baseDescEsc +
          `\n\n--- Escalated from ${task.assigned_tier} to ${nextTier} ---\n` +
          escalationHeader +
          feedbackReasons.map(r => `- ${r}`).join('\n') +
          '\nYou are a more capable agent. Please produce a correct solution.\n',
          task.id
        );

        // Transition: retrying → running, create new job at new tier.
        // Record the failed job as parent so the escalation chain is traceable.
        this.taskRepo.updateStatus(task.id, 'running');
        const model = this.getModelForTier(nextTier);
        const parentJobEsc = this.jobRepo.getByTask(task.id)[0];
        const newJob = this.jobRepo.create({
          task_id: task.id,
          model,
          token_estimate: task.token_budget_estimate || 4096,
          delegating_supervisor_id: 'sentinel',
          parent_job_id: parentJobEsc?.id ?? null,
        });
        // Mark the escalated-from job as superseded for full lineage tracking
        if (parentJobEsc) this.jobRepo.markSuperseded(parentJobEsc.id, newJob.id);

        this.scribe?.({ type: 'task_transition', agentId: 'healer', taskId: task.id, details: { action: 'escalate', from_tier: task.assigned_tier, to_tier: nextTier, new_job: newJob.id } });

        this.milestone?.({
          type: 'escalation',
          taskId: task.id,
          taskTitle: task.title,
          details: { from_tier: task.assigned_tier, to_tier: nextTier, reasons: feedbackReasons, stuck_detected: semanticallyStuck },
        });

      } else {
        // No higher tier available — mark as awaiting healer (truly stuck)
        if (this.config.verbose) {
          console.log(`[Dispatcher] 🚫 Task ${task.id} exhausted all retries at ${task.assigned_tier} (no higher tier) — awaiting healer`);
        }
        this.taskRepo.updateStatus(task.id, 'awaiting-healer');
        this.scribe?.({ type: 'task_transition', agentId: 'healer', taskId: task.id, details: { action: 'exhausted', tier: task.assigned_tier, retries: retryCount } });

        this.milestone?.({
          type: 'task_stuck',
          taskId: task.id,
          taskTitle: task.title,
          details: { tier: task.assigned_tier, retries: retryCount, reasons: feedbackReasons },
        });
      }
    }
  }
}

function isDesignReviewObject(value: JsonObject): value is ParsedDesignReview & JsonObject {
  return typeof value.pass === 'boolean'
    && (value.feedback === undefined || typeof value.feedback === 'string');
}

/**
 * Extract feedback bullet points from the most recent "previous attempt" section
 * in a task description. Used for semantic stuck detection.
 */
function extractPreviousFeedback(description: string): string[] {
  const marker = '--- Feedback from previous attempt';
  const idx = description.indexOf(marker);
  if (idx === -1) return [];
  const section = description.slice(idx);
  return section
    .split('\n')
    .filter(line => line.startsWith('- '))
    .map(line => line.slice(2).trim().toLowerCase());
}

// PHASE3 (P3.4): the lexical isFeedbackIdentical now lives in
// verification/loop-detector.ts and is imported above (used as the fallback).

/**
 * Strip previous feedback/escalation sections from a task description so retries
 * only ever see the most recent feedback, not an ever-growing history (Issue 10).
 */
function stripFeedbackSections(description: string): string {
  // Remove everything from the first feedback/escalation marker onward
  const markers = [
    '\n\n--- Feedback from previous attempt',
    '\n\n--- Previous Attempt Feedback',
    '\n\n--- Escalated from ',
  ];
  let cut = description.length;
  for (const marker of markers) {
    const idx = description.indexOf(marker);
    if (idx !== -1 && idx < cut) cut = idx;
  }
  return description.slice(0, cut);
}
