const db = require('better-sqlite3')('./kingdom/kingdom.db');
const fs = require('fs');
const path = require('path');

const OBJ = '01KMFGY4GHJPFD8RGB1PA5AETQ';

const statusCounts = db.prepare(
  "SELECT j.status, COUNT(*) as count FROM jobs j JOIN task_graph_nodes t ON j.task_id=t.id WHERE t.objective_id=? GROUP BY j.status"
).all(OBJ);

const taskStatuses = db.prepare(
  "SELECT t.status, COUNT(*) as count FROM task_graph_nodes t WHERE t.objective_id=? AND t.level='task' GROUP BY t.status"
).all(OBJ);

const jobs = db.prepare(
  "SELECT substr(j.id,-6) as jid, j.status, j.started_at, j.heartbeat_at, j.result_path, t.title, t.status as task_status FROM jobs j JOIN task_graph_nodes t ON j.task_id=t.id WHERE t.objective_id=? ORDER BY j.started_at"
).all(OBJ);

const targetFile = path.join(__dirname, '..', 'packages', 'ui', 'src', 'engine', 'pixel-characters.ts');
const currentLines = fs.readFileSync(targetFile, 'utf-8').split('\n').length;
const backupFile = targetFile + '.bak';
const hasBackup = fs.existsSync(backupFile);
const backupLines = hasBackup ? fs.readFileSync(backupFile, 'utf-8').split('\n').length : 0;

const lines = [];
lines.push('=== Run 8 Status ===');
lines.push('Job statuses: ' + JSON.stringify(statusCounts));
lines.push('Task statuses: ' + JSON.stringify(taskStatuses));
lines.push(`File: ${currentLines} lines | Backup: ${hasBackup ? backupLines + ' lines' : 'none'}`);
lines.push('');
lines.push('=== Jobs ===');
jobs.forEach(j => {
  const status = j.task_status === 'completed' ? 'DIFF_OK' : 
                 j.task_status === 'completed-with-warnings' ? 'DIFF_FAIL' : 
                 j.status.toUpperCase();
  lines.push(`  ${j.jid} [${status.padEnd(12)}] ${j.title.substring(0, 55)}`);
});

fs.writeFileSync('run8-status.txt', lines.join('\n'));
console.log('Written');
