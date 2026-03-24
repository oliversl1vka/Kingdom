const { parsePatch, applyPatch } = require('../packages/blacksmith/node_modules/diff');
const fs = require('fs');
const path = require('path');

const result = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'kingdom', 'results', '01KMDWST3W644Y3TCY610CVBWD.result.json'), 'utf-8'));
let diffText = result.content;

// Normalize line endings (same as applyDiff does now)
diffText = diffText.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

// Use built fixDiffLineCounts
const { applyDiff } = require('../packages/blacksmith/dist/diff-applicator.js');

// Also import the internal fixDiffLineCounts by reading the source
// Just inline it here for diagnostics
function fixDiffLineCounts(dt) {
  const lines = dt.split('\n');
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const hunkMatch = line.match(/^@@\s+-(\d+)(?:,\d+)?\s+\+(\d+)(?:,\d+)?\s+@@(.*)$/);
    if (hunkMatch) {
      const oldStart = parseInt(hunkMatch[1], 10);
      const newStart = parseInt(hunkMatch[2], 10);
      const trailing = hunkMatch[3] || '';
      const hunkLines = [];
      i++;
      while (i < lines.length) {
        const l = lines[i];
        if (l.match(/^@@\s/) || l.startsWith('diff --git ') || l.startsWith('--- ') || l.startsWith('+++ ')) break;
        if (l === '\\ No newline at end of file') { hunkLines.push(l); i++; continue; }
        hunkLines.push(l);
        i++;
      }
      let oldLines = 0, newLines = 0;
      for (const hl of hunkLines) {
        if (hl === '\\ No newline at end of file') continue;
        if (hl.startsWith('-')) oldLines++;
        else if (hl.startsWith('+')) newLines++;
        else { oldLines++; newLines++; }
      }
      out.push(`@@ -${oldStart},${oldLines} +${newStart},${newLines} @@${trailing}`);
      out.push(...hunkLines);
    } else { out.push(line); i++; }
  }
  return out.join('\n');
}

const fixed = fixDiffLineCounts(diffText);
const patches = parsePatch(fixed);
const patch = patches[0];

console.log('=== PATCH INFO ===');
console.log('oldFileName:', patch.oldFileName);
console.log('newFileName:', patch.newFileName);
console.log('Hunks:', patch.hunks.length);

for (const hunk of patch.hunks) {
  console.log(`\n=== HUNK @@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`);
  
  // Show first 10 context/removed lines
  const contextLines = [];
  for (const line of hunk.lines) {
    if (line.startsWith('-') || line.startsWith(' ')) {
      contextLines.push(line);
      if (contextLines.length >= 10) break;
    }
  }
  console.log('\nFirst context/removed lines from diff:');
  for (const l of contextLines) {
    const hasR = l.includes('\r');
    console.log(`  ${JSON.stringify(l.substring(0, 80))}${hasR ? ' [HAS \\r]' : ''}`);
  }
}

// Now read the actual file and compare
const filePath = path.join(__dirname, '..', 'packages', 'ui', 'src', 'engine', 'pixel-characters.ts');
let original = fs.readFileSync(filePath, 'utf-8');
original = original.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
const fileLines = original.split('\n');

console.log('\n=== FILE LINES around 890 ===');
for (let i = 888; i <= 900 && i < fileLines.length; i++) {
  console.log(`  L${i + 1}: ${JSON.stringify(fileLines[i].substring(0, 80))}`);
}

// Check: what does the first hunk expect vs what's in the file?
const hunk = patch.hunks[0];
const firstFew = [];
for (const line of hunk.lines) {
  if (firstFew.length >= 5) break;
  if (line.startsWith('-') || line.startsWith(' ')) {
    firstFew.push(line.slice(1));
  }
}

console.log('\n=== COMPARISON: diff lines vs file lines ===');
const start = hunk.oldStart - 1; // 0-indexed
for (let i = 0; i < firstFew.length && start + i < fileLines.length; i++) {
  const diffLine = firstFew[i];
  const fileLine = fileLines[start + i];
  const match = diffLine === fileLine;
  if (!match) {
    console.log(`  Line ${start + i + 1}: MISMATCH`);
    console.log(`    diff: ${JSON.stringify(diffLine.substring(0, 80))}`);
    console.log(`    file: ${JSON.stringify(fileLine.substring(0, 80))}`);
  } else {
    console.log(`  Line ${start + i + 1}: MATCH`);
  }
}

// Try applyPatch directly with fuzz 5
console.log('\n=== APPLYING PATCH (fuzz=5) ===');
const patched = applyPatch(original, patch, { fuzzFactor: 5 });
console.log('Result:', patched !== false ? 'SUCCESS' : 'FAILED');

// Try with higher fuzz
console.log('\n=== APPLYING PATCH (fuzz=20) ===');
const patched2 = applyPatch(original, patch, { fuzzFactor: 20 });
console.log('Result:', patched2 !== false ? 'SUCCESS' : 'FAILED');
