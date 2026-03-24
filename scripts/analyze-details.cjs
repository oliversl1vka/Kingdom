const db = require('better-sqlite3')('kingdom/kingdom.db');

// Find model invocations for latest objective
const rows = db.prepare(`
  SELECT el.event_type, el.details, el.job_id 
  FROM event_log el 
  JOIN jobs j ON el.job_id = j.id 
  JOIN task_graph_nodes t ON j.task_id = t.id
  WHERE t.objective_id = (SELECT id FROM objectives ORDER BY created_at DESC LIMIT 1)
    AND el.event_type = 'model_invocation'
`).all();

console.log(`Model invocations: ${rows.length}`);
for (const r of rows) {
  try {
    const d = JSON.parse(r.details);
    console.log(`Job ${r.job_id.slice(-6)}: completion_tokens=${d.completion_tokens}, finish_reason=${d.finish_reason}`);
  } catch {}
}

// Also check task transitions for diff info
const transitions = db.prepare(`
  SELECT el.details, el.job_id
  FROM event_log el
  JOIN jobs j ON el.job_id = j.id
  JOIN task_graph_nodes t ON j.task_id = t.id
  WHERE t.objective_id = (SELECT id FROM objectives ORDER BY created_at DESC LIMIT 1)
    AND el.event_type = 'task_transition'
    AND el.details LIKE '%diff_applied%'
`).all();

console.log(`\nDiff results:`);
for (const r of transitions) {
  try {
    const d = JSON.parse(r.details);
    console.log(`Job ${r.job_id.slice(-6)}: diff_applied=${d.diff_applied}, to=${d.to}`);
  } catch {}
}

db.close();
