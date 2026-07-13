import Database from 'better-sqlite3';
import { existsSync, lstatSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { detectLanguage } from './language.js';
import { shouldIndexPath } from './ignore-rules.js';
import { normalizeWorkspaceRelativePath, toPosixPath } from './path-utils.js';
import { sha256Text } from './hashing.js';
import type { ScanSummary, ScannedFile } from './types.js';

export interface CandidateFile {
  path: string;
  absolutePath: string;
  diskMtimeMs: number;
  sizeBytes: number;
}

export interface ScannerOptions {
  rootPath?: string;
  includeGenerated?: boolean;
  orchestrationDbPath?: string;
}

export function listIndexableFiles(options: ScannerOptions = {}): CandidateFile[] {
  const rootPath = resolve(options.rootPath ?? process.cwd());
  const files: CandidateFile[] = [];

  function walk(directory: string): void {
    let entries: string[];
    try {
      entries = readdirSync(directory);
    } catch {
      return;
    }

    for (const entry of entries) {
      const absolutePath = join(directory, entry);
      let stat;
      try {
        stat = lstatSync(absolutePath);
      } catch {
        continue;
      }
      if (stat.isSymbolicLink()) continue;

      const rel = normalizeWorkspaceRelativePath(absolutePath, rootPath);
      if (rel === null || rel === '') continue;

      if (stat.isDirectory()) {
        const decision = shouldIndexPath(`${rel}/__probe__.ts`, options.includeGenerated ?? false);
        if (!decision.included && shouldSkipDirectory(rel, options.includeGenerated ?? false)) {
          continue;
        }
        walk(absolutePath);
        continue;
      }

      if (!stat.isFile()) continue;
      if (!shouldIndexPath(rel, options.includeGenerated ?? false).included) continue;
      files.push({
        path: rel,
        absolutePath,
        diskMtimeMs: Math.trunc(stat.mtimeMs),
        sizeBytes: stat.size,
      });
    }
  }

  walk(rootPath);
  files.sort((a, b) => a.path.localeCompare(b.path));
  return files;
}

export function scanProjectFiles(options: ScannerOptions = {}): ScanSummary {
  const rootPath = resolve(options.rootPath ?? process.cwd());
  const lockedPaths = loadLockedPaths(rootPath, options.orchestrationDbPath);
  const candidates = listIndexableFiles({ ...options, rootPath });
  const files: ScannedFile[] = [];
  const errors: string[] = [];
  let skippedLocked = 0;
  let skippedUnstable = 0;

  for (const candidate of candidates) {
    if (lockedPaths.has(candidate.path.toLowerCase())) {
      skippedLocked += 1;
      continue;
    }

    const read = readStableFile(candidate.absolutePath);
    if (!read.ok) {
      if (read.reason === 'unstable') {
        skippedUnstable += 1;
      } else {
        errors.push(`${candidate.path}: ${read.reason}`);
      }
      continue;
    }

    files.push({
      path: candidate.path,
      absolutePath: candidate.absolutePath,
      language: detectLanguage(candidate.path),
      sha256: sha256Text(read.content),
      diskMtimeMs: read.diskMtimeMs,
      sizeBytes: read.sizeBytes,
      lineCount: countLines(read.content),
      content: read.content,
    });
  }

  return {
    rootPath,
    files,
    filesTotal: candidates.length,
    skippedExcluded: 0,
    skippedLocked,
    skippedUnstable,
    errors,
  };
}

function shouldSkipDirectory(posixPath: string, includeGenerated: boolean): boolean {
  const lower = posixPath.toLowerCase();
  if (includeGenerated) return false;
  return (
    lower === 'node_modules' ||
    lower.endsWith('/node_modules') ||
    lower === '.git' ||
    lower.endsWith('/.git') ||
    lower === '.venv' ||
    lower.endsWith('/.venv') ||
    lower === 'coverage' ||
    lower.endsWith('/coverage') ||
    lower === 'kingdom/results' ||
    lower.startsWith('kingdom/results/') ||
    lower === 'kingdom/memory' ||
    lower.startsWith('kingdom/memory/') ||
    lower === 'memory' ||
    lower.startsWith('memory/') ||
    lower.endsWith('/dist') ||
    lower.endsWith('/build')
  );
}

function readStableFile(filePath: string):
  | { ok: true; content: string; diskMtimeMs: number; sizeBytes: number }
  | { ok: false; reason: string } {
  try {
    const before = statSync(filePath);
    const content = readFileSync(filePath, 'utf8');
    const after = statSync(filePath);
    if (Math.trunc(before.mtimeMs) !== Math.trunc(after.mtimeMs) || before.size !== after.size) {
      return { ok: false, reason: 'unstable' };
    }
    return {
      ok: true,
      content,
      diskMtimeMs: Math.trunc(after.mtimeMs),
      sizeBytes: after.size,
    };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) };
  }
}

function countLines(content: string): number {
  if (content.length === 0) return 0;
  return content.split(/\r?\n/).length;
}

function loadLockedPaths(rootPath: string, orchestrationDbPath?: string): Set<string> {
  const locked = new Set<string>();
  if (!orchestrationDbPath || !existsSync(orchestrationDbPath)) return locked;

  let database: Database.Database | null = null;
  try {
    database = new Database(orchestrationDbPath, { readonly: true, fileMustExist: true });
    const table = database
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='file_locks'")
      .get();
    if (!table) return locked;
    const rows = database.prepare('SELECT file_path FROM file_locks').all() as Array<{ file_path: string }>;
    for (const row of rows) {
      const normalized = normalizeWorkspaceRelativePath(row.file_path, rootPath) ?? toPosixPath(row.file_path);
      locked.add(normalized.toLowerCase());
    }
  } catch {
    return locked;
  } finally {
    database?.close();
  }
  return locked;
}
