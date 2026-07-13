import type Database from 'better-sqlite3';
import { resolve } from 'node:path';
import { chunkPlainText, createFileSummaryChunk } from './chunking/text.js';
import { openContextDatabaseForPath, defaultContextDbPath } from './db.js';
import { extractJsonContext } from './extractors/json.js';
import { extractMarkdownContext } from './extractors/markdown.js';
import { extractSqlContext } from './extractors/sql.js';
import { extractTypeScriptContext } from './extractors/typescript.js';
import { createContextId, nowIso } from './ids.js';
import { isTypeScriptLike } from './language.js';
import { deleteContextProject, ensureContextProject } from './project.js';
import { resolveGraphEdges } from './graph/resolver.js';
import { scanProjectFiles } from './scanner.js';
import type { ContextChunkRecord, ContextEdgeRecord, ContextIndexOptions, ContextIndexResult, ContextSymbolRecord, ExtractedContext, ScannedFile } from './types.js';

interface ExistingFileRow {
  id: string;
  sha256: string;
  disk_mtime_ms: number;
  size_bytes: number;
  deleted_at: string | null;
}

export function indexContextProject(options: ContextIndexOptions = {}): ContextIndexResult {
  const startedAt = Date.now();
  const rootPath = resolve(options.rootPath ?? process.cwd());
  const dbPath = options.dbPath ?? defaultContextDbPath(process.cwd());
  const database = openContextDatabaseForPath(dbPath);
  try {
    if (options.fresh && options.projectId) {
      deleteContextProject(database, options.projectId);
    }

    const project = ensureContextProject(database, rootPath, options.projectId, options.projectName);
    if (options.fresh && !options.projectId) {
      deleteContextProject(database, project.id);
      ensureContextProject(database, rootPath, project.id, options.projectName ?? project.name);
    }

    const jobId = createContextId('job');
    const scan = scanProjectFiles({ rootPath, includeGenerated: options.includeGenerated, orchestrationDbPath: options.orchestrationDbPath });
    database
      .prepare(
        `INSERT INTO context_index_jobs
         (id, project_id, status, fresh, incremental, files_total, files_seen, files_skipped_locked, files_skipped_unstable, errors_json, started_at)
         VALUES (?, ?, 'running', ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        jobId,
        project.id,
        options.fresh ? 1 : 0,
        options.incremental === false ? 0 : 1,
        scan.filesTotal,
        scan.files.length,
        scan.skippedLocked,
        scan.skippedUnstable,
        JSON.stringify(scan.errors),
        nowIso(),
      );

    const seenPaths = new Set(scan.files.map((file) => file.path));
    let filesIndexed = 0;
    let filesSkipped = 0;
    let symbolsIndexed = 0;
    let chunksIndexed = 0;
    const errors = [...scan.errors];

    for (const file of scan.files) {
      try {
        const existing = database
          .prepare('SELECT id, sha256, disk_mtime_ms, size_bytes, deleted_at FROM context_files WHERE project_id = ? AND path = ?')
          .get(project.id, file.path) as ExistingFileRow | undefined;
        if (
          options.incremental !== false &&
          existing &&
          existing.sha256 === file.sha256 &&
          existing.disk_mtime_ms === file.diskMtimeMs &&
          existing.size_bytes === file.sizeBytes &&
          existing.deleted_at === null
        ) {
          filesSkipped += 1;
          continue;
        }

        const counts = indexSingleFile(database, project.id, file, existing?.id);
        filesIndexed += 1;
        symbolsIndexed += counts.symbols;
        chunksIndexed += counts.chunks;
      } catch (error) {
        errors.push(`${file.path}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    const filesDeleted = markDeletedFiles(database, project.id, seenPaths);
    resolveGraphEdges(database, project.id);
    const status = errors.length > 0 ? 'completed-with-warnings' : 'completed';
    database
      .prepare(
        `UPDATE context_index_jobs
         SET status = ?, files_indexed = ?, files_skipped = ?, files_deleted = ?, errors_json = ?, completed_at = ?
         WHERE id = ?`,
      )
      .run(status, filesIndexed, filesSkipped, filesDeleted, JSON.stringify(errors), nowIso(), jobId);

    return {
      projectId: project.id,
      status,
      rootPath,
      filesSeen: scan.files.length,
      filesIndexed,
      filesSkipped,
      filesSkippedLocked: scan.skippedLocked,
      filesSkippedUnstable: scan.skippedUnstable,
      filesDeleted,
      symbols: symbolsIndexed,
      chunks: chunksIndexed,
      durationMs: Date.now() - startedAt,
      errors,
    };
  } catch (error) {
    return {
      projectId: options.projectId ?? 'unknown',
      status: 'failed',
      rootPath,
      filesSeen: 0,
      filesIndexed: 0,
      filesSkipped: 0,
      filesSkippedLocked: 0,
      filesSkippedUnstable: 0,
      filesDeleted: 0,
      symbols: 0,
      chunks: 0,
      durationMs: Date.now() - startedAt,
      errors: [error instanceof Error ? error.message : String(error)],
    };
  } finally {
    database.close();
  }
}

function indexSingleFile(
  database: Database.Database,
  projectId: string,
  file: ScannedFile,
  existingFileId?: string,
): { symbols: number; chunks: number } {
  const transaction = database.transaction(() => {
    const fileId = existingFileId ?? createContextId('fil');
    upsertFile(database, projectId, fileId, file);
    deleteIndexedContentForFile(database, fileId);

    const extracted = extractFileContext(file, fileId);
    const summary = createFileSummaryChunk(fileId, file.path, file.language, file.lineCount);
    const fallback = extracted.chunks.length === 0 ? chunkPlainText(fileId, file.path, file.language, file.content) : [];
    const chunks = [summary, ...extracted.chunks, ...fallback];

    insertSymbols(database, projectId, extracted.symbols);
    insertChunks(database, projectId, chunks);
    insertEdges(database, projectId, extracted.edges);
    return { symbols: extracted.symbols.length, chunks: chunks.length };
  });
  return transaction();
}

function extractFileContext(file: ScannedFile, fileId: string): ExtractedContext {
  if (isTypeScriptLike(file.language)) return extractTypeScriptContext(file, fileId);
  if (file.language === 'markdown') return extractMarkdownContext(file, fileId);
  if (file.language === 'json') return extractJsonContext(file, fileId);
  if (file.language === 'sql') return extractSqlContext(file, fileId);
  return { symbols: [], chunks: chunkPlainText(fileId, file.path, file.language, file.content), edges: [] };
}

function upsertFile(database: Database.Database, projectId: string, fileId: string, file: ScannedFile): void {
  database
    .prepare(
      `INSERT INTO context_files
       (id, project_id, path, absolute_path, language, sha256, disk_mtime_ms, size_bytes, line_count, indexed_at, deleted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
       ON CONFLICT(project_id, path) DO UPDATE SET
         absolute_path = excluded.absolute_path,
         language = excluded.language,
         sha256 = excluded.sha256,
         disk_mtime_ms = excluded.disk_mtime_ms,
         size_bytes = excluded.size_bytes,
         line_count = excluded.line_count,
         indexed_at = excluded.indexed_at,
         deleted_at = NULL`,
    )
    .run(fileId, projectId, file.path, file.absolutePath, file.language, file.sha256, file.diskMtimeMs, file.sizeBytes, file.lineCount, nowIso());
}

function deleteIndexedContentForFile(database: Database.Database, fileId: string): void {
  const symbolRows = database.prepare('SELECT id FROM context_symbols WHERE file_id = ?').all(fileId) as Array<{ id: string }>;
  database.prepare('DELETE FROM context_chunks_fts WHERE file_id = ?').run(fileId);
  database.prepare('DELETE FROM context_chunks WHERE file_id = ?').run(fileId);
  for (const row of symbolRows) {
    database.prepare('DELETE FROM context_edges WHERE source_id = ? OR target_id = ?').run(row.id, row.id);
  }
  database.prepare('DELETE FROM context_edges WHERE source_id = ? OR target_id = ?').run(fileId, fileId);
  database.prepare('DELETE FROM context_symbols WHERE file_id = ?').run(fileId);
}

function insertSymbols(database: Database.Database, projectId: string, symbols: ContextSymbolRecord[]): void {
  const statement = database.prepare(
    `INSERT INTO context_symbols
     (id, project_id, file_id, parent_symbol_id, name, qualified_name, kind, exported, signature, doc_text, start_line, end_line, start_col, end_col)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const symbol of symbols) {
    statement.run(
      symbol.id,
      projectId,
      symbol.fileId,
      symbol.parentSymbolId ?? null,
      symbol.name,
      symbol.qualifiedName,
      symbol.kind,
      symbol.exported ? 1 : 0,
      symbol.signature ?? null,
      symbol.docText ?? null,
      symbol.startLine,
      symbol.endLine,
      symbol.startCol,
      symbol.endCol,
    );
  }
}

function insertChunks(database: Database.Database, projectId: string, chunks: ContextChunkRecord[]): void {
  const chunkStatement = database.prepare(
    `INSERT INTO context_chunks
     (id, project_id, file_id, symbol_id, chunk_kind, title, content, file_path, symbol_name, language, start_line, end_line, token_estimate, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const ftsStatement = database.prepare(
    `INSERT INTO context_chunks_fts
     (chunk_id, project_id, file_id, symbol_id, title, content, file_path, symbol_name, language)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const chunk of chunks) {
    chunkStatement.run(
      chunk.id,
      projectId,
      chunk.fileId,
      chunk.symbolId ?? null,
      chunk.chunkKind,
      chunk.title,
      chunk.content,
      chunk.filePath,
      chunk.symbolName ?? null,
      chunk.language,
      chunk.startLine,
      chunk.endLine,
      chunk.tokenEstimate,
      nowIso(),
    );
    ftsStatement.run(chunk.id, projectId, chunk.fileId, chunk.symbolId ?? null, chunk.title, chunk.content, chunk.filePath, chunk.symbolName ?? '', chunk.language);
  }
}

function insertEdges(database: Database.Database, projectId: string, edges: ContextEdgeRecord[]): void {
  const statement = database.prepare(
    `INSERT INTO context_edges
     (id, project_id, source_kind, source_id, target_kind, target_id, target_name, edge_type, confidence, metadata_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const edge of edges) {
    statement.run(
      edge.id,
      projectId,
      edge.sourceKind,
      edge.sourceId,
      edge.targetKind,
      edge.targetId ?? null,
      edge.targetName ?? null,
      edge.edgeType,
      edge.confidence,
      JSON.stringify(edge.metadata ?? {}),
    );
  }
}

function markDeletedFiles(database: Database.Database, projectId: string, seenPaths: Set<string>): number {
  const activeRows = database
    .prepare('SELECT id, path FROM context_files WHERE project_id = ? AND deleted_at IS NULL')
    .all(projectId) as Array<{ id: string; path: string }>;
  let deleted = 0;
  for (const row of activeRows) {
    if (seenPaths.has(row.path)) continue;
    database.prepare('UPDATE context_files SET deleted_at = ? WHERE id = ?').run(nowIso(), row.id);
    database.prepare('DELETE FROM context_chunks_fts WHERE file_id = ?').run(row.id);
    deleted += 1;
  }
  return deleted;
}
