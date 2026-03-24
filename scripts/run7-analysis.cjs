const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

const db = new Database(path.join(__dirname, '..', 'kingdom', 'kingdom.db'), { readonly: true });
const OBJ = '01KME9W52GBMWJFHM5HN4YG1R7';

// 1. Status distribution
const statusCounts = db.prepare(
  `SELECT j.status, COUNT(*) as count FROM jobs j JOIN task_graph_nodes t ON j.task_id=t.id WHERE t.objective_id=? GROUP BY j.status`
).all(OBJ);

// 2. All jobs with details
const jobs = db.prepare(
  `SELECT substr(j.id,-6) as jid, j.id as full_id, j.status, j.started_at, j.heartbeat_at, j.result_path, 
          t.title, t.context_refs
   FROM jobs j JOIN task_graph_nodes t ON j.task_id = t.id 
   WHERE t.objective_id=? ORDER BY j.started_at`
).all(OBJ);

// 3. Analyze result files for diff_applied
const results = [];
for (const job of jobs) {
  const info = {
    jid: job.jid || job.full_id,
    status: job.status,
    title: job.title,
    started: job.started_at,
    finished: job.heartbeat_at,
    diff_applied: null,
    diff_error: null,
    has_result: false,
    finish_reason: null,
    usage_tokens: null,
  };
  
  if (job.result_path && fs.existsSync(job.result_path)) {
    info.has_result = true;
    try {
      const result = JSON.parse(fs.readFileSync(job.result_path, 'utf-8'));
      info.diff_applied = result.diff_applied || false;
      info.diff_error = result.diff_error || null;
      info.finish_reason = result.raw?.choices?.[0]?.finish_reason || null;
      info.usage_tokens = result.raw?.usage || null;
    } catch(e) {
      info.diff_error = 'parse_error: ' + e.message;
    }
  }
  results.push(info);
}

// 4. Summary stats
const total = results.length;
const completed = results.filter(r => r.status === 'completed').length;
const running = results.filter(r => r.status === 'running').length;
const queued = results.filter(r => r.status === 'queued').length;
const diffsApplied = results.filter(r => r.diff_applied === true).length;
const diffsFailed = results.filter(r => r.has_result && r.diff_applied !== true).length;
const noResult = results.filter(r => !r.has_result && r.status === 'completed').length;

// 5. Check file health
let fileHealth = 'unknown';
let fileLines = 0;
const targetFile = path.join(__dirname, '..', 'packages', 'ui', 'src', 'engine', 'pixel-characters.ts');
const backupFile = targetFile + '.bak';
if (fs.existsSync(targetFile)) {
  const content = fs.readFileSync(targetFile, 'utf-8');
  fileLines = content.split('\n').length;
  fileHealth = `${fileLines} lines`;
}
const hasBackup = fs.existsSync(backupFile);
let backupLines = 0;
if (hasBackup) {
  backupLines = fs.readFileSync(backupFile, 'utf-8').split('\n').length;
}

// 6. Skip event log (schema mismatch)
const events = [];

const report = {
  summary: {
    total,
    completed,
    running,
    queued,
    diffs_applied: diffsApplied,
    diffs_failed: diffsFailed,
    no_result: noResult,
  },
  file_health: {
    current_lines: fileLines,
    has_backup: hasBackup,
    backup_lines: backupLines,
  },
  error_events: events.length,
  jobs: results,
};

fs.writeFileSync(
  path.join(__dirname, '..', 'run7-analysis.json'), 
  JSON.stringify(report, null, 2)
);
console.log('Analysis written to run7-analysis.json');
console.log('Summary:', JSON.stringify(report.summary));
console.log('File health:', JSON.stringify(report.file_health));
