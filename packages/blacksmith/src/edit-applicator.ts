/**
 * Programmatic structured-edit applicator (Phase 2 / P2.1).
 *
 * Applies an `{ path, old_string, new_string }` edit directly to a file on disk
 * by literal string replacement, eliminating the diff-string brittleness that
 * plagues the LLM-prose-diff path. The agentic Knight loop calls this when a
 * tool-using model requests an `apply_edit` tool call.
 *
 * Safety mirrors `applyDiff`:
 *  - writes `<file>.bak` with the pre-edit content before mutating (rollback point)
 *  - normalizes CRLF → LF so edits authored against LF files apply cleanly
 *  - empty `old_string` ⇒ create-new-file (content = new_string); fails if the file
 *    already exists and is non-empty (prevents the "prepend stub onto existing file"
 *    corruption class)
 *  - non-unique / not-found `old_string` is a hard failure (never a silent no-op)
 */

import { readFileSync, writeFileSync, renameSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';

export interface EditRequest {
  /** Workspace-relative path. */
  path: string;
  /** Exact text to replace. Empty string ⇒ create a new file. */
  old_string: string;
  /** Replacement text. */
  new_string: string;
}

export interface EditResult {
  success: boolean;
  /** Relative path actually written (when success). */
  appliedFile?: string;
  error?: string;
  /** True when the edit created a brand-new file. */
  created?: boolean;
}

function normalizeEol(text: string): string {
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

/** Count non-overlapping occurrences of `needle` in `haystack`. */
function countOccurrences(haystack: string, needle: string): number {
  if (needle.length === 0) return 0;
  let count = 0;
  let idx = haystack.indexOf(needle);
  while (idx !== -1) {
    count += 1;
    idx = haystack.indexOf(needle, idx + needle.length);
  }
  return count;
}

export function applyEdit(edit: EditRequest, baseDir: string): EditResult {
  const relativePath = (edit.path ?? '').replace(/^[ab]\//, '').replace(/\\/g, '/').replace(/^\.\//, '').trim();
  if (!relativePath) {
    return { success: false, error: 'apply_edit: empty path' };
  }
  if (relativePath.startsWith('/') || /^[A-Za-z]:\//.test(relativePath) || relativePath.split('/').some((p) => p === '..')) {
    return { success: false, error: `apply_edit: path escapes the workspace: ${edit.path}` };
  }

  const filePath = join(baseDir, relativePath);
  const oldString = normalizeEol(edit.old_string ?? '');
  const newString = normalizeEol(edit.new_string ?? '');
  const fileExists = existsSync(filePath);

  // Create-new-file case.
  if (oldString.length === 0) {
    if (fileExists) {
      const existing = normalizeEol(readFileSync(filePath, 'utf-8'));
      if (existing.trim().length > 0) {
        return {
          success: false,
          error: `apply_edit: file "${relativePath}" already exists and is non-empty — provide old_string to edit it`,
        };
      }
      writeFileSync(filePath + '.bak', existing, 'utf-8');
    } else {
      mkdirSync(dirname(filePath), { recursive: true });
    }
    // Atomic write: temp file + rename to prevent partial writes on crash.
    const tmpPath1 = filePath + '.kingdom-tmp';
    writeFileSync(tmpPath1, newString, 'utf-8');
    renameSync(tmpPath1, filePath);
    return { success: true, appliedFile: relativePath, created: !fileExists };
  }

  // Edit-existing-file case.
  if (!fileExists) {
    return { success: false, error: `apply_edit: file "${relativePath}" does not exist in the workspace` };
  }

  const original = normalizeEol(readFileSync(filePath, 'utf-8'));
  const occurrences = countOccurrences(original, oldString);
  if (occurrences === 0) {
    return { success: false, error: `apply_edit: old_string not found in "${relativePath}"` };
  }
  if (occurrences > 1) {
    return {
      success: false,
      error: `apply_edit: old_string occurs ${occurrences} times in "${relativePath}" — make it unique (add surrounding context)`,
    };
  }
  if (oldString === newString) {
    return { success: false, error: `apply_edit: old_string and new_string are identical — no-op` };
  }

  const patched = original.replace(oldString, newString);
  writeFileSync(filePath + '.bak', original, 'utf-8');
  // Atomic write: temp file + rename to prevent partial writes on crash.
  const tmpPath2 = filePath + '.kingdom-tmp';
  writeFileSync(tmpPath2, patched, 'utf-8');
  renameSync(tmpPath2, filePath);
  return { success: true, appliedFile: relativePath, created: false };
}
