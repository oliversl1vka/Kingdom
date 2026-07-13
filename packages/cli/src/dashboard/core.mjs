// KingdomOS — Terminal Dashboard SMOKE
// Shared engine: ANSI helpers, tier metadata, demo snapshot, portrait loader.
// Zero dependencies. Pure Node ESM.

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = join(__dirname, '..', '..', '..', '..');
let FRAME_DIR = join(REPO_ROOT, 'assets', 'terminal-portraits', 'frames');
export function setFrameDir(dir) { FRAME_DIR = dir; }
export function getFrameDir() { return FRAME_DIR; }

// ---------------------------------------------------------------------------
// ANSI
// ---------------------------------------------------------------------------

const ANSI_RE = /\x1b\[[0-9;]*m/g;
export const stripAnsi = (s) => s.replace(ANSI_RE, '');
export const vlen = (s) => stripAnsi(s).length;

export function vpadEnd(s, n, ch = ' ') {
  const len = vlen(s);
  return len >= n ? s : s + ch.repeat(n - len);
}
export function vpadStart(s, n, ch = ' ') {
  const len = vlen(s);
  return len >= n ? s : ch.repeat(n - len) + s;
}
export function vcenter(s, n, ch = ' ') {
  const len = vlen(s);
  if (len >= n) return s;
  const total = n - len;
  const left = Math.floor(total / 2);
  return ch.repeat(left) + s + ch.repeat(total - left);
}
// Truncate a PLAIN string (no ANSI) to n visible chars with optional ellipsis.
export function clip(s, n, ell = '…') {
  if (s.length <= n) return s;
  if (n <= 1) return s.slice(0, n);
  return s.slice(0, n - 1) + ell;
}

// Hard-truncate an ANSI string to exactly n visible columns (no ellipsis),
// preserving escape codes and always terminating with a reset if clipped.
export function vclip(s, n) {
  if (vlen(s) <= n) return s;
  let vis = 0, i = 0, out = '';
  while (i < s.length && vis < n) {
    if (s[i] === '\x1b') {
      const start = i;
      while (i < s.length && s[i] !== 'm') i++;
      if (i < s.length) i++; // include the 'm'
      out += s.slice(start, i);
    } else {
      out += s[i]; vis++; i++;
    }
  }
  return out + '\x1b[0m';
}

export function makeAnsi(enabled = true) {
  const wrap = (open) => (t) => (enabled ? `\x1b[${open}m${t}\x1b[0m` : `${t}`);
  const fg = (r, g, b) => (t) => (enabled ? `\x1b[38;2;${r};${g};${b}m${t}\x1b[0m` : `${t}`);
  const bg = (r, g, b) => (t) => (enabled ? `\x1b[48;2;${r};${g};${b}m${t}\x1b[0m` : `${t}`);
  const fgbg = (fr, fgc, fb, br, bgc, bb) => (t) =>
    enabled ? `\x1b[38;2;${fr};${fgc};${fb};48;2;${br};${bgc};${bb}m${t}\x1b[0m` : `${t}`;
  return {
    enabled,
    fg,
    bg,
    fgbg,
    rgb: (c) => fg(c[0], c[1], c[2]),
    bgRgb: (c) => bg(c[0], c[1], c[2]),
    bold: wrap('1'),
    dim: wrap('2'),
    italic: wrap('3'),
    underline: wrap('4'),
    blink: wrap('5'),
    reverse: wrap('7'),
  };
}

// Linear interpolate between two rgb colors, t in [0,1]
export function lerp(a, b, t) {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ];
}

// Multiply an rgb by a scalar (for dimming portrait shading)
export function shade(c, k) {
  return [
    Math.max(0, Math.min(255, Math.round(c[0] * k))),
    Math.max(0, Math.min(255, Math.round(c[1] * k))),
    Math.max(0, Math.min(255, Math.round(c[2] * k))),
  ];
}

// ---------------------------------------------------------------------------
// Box-drawing style sets (per rank richness)
// ---------------------------------------------------------------------------

