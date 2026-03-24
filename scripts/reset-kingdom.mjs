#!/usr/bin/env node
/**
 * Reset the kingdom database completely — drops all data and re-initializes.
 * Usage: node scripts/reset-kingdom.mjs
 */
import Database from 'better-sqlite3';
import { existsSync, mkdirSync, copyFileSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const basePath = process.cwd();
const kingdomDir = join(basePath, 'kingdom');
const dbPath = join(kingdomDir, 'kingdom.db');

if (!existsSync(dbPath)) {
  console.log('No kingdom DB found. Nothing to reset.');
  process.exit(0);
}

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');

// Clear all data tables
const tables = [
  'event_log', 'file_locks', 'review_decisions', 'heartbeats',
  'incidents', 'crypt_entries', 'jobs', 'task_graph_nodes',
  'objectives', 'projects',
];
for (const t of tables) {
  try { db.prepare(`DELETE FROM ${t}`).run(); } catch { /* table may not exist */ }
}
console.log('✓ All data tables cleared');

db.close();
console.log('✓ Kingdom reset complete. Ready for fresh decree.');
