import Database from 'better-sqlite3';
const db = new Database('c:/Users/KingdomOS/Kingdom/kingdom/kingdom.db');

// Update all queued jobs to use gpt-4.1-mini
const r = db.prepare("UPDATE jobs SET model = 'gpt-4.1-mini' WHERE status = 'queued'").run();
console.log('Updated', r.changes, 'jobs to gpt-4.1-mini');

// Verify
const counts = db.prepare('SELECT model, COUNT(*) as cnt FROM jobs GROUP BY model').all();
console.log('Jobs by model:', JSON.stringify(counts));

db.close();
