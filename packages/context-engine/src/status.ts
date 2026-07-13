import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { defaultContextDbPath, openContextDatabaseForPath } from './db.js';
import { getContextProject } from './project.js';
import { listIndexableFiles } from './scanner.js';
import type { ContextStatusOptions, ContextStatusResult } from './types.js';

interface CountRow { n: number }

export function getContextStatus(options: ContextStatusOptions = {}): ContextStatusResult {
  const dbPath = options.dbPath ?? defaultContextDbPath(process.cwd());
  if (!existsSync(dbPath)) return emptyStatus('No context DB exists yet');
  const database = openContextDatabaseForPath(dbPath);
  try {
    const rootPath = options.rootPath ? resolve(options.rootPath) : process.cwd();
    const project = getContextProject(database, { projectId: options.projectId, rootPath });
    if (!project) return emptyStatus('No context project index exists for this workspace');

    const diskFiles = listIndexableFiles({ rootPath: project.rootPath, includeGenerated: options.includeGenerated });
    const diskByPath = new Map(diskFiles.map((file) => [file.path, file]));
    const dbFiles = database
      .prepare('SELECT path, disk_mtime_ms, size_bytes, deleted_at FROM context_files WHERE project_id = ?')
      .all(project.id) as Array<{ path: string; disk_mtime_ms: number; size_bytes: number; deleted_at: string | null }>;
    const activeDbFiles = dbFiles.filter((file) => file.deleted_at === null);
    const activePaths = new Set(activeDbFiles.map((file) => file.path));

    const staleFileCount = activeDbFiles.filter((file) => {
      const disk = diskByPath.get(file.path);
      return disk && (Math.abs(disk.diskMtimeMs - file.disk_mtime_ms) > 100 || disk.sizeBytes !== file.size_bytes);
    }).length;
    const missingFileCount = activeDbFiles.filter((file) => !diskByPath.has(file.path)).length;
    const newFileCount = diskFiles.filter((file) => !activePaths.has(file.path)).length;
    const chunkCount = count(database, 'SELECT COUNT(*) n FROM context_chunks c JOIN context_files f ON f.id = c.file_id WHERE c.project_id = ? AND f.deleted_at IS NULL', project.id);
    const ftsRowCount = count(database, 'SELECT COUNT(*) n FROM context_chunks_fts WHERE project_id = ?', project.id);
    const missingFtsRows = count(
      database,
      `SELECT COUNT(*) n
       FROM context_chunks c
       JOIN context_files f ON f.id = c.file_id
       LEFT JOIN context_chunks_fts fts ON fts.chunk_id = c.id
       WHERE c.project_id = ? AND f.deleted_at IS NULL AND fts.chunk_id IS NULL`,
      project.id,
    );
    const duplicateFtsRows = count(
      database,
      `SELECT COUNT(*) n FROM (
        SELECT chunk_id, COUNT(*) row_count
        FROM context_chunks_fts
        WHERE project_id = ?
        GROUP BY chunk_id
        HAVING row_count > 1
      )`,
      project.id,
    );
    const ftsDriftCount = Math.abs(chunkCount - ftsRowCount) + missingFtsRows + duplicateFtsRows;
    const lastJob = database
      .prepare(
        `SELECT id, status, started_at, completed_at, files_skipped_locked, files_skipped_unstable
         FROM context_index_jobs WHERE project_id = ? ORDER BY started_at DESC LIMIT 1`,
      )
      .get(project.id) as
      | { id: string; status: string; started_at: string; completed_at: string | null; files_skipped_locked: number; files_skipped_unstable: number }
      | undefined;
    const warnings: string[] = [];
    if (staleFileCount > 0 || newFileCount > 0 || missingFileCount > 0) warnings.push('Index is stale');
    if (ftsDriftCount > 0) warnings.push('FTS drift detected; run kingdom context repair --fts-only');

    return {
      indexed: true,
      projectId: project.id,
      rootPath: project.rootPath,
      fileCount: activeDbFiles.length,
      symbolCount: count(database, 'SELECT COUNT(*) n FROM context_symbols WHERE project_id = ?', project.id),
      chunkCount,
      deletedFileCount: dbFiles.length - activeDbFiles.length,
      staleFileCount,
      newFileCount,
      missingFileCount,
      lastIndexJob: lastJob
        ? {
            id: lastJob.id,
            status: lastJob.status,
            startedAt: lastJob.started_at,
            completedAt: lastJob.completed_at ?? undefined,
            filesSkippedLocked: lastJob.files_skipped_locked,
            filesSkippedUnstable: lastJob.files_skipped_unstable,
          }
        : undefined,
      ftsRowCount,
      ftsReady: ftsDriftCount === 0,
      ftsDriftCount,
      embeddingStatus: 'schema-reserved',
      warnings,
    };
  } finally {
    database.close();
  }
}

function emptyStatus(warning: string): ContextStatusResult {
  return {
    indexed: false,
    fileCount: 0,
    symbolCount: 0,
    chunkCount: 0,
    deletedFileCount: 0,
    staleFileCount: 0,
    newFileCount: 0,
    missingFileCount: 0,
    ftsRowCount: 0,
    ftsReady: false,
    ftsDriftCount: 0,
    embeddingStatus: 'disabled',
    warnings: [warning],
  };
}

function count(database: import('better-sqlite3').Database, sql: string, ...params: unknown[]): number {
  return ((database.prepare(sql).get(...params) as CountRow | undefined)?.n ?? 0) as number;
}
