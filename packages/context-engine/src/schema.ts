import type Database from 'better-sqlite3';

export const CONTEXT_SCHEMA_VERSION = 1;

export const CONTEXT_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS context_schema_version (
  version INTEGER NOT NULL,
  applied_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS context_projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  root_path TEXT NOT NULL,
  root_path_normalized TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(root_path_normalized)
);

CREATE TABLE IF NOT EXISTS context_files (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES context_projects(id) ON DELETE CASCADE,
  path TEXT NOT NULL,
  absolute_path TEXT NOT NULL,
  language TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  disk_mtime_ms INTEGER NOT NULL,
  size_bytes INTEGER NOT NULL,
  line_count INTEGER NOT NULL,
  indexed_at TEXT NOT NULL,
  deleted_at TEXT,
  UNIQUE(project_id, path)
);

CREATE INDEX IF NOT EXISTS idx_context_files_project ON context_files(project_id);
CREATE INDEX IF NOT EXISTS idx_context_files_hash ON context_files(project_id, sha256);
CREATE INDEX IF NOT EXISTS idx_context_files_deleted ON context_files(project_id, deleted_at);
CREATE INDEX IF NOT EXISTS idx_context_files_mtime ON context_files(project_id, disk_mtime_ms);

CREATE TABLE IF NOT EXISTS context_symbols (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES context_projects(id) ON DELETE CASCADE,
  file_id TEXT NOT NULL REFERENCES context_files(id) ON DELETE CASCADE,
  parent_symbol_id TEXT REFERENCES context_symbols(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  qualified_name TEXT NOT NULL,
  kind TEXT NOT NULL,
  exported INTEGER NOT NULL DEFAULT 0,
  signature TEXT,
  doc_text TEXT,
  start_line INTEGER NOT NULL,
  end_line INTEGER NOT NULL,
  start_col INTEGER NOT NULL DEFAULT 0,
  end_col INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_context_symbols_project_name ON context_symbols(project_id, name);
CREATE INDEX IF NOT EXISTS idx_context_symbols_file ON context_symbols(file_id);
CREATE INDEX IF NOT EXISTS idx_context_symbols_kind ON context_symbols(project_id, kind);

CREATE TABLE IF NOT EXISTS context_chunks (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES context_projects(id) ON DELETE CASCADE,
  file_id TEXT NOT NULL REFERENCES context_files(id) ON DELETE CASCADE,
  symbol_id TEXT REFERENCES context_symbols(id) ON DELETE SET NULL,
  chunk_kind TEXT NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  file_path TEXT NOT NULL,
  symbol_name TEXT,
  language TEXT NOT NULL,
  start_line INTEGER NOT NULL,
  end_line INTEGER NOT NULL,
  token_estimate INTEGER NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_context_chunks_project ON context_chunks(project_id);
CREATE INDEX IF NOT EXISTS idx_context_chunks_file ON context_chunks(file_id);
CREATE INDEX IF NOT EXISTS idx_context_chunks_symbol ON context_chunks(symbol_id);
CREATE INDEX IF NOT EXISTS idx_context_chunks_kind ON context_chunks(project_id, chunk_kind);

CREATE VIRTUAL TABLE IF NOT EXISTS context_chunks_fts USING fts5(
  chunk_id UNINDEXED,
  project_id UNINDEXED,
  file_id UNINDEXED,
  symbol_id UNINDEXED,
  title,
  content,
  file_path,
  symbol_name,
  language UNINDEXED,
  tokenize = 'porter unicode61'
);

CREATE TABLE IF NOT EXISTS context_edges (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES context_projects(id) ON DELETE CASCADE,
  source_kind TEXT NOT NULL,
  source_id TEXT NOT NULL,
  target_kind TEXT NOT NULL,
  target_id TEXT,
  target_name TEXT,
  edge_type TEXT NOT NULL,
  confidence REAL NOT NULL DEFAULT 1.0,
  metadata_json TEXT NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_context_edges_source ON context_edges(project_id, source_kind, source_id);
CREATE INDEX IF NOT EXISTS idx_context_edges_target ON context_edges(project_id, target_kind, target_id);
CREATE INDEX IF NOT EXISTS idx_context_edges_name ON context_edges(project_id, target_name);
CREATE INDEX IF NOT EXISTS idx_context_edges_type ON context_edges(project_id, edge_type);

CREATE TABLE IF NOT EXISTS context_index_jobs (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES context_projects(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  fresh INTEGER NOT NULL DEFAULT 0,
  incremental INTEGER NOT NULL DEFAULT 1,
  files_total INTEGER NOT NULL DEFAULT 0,
  files_seen INTEGER NOT NULL DEFAULT 0,
  files_indexed INTEGER NOT NULL DEFAULT 0,
  files_skipped INTEGER NOT NULL DEFAULT 0,
  files_skipped_locked INTEGER NOT NULL DEFAULT 0,
  files_skipped_unstable INTEGER NOT NULL DEFAULT 0,
  files_deleted INTEGER NOT NULL DEFAULT 0,
  errors_json TEXT NOT NULL DEFAULT '[]',
  started_at TEXT NOT NULL,
  completed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_context_index_jobs_project ON context_index_jobs(project_id, started_at);

CREATE TABLE IF NOT EXISTS context_queries (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES context_projects(id) ON DELETE CASCADE,
  query TEXT NOT NULL,
  intent TEXT,
  filters_json TEXT NOT NULL DEFAULT '{}',
  result_count INTEGER NOT NULL,
  latency_ms INTEGER NOT NULL,
  used_embeddings INTEGER NOT NULL DEFAULT 0,
  used_rerank INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS context_embeddings (
  chunk_id TEXT PRIMARY KEY REFERENCES context_chunks(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  dimensions INTEGER NOT NULL,
  vector BLOB NOT NULL,
  created_at TEXT NOT NULL
);
`;

export function applyContextSchema(database: Database.Database): void {
  database.exec(CONTEXT_SCHEMA_SQL);
  const row = database.prepare('SELECT MAX(version) as version FROM context_schema_version').get() as
    | { version: number | null }
    | undefined;
  if ((row?.version ?? 0) < CONTEXT_SCHEMA_VERSION) {
    database.prepare('INSERT INTO context_schema_version (version) VALUES (?)').run(CONTEXT_SCHEMA_VERSION);
  }
}
