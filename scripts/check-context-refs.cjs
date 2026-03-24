const db = require('better-sqlite3')('./kingdom/kingdom.db');

// Check context_refs format
const rows = db.prepare(
  "SELECT title, context_refs FROM task_graph_nodes WHERE objective_id='01KME9W52GBMWJFHM5HN4YG1R7' AND level='task' LIMIT 5"
).all();

rows.forEach(r => {
  console.log(`\nTask: ${r.title}`);
  console.log(`context_refs: ${r.context_refs}`);
});
