const db = require('better-sqlite3')('./kingdom/kingdom.db');
const fs = require('fs');

const OBJ = '01KMFJ62F26VA8J5J9CYCGHYM1';

// Get failed-review jobs
const failed = db.prepare(
  `SELECT j.id, j.result_path, t.title FROM jobs j JOIN task_graph_nodes t ON j.task_id=t.id 
   WHERE t.objective_id=? AND j.status='failed-review'`
).all(OBJ);

const out = [];
for (const f of failed) {
  out.push('=== ' + f.id.slice(-6) + ' ' + f.title.slice(0, 50) + ' ===');
  if (f.result_path && fs.existsSync(f.result_path)) {
    const result = JSON.parse(fs.readFileSync(f.result_path, 'utf-8'));
    out.push('Content length: ' + (result.content?.length || 0));
    out.push('First 500 chars:');
    out.push(result.content?.slice(0, 500) || 'NO CONTENT');
  } else {
    out.push('No result file');
  }
  out.push('');
}

fs.writeFileSync('run9-failures.txt', out.join('\n'), 'utf-8');
console.log('Written', failed.length, 'failures');
