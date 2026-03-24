const fs = require('fs');
const lines = fs.readFileSync('packages/ui/src/engine/pixel-characters.ts', 'utf-8').split('\n');
const errorLines = [990, 1100, 1103, 1224, 1831, 2404, 2484, 2730];
for (const ln of errorLines) {
  console.log(`Line ${ln}: ${lines[ln - 1].trim().substring(0, 100)}`);
}

// Find all function declarations and check for duplicates
const funcMap = {};
lines.forEach((line, i) => {
  const m = line.match(/^(?:export )?function (\w+)/);
  if (m) {
    const name = m[1];
    if (!funcMap[name]) funcMap[name] = [];
    funcMap[name].push(i + 1);
  }
});

console.log('\n=== Duplicate functions ===');
for (const [name, lns] of Object.entries(funcMap)) {
  if (lns.length > 1) console.log(`  ${name}: lines ${lns.join(', ')}`);
}
