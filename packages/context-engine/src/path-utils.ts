import { basename, isAbsolute, relative, resolve } from 'node:path';

export function toPosixPath(value: string): string {
  return value.replace(/\\/g, '/').replace(/\/+/g, '/');
}

export function normalizeRootPath(rootPath: string): string {
  return toPosixPath(resolve(rootPath)).toLowerCase();
}

export function normalizeWorkspaceRelativePath(filePath: string, rootPath: string): string | null {
  const absolutePath = isAbsolute(filePath) ? resolve(filePath) : resolve(rootPath, filePath);
  const rel = relative(resolve(rootPath), absolutePath);
  if (rel === '') return '';
  if (rel.startsWith('..') || isAbsolute(rel)) return null;
  return toPosixPath(rel);
}

export function slugFromRoot(rootPath: string): string {
  const slug = basename(resolve(rootPath))
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'project';
}

export function pathContainsSegment(posixPath: string, segment: string): boolean {
  return posixPath.split('/').some((part) => part.toLowerCase() === segment.toLowerCase());
}


