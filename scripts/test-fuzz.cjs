const fs = require('fs');
const path = require('path');
const { applyPatch, parsePatch } = require(require('path').join(__dirname, '..', 'node_modules', '.pnpm', 'diff@8.0.3', 'node_modules', 'diff'));

// Load the result
const result = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'kingdom', 'results', '01KMDWST3W644Y3TCY610CVBWD.result.json'), 'utf-8'));
const diffText = result.content;

// Load the target file
const filePath = path.join(__dirname, '..', 'packages', 'ui', 'src', 'engine', 'pixel-characters.ts');
const original = fs.readFileSync(filePath, 'utf-8');

console.log('Original file lines:', original.split('\n').length);
console.log('Diff length:', diffText.length);

// Strip markdown fences
const fencePattern = /^```(?:diff|patch|unified-diff)?\s*\n([\s\S]*?)\n```\s*$/;
const match = diffText.match(fencePattern);
const cleanDiff = match ? match[1] : diffText;
console.log('Clean diff length:', cleanDiff.length);

// Fix hunk line counts (same as diff-applicator.ts)
function fixDiffLineCounts(diffText) {
  const lines = diffText.split('\n');
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
    } else {
      out.push(line);
      i++;
    }
  }
  return out.join('\n');
}

// Parse diff
const fixedDiff = fixDiffLineCounts(cleanDiff);
console.log('Fixed diff length:', fixedDiff.length);

const patches = parsePatch(fixedDiff);
console.log('Patches:', patches.length);
for (const p of patches) {
  console.log('  File:', p.newFileName, 'Hunks:', p.hunks?.length);
  if (p.hunks) {
    for (const h of p.hunks) {
      console.log(`    @@ -${h.oldStart},${h.oldLines} +${h.newStart},${h.newLines} @@`);
    }
  }
}

const { applyDiff } = require(require('path').join(__dirname, '..', 'packages', 'blacksmith', 'dist', 'diff-applicator.js'));

const results = [];
const start = Date.now();
const workspacePath = path.join(__dirname, '..');
const r = applyDiff(cleanDiff, workspacePath);
const elapsed = Date.now() - start;
results.push(`applyDiff: success=${r.success} applied=${r.appliedFiles.join(',')} failed=${r.failedFiles.join(',')} errors=${r.errors.join('; ')} (${elapsed}ms)`);
fs.writeFileSync(path.join(__dirname, '..', 'kingdom', 'fuzz-test.txt'), results.join('\n'), 'utf-8');
