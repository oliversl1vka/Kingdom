const fs = require('fs');
const db = require('better-sqlite3')('./kingdom/kingdom.db');
const OBJ = '01KMFGY4GHJPFD8RGB1PA5AETQ';

const jobs = db.prepare(
  "SELECT substr(j.id,-6) as jid, j.status, j.started_at, j.heartbeat_at, datetime(j.heartbeat_at) as hb FROM jobs j JOIN task_graph_nodes t ON j.task_id=t.id WHERE t.objective_id=? AND j.status='running'"
).all(OBJ);

const now = new Date().toISOString();
const lines = [];
jobs.forEach(j => {
  const ageSec = j.heartbeat_at ? Math.floor((Date.now() - new Date(j.heartbeat_at).getTime()) / 1000) : 'N/A';
  lines.push(`Job ${j.jid}: started ${j.started_at}, heartbeat ${j.heartbeat_at} (${ageSec}s ago)`);
});

lines.push('Now: ' + now);
fs.writeFileSync('heartbeat.txt', lines.join('\n'));
console.log('Written');
