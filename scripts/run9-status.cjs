const db = require('better-sqlite3')('./kingdom/kingdom.db');
const fs = require('fs');

const OBJ = '01KMFJ62F26VA8J5J9CYCGHYM1'; // Run 9

// Job counts by status
const jobCounts = db.prepare(
  "SELECT j.status, COUNT(*) as cnt FROM jobs j JOIN task_graph_nodes t ON j.task_id=t.id WHERE t.objective_id=? GROUP BY j.status"
).all(OBJ);

// Task counts by status
const taskCounts = db.prepare(
  "SELECT status, COUNT(*) as cnt FROM task_graph_nodes WHERE objective_id=? GROUP BY status"
).all(OBJ);

// Count DIFF_OK vs DIFF_FAIL
const diffOk = db.prepare(
  "SELECT COUNT(*) as cnt FROM event_log WHERE event_type='DIFF_OK' AND job_id IN (SELECT j.id FROM jobs j JOIN task_graph_nodes t ON j.task_id=t.id WHERE t.objective_id=?)"
).get(OBJ);
const diffFail = db.prepare(
  "SELECT COUNT(*) as cnt FROM event_log WHERE event_type='DIFF_FAIL' AND job_id IN (SELECT j.id FROM jobs j JOIN task_graph_nodes t ON j.task_id=t.id WHERE t.objective_id=?)"
).get(OBJ);

// File line count
const fileLines = fs.readFileSync('packages/ui/src/engine/pixel-characters.ts', 'utf-8').split('\n').length;
const bakExists = fs.existsSync('packages/ui/src/engine/pixel-characters.ts.bak');
const bakLines = bakExists ? fs.readFileSync('packages/ui/src/engine/pixel-characters.ts.bak', 'utf-8').split('\n').length : 0;

const output = [];
output.push('=== Run 9 Status ===');
output.push('Job statuses: ' + JSON.stringify(Object.fromEntries(jobCounts.map(r => [r.status, r.cnt]))));
output.push('Task statuses: ' + JSON.stringify(Object.fromEntries(taskCounts.map(r => [r.status, r.cnt]))));
output.push('DIFF_OK: ' + diffOk.cnt + ', DIFF_FAIL: ' + diffFail.cnt);
output.push('File lines: ' + fileLines + (bakExists ? ', Backup lines: ' + bakLines : ', No backup yet'));

// List completed tasks
const completed = db.prepare(
  "SELECT t.title, t.status FROM task_graph_nodes t WHERE t.objective_id=? AND t.status IN ('completed','completed-with-warnings') ORDER BY t.title"
).all(OBJ);
if (completed.length > 0) {
  output.push('\nCompleted tasks:');
  for (const t of completed) output.push('  [' + t.status + '] ' + t.title);
}

// Show any running jobs
const running = db.prepare(
  "SELECT j.id, t.title, j.started_at, j.heartbeat_at FROM jobs j JOIN task_graph_nodes t ON j.task_id=t.id WHERE t.objective_id=? AND j.status='running'"
).all(OBJ);
if (running.length > 0) {
  output.push('\nRunning jobs:');
  for (const j of running) {
    const age = j.heartbeat_at ? Math.round((Date.now() - new Date(j.heartbeat_at).getTime()) / 1000) : '?';
    output.push('  ' + j.id.slice(-6) + ' ' + j.title + ' (heartbeat ' + age + 's ago)');
  }
}

fs.writeFileSync('run9-status.txt', output.join('\n'), 'utf-8');
console.log('Written');
