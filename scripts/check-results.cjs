const db = require('better-sqlite3')('./kingdom/kingdom.db');
const fs = require('fs');

const jobs = db.prepare(
  "SELECT result_path FROM jobs j JOIN task_graph_nodes t ON j.task_id=t.id WHERE t.objective_id='01KME9W52GBMWJFHM5HN4YG1R7' AND j.result_path IS NOT NULL LIMIT 3"
).all();

jobs.forEach((j, i) => {
  console.log(`\n--- Result ${i+1}: ${j.result_path} ---`);
  if (fs.existsSync(j.result_path)) {
    const data = JSON.parse(fs.readFileSync(j.result_path, 'utf-8'));
    // Show top-level keys
    console.log('Keys:', Object.keys(data));
    console.log('diff_applied:', data.diff_applied);
    console.log('diff_error:', data.diff_error);
    // Check for nested structures
    if (data.raw) console.log('raw keys:', Object.keys(data.raw));
    if (data.result) console.log('result keys:', Object.keys(data.result));
    // Show first 200 chars of the response text if available
    const text = data.text || data.content || data.raw?.choices?.[0]?.message?.content;
    if (text) console.log('text preview:', text.substring(0, 200));
  } else {
    console.log('FILE NOT FOUND');
  }
});
