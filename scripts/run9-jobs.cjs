const db = require('better-sqlite3')('./kingdom/kingdom.db');
const fs = require('fs');

const OBJ = '01KMFJ62F26VA8J5J9CYCGHYM1';

const jobs = db.prepare(
  `SELECT j.id, j.status, j.started_at, j.heartbeat_at, j.failure_type, t.title, t.status as task_status
   FROM jobs j JOIN task_graph_nodes t ON j.task_id=t.id 
   WHERE t.objective_id=? 
   ORDER BY j.created_at`
).all(OBJ);

const out = [];
out.push('=== All Run 9 Jobs ===');
for (const j of jobs) {
  const age = j.heartbeat_at ? Math.round((Date.now() - new Date(j.heartbeat_at).getTime()) / 1000) + 's' : '-';
  const started = j.started_at ? j.started_at.split('T')[1]?.slice(0, 8) : '-';
  out.push(`  ${j.id.slice(-6)} [${j.status}] ${j.title.slice(0, 55)}... (task:${j.task_status}, started:${started}, hb:${age}${j.failure_type ? ', fail:' + j.failure_type : ''})`);
}
out.push('\nTotal jobs: ' + jobs.length);

fs.writeFileSync('run9-jobs.txt', out.join('\n'), 'utf-8');
console.log('Written');
