const db = require('better-sqlite3')('kingdom/kingdom.db');
const failedTasks = db.prepare(`
  SELECT tgn.id, tgn.status, tgn.description, j.id as job_id
  FROM task_graph_nodes tgn
  JOIN jobs j ON j.task_id = tgn.id
  WHERE tgn.objective_id = '01KMFJY9D6XADS79S9CZNABM5J'
  AND tgn.status = 'completed-with-warnings'
`).all();

for (const t of failedTasks) {
  console.log(`\nTask: ${t.id.slice(-6)} — ${t.description}`);
  console.log(`Job: ${t.job_id.slice(-6)}`);
  
  // Check event log for failure details
  const events = db.prepare(`
    SELECT event_type, details FROM event_log 
    WHERE job_id = ? 
    ORDER BY timestamp
  `).all(t.job_id);
  
  for (const e of events) {
    if (e.event_type === 'task_transition') {
      const d = JSON.parse(e.details);
      if (d.diff_applied === false) {
        console.log(`  Diff failed to apply`);
      }
    }
  }
}
db.close();
