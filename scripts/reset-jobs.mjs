// Reset all failed jobs back to queued
const API = 'http://127.0.0.1:7778';

// We'll do this via direct DB access since server is running
import { createRequire } from 'module';
import { join } from 'path';
import Database from 'better-sqlite3';

const dbPath = 'c:/Users/KingdomOS/Kingdom/kingdom/kingdom.db';
const db = new Database(dbPath);

const r = db.prepare("UPDATE jobs SET status='queued', started_at=NULL, failure_type=NULL, worker_id=NULL WHERE status LIKE 'failed%'").run();
console.log('Reset', r.changes, 'jobs to queued');

const counts = db.prepare('SELECT status, COUNT(*) as cnt FROM jobs GROUP BY status').all();
console.log('Job status counts:', JSON.stringify(counts, null, 2));

db.close();
