const db = require('better-sqlite3')('./kingdom/kingdom.db');
const fs = require('fs');

// Check result for C097AN (idle animation - invalid format)
const job = db.prepare("SELECT result_path FROM jobs WHERE id LIKE '%C097AN'").get();
if (job && job.result_path && fs.existsSync(job.result_path)) {
  const result = JSON.parse(fs.readFileSync(job.result_path, 'utf-8'));
  const out = [];
  out.push('=== C097AN (idle animation) - "Diff format is invalid" ===');
  out.push('Content length: ' + result.content?.length);
  out.push('Finish reason: ' + result.finish_reason);
  out.push('');
  out.push('=== FULL CONTENT ===');
  out.push(result.content || 'NO CONTENT');
  fs.writeFileSync('run9-c097an.txt', out.join('\n'), 'utf-8');
  console.log('Written C097AN');
}

// Check result for CXMPYQ (tilemap - files outside scope)
const job2 = db.prepare("SELECT result_path FROM jobs WHERE id LIKE '%CXMPYQ'").get();
if (job2 && job2.result_path && fs.existsSync(job2.result_path)) {
  const result = JSON.parse(fs.readFileSync(job2.result_path, 'utf-8'));
  const out = [];
  out.push('=== CXMPYQ (tilemap) - "files outside allowed scope" ===');
  out.push('Content length: ' + result.content?.length);
  out.push('First 200 chars: ' + result.content?.slice(0, 200));
  fs.writeFileSync('run9-cxmpyq.txt', out.join('\n'), 'utf-8');
  console.log('Written CXMPYQ');
}
