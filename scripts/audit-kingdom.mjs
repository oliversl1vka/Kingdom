import Database from 'better-sqlite3';

const db = new Database('c:/Users/KingdomOS/Kingdom/kingdom/kingdom.db');

// Task statuses
console.log('=== TASK STATUSES ===');
const tasks = db.prepare('SELECT status, COUNT(*) as cnt FROM task_graph_nodes GROUP BY status').all();
console.log(JSON.stringify(tasks, null, 2));

// Job statuses  
console.log('\n=== JOB STATUSES ===');
const jobs = db.prepare('SELECT status, COUNT(*) as cnt FROM jobs GROUP BY status').all();
console.log(JSON.stringify(jobs, null, 2));

// Heartbeats
console.log('\n=== HEARTBEATS ===');
const hb = db.prepare('SELECT COUNT(*) as cnt FROM heartbeats').get();
console.log('Total heartbeats:', hb.cnt);

// Review decisions
console.log('\n=== REVIEW DECISIONS ===');
const rd = db.prepare('SELECT COUNT(*) as cnt FROM review_decisions').get();
console.log('Total reviews:', rd.cnt);

// Incidents
console.log('\n=== INCIDENTS ===');
const inc = db.prepare('SELECT COUNT(*) as cnt FROM incidents').get();
console.log('Total incidents:', inc.cnt);

// Crypt entries
console.log('\n=== CRYPT ENTRIES ===');
const crypt = db.prepare('SELECT COUNT(*) as cnt FROM crypt_entries').get();
console.log('Total crypt entries:', crypt.cnt);

// Event log
console.log('\n=== EVENT LOG ===');
try {
  const ev = db.prepare('SELECT COUNT(*) as cnt FROM event_log').get();
  console.log('Total events:', ev.cnt);
} catch { console.log('No event_log table'); }

// Memory files
console.log('\n=== MEMORY FILES ===');
const fs = require('fs');
const memDir = 'c:/Users/KingdomOS/Kingdom/kingdom/memory';
if (fs.existsSync(memDir)) {
  const walk = (d, prefix='') => {
    fs.readdirSync(d).forEach(f => {
      const p = d + '/' + f;
      if (fs.statSync(p).isDirectory()) walk(p, prefix + f + '/');
      else console.log(prefix + f);
    });
  };
  walk(memDir);
} else { console.log('No memory directory'); }

// Check if task statuses ever changed (all still queued?)
console.log('\n=== SAMPLE TASKS ===');
const sampleTasks = db.prepare(`
  SELECT id, title, status, assigned_tier, retry_count 
  FROM task_graph_nodes 
  WHERE level = 'task'
  LIMIT 5
`).all();
console.log(JSON.stringify(sampleTasks, null, 2));

db.close();
