const db = require('better-sqlite3')('./kingdom/kingdom.db');
const fs = require('fs');

const OBJ = '01KMFJ62F26VA8J5J9CYCGHYM1';
const rows = db.prepare(
  "SELECT j.id, j.result_path, t.title FROM jobs j JOIN task_graph_nodes t ON j.task_id=t.id WHERE t.objective_id=? AND j.status='failed-review'"
).all(OBJ);

for (const r of rows) {
  console.log(r.id.slice(-6), r.result_path || 'NULL', r.title.slice(0, 40));
  if (r.result_path && fs.existsSync(r.result_path)) {
    const result = JSON.parse(fs.readFileSync(r.result_path, 'utf-8'));
    console.log('  Content first 300:', result.content?.slice(0, 300));
  } else if (r.result_path) {
    console.log('  File missing at:', r.result_path);
  }
}
