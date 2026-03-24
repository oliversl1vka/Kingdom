const r = await fetch('http://127.0.0.1:7778/api/status');
const d = await r.json();
process.stdout.write(`active=${d.activeJobs} queued=${d.queuedJobs} completed=${d.completedJobs} failed=${d.failedJobs}\n`);
