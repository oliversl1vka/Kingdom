import { extname } from 'node:path';
import { isSupportedTextPath } from './language.js';
import { pathContainsSegment } from './path-utils.js';

const GENERATED_SEGMENTS = new Set(['node_modules', '.git', '.venv', 'coverage', '.next', '.turbo']);
const GENERATED_NAMES = new Set(['dist', 'build']);
const RUNTIME_PREFIXES = ['kingdom/results/', 'kingdom/memory/', 'memory/'];
const DATABASE_PREFIXES = ['kingdom/kingdom.db', 'kingdom/context.db'];

export interface IgnoreDecision {
  included: boolean;
  reason?: string;
}

export function shouldIndexPath(posixPath: string, includeGenerated = false): IgnoreDecision {
  const lower = posixPath.toLowerCase();
  const baseName = lower.split('/').at(-1) ?? lower;

  if (!includeGenerated) {
    for (const segment of GENERATED_SEGMENTS) {
      if (pathContainsSegment(lower, segment)) {
        return { included: false, reason: `generated segment ${segment}` };
      }
    }
    if (lower.split('/').some((part) => GENERATED_NAMES.has(part))) {
      return { included: false, reason: 'generated output' };
    }
  }

  if (RUNTIME_PREFIXES.some((prefix) => lower.startsWith(prefix))) {
    return { included: false, reason: 'runtime state' };
  }
  if (DATABASE_PREFIXES.some((prefix) => lower.startsWith(prefix))) {
    return { included: false, reason: 'database' };
  }
  if (baseName.endsWith('.bak') || baseName.endsWith('.log') || baseName.endsWith('.tsbuildinfo')) {
    return { included: false, reason: 'backup or log' };
  }
  if (baseName === 'pnpm-lock.yaml') {
    return { included: false, reason: 'lockfile' };
  }
  if (!isSupportedTextPath(posixPath)) {
    return { included: false, reason: `unsupported extension ${extname(posixPath) || '(none)'}` };
  }

  if (lower.startsWith('packages/')) return { included: true };
  if (lower.startsWith('tests/')) return { included: true };
  if (lower.startsWith('docs/')) return { included: true };
  if (lower.startsWith('scripts/')) return { included: true };
  if (lower.startsWith('kingdom/agents/')) return { included: true };
  if (lower.startsWith('.github/')) return { included: true };
  if (!lower.includes('/')) return { included: true };

  return { included: false, reason: 'outside default include roots' };
}
