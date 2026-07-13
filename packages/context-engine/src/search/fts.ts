import type Database from 'better-sqlite3';
import { defaultContextDbPath, openContextDatabaseForPath } from '../db.js';
import { createContextId, nowIso } from '../ids.js';
import { getContextProject } from '../project.js';
import { expandGraphNeighbors } from '../graph/expansion.js';
import { getContextStatus } from '../status.js';
import { buildFtsQuery, parseContextQuery } from './query-parser.js';
import { rankCandidate } from './ranker.js';
import type { ContextSearchRequest, ContextSearchResponse, ContextSearchResult, ContextSymbolKind, ParsedContextQuery } from '../types.js';

interface CandidateRow {
  chunk_id: string;
  file_id: string;
  symbol_id: string | null;
  file_path: string;
  language: ContextSearchResult['language'];
  chunk_kind: ContextSearchResult['chunkKind'];
  title: string;
  content: string;
  start_line: number;
  end_line: number;
  token_estimate: number;
  symbol_name: string | null;
  symbol_qualified_name: string | null;
  symbol_kind: ContextSymbolKind | null;
  symbol_signature: string | null;
  fts_rank: number;
}

export function searchContext(request: ContextSearchRequest): ContextSearchResponse {
  const startedAt = Date.now();
  const dbPath = request.dbPath ?? defaultContextDbPath(process.cwd());
  const database = openContextDatabaseForPath(dbPath);
  try {
    const project = getContextProject(database, { projectId: request.projectId, rootPath: request.rootPath ?? process.cwd() });
    if (!project) {
      return {
        query: request.query,
        intent: request.intent ?? 'auto',
        projectId: request.projectId ?? 'unknown',
        latencyMs: Date.now() - startedAt,
        results: [],
        warnings: ['No context index exists for this workspace. Run kingdom context index . first.'],
      };
    }

    const parsed = parseContextQuery(request.query, request.intent ?? 'auto');
    const warnings = getContextStatus({ dbPath, projectId: project.id, rootPath: project.rootPath }).warnings;
    const candidates = loadCandidates(database, project.id, parsed, request);
    const ranked = candidates.map((candidate, index) => {
      const score = rankCandidate(
        {
          ftsRank: candidate.fts_rank,
          file: candidate.file_path,
          title: candidate.title,
          content: candidate.content,
          chunkKind: candidate.chunk_kind,
          symbolName: candidate.symbol_name ?? undefined,
          symbolKind: candidate.symbol_kind ?? undefined,
        },
        parsed,
        index,
        candidates.length,
      );
      return { candidate, score };
    });

    ranked.sort((a, b) => b.score.score - a.score.score || a.candidate.file_path.localeCompare(b.candidate.file_path));
    const limit = request.limit ?? 10;
    const maxTokens = request.maxTokens ?? 4000;
    let usedTokens = 0;
    const selected = [] as typeof ranked;
    for (const item of ranked) {
      if (selected.length >= limit) break;
      if (usedTokens + item.candidate.token_estimate > maxTokens && selected.length > 0) continue;
      selected.push(item);
      usedTokens += item.candidate.token_estimate;
    }

    const neighborMap = request.includeNeighbors === false
      ? new Map<string, []>()
      : expandGraphNeighbors(
          database,
          selected.map((item) => ({ projectId: project.id, fileId: item.candidate.file_id, symbolId: item.candidate.symbol_id ?? undefined, chunkId: item.candidate.chunk_id })),
        );

    const results = selected.map(({ candidate, score }) => ({
      score: score.score,
      scoreBreakdown: score.scoreBreakdown,
      file: candidate.file_path,
      language: candidate.language,
      startLine: candidate.start_line,
      endLine: candidate.end_line,
      chunkKind: candidate.chunk_kind,
      title: candidate.title,
      symbol: candidate.symbol_id
        ? {
            id: candidate.symbol_id,
            name: candidate.symbol_name ?? candidate.title,
            qualifiedName: candidate.symbol_qualified_name ?? candidate.title,
            kind: candidate.symbol_kind ?? 'function',
            signature: candidate.symbol_signature ?? undefined,
          }
        : undefined,
      snippet: request.includeSnippets === false ? undefined : trimSnippet(candidate.content, 1200),
      why: score.why.length > 0 ? score.why : ['ranked match'],
      neighbors: neighborMap.get(candidate.chunk_id),
    })) satisfies ContextSearchResult[];

    logQuery(database, project.id, parsed, results.length, Date.now() - startedAt);
    return { query: request.query, intent: parsed.intent, projectId: project.id, latencyMs: Date.now() - startedAt, results, warnings };
  } finally {
    database.close();
  }
}

function loadCandidates(
  database: Database.Database,
  projectId: string,
  parsed: ParsedContextQuery,
  request: ContextSearchRequest,
): CandidateRow[] {
  const ftsQuery = buildFtsQuery(parsed.terms);
  const rows = ftsQuery ? queryFts(database, projectId, ftsQuery, parsed, request) : [];
  const fallbackRows = rows.length > 0 ? [] : queryLike(database, projectId, parsed, request);
  const map = new Map<string, CandidateRow>();
  for (const row of [...rows, ...fallbackRows, ...queryStructured(database, projectId, parsed, request)]) {
    if (!matchesFilters(row, parsed, request)) continue;
    map.set(row.chunk_id, row);
  }
  return Array.from(map.values()).slice(0, 200);
}

