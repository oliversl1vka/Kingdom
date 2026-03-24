const db = require('better-sqlite3')('./kingdom/kingdom.db');
const fs = require('fs');

const OBJ = '01KMFJ62F26VA8J5J9CYCGHYM1';

// Get review failure details
const failures = db.prepare(
  `SELECT j.id, t.title, e.event_type, e.details 
   FROM event_log e 
   JOIN jobs j ON e.job_id=j.id 
   JOIN task_graph_nodes t ON j.task_id=t.id 
   WHERE t.objective_id=? AND e.event_type IN ('REVIEW_FAIL','DIFF_FAIL','DIFF_OK','REVIEW_PASS')
   ORDER BY e.timestamp`
).all(OBJ);

const out = [];
for (const f of failures) {
  out.push(`[${f.event_type}] ${f.id.slice(-6)} ${f.title.slice(0, 50)}`);
  if (f.details) {
    try {
      const d = JSON.parse(f.details);
      out.push('  ' + JSON.stringify(d).slice(0, 300));
    } catch { out.push('  ' + f.details.slice(0, 300)); }
  }
}

fs.writeFileSync('run9-events.txt', out.join('\n'), 'utf-8');
console.log('Written');
