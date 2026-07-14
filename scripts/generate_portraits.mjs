#!/usr/bin/env node
// generate_portraits.mjs — Generate new tier portraits via OpenRouter image models.
//
// Usage:
//   node scripts/generate_portraits.mjs --tier judge
//   node scripts/generate_portraits.mjs --tier scribe,sentinel,knight,king,squire
//   node scripts/generate_portraits.mjs --all
//
// Reads OPENROUTER_API_KEY from .env. Uses the 3 successful portraits
// (blacksmith, healer, nobility) as style references.

import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const SRC_DIR = resolve(REPO_ROOT, 'assets', 'terminal-portraits', 'production_images');
const REF_DIR = '/tmp/refs';  // compressed reference images for faster API calls

// ── API key ──────────────────────────────────────────────────────────
function loadApiKey() {
  if (process.env.OPENROUTER_API_KEY) return process.env.OPENROUTER_API_KEY;
  const dotenvPath = resolve(REPO_ROOT, '.env');
  if (existsSync(dotenvPath)) {
    const contents = readFileSync(dotenvPath, 'utf8');
    const match = contents.match(/^OPENROUTER_API_KEY\s*=\s*(.+)$/m);
    if (match) return match[1].trim().replace(/^['"]|['"]$/g, '');
  }
  return null;
}

// ── Image helpers ────────────────────────────────────────────────────
function imageToDataUrl(path) {
  const data = readFileSync(path);
  const mime = path.endsWith('.jpg') || path.endsWith('.jpeg')
    ? 'image/jpeg'
    : 'image/png';
  return `data:${mime};base64,${data.toString('base64')}`;
}

function findOriginal(name) {
  // Check compressed refs first (for reference images)
  const refPath = `${REF_DIR}/${name}.jpg`;
  if (existsSync(refPath)) return refPath;

  const candidates = [
    `${SRC_DIR}/${name}original.png`,
    `${SRC_DIR}/${name}original.jpg`,
    `${SRC_DIR}/${name}original.jpeg`,
    `${SRC_DIR}/${name}_original.png`,
    `${SRC_DIR}/${name}_original.jpg`,
    `${SRC_DIR}/${name}_original.jpeg`,
    // Also check numbered variants
    ...Array.from({length: 20}, (_, i) => [
      `${SRC_DIR}/${name}${i}original.png`,
      `${SRC_DIR}/${name}${i}original.jpg`,
      `${SRC_DIR}/${name}${i}original.jpeg`,
    ]).flat(),
  ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return null;
}

// ── Tier descriptions ────────────────────────────────────────────────
const TIER_DESCRIPTIONS = {
  judge: {
    role: 'Judge',
    description: `PORTRAIT ORIENTATION (taller than wide, about 2:3 ratio). The subject is a stern, gaunt male arbiter in his 50s with sharp angular features. He has deep-set piercing eyes that stare directly at the viewer, thin pressed lips, hollow cheeks, and a completely bald head. He wears high-collared dark judicial robes with subtle gold trim. His expression is cold and impartial. The lighting is a strong side-light from upper-left that carves his features out of darkness, creating dramatic shadows BUT his entire face is clearly visible and well-exposed (not silhouetted). The background is dark and atmospheric, fading to black at edges. MID-BRIGHTNESS OVERALL — not a dark image. His face should be at roughly 40-50% brightness.`,
  },
  scribe: {
    role: 'Scribe',
    description: `PORTRAIT ORIENTATION (taller than wide, about 2:3 ratio). An aged scholarly man in his 70s with wire-rimmed spectacles perched on his nose. Wispy grey hair receding at the temples. His ink-stained fingers are visible near his chin as he pauses from writing. Deep wrinkles around intelligent, kind eyes. Warm, knowing slight smile. Soft warm candlelight illuminates his face from the lower-right, creating a warm glow. His entire face is clearly lit and visible. MID-BRIGHTNESS — the candle glow ensures his features are well-exposed, not lost in shadow. Dark atmospheric background.`,
  },
  sentinel: {
    role: 'Sentinel',
    description: `PORTRAIT ORIENTATION (taller than wide, about 2:3 ratio). A stoic male watchman in his 40s with a worn leather hood framing his face and a dark wool cloak pulled close. Weathered, rugged face with unblinking eyes staring directly at the viewer. Short salt-and-pepper beard, strong square jaw. A warm orange-red glow from a brazier below-left casts dramatic light upward across his features. His face is clearly visible with the firelight illuminating his skin in warm tones. MID-BRIGHTNESS — the brazier light ensures his face is well-exposed. Dark atmospheric background. 80s dark fantasy OIL PAINTING style with visible brushstrokes and canvas texture — NOT digital art, NOT video game concept art.`,
  },
  knight: {
    role: 'Knight',
    description: `PORTRAIT ORIENTATION (taller than wide, about 2:3 ratio). A female knight in her 30s with fair skin — distinctly different from the Nobility portrait. Strong but feminine features, determined expression with lips slightly parted. Silver-chased dark steel pauldrons visible at the neck and shoulders. Auburn-red hair pulled back severely from her face. Her eyes are fierce and resolute, looking slightly upward as if toward a higher calling. Cool steel tones on the armor contrasting with her warm skin. Her face is clearly visible and well-defined with even lighting from the front-left. MID-BRIGHTNESS. Must look DIFFERENT from the Nobility reference — different face shape, different expression, different hair color.`,
  },
  king: {
    role: 'King',
    description: `PORTRAIT ORIENTATION (taller than wide, about 2:3 ratio). A weathered sovereign in late middle age, 55-60 years old. Greying temples with dark hair, short greying beard, strong nose, deeply furrowed brow. He wears heavy gold signet rings on his clasped hands which rest near his chest. Crimson and sable robes visible at the shoulders. Tired but commanding eyes — the weight of the kingdom visible in his gaze. Golden hour sunlight from the upper-right bathes one side of his face warmly. His eyes and full facial expression are clearly visible and well-lit. MID-BRIGHTNESS — golden light ensures his face is well-exposed, particularly the eyes. Dark atmospheric background.`,
  },
  squire: {
    role: 'Squire',
    description: `PORTRAIT ORIENTATION (taller than wide, about 2:3 ratio). A young apprentice, late teens to early 20s, with bright eager eyes and a slight, hopeful smile. Sandy brown hair, slightly tousled. Soft, unweathered skin — this is someone still learning, not yet hardened by battle. He wears a simple linen tunic and a worn leather vest, practical clothes for long hours of study and practice. A leather-bound codex and ink-stained quill are visible at the edge of the frame, hinting at his scholarly focus on code and precision work. Warm, gentle light from a single candle or oil lamp illuminates his face from the front-left, giving an intimate, focused atmosphere appropriate for a local model who works quietly on small tasks. His face is fully visible and well-lit. MID-BRIGHTNESS. 80s dark fantasy OIL PAINTING style — must match the reference portraits in palette and brushwork, but the mood should be warmer and more intimate, befitting a dedicated student working by lamplight.`,
  },
};

// ── Prompt builder ───────────────────────────────────────────────────
function buildPrompt(tier) {
  const info = TIER_DESCRIPTIONS[tier];
  if (!info) throw new Error(`Unknown tier: ${tier}`);

  return `Generate a character portrait of a ${info.role} in 80s dark fantasy style.

Character description: ${info.description}

CRITICAL STYLE REQUIREMENTS — match these reference portraits exactly:
- Oil painting aesthetic with visible brush strokes and canvas texture
- Warm, muted earth-tone palette: browns, ochres, burnt sienna, deep golds, muted greens
- Dramatic chiaroscuro lighting (strong light/shadow contrast) BUT the face must be clearly visible
- Dark, atmospheric background that fades to near-black at edges
- Vertical portrait orientation, face centered in upper third
- Painterly, textured surface — NOT smooth digital art
- Color temperature: distinctly warm (red-brown bias), never cool or blue
- Resolution: ~1024x1536 portrait aspect ratio
- The character should fill roughly 60-70% of the frame

WHAT TO AVOID:
- NO video game concept art style
- NO anime or illustrated look
- NO flat digital coloring
- NO face hidden in deep shadow — the facial features must be readable
- NO bright white backgrounds
- NO cool blue/teal color casts

The portrait must look like it belongs in the same dark fantasy oil painting series as the references.`;
}

// ── API call ─────────────────────────────────────────────────────────
async function generateImage(apiKey, tier, model) {
  const info = TIER_DESCRIPTIONS[tier];
  const prompt = buildPrompt(tier);

  // Load reference images (the 3 successful ones)
  const refs = ['blacksmith', 'healer', 'nobility'];
  const refImages = [];
  for (const name of refs) {
    const path = findOriginal(name);
    if (path) {
      refImages.push({
        name,
        dataUrl: imageToDataUrl(path),
      });
      console.error(`  Reference: ${name} (${basename(path)})`);
    }
  }

  // Build content array: reference images first, then text prompt
  const content = [];

  content.push({
    type: 'text',
    text: 'Here are 3 reference portraits that define the EXACT art style I need:',
  });

  for (const ref of refImages) {
    content.push({
      type: 'image_url',
      image_url: { url: ref.dataUrl, detail: 'high' },
    });
    content.push({
      type: 'text',
      text: `↑ Reference: ${ref.name} portrait in the target 80s dark fantasy oil painting style.`,
    });
  }

  content.push({
    type: 'text',
    text: prompt,
  });

  console.error(`\nGenerating ${tier} portrait via ${model}...`);
  console.error(`  Prompt length: ${prompt.length} chars`);
  console.error(`  Reference images: ${refImages.length}`);

  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
      'HTTP-Referer': 'https://github.com/oliversl1vka/Kingdom',
      'X-Title': 'KingdomOS Portrait Generator',
    },
    body: JSON.stringify({
      model,
      modalities: ['image', 'text'],
      messages: [
        {
          role: 'user',
          content,
        },
      ],
      max_tokens: 4000,
    }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`API error ${response.status}: ${text.slice(0, 500)}`);
  }

  const data = await response.json();

  if (data.error) {
    throw new Error(`API error: ${JSON.stringify(data.error)}`);
  }

  // Extract image from response
  const message = data.choices?.[0]?.message;
  if (!message) {
    throw new Error(`No message in response: ${JSON.stringify(data).slice(0, 500)}`);
  }

  // Check message.images first (OpenAI format)
  if (message.images && Array.isArray(message.images)) {
    for (const img of message.images) {
      if (img.image_url?.url) {
        const url = img.image_url.url;
        console.error(`  Image found: ${url.slice(0, 50)}... (${url.length} chars)`);
        return url;
      }
    }
  }

  // Also check message.content (Gemini/anthropic format)
  const msgContent = message.content;

  // Content can be:
  // - A string (text only, no image generated)
  // - An array of content parts
  // - An object with image data

  if (typeof msgContent === 'string') {
    console.error('Model returned text-only response (no image):');
    console.error(msgContent.slice(0, 500));
    return null;
  }

  if (Array.isArray(msgContent)) {
    for (const part of msgContent) {
      if (part.type === 'image_url') {
        const url = part.image_url?.url;
        if (url) {
          console.error(`  Image URL received: ${url.slice(0, 80)}...`);
          return url; // Could be a data URL or a remote URL
        }
      }
      if (part.type === 'image' && part.image) {
        // Some models return base64 directly
        const b64 = part.image;
        console.error(`  Base64 image received (${b64.length} chars)`);
        return `data:image/png;base64,${b64}`;
      }
    }
  }

  // Check for tool calls (some models use image generation tool)
  if (message.tool_calls) {
    for (const tc of message.tool_calls) {
      if (tc.function?.name?.includes('image') || tc.function?.name?.includes('generate')) {
        try {
          const args = JSON.parse(tc.function.arguments);
          console.error(`  Tool call: ${tc.function.name}`, JSON.stringify(args).slice(0, 200));
        } catch {}
      }
    }
  }

  // Debug: show response structure
  console.error('Response structure:');
  console.error(JSON.stringify(data, null, 2).slice(0, 1000));

  return null;
}

// ── Download/save image ──────────────────────────────────────────────
async function saveImage(url, tier) {
  const outDir = SRC_DIR;

  let imageData;
  let ext;

  if (url.startsWith('data:')) {
    // Parse data URL
    const match = url.match(/^data:image\/(png|jpeg|jpg|webp);base64,(.+)$/);
    if (!match) throw new Error('Could not parse data URL');
    ext = match[1] === 'jpeg' ? 'jpg' : match[1];
    imageData = Buffer.from(match[2], 'base64');
  } else {
    // Download from URL
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`Download failed: ${resp.status}`);
    const buffer = await resp.arrayBuffer();
    imageData = Buffer.from(buffer);
    const contentType = resp.headers.get('content-type') || '';
    ext = contentType.includes('jpeg') ? 'jpg' : 'png';
  }

  // Find next available filename
  let idx = '';
  let path;
  do {
    path = resolve(outDir, `${tier}${idx}original.${ext}`);
    idx = idx === '' ? 2 : idx + 1;
  } while (existsSync(path));

  // Actually use first available slot
  path = resolve(outDir, `${tier}_original.${ext}`);
  if (existsSync(path)) {
    // Find next available
    let n = 2;
    while (existsSync(resolve(outDir, `${tier}${n}original.${ext}`))) n++;
    path = resolve(outDir, `${tier}${n}original.${ext}`);
  }

  // Write
  const { writeFileSync } = await import('node:fs');
  writeFileSync(path, imageData);
  console.error(`  Saved: ${path} (${(imageData.length / 1024).toFixed(0)} KB)`);

  return path;
}

