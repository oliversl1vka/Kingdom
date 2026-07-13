import type Database from 'better-sqlite3';
import type { ContextNeighbor } from '../types.js';

export interface ExpansionSeed {
  projectId: string;
  fileId: string;
  symbolId?: string;
  chunkId: string;
}

export function expandGraphNeighbors(
  database: Database.Database,
  seeds: ExpansionSeed[],
  options: { maxNeighbors?: number; minConfidence?: number } = {},
): Map<string, ContextNeighbor[]> {
  const maxNeighbors = options.maxNeighbors ?? 6;
  const minConfidence = options.minConfidence ?? 0.7;
  const result = new Map<string, ContextNeighbor[]>();
  const edgeStatement = database.prepare(
    `SELECT source_kind, source_id, target_kind, target_id, target_name, edge_type, confidence
     FROM context_edges
     WHERE project_id = ?
       AND confidence >= ?
       AND (source_id = ? OR target_id = ? OR source_id = ? OR target_id = ?)
     ORDER BY confidence DESC
     LIMIT ?`,
  );
  const targetChunkStatement = database.prepare(
    `SELECT c.file_path, c.title, c.start_line, c.end_line
     FROM context_chunks c
     JOIN context_files f ON f.id = c.file_id
     WHERE f.deleted_at IS NULL AND (c.file_id = ? OR c.symbol_id = ?)
     ORDER BY CASE c.chunk_kind WHEN 'symbol' THEN 0 WHEN 'file_summary' THEN 1 ELSE 2 END, c.start_line
     LIMIT 1`,
  );

  for (const seed of seeds) {
    const rows = edgeStatement.all(seed.projectId, minConfidence, seed.fileId, seed.fileId, seed.symbolId ?? '', seed.symbolId ?? '', maxNeighbors * 2) as Array<{
      source_id: string;
      target_id: string | null;
      target_name: string | null;
      edge_type: ContextNeighbor['edgeType'];
      confidence: number;
    }>;
    const neighbors: ContextNeighbor[] = [];
    for (const row of rows) {
      if (!row.target_id) continue;
      const target = targetChunkStatement.get(row.target_id, row.target_id) as
        | { file_path: string; title: string; start_line: number; end_line: number }
        | undefined;
      if (!target) continue;
      neighbors.push({
        file: target.file_path,
        title: target.title,
        edgeType: row.edge_type,
        confidence: row.confidence,
        startLine: target.start_line,
        endLine: target.end_line,
      });
      if (neighbors.length >= maxNeighbors) break;
    }
    result.set(seed.chunkId, neighbors);
  }
  return result;
}
