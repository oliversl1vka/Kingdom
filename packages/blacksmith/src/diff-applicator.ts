/**
 * Unified diff applicator using jsdiff.
 * Applies unified diff patches to files on disk.
 * Includes LLM-diff fixup: recalculates hunk line counts and relocates hunks
 * to their correct positions when models produce wrong line numbers.
 */

import { applyPatch, parsePatch, type StructuredPatch } from 'diff';
import { readFileSync, writeFileSync, renameSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';

export interface ApplyResult {
  success: boolean;
  appliedFiles: string[];
  failedFiles: string[];
  errors: string[];
}

/**
 * Fix hunk line counts in a unified diff.
 * LLMs often emit correct diff content but wrong numbers in @@ headers.
 */
function fixDiffLineCounts(diffText: string): string {
  const lines = diffText.split('\n');
  const out: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Match a standard hunk header: @@ -N,N +N,N @@
    const hunkMatch = line.match(/^@@\s+-(\d+)(?:,\d+)?\s+\+(\d+)(?:,\d+)?\s+@@(.*)$/);
    // Match a truncated header from LLMs: "@@ -267,6 +274" or "@@ -267 +274<trailing>"
    // (missing closing @@, missing second comma count). Capture any tail content
    // so we can treat it as the first body line (context).
    const truncatedMatch = !hunkMatch && line.match(/^@@\s+-(\d+)(?:,\d+)?\s+\+(\d+)(?:,\d+)?(\s.*)?$/);
    // Match a malformed hunk header from LLMs: @@ ... @@ or @@ <anything> @@
    const malformedMatch = !hunkMatch && !truncatedMatch && line.match(/^@@\s.*@@\s*$/);

    if (hunkMatch || truncatedMatch || malformedMatch) {
      let oldStart: number;
      let newStart: number;
      let trailing: string;
      let tailBody: string | null = null;

      if (hunkMatch) {
        oldStart = parseInt(hunkMatch[1], 10);
        newStart = parseInt(hunkMatch[2], 10);
        trailing = hunkMatch[3] || '';
      } else if (truncatedMatch) {
        oldStart = parseInt(truncatedMatch[1], 10);
        newStart = parseInt(truncatedMatch[2], 10);
        trailing = '';
        // Any trailing text on the header line is almost certainly the first
        // body line that the model crammed onto the same row.
        const tail = (truncatedMatch[3] ?? '').replace(/^\s+/, '');
        if (tail.length > 0) {
          // Treat as context line unless it already has a +/- prefix.
          tailBody = /^[+\- ]/.test(tail) ? tail : ' ' + tail;
        }
      } else {
        // Malformed header — use placeholder line 1; relocateHunks will fix position
        oldStart = 1;
        newStart = 1;
        trailing = '';
      }

      // Collect hunk body lines until next hunk header, file header, or end
      const hunkLines: string[] = [];
      if (tailBody !== null) hunkLines.push(tailBody);
      i++;
      while (i < lines.length) {
        const l = lines[i];
        // Stop at next hunk header or file header
        if (l.match(/^@@\s/) || l.startsWith('diff --git ') || l.startsWith('--- ') || l.startsWith('+++ ')) break;
        // Also stop at EOF marker (only the literal)
        if (l === '\\ No newline at end of file') {
          hunkLines.push(l);
          i++;
          continue;
        }
        hunkLines.push(l);
        i++;
      }

      // Count actual old lines (context + removed) and new lines (context + added)
      let oldLines = 0;
      let newLines = 0;
      for (const hl of hunkLines) {
        if (hl === '\\ No newline at end of file') continue;
        if (hl.startsWith('-')) { oldLines++; }
        else if (hl.startsWith('+')) { newLines++; }
        else { oldLines++; newLines++; } // context line (starts with ' ' or is just the line)
      }

      out.push(`@@ -${oldStart},${oldLines} +${newStart},${newLines} @@${trailing}`);
      out.push(...hunkLines);
    } else {
      out.push(line);
      i++;
    }
  }

  return out.join('\n');
}

/**
 * Relocate hunks in a parsed diff to their correct positions in the file.
 * LLMs produce diffs with wrong start line numbers. This finds where
 * the hunk content ACTUALLY appears and adjusts the line numbers.
 */
function relocateHunks(patch: StructuredPatch, fileLines: string[]): void {
  for (const hunk of patch.hunks) {
    // Extract the first few context/removed lines to search for
    const searchLines: string[] = [];
    for (const line of hunk.lines) {
      if (searchLines.length >= 5) break;
      if (line.startsWith('-') || line.startsWith(' ')) {
        searchLines.push(line.slice(1)); // Remove the diff prefix
      }
    }

    if (searchLines.length === 0) continue;

    // Search for these lines in the file (trimEnd for whitespace tolerance)
    const firstLine = searchLines[0].trimEnd();
    let bestOffset = -1;
    let bestScore = 0;

    for (let lineIdx = 0; lineIdx < fileLines.length; lineIdx++) {
      if (fileLines[lineIdx].trimEnd() === firstLine) {
        // Check how many subsequent lines match
        let score = 1;
        for (let j = 1; j < searchLines.length && lineIdx + j < fileLines.length; j++) {
          if (fileLines[lineIdx + j].trimEnd() === searchLines[j].trimEnd()) score++;
          else break;
        }
        if (score > bestScore) {
          bestScore = score;
          bestOffset = lineIdx + 1; // 1-indexed
        }
      }
    }

    if (bestOffset > 0 && bestOffset !== hunk.oldStart) {
      const delta = bestOffset - hunk.oldStart;
      hunk.oldStart = bestOffset;
      hunk.newStart += delta;
    }
  }
}

