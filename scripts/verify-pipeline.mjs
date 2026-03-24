#!/usr/bin/env node
/**
 * Verify all pipeline stages are working after a summon.
 * Checks: task transitions, heartbeats, reviews, crypt entries, event logs.
 *
 * Usage: node scripts/verify-pipeline.mjs
 */
import Database from 'better-sqlite3';
import { join } from 'node:path';

const dbPath = join(process.cwd(), 'kingdom', 'kingdom.db');
const db = new Database(dbPath, { readonly: true });

function count(sql) {
  return db.prepare(sql).get();
}

console.log('═══ Pipeline Verification Report ═══\n');

// Tasks
const tasks = count('SELECT COUNT(*) as total, SUM(CASE WHEN status != \'queued\' THEN 1 ELSE 0 END) as transitioned FROM task_graph_nodes WHERE level != \'epic\'');
console.log(`Tasks: ${tasks.total} total, ${tasks.transitioned} transitioned from queued`);

const taskStatuses = db.prepare('SELECT status, COUNT(*) as cnt FROM task_graph_nodes GROUP BY status').all();
console.log('  Status breakdown:', taskStatuses.map(r => `${r.status}=${r.cnt}`).join(', '));

// Jobs
const jobs = count('SELECT COUNT(*) as total, SUM(CASE WHEN status = \'completed\' THEN 1 ELSE 0 END) as completed, SUM(CASE WHEN status LIKE \'failed%\' THEN 1 ELSE 0 END) as failed FROM jobs');
console.log(`\nJobs: ${jobs.total} total, ${jobs.completed} completed, ${jobs.failed} failed`);

const jobStatuses = db.prepare('SELECT status, COUNT(*) as cnt FROM jobs GROUP BY status').all();
console.log('  Status breakdown:', jobStatuses.map(r => `${r.status}=${r.cnt}`).join(', '));

// Heartbeats
const hb = count('SELECT COUNT(*) as total, COUNT(DISTINCT job_id) as jobs FROM heartbeats');
console.log(`\nHeartbeats: ${hb.total} total across ${hb.jobs} jobs`);

// Reviews
const reviews = count('SELECT COUNT(*) as total, SUM(CASE WHEN decision = \'approved\' THEN 1 ELSE 0 END) as approved, SUM(CASE WHEN decision = \'rejected\' THEN 1 ELSE 0 END) as rejected FROM review_decisions');
console.log(`Reviews: ${reviews.total} total, ${reviews.approved} approved, ${reviews.rejected} rejected`);

// Crypt entries
const crypt = count('SELECT COUNT(*) as total, SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) as success FROM crypt_entries');
console.log(`Crypt entries: ${crypt.total} total, ${crypt.success} successful`);

// Event log
const events = count('SELECT COUNT(*) as total FROM event_log');
console.log(`Event log entries: ${events.total}`);

if (events.total > 0) {
  const eventTypes = db.prepare('SELECT event_type, COUNT(*) as cnt FROM event_log GROUP BY event_type').all();
  console.log('  Event types:', eventTypes.map(r => `${r.event_type}=${r.cnt}`).join(', '));
}

// Token usage
const tokens = count('SELECT SUM(tokens_used) as total FROM jobs WHERE tokens_used IS NOT NULL');
console.log(`\nTotal tokens used: ${tokens.total ?? 0}`);

// Pipeline stage check
console.log('\n═══ Pipeline Stage Verification ═══');
const stages = [
  ['Task transitions', tasks.transitioned > 0],
  ['Heartbeats written', hb.total > 0],
  ['Reviews conducted', reviews.total > 0],
  ['Crypt entries recorded', crypt.total > 0],
  ['Events logged', events.total > 0],
  ['Tokens tracked', (tokens.total ?? 0) > 0],
];

let allPassed = true;
for (const [name, pass] of stages) {
  console.log(`  ${pass ? '✓' : '✗'} ${name}`);
  if (!pass) allPassed = false;
}

console.log(`\n${allPassed ? '✓ ALL PIPELINE STAGES VERIFIED' : '✗ SOME STAGES MISSING — check above'}`);

db.close();
