/**
 * Unified diff parser using jsdiff.
 * Parses unified diff text into structured patch objects.
 */

import { parsePatch, type StructuredPatch } from 'diff';

export interface ParsedPatchFile {
  oldFileName: string;
  newFileName: string;
  hunks: PatchHunk[];
}

export interface PatchHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: string[];
}

export function parseDiff(diffText: string): ParsedPatchFile[] {
  const patches = parsePatch(diffText);

  return patches.map((patch: StructuredPatch) => ({
    oldFileName: patch.oldFileName ?? '',
    newFileName: patch.newFileName ?? '',
    hunks: patch.hunks.map((hunk) => ({
      oldStart: hunk.oldStart,
      oldLines: hunk.oldLines,
      newStart: hunk.newStart,
      newLines: hunk.newLines,
      lines: hunk.lines,
    })),
  }));
}

export function extractModifiedFiles(diffText: string): string[] {
  const patches = parseDiff(diffText);
  const files = new Set<string>();

  for (const patch of patches) {
    const fileName = patch.newFileName.replace(/^[ab]\//, '');
    if (fileName) files.add(fileName);
  }

  return Array.from(files);
}

export function validateDiffFormat(diffText: string): { valid: boolean; error?: string } {
  try {
    const patches = parseDiff(diffText);
    if (patches.length === 0) {
      return { valid: false, error: 'No patches found in diff text' };
    }
    for (const patch of patches) {
      if (!patch.newFileName) {
        return { valid: false, error: 'Patch missing file name' };
      }
    }
    return { valid: true };
  } catch (error) {
    return { valid: false, error: error instanceof Error ? error.message : String(error) };
  }
}