export const BOX = {
  double: { tl: '╔', tr: '╗', bl: '╚', br: '╝', h: '═', v: '║', ml: '╠', mr: '╣', tt: '╦', bt: '╩', x: '╬' },
  heavy: { tl: '┏', tr: '┓', bl: '┗', br: '┛', h: '━', v: '┃', ml: '┣', mr: '┫', tt: '┳', bt: '┻', x: '╋' },
  single: { tl: '┌', tr: '┐', bl: '└', br: '┘', h: '─', v: '│', ml: '├', mr: '┤', tt: '┬', bt: '┴', x: '┼' },
  round: { tl: '╭', tr: '╮', bl: '╰', br: '╯', h: '─', v: '│', ml: '├', mr: '┤', tt: '┬', bt: '┴', x: '┼' },
  ascii: { tl: '+', tr: '+', bl: '+', br: '+', h: '=', v: '|', ml: '+', mr: '+', tt: '+', bt: '+', x: '+' },
};

// ---------------------------------------------------------------------------
// Tier metadata (only the 5 tiers with curated portraits in this smoke)
// ---------------------------------------------------------------------------

export const TIER_ORDER = ['king', 'nobility', 'judge', 'knight', 'squire', 'blacksmith', 'scribe', 'sentinel', 'healer'];

export const TIERS = {
  king: {
    name: 'KING',
    rank: 'Sovereign',
    glyph: '',
    accent: [214, 175, 55],
    accent2: [255, 226, 138],
    box: 'double',
    role: 'Decompose objective',
    model: 'gpt-4.1-mini',
    provider: 'openai',
  },
  nobility: {
    name: 'NOBILITY',
    rank: 'Peerage',
    glyph: '',
    accent: [167, 119, 230],
    accent2: [214, 184, 255],
    box: 'heavy',
    role: 'Decompose epics',
    model: 'gpt-4.1-mini',
    provider: 'openai',
  },
  knight: {
    name: 'KNIGHT',
    rank: 'Man-at-arms',
    glyph: '',
    accent: [108, 166, 221],
    accent2: [184, 218, 255],
    box: 'single',
    role: 'Execute tasks',
    model: 'gpt-4o-mini',
    provider: 'openai',
  },
  squire: {
    name: 'SQUIRE',
    rank: 'Attendant',
    glyph: '',
    accent: [140, 180, 210],
    accent2: [190, 215, 235],
    box: 'single',
    role: 'Micro-task execution',
    model: 'gpt-4o-mini',
    provider: 'openai',
  },
  blacksmith: {
    name: 'BLACKSMITH',
    rank: 'Artificer',
    glyph: '',
    accent: [226, 116, 40],
    accent2: [255, 175, 95],
    box: 'ascii',
    role: 'Apply diffs',
    model: 'system',
    provider: 'local',
  },
  judge: {
    name: 'JUDGE',
    rank: 'Arbiter',
    glyph: '',
    accent: [212, 175, 55],
    accent2: [255, 220, 120],
    box: 'double',
    role: 'Review every diff',
    model: 'gpt-4.1-mini',
    provider: 'openai',
  },
  scribe: {
    name: 'SCRIBE',
    rank: 'Chronicler',
    glyph: '',
    accent: [180, 140, 200],
    accent2: [220, 190, 240],
    box: 'single',
    role: 'Event log & archive',
    model: 'system',
    provider: 'local',
  },
  sentinel: {
    name: 'SENTINEL',
    rank: 'Watcher',
    glyph: '',
    accent: [180, 60, 60],
    accent2: [230, 120, 120],
    box: 'heavy',
    role: 'Heartbeat monitor',
    model: 'system',
    provider: 'local',
  },
  healer: {
    name: 'HEALER',
    rank: 'Mender',
    glyph: '',
    accent: [56, 200, 142],
    accent2: [150, 240, 205],
    box: 'round',
    role: 'Diagnose failures',
    model: 'gpt-4.1-mini',
    provider: 'openai',
  },
};

// ---------------------------------------------------------------------------
// Demo snapshot (deterministic). Replaceable by a real DB collector later.
// ---------------------------------------------------------------------------

