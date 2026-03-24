const db = require('better-sqlite3')('./kingdom/kingdom.db');
const fs = require('fs');

// Check Run 7 job details
const jobs = db.prepare(
  "SELECT substr(j.id,-6) as jid, j.id, j.status, j.started_at, j.heartbeat_at, j.result_path, t.title FROM jobs j JOIN task_graph_nodes t ON j.task_id=t.id WHERE t.objective_id='01KME9W52GBMWJFHM5HN4YG1R7' ORDER BY j.created_at LIMIT 25"
).all();

const out = jobs.map(j => ({
  jid: j.jid,
  status: j.status,
  started: j.started_at,
  heartbeat: j.heartbeat_at,
  result: j.result_path ? 'yes' : 'no',
  title: j.title.substring(0, 50),
}));

fs.writeFileSync('run7-detail.txt', JSON.stringify(out, null, 2));
console.log('Written');
