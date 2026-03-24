const db = require('better-sqlite3')('kingdom/kingdom.db');
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
console.log('Tables:', tables.map(r => r.name).join(', '));

// Find jobs/tasks tables
for (const t of tables) {
  const cols = db.prepare(`PRAGMA table_info(${t.name})`).all();
  console.log(`\n${t.name}:`, cols.map(c => c.name).join(', '));
}

db.close();
