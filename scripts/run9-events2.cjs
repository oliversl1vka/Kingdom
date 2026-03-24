const db = require('better-sqlite3')('./kingdom/kingdom.db');
const fs = require('fs');

const OBJ = '01KMFJ62F26VA8J5J9CYCGHYM1';

// Get all events for this objective
const events = db.prepare(
  `SELECT e.event_type, e.details, e.timestamp, j.id as job_id, t.title
   FROM event_log e 
   LEFT JOIN jobs j ON e.job_id=j.id 
   LEFT JOIN task_graph_nodes t ON j.task_id=t.id 
   WHERE t.objective_id=?
   ORDER BY e.timestamp`
).all(OBJ);

const out = [];
for (const e of events) {
  const time = e.timestamp?.split('T')[1]?.slice(0, 8) || '?';
  out.push(`[${time}] ${e.event_type} | ${(e.job_id||'').slice(-6)} ${(e.title||'').slice(0, 45)}`);
  if (e.details) {
    try {
      const d = JSON.parse(e.details);
      out.push('  ' + JSON.stringify(d).slice(0, 400));
    } catch { out.push('  ' + String(e.details).slice(0, 400)); }
  }
}

fs.writeFileSync('run9-events.txt', out.join('\n'), 'utf-8');
console.log('Written', events.length, 'events');
