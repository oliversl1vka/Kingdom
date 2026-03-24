const db = require('better-sqlite3')('./kingdom/kingdom.db');
const j = db.prepare("SELECT started_at, heartbeat_at FROM jobs WHERE id LIKE '%B6N6HB'").get();
console.log('started:', j.started_at);
console.log('heartbeat:', j.heartbeat_at);
console.log('now:', new Date().toISOString());
const elapsed = (Date.now() - new Date(j.started_at).getTime()) / 1000;
console.log('elapsed:', Math.round(elapsed) + 's');
