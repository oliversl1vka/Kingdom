const db = require('better-sqlite3')('./kingdom/kingdom.db');
const fs = require('fs');

const OBJ = '01KMFJ62F26VA8J5J9CYCGHYM1';
const jobs = db.prepare(
  "SELECT j.id FROM jobs j JOIN task_graph_nodes t ON j.task_id=t.id WHERE t.objective_id=? AND j.status='failed-review'"
).all(OBJ);

for (const j of jobs) {
  const p = 'kingdom/results/' + j.id + '.result.json';
  if (fs.existsSync(p)) {
    const result = JSON.parse(fs.readFileSync(p, 'utf-8'));
    console.log(j.id.slice(-6), 'EXISTS, content first 300:');
    console.log(result.content?.slice(0, 300));
    console.log('---');
  } else {
    console.log(j.id.slice(-6), 'MISSING');
  }
}
