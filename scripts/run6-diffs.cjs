const db = require('better-sqlite3')('./kingdom/kingdom.db');
const fs = require('fs');

// Get all jobs from Run 6 that completed
const events = db.prepare(
  `SELECT e.job_id, e.event_type, e.payload
   FROM event_log e
   WHERE e.job_id IN (
     SELECT j.id FROM jobs j JOIN task_graph_nodes t ON j.task_id=t.id
     WHERE t.objective_id='01KME8JES8T4PB10TA1B0K4223'
   )
   AND e.event_type='task_transition'
   ORDER BY e.created_at`
).all();

const applied = [];
for (const e of events) {
  const p = JSON.parse(e.payload);
  if (p.diff_applied !== undefined) {
    applied.push(`${e.job_id.slice(-6)} | diff_applied=${p.diff_applied} | ${p.from}->${p.to}`);
  }
}

fs.writeFileSync('run6-diffs.txt', applied.join('\n'));
console.log(applied.length + ' transition events with diff info');
applied.forEach(a => console.log(a));
