const http = require('http');

const req = http.get('http://127.0.0.1:7778/api/status', (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    const d = JSON.parse(data);
    process.stderr.write(`RESULT: a=${d.activeJobs} q=${d.queuedJobs} c=${d.completedJobs} f=${d.failedJobs}\n`);
  });
});
req.on('error', e => process.stderr.write('ERROR: ' + e.message + '\n'));
