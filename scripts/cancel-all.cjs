const path = require('path');
const db = require('better-sqlite3')(path.join(__dirname, '..', 'kingdom', 'kingdom.db'));

// Cancel all queued/running jobs from any objective
const cancelledJobs = db.prepare("UPDATE jobs SET status='cancelled' WHERE status IN ('queued','running')").run();
console.log(`Cancelled ${cancelledJobs.changes} queued/running jobs`);

// Cancel all queued/running tasks  
const cancelledTasks = db.prepare("UPDATE task_graph_nodes SET status='cancelled' WHERE status IN ('queued','running')").run();
console.log(`Cancelled ${cancelledTasks.changes} queued/running tasks`);

db.close();
