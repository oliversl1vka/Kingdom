const db = require('better-sqlite3')('./kingdom/kingdom.db');
const fs = require('fs');

const OBJ = '01KMFGY4GHJPFD8RGB1PA5AETQ';
const lines = [];

// Get completed jobs with failed diffs
const jobs = db.prepare(
  "SELECT substr(j.id,-6) as jid, j.id, j.result_path, t.title, t.status as task_status FROM jobs j JOIN task_graph_nodes t ON j.task_id=t.id WHERE t.objective_id=? AND t.status='completed-with-warnings' LIMIT 3"
).all(OBJ);

jobs.forEach(j => {
  lines.push(`\n=== ${j.jid}: ${j.title} ===`);
  lines.push('Task status: ' + j.task_status);
  if (j.result_path && fs.existsSync(j.result_path)) {
    const result = JSON.parse(fs.readFileSync(j.result_path, 'utf-8'));
    lines.push('Has content: ' + !!result.content);
    lines.push('Content length: ' + result.content?.length);
    lines.push('Finish reason: ' + result.finish_reason);
    // Show first 500 chars of diff
    if (result.content) {
      lines.push('Content preview: ' + result.content.substring(0, 500));
    }
  } else {
    lines.push('No result file');
  }
});

fs.writeFileSync('check-fail.txt', lines.join('\n'), 'utf-8');
console.log('Written');
