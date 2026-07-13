export type ContextIntent =
  | 'auto'
  | 'locate'
  | 'definition'
  | 'flow'
  | 'impact'
  | 'debug'
  | 'test'
  | 'docs'
  | 'run-ops';

export type ContextLanguage =
  | 'typescript'
  | 'tsx'
  | 'javascript'
  | 'jsx'
  | 'markdown'
  | 'json'
  | 'yaml'
  | 'sql'
  | 'powershell'
  | 'batch'
  | 'shell'
  | 'python'
  | 'text';

export type ContextChunkKind =
  | 'file_summary'
  | 'symbol'
  | 'markdown_section'
  | 'json_object'
  | 'sql_statement'
  | 'plain_block';

export type ContextSymbolKind =
  | 'function'
  | 'class'
  | 'method'
  | 'constructor'
  | 'interface'
  | 'type'
  | 'enum'
  | 'variable'
  | 'command'
  | 'test_suite'
  | 'test_case'
  | 'import'
  | 'export';

export type ContextEdgeType =
  | 'file_imports_file'
  | 'file_imports_package'
  | 'file_exports_symbol'
  | 'symbol_contains_symbol'
  | 'symbol_calls_identifier'
  | 'symbol_calls_symbol'
  | 'symbol_references_identifier'
  | 'symbol_references_symbol'
  | 'test_imports_source'
  | 'test_describes_symbol'
  | 'cli_registers_command'
  | 'command_implemented_by'
  | 'doc_mentions_file'
  | 'doc_mentions_symbol'
  | 'sql_defines_table'
  | 'sql_defines_index'
  | 'config_declares_package'
  | 'task_refers_to_file'
  | 'task_refers_to_symbol';

export interface ContextProject {
  id: string;
  name: string;
  rootPath: string;
  rootPathNormalized: string;
  createdAt: string;
  updatedAt: string;
}

export interface ScannedFile {
  path: string;
  absolutePath: string;
  language: ContextLanguage;
  sha256: string;
  diskMtimeMs: number;
  sizeBytes: number;
  lineCount: number;
  content: string;
}

export interface ScanSummary {
  rootPath: string;
  files: ScannedFile[];
  filesTotal: number;
  skippedExcluded: number;
  skippedLocked: number;
  skippedUnstable: number;
  errors: string[];
}

export interface ContextIndexOptions {
  rootPath?: string;
  dbPath?: string;
  projectId?: string;
  projectName?: string;
  fresh?: boolean;
  incremental?: boolean;
  includeGenerated?: boolean;
  orchestrationDbPath?: string;
}

export interface ContextIndexResult {
  projectId: string;
  status: 'completed' | 'completed-with-warnings' | 'failed';
  rootPath: string;
  filesSeen: number;
  filesIndexed: number;
  filesSkipped: number;
  filesSkippedLocked: number;
  filesSkippedUnstable: number;
  filesDeleted: number;
  symbols: number;
  chunks: number;
  durationMs: number;
  errors: string[];
}

export interface ContextSymbolRecord {
  id: string;
  fileId: string;
  parentSymbolId?: string;
  name: string;
  qualifiedName: string;
  kind: ContextSymbolKind;
  exported: boolean;
  signature?: string;
  docText?: string;
  startLine: number;
  endLine: number;
  startCol: number;
  endCol: number;
}

export interface ContextChunkRecord {
  id: string;
  fileId: string;
  symbolId?: string;
  chunkKind: ContextChunkKind;
  title: string;
  content: string;
  filePath: string;
  symbolName?: string;
  language: ContextLanguage;
  startLine: number;
  endLine: number;
  tokenEstimate: number;
}

export interface ContextEdgeRecord {
  id: string;
  sourceKind: 'file' | 'symbol' | 'chunk' | 'task' | 'doc' | 'sql' | 'command';
  sourceId: string;
  targetKind: 'file' | 'symbol' | 'chunk' | 'task' | 'doc' | 'sql' | 'command' | 'package' | 'identifier';
  targetId?: string;
  targetName?: string;
  edgeType: ContextEdgeType;
  confidence: number;
  metadata?: Record<string, unknown>;
}

export interface ExtractedContext {
  symbols: ContextSymbolRecord[];
  chunks: ContextChunkRecord[];
  edges: ContextEdgeRecord[];
}

export interface ContextSearchRequest {
  projectId?: string;
  rootPath?: string;
  dbPath?: string;
  query: string;
  intent?: ContextIntent;
  limit?: number;
  path?: string;
  includeSnippets?: boolean;
  includeNeighbors?: boolean;
  maxTokens?: number;
  noRerank?: boolean;
  noEmbeddings?: boolean;
}

export interface ContextNeighbor {
  file: string;
  title: string;
  edgeType: ContextEdgeType;
  confidence: number;
  startLine: number;
  endLine: number;
}

export interface ContextSearchResult {
  score: number;
  scoreBreakdown: Record<string, number>;
  file: string;
  language: ContextLanguage;
  startLine: number;
  endLine: number;
  chunkKind: ContextChunkKind;
  title: string;
  symbol?: {
    id: string;
    name: string;
    qualifiedName: string;
    kind: ContextSymbolKind;
    signature?: string;
  };
  snippet?: string;
  why: string[];
  neighbors?: ContextNeighbor[];
}

export interface ContextSearchResponse {
  query: string;
  intent: ContextIntent;
  projectId: string;
  latencyMs: number;
  results: ContextSearchResult[];
  warnings: string[];
}

export interface ParsedContextQuery {
  rawQuery: string;
  textQuery: string;
  intent: ContextIntent;
  filters: {
    symbol?: string;
    def?: string;
    type?: string;
    file?: string;
    path?: string;
    package?: string;
    uses?: string;
  };
  terms: string[];
}

export interface ContextStatusOptions {
  rootPath?: string;
  dbPath?: string;
  projectId?: string;
  includeGenerated?: boolean;
}

export interface ContextStatusResult {
  indexed: boolean;
  projectId?: string;
  rootPath?: string;
  fileCount: number;
  symbolCount: number;
  chunkCount: number;
  deletedFileCount: number;
  staleFileCount: number;
  newFileCount: number;
  missingFileCount: number;
  lastIndexJob?: {
    id: string;
    status: string;
    startedAt: string;
    completedAt?: string;
    filesSkippedLocked: number;
    filesSkippedUnstable: number;
  };
  ftsRowCount: number;
  ftsReady: boolean;
  ftsDriftCount: number;
  embeddingStatus: 'disabled' | 'schema-reserved';
  warnings: string[];
}

export interface ContextRepairOptions {
  rootPath?: string;
  dbPath?: string;
  projectId?: string;
  ftsOnly?: boolean;
}

export interface ContextRepairResult {
  projectId: string;
  fixes: string[];
  ftsRowsRebuilt: number;
  filesMarkedDeleted: number;
  orphanRowsRemoved: number;
}
