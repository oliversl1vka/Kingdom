#!/usr/bin/env node
/**
 * Test the improved diff applicator against LLM-generated result files.
 * Usage: node scripts/test-diff-apply.mjs [--apply]
 * Without --apply flag, does dry run (backs up and restores the file).
 */
import { readFileSync, readdirSync, writeFileSync, existsSync, copyFileSync } from 'fs';
import { join } from 'path';
import { applyDiff } from '../packages/blacksmith/dist/diff-applicator.js';

const dir = 'kingdom/results';
const doApply = process.argv.includes('--apply');
const files = readdirSync(dir)
  .filter(f => f.endsWith('.result.json'))
  .sort()
  .slice(-20); // last 20 = current run

// Strip markdown fences
function stripFences(text) {
  const fencePattern = /^```(?:diff|patch|unified-diff)?\s*\n([\s\S]*?)\n```\s*$/;
  const match = text.trim().match(fencePattern);
  if (match) return match[1];
  const multiPattern = /```(?:diff|patch|unified-diff)?\s*\n([\s\S]*?)\n```/g;
  let result = '';
  let found = false;
  let m;
  while ((m = multiPattern.exec(text)) !== null) {
    result += m[1] + '\n';
    found = true;
  }
  return found ? result.trim() : text;
}

let applied = 0, failed = 0, skipped = 0;
const targetFile = 'packages/ui/src/engine/pixel-characters.ts';
let backup = null;

// Back up the main file before testing
if (!doApply && existsSync(targetFile)) {
  backup = readFileSync(targetFile, 'utf8');
}

for (const f of files) {
  const d = JSON.parse(readFileSync(join(dir, f), 'utf8'));
  const clean = stripFences(d.content);

  // Check if this is a design/research task (no diff, just markdown)
  if (!clean.includes('--- ') && !clean.includes('diff --git')) {
    console.log(`SKIP ${f.slice(-15)}: non-diff output`);
    skipped++;
    continue;
  }

  // Test application
  const result = applyDiff(clean, process.cwd());
  if (result.appliedFiles.length > 0) {
    console.log(`OK   ${f.slice(-15)}: applied to ${result.appliedFiles.join(', ')}`);
    applied += result.appliedFiles.length;

    // Restore for dry run mode
    if (!doApply && backup) {
      writeFileSync(targetFile, backup, 'utf8');
    }
  }
  if (result.failedFiles.length > 0) {
    console.log(`FAIL ${f.slice(-15)}: ${result.errors.join('; ')}`);
    failed += result.failedFiles.length;
  }
  if (result.appliedFiles.length === 0 && result.failedFiles.length === 0) {
    console.log(`SKIP ${f.slice(-15)}: no patches extracted`);
    skipped++;
  }
}

// Final restore
if (!doApply && backup) {
  writeFileSync(targetFile, backup, 'utf8');
  console.log('\n(dry-run mode: file restored to original)');
}

console.log(`\nSummary: ${applied} OK, ${failed} failed, ${skipped} skipped (${files.length} results)`);
