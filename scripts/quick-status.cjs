#!/usr/bin/env node
const Database = require('better-sqlite3');
const db = new Database('kingdom/kingdom.db');

const jobs = db.prepare('SELECT status, COUNT(*) as c FROM jobs GROUP BY status').all();
const tasks = db.prepare("SELECT status, COUNT(*) as c FROM task_graph_nodes WHERE level != 'epic' GROUP BY status").all();
const tokens = db.prepare('SELECT SUM(tokens_used) as total FROM jobs WHERE tokens_used IS NOT NULL').get();
const heartbeats = db.prepare('SELECT COUNT(*) as c FROM heartbeats').get();
const reviews = db.prepare('SELECT decision, COUNT(*) as c FROM review_decisions GROUP BY decision').all();
const crypt = db.prepare('SELECT COUNT(*) as c FROM crypt_entries').get();
const events = db.prepare('SELECT event_type, COUNT(*) as c FROM event_log GROUP BY event_type').all();
const diffApplied = db.prepare("SELECT COUNT(*) as c FROM event_log WHERE event_type='task_transition' AND details LIKE '%diff_applied%true%'").get();

console.log('=== KINGDOM STATUS ===');
console.log('Jobs:', jobs.map(r => `${r.status}=${r.c}`).join(', '));
console.log('Tasks:', tasks.map(r => `${r.status}=${r.c}`).join(', '));
console.log('Total tokens:', tokens.total);
console.log('Heartbeats:', heartbeats.c);
console.log('Reviews:', reviews.map(r => `${r.decision}=${r.c}`).join(', '));
console.log('Crypt entries:', crypt.c);
console.log('Events:', events.map(r => `${r.event_type}=${r.c}`).join(', '));
console.log('Diffs applied:', diffApplied.c);
