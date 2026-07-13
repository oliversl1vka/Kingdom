export { getDatabase, closeDatabase, getDatabaseForPath } from './db.js';
export { generateUlid } from './ulid.js';
export { getConfig, setConfig, resetConfig, configExists, getConfigPath, createDefaultConfig } from './config.js';
export * from './types.js';
export * from './errors.js';
export { ProjectRepository } from './repositories/project-repo.js';
export { ObjectiveRepository } from './repositories/objective-repo.js';
export { TaskRepository } from './repositories/task-repo.js';
export { JobRepository } from './repositories/job-repo.js';
export { transitionStatus, type TransitionResult } from './repositories/state-transition.js';
export { reconcile, type ReconcileResult, type ReconcileOptions } from './recovery/reconciler.js';
export { TaskDecomposer } from './task-graph/decomposer.js';
export { PLANNER_READ_TOOLS, emitTaskGraphSchema, type PlannerOptions, type RepoReader, type CapabilityLookup } from './task-graph/planner-tools.js';
export { JobPacketAssembler, buildScopePlan, derivePlannedFiles, normalizePlannedFilePath, type GroundedContext } from './job/packet-assembler.js';
export { HeartbeatWriter } from './worker/heartbeat-writer.js';
export { isValidTransition, getValidTransitions, isTerminalStatus, isFailedStatus, isActiveStatus, assertTransition } from './job/lifecycle.js';
export { JobDispatcher } from './job/dispatcher.js';
// PHASE5: agentic dispatch — integration merge gate + worktree ledger.
export { IntegrationGate } from './job/integration-gate.js';
export {
  WorktreeRepository,
  type WorktreeStatus,
  type JobWorktreeRow,
  type OpenWorktreeParams,
} from './repositories/worktree-repo.js';
export { spawnWorker, killWorker, hardKillWorker, killWorkerByPid, isPidAlive, getActiveWorkers, getWorkerCount } from './worker/spawner.js';
export { executeWorker, runAgenticLoop, classifyWorkerFailure, type AgenticOptions, type AgenticDriveOptions, type ApplyEditFn, type WorkerResult } from './worker/worker-main.js';
export { runSandboxedCommand, isCommandAllowed, type CommandPolicy } from './worker/command-sandbox.js';
export { ContextResolver, ContextIndexLifecycle, loadContextEngine, __setContextEngineForTests, type ContextEngine, type ContextSearchHit } from './context/index.js';
export { FileLockManager } from './locks/file-lock-manager.js';
export { cancelJob, cascadeCancel } from './job/cancellation.js';
export { ReviewRepository } from './repositories/review-repo.js';
export {
  LessonsRepository,
  type LessonUpsert,
  computeWinRate,
  DECAY_THRESHOLD,
  PROMOTE_THRESHOLD,
  MIN_OUTCOMES_FOR_DECAY,
  GENERATED_INJECT_THRESHOLD,
  GENERATED_SEED_CONFIDENCE,
  RULE_SEED_CONFIDENCE,
} from './repositories/lessons-repo.js';
export {
  buildLessonsBlock,
  buildLessonsBlockSync,
  selectRelevantLessons,
  cosineSimilarity,
  type EmbeddingProvider,
  type SelectedLesson,
  DEFAULT_MAX_LESSONS_BYTES,
  DEFAULT_MAX_PER_TIER,
  DEFAULT_INJECTION_TIERS,
} from './memory/lesson-injector.js';
export {
  sanitizeLessonTitle,
  sanitizeLessonBody,
  isLikelyInjection,
  LESSON_TITLE_MAX_CHARS,
  LESSON_BODY_MAX_CHARS,
} from './memory/sanitize.js';
export { ReviewEngine, type ReviewContext, type ReviewModelResolver } from './review/reviewer.js';
export { RetryManager } from './job/retry-manager.js';
// PHASE3 (P3.2 / P3.4): verification gate + semantic loop-breaking.
export { runVerificationGate, type VerificationGateResult, type VerificationGateOptions } from './verification/verification-gate.js';
export { computeFailureSignature, signatureHash, isFeedbackIdentical, isSemanticallyStuck, type LoopDetectorDeps } from './verification/loop-detector.js';
export { encryptCredential, decryptCredential, loadCredentialStore, saveCredentialStore, setProviderCredential, getProviderCredential } from './security/credential-store.js';
export { withDryRun, withDryRunAsync, withDryRunTransaction } from './dry-run.js';
export { onJobCompletion, onReviewRejection, onHealerDiagnosis } from './worker/memory-hooks.js';
export { MCPClient, type MCPClientConfig, type MCPCallResult } from './mcp/client.js';
export { OrchestrationLoop, type OrchestrationConfig } from './orchestration-loop.js';
export { createGitHubIssue, type GitHubIssueParams, type GitHubIssueResult } from './mcp/github-issues.js';
export { createGitHubPR, type GitHubPRParams, type GitHubPRResult } from './mcp/github-prs.js';
export { isAllowedMethod, enforceBoundary, createBoundaryEnforcedClient, getViolations, clearViolations } from './mcp/boundary.js';
