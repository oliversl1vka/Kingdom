#!/usr/bin/env node
// vision-qa.mjs — Send a PNG screenshot to an OpenRouter vision model for inspection.
//
// Usage:
//   node scripts/vision-qa.mjs --image /tmp/dash.png
//   node scripts/vision-qa.mjs --image /tmp/dash.png --prompt "Check for overlapping text"
//   node scripts/vision-qa.mjs --image /tmp/dash.png --model google/gemini-2.5-flash-lite
//
// Reads OPENROUTER_API_KEY from .env in the current directory, or from the environment.

import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── CLI args ──────────────────────────────────────────────────────────
function parseArgs() {
  const argv = process.argv.slice(2);
  const args = { image: '', prompt: '', model: 'google/gemini-2.0-flash-001' };

  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--image' || argv[i] === '-i') {
      args.image = argv[++i] ?? '';
    } else if (argv[i] === '--prompt' || argv[i] === '-p') {
      args.prompt = argv[++i] ?? '';
    } else if (argv[i] === '--model' || argv[i] === '-m') {
      args.model = argv[++i] ?? args.model;
    } else if (!argv[i].startsWith('-') && !args.image) {
      args.image = argv[i];
    }
  }

  if (!args.image) {
    console.error('Usage: vision-qa.mjs --image <file.png> [--prompt "question"] [--model id]');
    console.error('');
    console.error('Models (cheap vision):');
    console.error('  google/gemini-2.0-flash-001      (default — very cheap, fast)');
    console.error('  google/gemini-2.5-flash-lite     (even cheaper)');
    console.error('  meta-llama/llama-4-maverick      (free on OpenRouter)');
    console.error('  openai/gpt-4.1-mini              (good, pricier)');
    process.exit(1);
  }

  if (!args.prompt) {
    args.prompt = `You are a terminal dashboard QA inspector. Examine this screenshot of a live terminal dashboard and report any rendering issues:

1. Is any text overlapping or misaligned?
2. Are box-drawing borders (╔═╗║╚╝┌─┐│└┘) intact and properly connected?
3. Are the braille character portraits (dot patterns) rendering correctly without gaps?
4. Is the color consistent and readable?
5. Are there any visual artifacts, broken characters, or layout problems?

Be specific about what you see. If everything looks correct, say so clearly.`;
  }

  return args;
}

// ── API key ───────────────────────────────────────────────────────────
function loadApiKey() {
  // 1. Check env var directly
  if (process.env.OPENROUTER_API_KEY) return process.env.OPENROUTER_API_KEY;

  // 2. Try .env file in CWD
  const dotenvPath = resolve(process.cwd(), '.env');
  if (existsSync(dotenvPath)) {
    const contents = readFileSync(dotenvPath, 'utf8');
    const match = contents.match(/^OPENROUTER_API_KEY\s*=\s*(.+)$/m);
    if (match) return match[1].trim().replace(/^['"]|['"]$/g, '');
  }

  // 3. Try .env in repo root
  const repoRoot = resolve(__dirname, '..');
  const repoDotenv = resolve(repoRoot, '.env');
  if (repoDotenv !== dotenvPath && existsSync(repoDotenv)) {
    const contents = readFileSync(repoDotenv, 'utf8');
    const match = contents.match(/^OPENROUTER_API_KEY\s*=\s*(.+)$/m);
    if (match) return match[1].trim().replace(/^['"]|['"]$/g, '');
  }

  return null;
}

// ── Main ──────────────────────────────────────────────────────────────
async function main() {
  const args = parseArgs();
  const apiKey = loadApiKey();

  if (!apiKey) {
    console.error('OPENROUTER_API_KEY not found.');
    console.error('Set it in .env:  OPENROUTER_API_KEY=sk-or-v1-...');
    console.error('Or export it:    export OPENROUTER_API_KEY=sk-or-v1-...');
    process.exit(1);
  }

  // Read and encode image
  let imagePath = args.image;
  if (!existsSync(imagePath)) {
    // Try relative to CWD
    imagePath = resolve(process.cwd(), args.image);
    if (!existsSync(imagePath)) {
      console.error(`Image not found: ${args.image}`);
      process.exit(1);
    }
  }
  const imageData = readFileSync(imagePath);
  const mime = imagePath.endsWith('.jpg') || imagePath.endsWith('.jpeg')
    ? 'image/jpeg'
    : 'image/png';
  const dataUrl = `data:${mime};base64,${imageData.toString('base64')}`;

  console.error(`Sending ${(imageData.length / 1024).toFixed(1)} KB to ${args.model}...`);

  // Call OpenRouter
  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
      'HTTP-Referer': 'https://github.com/oliversl1vka/Kingdom',
      'X-Title': 'KingdomOS Dashboard QA',
    },
    body: JSON.stringify({
      model: args.model,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: args.prompt },
            { type: 'image_url', image_url: { url: dataUrl } },
          ],
        },
      ],
      max_tokens: 2000,
    }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    console.error(`OpenRouter error ${response.status}: ${text.slice(0, 500)}`);
    process.exit(1);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content;

  if (!content) {
    console.error('No content in response.');
    console.error(JSON.stringify(data, null, 2).slice(0, 1000));
    process.exit(1);
  }

  // Output
  const tokens = data.usage;
  if (tokens) {
    console.error(
      `Model: ${data.model || args.model}  |  ` +
      `tokens: ${tokens.prompt_tokens}+${tokens.completion_tokens}=${tokens.total_tokens}  |  ` +
      `cost: ~$${((tokens.prompt_tokens * 0.075 + tokens.completion_tokens * 0.15) / 1_000_000).toFixed(4)}`
    );
    console.error('─'.repeat(72));
  }
  console.log(content);
}

main().catch((err) => {
  console.error(`Fatal: ${err.message}`);
  process.exit(1);
});
