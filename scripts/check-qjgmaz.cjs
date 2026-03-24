const db = require('better-sqlite3')('kingdom/kingdom.db');
const j = db.prepare("SELECT id, status, started_at, heartbeat_at FROM jobs WHERE id LIKE '%QJGMAZ'").get();
console.log(JSON.stringify(j, null, 2));
if (j && j.heartbeat_at) {
  console.log('Heartbeat age:', Math.round((Date.now() - j.heartbeat_at) / 1000) + 's');
}
if (j && j.started_at) {
  console.log('Running for:', Math.round((Date.now() - j.started_at) / 1000) + 's');
}
// Check active file locks
const running = db.prepare("SELECT id, status, started_at, heartbeat_at FROM jobs WHERE status = 'running'").all();
console.log('\nRunning jobs:', running.length);
running.forEach(r => {
  console.log(' ', r.id.slice(-6), 'started', Math.round((Date.now() - r.started_at) / 1000) + 's ago', 'hb', Math.round((Date.now() - r.heartbeat_at) / 1000) + 's ago');
});
db.close();
