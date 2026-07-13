import { existsSync } from 'node:fs';
import { defaultContextDbPath, openContextDatabaseForPath } from './db.js';
import { nowIso } from './ids.js';
import { getContextProject } from './project.js';
import type { ContextRepairOptions, ContextRepairResult } from './types.js';

export function repairContextIndex(options: ContextRepairOptions = {}): ContextRepairResult {
  const dbPath = options.dbPath ?? defaultContextDbPath(process.cwd());
  const database = openContextDatabaseForPath(dbPath);
  try {
    const project = getContextProject(database, { projectId: options.projectId, rootPath: options.rootPath ?? process.cwd() });
    if (!project) throw new Error('No context project index exists for this workspace');
    const fixes: string[] = [];
    let orphanRowsRemoved = 0;

    if (!options.ftsOnly) {
      const rows = database
        .prepare('SELECT id, absolute_path FROM context_files WHERE project_id = ? AND deleted_at IS NULL')
        .all(project.id) as Array<{ id: string; absolute_path: string }>;
      let markedDeleted = 0;
      for (const row of rows) {
        if (existsSync(row.absolute_path)) continue;
        database.prepare('UPDATE context_files SET deleted_at = ? WHERE id = ?').run(nowIso(), row.id);
        database.prepare('DELETE FROM context_chunks_fts WHERE file_id = ?').run(row.id);
        markedDeleted += 1;
      }
      if (markedDeleted > 0) fixes.push(`Marked ${markedDeleted} missing files as deleted`);
      orphanRowsRemoved += database.prepare('DELETE FROM context_chunks WHERE file_id NOT IN (SELECT id FROM context_files)').run().changes;
      orphanRowsRemoved += database.prepare('DELETE FROM context_symbols WHERE file_id NOT IN (SELECT id FROM context_files)').run().changes;
      orphanRowsRemoved += database.prepare('DELETE FROM context_edges WHERE project_id NOT IN (SELECT id FROM context_projects)').run().changes;
      if (orphanRowsRemoved > 0) fixes.push(`Removed ${orphanRowsRemoved} orphan rows`);
    }

    const ftsRowsRebuilt = rebuildFts(database, project.id);
    fixes.push(`Rebuilt ${ftsRowsRebuilt} FTS rows`);
    return {
      projectId: project.id,
      fixes,
      ftsRowsRebuilt,
      filesMarkedDeleted: fixes.find((fix) => fix.includes('missing files')) ? Number(fixes.find((fix) => fix.includes('missing files'))?.match(/\d+/)?.[0] ?? 0) : 0,
      orphanRowsRemoved,
    };
  } finally {
    database.close();
  }
}

function rebuildFts(database: import('better-sqlite3').Database, projectId: string): number {
  const chunks = database
    .prepare(
      `SELECT c.id, c.project_id, c.file_id, c.symbol_id, c.title, c.content, c.file_path, COALESCE(c.symbol_name, '') symbol_name, c.language
       FROM context_chunks c
       JOIN context_files f ON f.id = c.file_id
       WHERE c.project_id = ? AND f.deleted_at IS NULL`,
    )
    .all(projectId) as Array<{
    id: string;
    project_id: string;
    file_id: string;
    symbol_id: string | null;
    title: string;
    content: string;
    file_path: string;
    symbol_name: string;
    language: string;
  }>;
  const transaction = database.transaction(() => {
    database.prepare('DELETE FROM context_chunks_fts WHERE project_id = ?').run(projectId);
    const insert = database.prepare(
      `INSERT INTO context_chunks_fts
       (chunk_id, project_id, file_id, symbol_id, title, content, file_path, symbol_name, language)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const chunk of chunks) {
      insert.run(chunk.id, chunk.project_id, chunk.file_id, chunk.symbol_id, chunk.title, chunk.content, chunk.file_path, chunk.symbol_name, chunk.language);
    }
  });
  transaction();
  return chunks.length;
}