export function demoSnapshot() {
  return {
    global: {
      objective: 'Pixel-art idle game — procedural sprites + Zustand economy',
      status: 'running',
      runtimeSec: 2537, // 00:42:17
      tokens: 1284539,
      locks: 2,
      diffRate: 91,
      health: 'HEALTHY',
    },
    tiers: {
      king: { state: 'DECOMPOSING', job: 'Decompose objective into 6 epics', elapsed: 12, prog: 100, tokens: 84201, done: 1, total: 1, hb: 3, stuck: 0, verdict: 'ok' },
      nobility: { state: 'PLANNING', job: 'Break Epic 3 → 9 tasks', elapsed: 47, prog: 66, tokens: 156880, done: 4, total: 6, hb: 5, stuck: 0, verdict: 'ok' },
      knight: { state: 'FORGING', job: 'Implement SpriteCanvas renderer', elapsed: 118, prog: 72, tokens: 612400, done: 14, total: 22, hb: 2, stuck: 0, verdict: 'ok' },
      squire: { state: 'FORGING', job: 'Implement greet function in hello.ts', elapsed: 23, prog: 45, tokens: 82400, done: 1, total: 2, hb: 2, stuck: 0, verdict: 'ok' },
      judge: { state: 'REVIEWING', job: 'Review diff +38 −12 on economy.ts', elapsed: 34, prog: 65, tokens: 92400, done: 18, total: 28, hb: 4, stuck: 0, verdict: 'ok' },
      blacksmith: { state: 'APPLYING', job: 'Patch src/store/economy.ts (+38 −12)', elapsed: 4, prog: 88, tokens: 0, done: 31, total: 35, hb: 1, stuck: 0, verdict: 'ok' },
      scribe: { state: 'ARCHIVING', job: 'Archive crypt log for run #142', elapsed: 2, prog: 95, tokens: 0, done: 140, total: 148, hb: 1, stuck: 0, verdict: 'ok' },
      sentinel: { state: 'WATCHING', job: 'Monitor heartbeats — 8 agents alive', elapsed: 2537, prog: 100, tokens: 0, done: 1, total: 1, hb: 3, stuck: 0, verdict: 'ok' },
      healer: { state: 'DIAGNOSING', job: 'Heal failed-review on test task', elapsed: 22, prog: 40, tokens: 38150, done: 2, total: 3, hb: 7, stuck: 1, verdict: 'attention' },
    },
  };
}

// ---------------------------------------------------------------------------
// Portrait loader
// ---------------------------------------------------------------------------

const _frameCache = new Map();

function rawFrame(tier, size) {
  const key = `${tier}.${size}`;
  if (_frameCache.has(key)) return _frameCache.get(key);
  const file = join(FRAME_DIR, `${tier}.${size}.txt`);
  let lines;
  if (existsSync(file)) {
    lines = readFileSync(file, 'utf8').replace(/\uFEFF/g, '').replace(/\r/g, '').split('\n');
  } else {
    lines = [`[${tier}]`];
  }
  // Drop trailing empty lines
  while (lines.length && lines[lines.length - 1].trim() === '') lines.pop();
  _frameCache.set(key, lines);
  return lines;
}

// Return a portrait clipped/padded to exactly w x h (plain text).
// size: 'ascii' (44 wide) or 'mini' (24 wide).
export function portrait(tier, { w, h, size = 'ascii', anchorY = 'top' } = {}) {
  let lines = rawFrame(tier, size).map((l) => l.replace(/\s+$/u, ''));
  // Vertical crop
  if (h && lines.length > h) {
    if (anchorY === 'center') {
      const start = Math.floor((lines.length - h) / 2);
      lines = lines.slice(start, start + h);
    } else {
      lines = lines.slice(0, h);
    }
  }
  // Normalize width
  const targetW = w ?? Math.max(...lines.map((l) => l.length));
  lines = lines.map((l) => (l.length > targetW ? l.slice(0, targetW) : l.padEnd(targetW, ' ')));
  // Pad height
  if (h) {
    while (lines.length < h) lines.push(' '.repeat(targetW));
  }
  return lines;
}

// Tint a list of plain portrait lines with a vertical gradient between two colors.
export function tintGradient(lines, A, top, bottom) {
  const n = Math.max(1, lines.length - 1);
  return lines.map((l, i) => {
    const c = lerp(top, bottom, i / n);
    return A.rgb(c)(l);
  });
}

// Tint with a single color but vary brightness by character density (darker glyphs dimmer)
export function tintSolid(lines, A, color) {
  return lines.map((l) => A.rgb(color)(l));
}

