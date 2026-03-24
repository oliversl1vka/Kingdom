#!/usr/bin/env node
/**
 * Create a small test decree with 3 tasks that operate on real workspace files.
 * Used to validate the full pipeline including context loading, review, diff application.
 *
 * Usage: node scripts/test-decree.mjs [workspace_path]
 */
const basePath = process.cwd();
const workspacePath = process.argv[2] || basePath;
const API = 'http://127.0.0.1:7778';

async function main() {
  // 1. Init with workspace path
  console.log(`Initializing kingdom with workspace: ${workspacePath}`);
  const initResp = await fetch(`${API}/api/init`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ project_name: 'KingdomOS', workspace_path: workspacePath }),
  });
  console.log('Init:', await initResp.json());

  // 2. Create a test decree with 3 small tasks
  const decree = {
    objective: 'Pipeline integration test — small tasks with real file context',
    priority: 8,
    tasks: [
      {
        title: 'Add JSDoc comment to generateUlid function',
        description: 'Add a brief JSDoc comment describing what the generateUlid function does. The function is in packages/core/src/ulid.ts. Read the file first, then output a unified diff that adds a JSDoc block above the function.',
        type: 'code',
        assigned_tier: 'squire',
        acceptance_criteria: [
          'JSDoc comment added above generateUlid export',
          'Output is valid unified diff format',
          'Only packages/core/src/ulid.ts is modified',
        ],
      },
      {
        title: 'Document the KingdomConfig interface',
        description: 'Review the KingdomConfig interface in packages/core/src/types.ts (around line 386) and produce a brief markdown summary of all its fields and what they do.',
        type: 'research',
        assigned_tier: 'scribe',
        acceptance_criteria: [
          'All KingdomConfig fields are documented',
          'Output is valid markdown',
        ],
      },
      {
        title: 'Add a TODO comment in config.ts',
        description: 'Add a TODO comment at the top of packages/core/src/config.ts noting that workspace_path validation should be added. Output as unified diff.',
        type: 'code',
        assigned_tier: 'squire',
        acceptance_criteria: [
          'TODO comment added at the top of the file',
          'Output is valid unified diff format',
          'Only packages/core/src/config.ts is modified',
        ],
      },
    ],
  };

  console.log(`\nCreating decree with ${decree.tasks.length} tasks...`);
  const decreeResp = await fetch(`${API}/api/decree`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(decree),
  });
  const decreeResult = await decreeResp.json();
  console.log('Decree:', decreeResult);

  // 3. Check status
  const statusResp = await fetch(`${API}/api/status`);
  console.log('Status:', await statusResp.json());

  console.log('\nDecree created. Use /api/summon to start the pipeline.');
}

main().catch(console.error);
