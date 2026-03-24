const db = require('better-sqlite3')('kingdom/kingdom.db');

// Get the latest objective
const obj = db.prepare('SELECT id FROM objectives ORDER BY created_at DESC LIMIT 1').get();
console.log('Objective:', obj.id);

// Get tasks for this objective
const tasks = db.prepare('SELECT id, title, status, context_refs FROM task_graph_nodes WHERE objective_id = ?').all(obj.id);
console.log(`\nTasks: ${tasks.length} total`);

// Get jobs for these tasks
const statusCounts = {};
let diffsApplied = 0;
let diffsTotal = 0;
let truncatedResponses = 0;

for (const task of tasks) {
  const jobs = db.prepare('SELECT id, status, tokens_used FROM jobs WHERE task_id = ?').all(task.id);
  for (const job of jobs) {
    statusCounts[job.status] = (statusCounts[job.status] || 0) + 1;
  }
}

// Check event logs for diff results and model invocations
const events = db.prepare("SELECT event_type, details FROM event_log WHERE task_id IN (SELECT id FROM task_graph_nodes WHERE objective_id = ?)").all(obj.id);
for (const ev of events) {
  if (ev.event_type === 'task_transition' && ev.details) {
    try {
      const d = JSON.parse(ev.details);
      if (d.diff_applied !== undefined) {
        diffsTotal++;
        if (d.diff_applied) diffsApplied++;
      }
    } catch {}
  }
  if (ev.event_type === 'model_invocation' && ev.details) {
    try {
      const d = JSON.parse(ev.details);
      if (d.finish_reason === 'length') truncatedResponses++;
    } catch {}
  }
}

console.log('\nJob statuses:', JSON.stringify(statusCounts));
console.log(`Diffs: ${diffsApplied}/${diffsTotal} applied`);
console.log(`Truncated responses (finish_reason=length): ${truncatedResponses}`);

// Task status summary
const taskStatuses = {};
for (const t of tasks) {
  taskStatuses[t.status] = (taskStatuses[t.status] || 0) + 1;
}
console.log('Task statuses:', JSON.stringify(taskStatuses));

db.close();