function queryFts(database: Database.Database, projectId: string, ftsQuery: string, parsed: ParsedContextQuery, request: ContextSearchRequest): CandidateRow[] {
  const filters = buildFilterTail(parsed, request);
  try {
    return database
      .prepare(`${baseSelect('context_chunks_fts, context_chunks c')} WHERE context_chunks_fts.chunk_id = c.id AND context_chunks_fts.project_id = ? AND context_chunks_fts MATCH ?${filters.sql} ORDER BY bm25(context_chunks_fts) LIMIT 120`)
      .all(projectId, ftsQuery, ...filters.params) as CandidateRow[];
  } catch {
    return [];
  }
}

function queryLike(database: Database.Database, projectId: string, parsed: ParsedContextQuery, request: ContextSearchRequest): CandidateRow[] {
  const filters = buildFilterTail(parsed, request);
  const like = `%${(parsed.textQuery || parsed.terms.join(' ')).replace(/[%_]/g, '')}%`;
  return database
    .prepare(`${baseSelect('context_chunks c')} WHERE c.project_id = ? AND (c.title LIKE ? OR c.content LIKE ? OR c.file_path LIKE ? OR COALESCE(c.symbol_name, '') LIKE ?)${filters.sql} ORDER BY c.file_path, c.start_line LIMIT 120`)
    .all(projectId, like, like, like, like, ...filters.params) as CandidateRow[];
}

function queryStructured(database: Database.Database, projectId: string, parsed: ParsedContextQuery, request: ContextSearchRequest): CandidateRow[] {
  const needles = [parsed.filters.symbol, parsed.filters.def, parsed.filters.file, parsed.filters.path, request.path].filter(Boolean) as string[];
  if (needles.length === 0) return [];
  const rows: CandidateRow[] = [];
  for (const needle of needles) {
    const filters = buildFilterTail(parsed, request);
    const like = `%${needle.replace(/[%_]/g, '')}%`;
    rows.push(
      ...(database
        .prepare(`${baseSelect('context_chunks c')} WHERE c.project_id = ? AND (c.file_path LIKE ? OR c.title LIKE ? OR COALESCE(c.symbol_name, '') LIKE ?)${filters.sql} ORDER BY c.file_path, c.start_line LIMIT 40`)
        .all(projectId, like, like, like, ...filters.params) as CandidateRow[]),
    );
  }
  return rows;
}

function baseSelect(from: string): string {
  const ftsRank = from.includes('context_chunks_fts') ? 'bm25(context_chunks_fts)' : '999';
  return `SELECT DISTINCT c.id chunk_id, c.file_id, c.symbol_id, c.file_path, c.language, c.chunk_kind, c.title, c.content,
    c.start_line, c.end_line, c.token_estimate, c.symbol_name,
    s.qualified_name symbol_qualified_name, s.kind symbol_kind, s.signature symbol_signature,
    ${ftsRank} fts_rank
    FROM ${from}
    JOIN context_files f ON f.id = c.file_id AND f.deleted_at IS NULL
    LEFT JOIN context_symbols s ON s.id = c.symbol_id`;
}

function buildFilterTail(parsed: ParsedContextQuery, request: ContextSearchRequest): { sql: string; params: unknown[] } {
  const clauses: string[] = [];
  const params: unknown[] = [];
  const pathFilter = request.path ?? parsed.filters.path;
  if (pathFilter) {
    clauses.push('AND c.file_path LIKE ?');
    params.push(likeParam(pathFilter));
  }
  if (parsed.filters.file) {
    clauses.push('AND c.file_path LIKE ?');
    params.push(likeParam(parsed.filters.file));
  }
  if (parsed.filters.type) {
    clauses.push('AND (c.chunk_kind = ? OR s.kind = ?)');
    params.push(parsed.filters.type, parsed.filters.type);
  }
  if (parsed.filters.symbol) {
    clauses.push('AND COALESCE(c.symbol_name, c.title) LIKE ?');
    params.push(likeParam(parsed.filters.symbol));
  }
  if (parsed.filters.def) {
    clauses.push("AND c.chunk_kind = 'symbol' AND COALESCE(c.symbol_name, c.title) LIKE ?");
    params.push(likeParam(parsed.filters.def));
  }
  return { sql: clauses.length > 0 ? ` ${clauses.join(' ')}` : '', params };
}

function matchesFilters(row: CandidateRow, parsed: ParsedContextQuery, request: ContextSearchRequest): boolean {
  const file = row.file_path.toLowerCase();
  if (request.path && !file.includes(request.path.toLowerCase().replace(/\\/g, '/'))) return false;
  if (parsed.filters.path && !file.includes(parsed.filters.path.toLowerCase().replace(/\\/g, '/'))) return false;
  if (parsed.filters.file && !file.includes(parsed.filters.file.toLowerCase().replace(/\\/g, '/'))) return false;
  if (parsed.filters.type && row.chunk_kind !== parsed.filters.type && row.symbol_kind !== parsed.filters.type) return false;
  return true;
}

function likeParam(value: string): string {
  return `%${value.replace(/\\/g, '/').replace(/[%_]/g, '')}%`;
}

function trimSnippet(content: string, maxChars: number): string {
  const trimmed = content.trim();
  return trimmed.length <= maxChars ? trimmed : `${trimmed.slice(0, maxChars).trimEnd()}\n...`;
}

function logQuery(database: Database.Database, projectId: string, parsed: ParsedContextQuery, resultCount: number, latencyMs: number): void {
  database
    .prepare(
      `INSERT INTO context_queries
       (id, project_id, query, intent, filters_json, result_count, latency_ms, used_embeddings, used_rerank, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, ?)`,
    )
    .run(createContextId('qry'), projectId, parsed.rawQuery, parsed.intent, JSON.stringify(parsed.filters), resultCount, latencyMs, nowIso());
}
