const db = require('better-sqlite3')('./kingdom/kingdom.db');
const fs = require('fs');

const OBJ = '01KMFJY9D6XADS79S9CZNABM5J'; // Run 10

// Job counts
const jobCounts = db.prepare(
  "SELECT j.status, COUNT(*) as cnt FROM jobs j JOIN task_graph_nodes t ON j.task_id=t.id WHERE t.objective_id=? GROUP BY j.status"
).all(OBJ);

// Task counts
const taskCounts = db.prepare(
  "SELECT status, COUNT(*) as cnt FROM task_graph_nodes WHERE objective_id=? GROUP BY status"
).all(OBJ);

// File lines
const fileLines = fs.readFileSync('packages/ui/src/engine/pixel-characters.ts', 'utf-8').split('\n').length;
const bakExists = fs.existsSync('packages/ui/src/engine/pixel-characters.ts.bak');
const bakLines = bakExists ? fs.readFileSync('packages/ui/src/engine/pixel-characters.ts.bak', 'utf-8').split('\n').length : 0;

// Events summary
const events = db.prepare(
  `SELECT e.event_type, e.details, j.id as job_id, t.title, e.timestamp
   FROM event_log e LEFT JOIN jobs j ON e.job_id=j.id LEFT JOIN task_graph_nodes t ON j.task_id=t.id
   WHERE t.objective_id=? ORDER BY e.timestamp`
).all(OBJ);

// All jobs detail
const jobs = db.prepare(
  `SELECT j.id, j.status, j.started_at, j.heartbeat_at, t.title, t.status as task_status
   FROM jobs j JOIN task_graph_nodes t ON j.task_id=t.id WHERE t.objective_id=? ORDER BY j.created_at`
).all(OBJ);

const out = [];
out.push('=== Run 10 Status ===');
out.push('Jobs: ' + JSON.stringify(Object.fromEntries(jobCounts.map(r => [r.status, r.cnt]))));
out.push('Tasks: ' + JSON.stringify(Object.fromEntries(taskCounts.map(r => [r.status, r.cnt]))));
out.push('File: ' + fileLines + ' lines' + (bakExists ? ', Backup: ' + bakLines : ', No backup'));

// Count approved vs rejected
const approved = events.filter(e => e.event_type === 'review_decision' && JSON.parse(e.details||'{}').verdict === 'approved').length;
const rejected = events.filter(e => e.event_type === 'review_decision' && JSON.parse(e.details||'{}').verdict === 'rejected').length;
out.push('Reviews: ' + approved + ' approved, ' + rejected + ' rejected');

// Diff applied tracking
const diffApplied = events.filter(e => e.event_type === 'task_transition' && (e.details||'').includes('"diff_applied":true')).length;
const diffFailed = events.filter(e => e.event_type === 'task_transition' && (e.details||'').includes('"diff_applied":false')).length;
out.push('Diffs: ' + diffApplied + ' applied, ' + diffFailed + ' failed');

out.push('');
out.push('=== Job Details ===');
for (const j of jobs) {
  const age = j.heartbeat_at ? Math.round((Date.now() - new Date(j.heartbeat_at).getTime()) / 1000) + 's' : '-';
  out.push(`  ${j.id.slice(-6)} [${j.status}] task:${j.task_status} ${j.title.slice(0, 50)} (hb:${age})`);
}

// Show rejection reasons
const rejects = events.filter(e => e.event_type === 'retry');
if (rejects.length > 0) {
  out.push('');
  out.push('=== Rejection Reasons ===');
  for (const r of rejects) {
    const d = JSON.parse(r.details || '{}');
    out.push(`  ${(r.job_id||'').slice(-6)} ${(r.title||'').slice(0, 40)}: ${JSON.stringify(d.reasons)}`);
  }
}

fs.writeFileSync('run10-status.txt', out.join('\n'), 'utf-8');
console.log('Written');
