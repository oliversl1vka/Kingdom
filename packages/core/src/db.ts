import Database from 'better-sqlite3';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const MIGRATIONS_DIR = join(__dirname, '..', 'migrations');

let db: Database.Database | null = null;

function getSchemaVersion(database: Database.Database): number {
  const tableExists = database
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='schema_version'")
    .get();
  if (!tableExists) return 0;
  const row = database.prepare('SELECT MAX(version) as version FROM schema_version').get() as
    | { version: number }
    | undefined;
  return row?.version ?? 0;
}

function applyMigrations(database: Database.Database): void {
  const currentVersion = getSchemaVersion(database);
  const migrationFiles = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  for (const file of migrationFiles) {
    const match = file.match(/^(\d+)/);
    if (!match) continue;
    const version = parseInt(match[1], 10);
    if (version <= currentVersion) continue;

    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf-8');
    database.exec(sql);
  }
}

export function getDatabase(dbPath?: string): Database.Database {
  if (db) return db;

  const resolvedPath = dbPath ?? join(process.cwd(), 'kingdom', 'kingdom.db');
  db = new Database(resolvedPath);

  // Enable WAL mode for concurrent read support, and set a retry window so
  // parallel writers wait up to 5s instead of immediately throwing SQLITE_BUSY.
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 5000');
  db.pragma('foreign_keys = ON');

  applyMigrations(db);
  return db;
}

export function closeDatabase(): void {
  if (db) {
    db.close();
    db = null;
  }
}

export function getDatabaseForPath(dbPath: string): Database.Database {
  const database = new Database(dbPath);
  database.pragma('journal_mode = WAL');
  database.pragma('busy_timeout = 5000');
  database.pragma('foreign_keys = ON');
  applyMigrations(database);
  return database;
}
