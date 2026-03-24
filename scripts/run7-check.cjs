const db = require('better-sqlite3')('./kingdom/kingdom.db');
const fs = require('fs');

const r = db.prepare(
  "SELECT status, count(*) as c FROM jobs WHERE id IN (SELECT j.id FROM jobs j JOIN task_graph_nodes t ON j.task_id=t.id WHERE t.objective_id='01KME9W52GBMWJFHM5HN4YG1R7') GROUP BY status"
).all();

const events = db.prepare(
  "SELECT substr(job_id,-6) as jid, event_type, details FROM event_log WHERE job_id IN (SELECT j.id FROM jobs j JOIN task_graph_nodes t ON j.task_id=t.id WHERE t.objective_id='01KME9W52GBMWJFHM5HN4YG1R7') ORDER BY timestamp DESC LIMIT 20"
).all();

fs.writeFileSync('run7-status.txt', JSON.stringify({ statuses: r, recent_events: events }, null, 2));
console.log('Written run7-status.txt');