export function applyDiff(diffText: string, baseDir: string): ApplyResult {
  // Normalize line endings to LF – LLMs often emit \r\n diffs for LF-only files
  diffText = diffText.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  // Strip markdown code fences that LLMs wrap diffs in (```diff ... ``` or ``` ... ```)
  diffText = diffText.replace(/^```(?:diff)?\s*\n/gm, '').replace(/^```\s*$/gm, '').trim();

  // Fix hunk line counts that LLMs get wrong
  const fixedDiff = fixDiffLineCounts(diffText);

  // Use jsdiff's parsePatch which is strict about format
  let patches;
  try {
    patches = parsePatch(fixedDiff);
  } catch (e) {
    return {
      success: false,
      appliedFiles: [],
      failedFiles: [],
      errors: [`Failed to parse diff: ${e instanceof Error ? e.message : String(e)}`],
    };
  }

  // If the parser returned zero patches, record the target file name(s) extracted
  // from the raw diff so the dispatcher can surface a concrete failure rather
  // than silently flipping the job to completed.
  if (patches.length === 0) {
    const targets: string[] = [];
    for (const m of fixedDiff.matchAll(/^\+\+\+\s+([ab]\/)?([^\s\r\n]+)/gm)) {
      if (m[2]) targets.push(m[2]);
    }
    return {
      success: false,
      appliedFiles: [],
      failedFiles: targets.length > 0 ? targets : ['<unknown>'],
      errors: ['parsePatch returned no patches — diff headers/hunks are malformed'],
    };
  }

  const result: ApplyResult = {
    success: true,
    appliedFiles: [],
    failedFiles: [],
    errors: [],
  };

  for (const patch of patches) {
    const newFile = patch.newFileName || '';
    const relativePath = newFile.replace(/^[ab]\//, '').replace(/\\/g, '/').replace(/^\.\//, '').trim();
    if (!relativePath) continue;
    // Path-traversal guard: reject absolute paths, Windows drive letters, and .. segments.
    // Mirrors the sanitizeRel() pattern in edit-applicator.ts:60-62.
    if (relativePath.startsWith('/') || /^[A-Za-z]:\//.test(relativePath) || relativePath.split('/').some((p) => p === '..')) {
      result.success = false;
      result.failedFiles.push(relativePath);
      result.errors.push(`Path escapes workspace: ${relativePath}`);
      continue;
    }
    const filePath = join(baseDir, relativePath);

    try {
      // Read original file content or start empty for new files
      let original = '';
      if (existsSync(filePath)) {
        original = readFileSync(filePath, 'utf-8').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
        // Always overwrite .bak with the current state before every apply.
        // This ensures .bak reflects the state just before the most recent
        // attempt — enabling accurate rollback even after prior patches succeeded.
        writeFileSync(filePath + '.bak', original, 'utf-8');
      } else {
        // Create parent directory for new files
        mkdirSync(dirname(filePath), { recursive: true });
      }

      // Relocate hunks to correct positions by searching for context in file
      if (original) {
        const fileLines = original.split('\n');
        relocateHunks(patch, fileLines);
      }

      const patched = applyPatch(original, patch, {
        fuzzFactor: 5,
        compareLine: (_lineNumber: number, line: string, _operation: string, patchContent: string) =>
          (line ?? '').trimEnd() === (patchContent ?? '').trimEnd(),
      });

      if (patched === false) {
        result.success = false;
        result.failedFiles.push(relativePath);
        result.errors.push(`Failed to apply patch to ${relativePath}: hunks did not apply cleanly`);
        continue;
      }

      // Sanity check: if the patched output is byte-identical to the original
      // file, the diff was a no-op (or every hunk silently dropped). Treat as
      // failure so the dispatcher retries rather than marking the job complete.
      if (patched === original) {
        result.success = false;
        result.failedFiles.push(relativePath);
        result.errors.push(`Patch applied to ${relativePath} but file bytes are unchanged — likely a no-op diff`);
        continue;
      }

      // Atomic write: write to temp file then rename to prevent partial writes on crash.
      const tmpPath = filePath + '.kingdom-tmp';
      writeFileSync(tmpPath, patched, 'utf-8');
      renameSync(tmpPath, filePath);
      result.appliedFiles.push(relativePath);
    } catch (error) {
      result.success = false;
      result.failedFiles.push(relativePath);
      result.errors.push(`Error applying patch to ${relativePath}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return result;
}
