export { IncidentReporter } from './incident-reporter.js';
export { Diagnostician, type DiagnosticianOptions } from './diagnostician.js';
export {
  ActionExecutor,
  type ActionExecutorOptions,
  type RepairApplyDiff,
  type RepairVerifier,
  type WorktreeRepairResult,
} from './action-executor.js';
export { HealerWorker, type HealerWorkerOptions } from './healer-worker.js';
// PHASE3 (P3.3): execution-grounded agentic healer primitives.
export {
  runAgenticDiagnosis,
  isCommandWhitelisted,
  type AgenticHealerContext,
  type AgenticHealerOptions,
} from './agentic-healer.js';
// PHASE4 (P4.5): additive calibration helper. Not yet wired into the
// diagnostician (separate module so it survives Phase 3's rewrite).
export {
  computeCalibration,
  calibrateConfidence,
  type CalibrationStats,
} from './calibration.js';