// ── Main ─────────────────────────────────────────────────────────────
async function main() {
  const args = process.argv.slice(2);
  const tiers = [];

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--tier' || args[i] === '-t') {
      tiers.push(...(args[++i] ?? '').split(','));
    } else if (args[i] === '--all') {
      tiers.push('judge', 'scribe', 'sentinel', 'knight', 'king', 'squire');
    } else if (args[i] === '--model' || args[i] === '-m') {
      // handled below
    }
  }

  if (tiers.length === 0) {
    console.error('Usage: generate_portraits.mjs --tier judge,scribe,sentinel,knight,king');
    console.error('       generate_portraits.mjs --all');
    console.error('');
    console.error('Available tiers: judge, scribe, sentinel, knight, king, squire');
    process.exit(1);
  }

  const apiKey = loadApiKey();
  if (!apiKey) {
    console.error('OPENROUTER_API_KEY not found in .env');
    process.exit(1);
  }

  const model = 'google/gemini-2.5-flash-image';
  console.error(`Model: ${model}`);
  console.error(`Tiers: ${tiers.join(', ')}`);

  for (const tier of tiers) {
    console.error(`\n${'═'.repeat(60)}`);
    try {
      const imageUrl = await generateImage(apiKey, tier, model);
      if (imageUrl) {
        await saveImage(imageUrl, tier);
        console.error(`✓ ${tier} generated successfully`);
      } else {
        console.error(`✗ ${tier}: No image in response`);
      }
    } catch (err) {
      console.error(`✗ ${tier}: ${err.message}`);
    }
  }
}

main().catch((err) => {
  console.error(`Fatal: ${err.message}`);
  process.exit(1);
});
