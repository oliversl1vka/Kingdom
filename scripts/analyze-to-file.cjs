const path = require('path');
const fs = require('fs');
const db = require('better-sqlite3')(path.join(__dirname, '..', 'kingdom', 'kingdom.db'));

const obj = db.prepare('SELECT id FROM objectives ORDER BY created_at DESC LIMIT 1').get();
const output = [`Objective: ${obj.id}`];

// Model invocations
const rows = db.prepare(`
  SELECT el.event_type, el.details, el.job_id 
  FROM event_log el 
  JOIN jobs j ON el.job_id = j.id 
  JOIN task_graph_nodes t ON j.task_id = t.id
  WHERE t.objective_id = ?
    AND el.event_type = 'model_invocation'
`).all(obj.id);

output.push(`Model invocations: ${rows.length}`);
for (const r of rows) {
  try {
    const d = JSON.parse(r.details);
    output.push(`Job ${r.job_id.slice(-6)}: tokens=${d.completion_tokens}, reason=${d.finish_reason}`);
  } catch {}
}

// Diff results
const transitions = db.prepare(`
  SELECT el.details, el.job_id
  FROM event_log el
  JOIN jobs j ON el.job_id = j.id
  JOIN task_graph_nodes t ON j.task_id = t.id
  WHERE t.objective_id = ?
    AND el.event_type = 'task_transition'
    AND el.details LIKE '%diff_applied%'
`).all(obj.id);

output.push(`\nDiff results: ${transitions.length}`);
let applied = 0;
for (const r of transitions) {
  try {
    const d = JSON.parse(r.details);
    if (d.diff_applied) applied++;
    output.push(`Job ${r.job_id.slice(-6)}: applied=${d.diff_applied}`);
  } catch {}
}
output.push(`\nTotal diffs applied: ${applied}/${transitions.length}`);

// Task status counts
const tasks = db.prepare('SELECT status FROM task_graph_nodes WHERE objective_id = ?').all(obj.id);
const statusMap = {};
for (const t of tasks) statusMap[t.status] = (statusMap[t.status] || 0) + 1;
output.push(`Task statuses: ${JSON.stringify(statusMap)}`);

db.close();

const outFile = path.join(__dirname, '..', 'kingdom', 'run-analysis.txt');
fs.writeFileSync(outFile, output.join('\n'), 'utf-8');
process.stderr.write('Analysis written to ' + outFile + '\n');
