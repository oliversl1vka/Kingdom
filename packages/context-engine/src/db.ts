import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { applyContextSchema } from './schema.js';

let sharedDatabase: Database.Database | null = null;
let sharedDatabasePath: string | null = null;

export function defaultContextDbPath(basePath = process.cwd()): string {
  return join(basePath, 'kingdom', 'context.db');
}

export function openContextDatabase(dbPath = defaultContextDbPath()): Database.Database {
  const resolvedPath = resolve(dbPath);
  if (sharedDatabase && sharedDatabasePath === resolvedPath) {
    return sharedDatabase;
  }
  if (sharedDatabase) {
    sharedDatabase.close();
    sharedDatabase = null;
    sharedDatabasePath = null;
  }
  mkdirSync(dirname(resolvedPath), { recursive: true });
  sharedDatabase = openContextDatabaseForPath(resolvedPath);
  sharedDatabasePath = resolvedPath;
  return sharedDatabase;
}

export function openContextDatabaseForPath(dbPath: string): Database.Database {
  const resolvedPath = resolve(dbPath);
  mkdirSync(dirname(resolvedPath), { recursive: true });
  const database = new Database(resolvedPath);
  database.pragma('journal_mode = WAL');
  database.pragma('busy_timeout = 5000');
  database.pragma('foreign_keys = ON');
  applyContextSchema(database);
  return database;
}

export function closeContextDatabase(): void {
  if (sharedDatabase) {
    sharedDatabase.close();
    sharedDatabase = null;
    sharedDatabasePath = null;
  }
}
