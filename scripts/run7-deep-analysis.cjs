const db = require('better-sqlite3')('./kingdom/kingdom.db');
const fs = require('fs');
const path = require('path');

const OBJ = '01KME9W52GBMWJFHM5HN4YG1R7';

// 1. Check task statuses (completed vs completed-with-warnings)
const taskStatuses = db.prepare(
  `SELECT t.status, COUNT(*) as count 
   FROM task_graph_nodes t 
   WHERE t.objective_id=? 
   GROUP BY t.status`
).all(OBJ);
console.log('\n=== Task Status Distribution ===');
console.log(JSON.stringify(taskStatuses, null, 2));

// 2. Check event_log for diff info
const evCols = db.prepare('PRAGMA table_info(event_log)').all();
console.log('\n=== Event Log Columns ===');
console.log(evCols.map(c => c.name).join(', '));

// 3. Get diff application events
const diffEvents = db.prepare(
  `SELECT e.event_type, e.details, substr(e.job_id,-6) as jid
   FROM event_log e 
   WHERE e.event_type = 'task_transition' 
   AND e.job_id IN (SELECT j.id FROM jobs j JOIN task_graph_nodes t ON j.task_id=t.id WHERE t.objective_id=?)
   ORDER BY e.timestamp`
).all(OBJ);

console.log('\n=== Diff Application Events ===');
let applied = 0;
let warnings = 0;
diffEvents.forEach(ev => {
  let details;
  try { details = JSON.parse(ev.details); } catch { details = ev.details; }
  const da = details?.diff_applied;
  if (da === true) applied++;
  else warnings++;
  console.log(`  ${ev.jid}: diff_applied=${da}, to=${details?.to}`);
});
console.log(`\nApplied: ${applied}, Warnings: ${warnings}`);

// 4. Check console output from server (look at crypt_entries)
const cryptCols = db.prepare('PRAGMA table_info(crypt_entries)').all();
console.log('\n=== Crypt Entry Columns ===');
console.log(cryptCols.map(c => c.name).join(', '));

const cryptEntries = db.prepare(
  `SELECT substr(c.task_id, -6) as tid, c.summary 
   FROM crypt_entries c 
   WHERE c.task_id IN (SELECT id FROM task_graph_nodes WHERE objective_id=?)
   ORDER BY c.timestamp`
).all(OBJ);
console.log('\n=== Crypt Entries (diff outcomes) ===');
cryptEntries.forEach(ce => {
  console.log(`  ${ce.tid}: ${ce.summary}`);
});

// 5. File health
const targetFile = path.join(__dirname, '..', 'packages', 'ui', 'src', 'engine', 'pixel-characters.ts');
const backupFile = targetFile + '.bak';
const currentLines = fs.readFileSync(targetFile, 'utf-8').split('\n').length;
const backupLines = fs.existsSync(backupFile) ? fs.readFileSync(backupFile, 'utf-8').split('\n').length : 0;
console.log(`\n=== File Health ===`);
console.log(`Current: ${currentLines} lines`);
console.log(`Backup: ${backupLines} lines`);
console.log(`Growth: +${currentLines - backupLines} lines (${((currentLines/backupLines - 1) * 100).toFixed(0)}%)`);

// 6. Quick TS error check
const agentsFile = path.join(__dirname, '..', 'packages', 'ui', 'src', 'scenes', 'agents.tsx');
const agentsLines = fs.existsSync(agentsFile) ? fs.readFileSync(agentsFile, 'utf-8').split('\n').length : 0;
console.log(`agents.tsx: ${agentsLines} lines`);