// ---------------------------------------------------------------------------
// Shaded portrait (braille glyph + per-cell luminance) — photographic greyscale
// ---------------------------------------------------------------------------

const _cellsCache = new Map();

export function loadCells(tier) {
  if (_cellsCache.has(tier)) return _cellsCache.get(tier);
  const file = join(FRAME_DIR, `${tier}.cells.json`);
  let data = null;
  if (existsSync(file)) {
    try { data = JSON.parse(readFileSync(file, 'utf8')); } catch { data = null; }
  }
  _cellsCache.set(tier, data);
  return data;
}

// Warm neutral ("beige / grey / black / white") luminance ramp.
// stops: black → warm charcoal → stone grey → warm beige-white
const NEUTRAL_RAMP = [
  [10, 10, 12],
  [44, 42, 44],
  [92, 88, 86],
  [150, 144, 138],
  [206, 199, 188],
  [238, 232, 220],
];

// Map a 0..255 luminance to a ramp colour. gain/bias let callers shape contrast.
export function rampColor(lum, ramp = NEUTRAL_RAMP, { gain = 1, bias = 0, gamma = 1 } = {}) {
  let t = Math.min(1, Math.max(0, (lum / 255) * gain + bias));
  if (gamma !== 1) t = Math.pow(t, gamma);
  const seg = t * (ramp.length - 1);
  const i = Math.min(ramp.length - 2, Math.floor(seg));
  return lerp(ramp[i], ramp[i + 1], seg - i);
}

// Render a portrait as ANSI greyscale lines using braille glyphs shaded per cell.
// opts: { h, anchorY, ramp, gain, bias, gamma, floor } — floor hides near-black cells.
export function shadedPortrait(tier, A, {
  h, anchorY = 'center', ramp = NEUTRAL_RAMP,
  gain = 1.15, bias = 0.02, gamma = 0.92, floor = 14,
} = {}) {
  const data = loadCells(tier);
  if (!data) return rawFrame(tier, 'ascii');
  let rows = data.braille.map((line, y) => ({ line, lum: data.lum[y] }));
  if (h && rows.length > h) {
    const start = anchorY === 'center' ? Math.floor((rows.length - h) / 2) : 0;
    rows = rows.slice(start, start + h);
  }
  const out = rows.map(({ line, lum }) => {
    let s = '';
    for (let x = 0; x < line.length; x++) {
      const ch = line[x];
      // Skip zero-width BOM/joiners that desync column math (terminal renders
      // them as 0 cells but they count as 1 char) — keeps lum[x] alignment.
      if (ch === '\uFEFF' || ch === '\u200B') continue;
      // Only blank cells (no dots) recede into the background. A lit glyph is
      // always drawn — the source converter already decided the dot density —
      // but its tint floors at `floor` so shadow detail stays faintly visible.
      if (ch === '⠀' || ch === ' ') { s += ' '; continue; }
      const l = Math.max(floor, lum[x] ?? 0);
      s += A.rgb(rampColor(l, ramp, { gain, bias, gamma }))(ch);
    }
    return s;
  });
  if (h) while (out.length < h) out.push('');
  return out;
}

// ---------------------------------------------------------------------------
// Small shared widgets
// ---------------------------------------------------------------------------

export function bar(pct, len, A, color, { full = '█', empty = '░' } = {}) {
  const filled = Math.round((Math.max(0, Math.min(100, pct)) / 100) * len);
  return A.rgb(color)(full.repeat(filled)) + A.dim(empty.repeat(len - filled));
}

export function fmtTokens(n) {
  return n.toLocaleString('en-US');
}

export function fmtRuntime(sec) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export const SPINNER = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
export const PULSE = ['◐', '◓', '◑', '◒'];

export function stateColor(tier, snap, A) {
  const t = snap.tiers[tier];
  const meta = TIERS[tier];
  if (t.verdict === 'attention') return A.rgb([240, 180, 60]);
  if (t.verdict === 'critical') return A.rgb([230, 70, 70]);
  return A.rgb(meta.accent);
}

// Build context object passed to variant renderers.
export function makeContext({ color = true, width = 120, frame = 0 } = {}) {
  return {
    A: makeAnsi(color),
    color,
    width,
    frame,
    snap: demoSnapshot(),
    TIERS,
    TIER_ORDER,
  };
}
