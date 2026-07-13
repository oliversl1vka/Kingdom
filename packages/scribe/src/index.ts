export { Logger, type LogEntry, type EventType } from './logger.js';
export { CryptWriter, type CryptEntry } from './crypt-writer.js';
export { RetentionScheduler, type RetentionConfig } from './retention.js';
export { ScribeAgent, type ScribeAgentConfig, type RunStats } from './scribe-agent.js';
export {
  distill,
  distillGenerated,
  mirrorLessonsToDisk,
  appendRunIndex,
  type DistillResult,
  type DistillOptions,
  type GenerativeDistillResult,
  type GenerativeDistillOptions,
  type RunIndexLine,
} from './lesson-distiller.js';
