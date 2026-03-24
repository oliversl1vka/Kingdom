const db = require('better-sqlite3')('./kingdom/kingdom.db');
const fs = require('fs');

const OBJ = '01KMFGY4GHJPFD8RGB1PA5AETQ';

// Get ONE failed diff - full content
const job = db.prepare(
  "SELECT j.result_path, t.title FROM jobs j JOIN task_graph_nodes t ON j.task_id=t.id WHERE t.objective_id=? AND t.status='completed-with-warnings' LIMIT 1"
).get(OBJ);

if (job && job.result_path && fs.existsSync(job.result_path)) {
  const result = JSON.parse(fs.readFileSync(job.result_path, 'utf-8'));
  
  const output = [];
  output.push('Title: ' + job.title);
  output.push('Finish reason: ' + result.finish_reason);
  output.push('Content length: ' + result.content?.length);
  output.push('');
  output.push('=== FULL DIFF CONTENT ===');
  output.push(result.content || 'NO CONTENT');
  
  fs.writeFileSync('failed-diff-sample.txt', output.join('\n'), 'utf-8');
  console.log('Written');
} else {
  console.log('No result found');
}
