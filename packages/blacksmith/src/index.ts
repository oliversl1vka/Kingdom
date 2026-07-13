export { parseDiff, extractModifiedFiles, validateDiffFormat } from './diff-parser.js';
export { applyDiff } from './diff-applicator.js';
export {
  WorktreeManager,
  WorktreeSession,
  isGitRepo,
  type WorktreeApplyResult,
  type WorktreeOptions,
  type WorktreeRunResult,
  type MergeBackResult,
  type OpenSessionOptions,
} from './worktree-manager.js';
export { applyEdit, type EditRequest, type EditResult } from './edit-applicator.js';
