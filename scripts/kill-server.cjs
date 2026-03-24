// Find and kill the server process on port 7778
const { execSync } = require('child_process');
try {
  const result = execSync('netstat -ano | findstr :7778 | findstr LISTENING', { encoding: 'utf-8' });
  const lines = result.trim().split('\n');
  for (const line of lines) {
    const parts = line.trim().split(/\s+/);
    const pid = parts[parts.length - 1];
    if (pid && /^\d+$/.test(pid)) {
      console.log('Killing PID', pid);
      try { process.kill(parseInt(pid)); } catch (e) { console.log('Kill error:', e.message); }
    }
  }
} catch (e) {
  console.log('No process found on 7778 or error:', e.message);
}
