const db = require('better-sqlite3')('./kingdom/kingdom.db');

// Cancel any remaining queued/running jobs from previous runs
const r = db.prepare(
  "UPDATE jobs SET status='cancelled', cancel_requested=1, cancel_reason='superseded by Run 8' WHERE status IN ('queued','running')"
).run();
console.log('Cancelled:', r.changes, 'old jobs');
