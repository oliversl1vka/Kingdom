const db = require('better-sqlite3')('./kingdom/kingdom.db');
const fs = require('fs');

const OBJ = '01KMFGY4GHJPFD8RGB1PA5AETQ';

// Cancel all queued/running jobs
const cancel = db.prepare(
  "UPDATE jobs SET status='cancelled' WHERE task_id IN (SELECT id FROM task_graph_nodes WHERE objective_id=?) AND status IN ('queued','running','preparing-context','awaiting-budget-check')"
);
const r1 = cancel.run(OBJ);
console.log('Cancelled jobs:', r1.changes);

// Cancel queued tasks
const cancelTasks = db.prepare(
  "UPDATE task_graph_nodes SET status='cancelled' WHERE objective_id=? AND status IN ('queued','running','preparing-context','awaiting-budget-check')"
);
const r2 = cancelTasks.run(OBJ);
console.log('Cancelled tasks:', r2.changes);

// Restore backup
const src = 'packages/ui/src/engine/pixel-characters.ts.bak';
const dst = 'packages/ui/src/engine/pixel-characters.ts';
if (fs.existsSync(src)) {
  fs.copyFileSync(src, dst);
  const lines = fs.readFileSync(dst, 'utf-8').split('\n').length;
  console.log('Restored backup:', lines, 'lines');
} else {
  console.log('No backup found!');
}
