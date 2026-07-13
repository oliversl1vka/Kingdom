// Soft reset: clear runtime state but preserve projects row.
const Database = require('better-sqlite3');
const db = new Database('C:/Users/slivk/Kingdom/kingdom/kingdom.db');
const tables = [
  'event_log','incidents','review_decisions','jobs','task_graph_nodes',
  'objectives','file_locks'
];
const ORDER = ['event_log','review_decisions','incidents','jobs','task_graph_nodes','objectives','file_locks'];
db.pragma('foreign_keys = OFF');
for (const t of ORDER) {
  try {
    const info = db.prepare(`SELECT count(*) as c FROM ${t}`).get();
    db.prepare(`DELETE FROM ${t}`).run();
    console.log(`cleared ${t} (${info.c} rows)`);
  } catch (e) { console.log(`skip ${t}: ${e.message}`); }
}
console.log('projects preserved:', db.prepare('SELECT * FROM projects').all());
db.close();
