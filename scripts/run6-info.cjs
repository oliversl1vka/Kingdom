const db = require('better-sqlite3')('./kingdom/kingdom.db');
const fs = require('fs');

const jobs = db.prepare(
  `SELECT substr(j.id,-6) as sid, t.title, j.status, j.result_path
   FROM jobs j JOIN task_graph_nodes t ON j.task_id=t.id
   WHERE t.objective_id=? ORDER BY j.created_at`
).all('01KME8JES8T4PB10TA1B0K4223');

const lines = jobs.map(j => {
  let d = 'none';
  if (j.result_path) {
    try {
      const r = JSON.parse(fs.readFileSync(j.result_path, 'utf-8'));
      d = r.content ? 'has_diff' : 'no_diff';
    } catch (e) { d = 'err:' + e.message; }
  }
  return `${j.sid} | ${j.status} | ${d} | ${j.title.substring(0, 50)}`;
});

fs.writeFileSync('run6.txt', lines.join('\n'));
console.log(lines.length + ' jobs');
