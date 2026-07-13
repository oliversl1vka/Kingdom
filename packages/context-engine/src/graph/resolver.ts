import type Database from 'better-sqlite3';
import { posix } from 'node:path';

interface EdgeRow {
  id: string;
  source_id: string;
  target_name: string;
  edge_type: string;
}

interface FileRow {
  id: string;
  path: string;
}

export function resolveGraphEdges(database: Database.Database, projectId: string): number {
  const files = database
    .prepare('SELECT id, path FROM context_files WHERE project_id = ? AND deleted_at IS NULL')
    .all(projectId) as FileRow[];
  const fileById = new Map(files.map((file) => [file.id, file]));
  const fileByPath = new Map(files.map((file) => [file.path, file]));
  const edges = database
    .prepare(
      `SELECT id, source_id, target_name, edge_type
       FROM context_edges
       WHERE project_id = ? AND target_id IS NULL AND edge_type IN ('file_imports_file', 'file_imports_package') AND target_name IS NOT NULL`,
    )
    .all(projectId) as EdgeRow[];
  const update = database.prepare('UPDATE context_edges SET target_id = ?, target_name = ? WHERE id = ?');
  let resolved = 0;
  for (const edge of edges) {
    const source = fileById.get(edge.source_id);
    if (!source) continue;
    const target = edge.edge_type === 'file_imports_package'
      ? resolvePackageImport(edge.target_name, fileByPath)
      : resolveRelativeImport(source.path, edge.target_name, fileByPath);
    if (!target) continue;
    update.run(target.id, target.path, edge.id);
    resolved += 1;
  }
  return resolved;
}

function resolveRelativeImport(sourcePath: string, specifier: string, fileByPath: Map<string, FileRow>): FileRow | undefined {
  if (!specifier.startsWith('.')) return undefined;
  const base = posix.normalize(posix.join(posix.dirname(sourcePath), specifier));
  return firstExisting(candidateImportPaths(base), fileByPath);
}

function resolvePackageImport(specifier: string, fileByPath: Map<string, FileRow>): FileRow | undefined {
  const match = specifier.match(/^@kingdomos\/([^/]+)(?:\/(.*))?$/);
  if (!match) return undefined;
  const packageName = match[1];
  const rest = match[2];
  const base = rest ? `packages/${packageName}/src/${rest}` : `packages/${packageName}/src/index`;
  return firstExisting(candidateImportPaths(base), fileByPath);
}

function candidateImportPaths(base: string): string[] {
  const withoutTrailing = base.replace(/\/index$/i, '/index');
  const withoutJsExtension = withoutTrailing.replace(/\.m?js$/i, '');
  return Array.from(new Set([
    withoutTrailing,
    withoutTrailing.replace(/\.m?js$/i, '.ts'),
    withoutTrailing.replace(/\.m?js$/i, '.tsx'),
    `${withoutTrailing}.ts`,
    `${withoutTrailing}.tsx`,
    `${withoutTrailing}.js`,
    `${withoutTrailing}.jsx`,
    `${withoutTrailing}.json`,
    withoutJsExtension,
    `${withoutJsExtension}.ts`,
    `${withoutJsExtension}.tsx`,
    `${withoutTrailing}/index.ts`,
    `${withoutTrailing}/index.tsx`,
    `${withoutTrailing}/index.js`,
    `${withoutTrailing}/index.jsx`,
  ]));
}

function firstExisting(candidates: string[], fileByPath: Map<string, FileRow>): FileRow | undefined {
  for (const candidate of candidates) {
    const found = fileByPath.get(candidate);
    if (found) return found;
  }
  return undefined;
}
