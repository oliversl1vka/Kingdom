import type Database from 'better-sqlite3';
import { createContextId, nowIso } from './ids.js';
import { normalizeRootPath, slugFromRoot } from './path-utils.js';
import type { ContextProject } from './types.js';

interface ProjectRow {
  id: string;
  name: string;
  root_path: string;
  root_path_normalized: string;
  created_at: string;
  updated_at: string;
}

export function ensureContextProject(
  database: Database.Database,
  rootPath: string,
  projectId?: string,
  projectName?: string,
): ContextProject {
  const normalized = normalizeRootPath(rootPath);
  const existingById = projectId
    ? (database.prepare('SELECT * FROM context_projects WHERE id = ?').get(projectId) as ProjectRow | undefined)
    : undefined;
  const existingByRoot = database
    .prepare('SELECT * FROM context_projects WHERE root_path_normalized = ?')
    .get(normalized) as ProjectRow | undefined;

  const existing = existingById ?? existingByRoot;
  const now = nowIso();
  if (existing) {
    database
      .prepare('UPDATE context_projects SET name = ?, root_path = ?, root_path_normalized = ?, updated_at = ? WHERE id = ?')
      .run(projectName ?? existing.name, rootPath, normalized, now, existing.id);
    return rowToProject({ ...existing, name: projectName ?? existing.name, root_path: rootPath, root_path_normalized: normalized, updated_at: now });
  }

  const id = projectId ?? slugFromRoot(rootPath);
  database
    .prepare(
      `INSERT INTO context_projects (id, name, root_path, root_path_normalized, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(id, projectName ?? slugFromRoot(rootPath), rootPath, normalized, now, now);
  return { id, name: projectName ?? slugFromRoot(rootPath), rootPath, rootPathNormalized: normalized, createdAt: now, updatedAt: now };
}

export function getContextProject(
  database: Database.Database,
  options: { projectId?: string; rootPath?: string },
): ContextProject | undefined {
  const row = options.projectId
    ? (database.prepare('SELECT * FROM context_projects WHERE id = ?').get(options.projectId) as ProjectRow | undefined)
    : options.rootPath
      ? (database
          .prepare('SELECT * FROM context_projects WHERE root_path_normalized = ?')
          .get(normalizeRootPath(options.rootPath)) as ProjectRow | undefined)
      : undefined;
  return row ? rowToProject(row) : undefined;
}

export function deleteContextProject(database: Database.Database, projectId: string): void {
  database.prepare('DELETE FROM context_chunks_fts WHERE project_id = ?').run(projectId);
  database.prepare('DELETE FROM context_projects WHERE id = ?').run(projectId);
}



function rowToProject(row: ProjectRow): ContextProject {
  return {
    id: row.id,
    name: row.name,
    rootPath: row.root_path,
    rootPathNormalized: row.root_path_normalized,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
