// Throne Hall — the one KingdomOS dashboard layout.
//
// Single fixed layout: 3-column (roster sidebar + braille shaded portrait +
// dossier), default stone/brass palette. Designed for wide terminals (120+
// cols). Narrower terminals clip content to its container — the layout never
// breaks, it just truncates.

import {
  BOX, TIER_ORDER, TIERS, shadedPortrait, vclip, vpadEnd, vlen, clip,
  bar, fmtTokens, fmtRuntime,
} from './core.mjs';

// --- Palette ----------------------------------------------------------------
const INK   = [150, 144, 136];
const PAPER = [232, 226, 214];
const STONE = [120, 114, 107];
const MUTE  = [86,  82,  77 ];
const LINE  = [70,  67,  63 ];
const BRASS = [178, 156, 120];
const AMBER = [196, 158, 96 ];
const SAGE  = [150, 162, 144];

// --- Layout constants (XL) --------------------------------------------------
const PORTRAIT_W = 65;   // braille portrait width (cols)
const PORTRAIT_H = 46;   // braille portrait height (rows)
const BODY_H     = 50;   // body panel height (rows)

// --- Entry ------------------------------------------------------------------

export function renderThroneHall(ctx) {
  const { A, snap, width, frame } = ctx;
  const W = width;
  const g = snap.global;
  const sel = TIER_ORDER[(ctx.selected ?? frame) % TIER_ORDER.length];
  const fg = (c) => A.rgb(c);
  const out = [];

  // Header
  const hdrTitle = A.bold(fg(PAPER)('KINGDOMOS')) + fg(MUTE)('  ') + fg(STONE)('XL');
  const hdrRight = fg(STONE)(`uptime ${fmtRuntime(g.runtimeSec)}    tokens ${fmtTokens(g.tokens)}`);
  const hdrW = vlen(hdrTitle) + vlen(hdrRight);
  if (hdrW + 3 <= W) out.push(' ' + vpadEnd(hdrTitle, W - vlen(hdrRight) - 2) + hdrRight);
  else { out.push(' ' + hdrTitle); out.push(' ' + vpadEnd('', W - vlen(hdrRight) - 2) + hdrRight); }
  out.push(' ' + fg(LINE)('─'.repeat(Math.max(0, W - 2))));

  // Body — 3-column: sidebar + braille portrait + dossier
  out.push(...renderBody(ctx, sel, W));

  // Footer
  out.push(' ' + fg(LINE)('─'.repeat(Math.max(0, W - 2))));
  const keys = [['↑↓','select'],['enter','inspect'],['p','pause'],['h','heal'],['q','quit']];
  const foot = keys.map(([k,d]) => A.bold(fg(INK)(k)) + ' ' + fg(STONE)(d)).join(fg(MUTE)('    '));
  out.push(' ' + (vlen(foot) <= W - 2 ? foot : keys.map(([k])=>A.bold(fg(INK)(k))).join(' ') + fg(STONE)('  q=quit')));

  return out.join('\n');
}

// ============================================================================
// Body — 3-column sidebar + braille portrait + dossier
// ============================================================================
function renderBody(ctx, sel, W) {
  const H = BODY_H;
  const sw = 24;
  const portraitW = PORTRAIT_W + 4;
  const gap = 1;
  const dw = W - sw - portraitW - gap * 2 - 1;
  const safeDw = Math.max(22, dw);

  const sidebar  = sidebarPanel(ctx, sel, sw, H);
  const portrait = braillePortraitPanel(ctx, sel, PORTRAIT_W, PORTRAIT_H, H);
  const detail   = detailPanel(ctx, sel, safeDw, H);
  return joinH([sidebar, portrait, detail], gap);
}

// ============================================================================
// Panel builders — every panel CLIPS content to fit
// ============================================================================

function sidebarPanel(ctx, sel, w, H) {
  const { A, snap } = ctx;
  const fg = (c) => A.rgb(c);
  const b = BOX.single;
  const inner = w - 2;
  const lines = [];

  lines.push(fg(MUTE)(b.tl + b.h.repeat(inner) + b.tr));
  const title = 'AGENTS';
  lines.push(fg(MUTE)(b.v) + ' ' + A.bold(fg(STONE)(vpadEnd(title, inner - 1))) + fg(MUTE)(b.v));
  lines.push(fg(MUTE)(b.ml) + fg(LINE)(b.h.repeat(inner)) + fg(MUTE)(b.mr));

  for (const tier of TIER_ORDER) {
    const m = TIERS[tier], st = snap.tiers[tier];
    const isSel = tier === sel;
    const cur  = isSel ? A.bold(fg(BRASS)('▌')) : fg(MUTE)(' ');
    const maxName = Math.max(3, inner - 8);
    const nm  = clip(m.name, maxName);
    const nameTxt = isSel ? A.bold(fg(PAPER)(nm)) : fg(INK)(nm);

    const l1 = `${cur} ${nameTxt}`;
    const l2 = `    ${fg(STONE)(st.state.toLowerCase())} ` + A.bold(fg(isSel?PAPER:MUTE)(st.prog+'%'));
    lines.push(fg(MUTE)(b.v) + vpadEnd(l1, inner) + fg(MUTE)(b.v));
    lines.push(fg(MUTE)(b.v) + vpadEnd(l2, inner) + fg(MUTE)(b.v));
    lines.push(fg(MUTE)(b.v) + ' '.repeat(inner) + fg(MUTE)(b.v));
  }
  // Guarantee bottom border is always the last visible line
  if (lines.length >= H) lines.length = H - 1;
  while (lines.length < H - 1) lines.push(fg(MUTE)(b.v) + ' '.repeat(inner) + fg(MUTE)(b.v));
  lines.push(fg(MUTE)(b.bl + b.h.repeat(inner) + b.br));
  return lines.slice(0, H);
}

function braillePortraitPanel(ctx, tier, pw, ph, H) {
  const { A } = ctx;
  const fg = (c) => A.rgb(c);
  const b = BOX.single;
  const por = shadedPortrait(tier, A, { h: ph, anchorY: 'center' });
  const inner = pw + 2;
  const lines = [];
  lines.push(fg(MUTE)(b.tl + b.h.repeat(inner) + b.tr));
  for (const row of por) {
    lines.push(fg(MUTE)(b.v) + ' ' + vpadEnd(vclip(row, pw), pw) + ' ' + fg(MUTE)(b.v));
  }
  // Guarantee bottom border is always the last visible line
  if (lines.length >= H) lines.length = H - 1;
  while (lines.length < H - 1) lines.push(fg(MUTE)(b.v) + ' '.repeat(inner) + fg(MUTE)(b.v));
  lines.push(fg(MUTE)(b.bl + b.h.repeat(inner) + b.br));
  return lines.slice(0, H);
}

function detailPanel(ctx, tier, w, H) {
  const { A } = ctx;
  const fg = (c) => A.rgb(c);
  const b = BOX.single;
  const inner = w - 2;
  const rows = dossierRows(ctx, tier, inner);
  const lines = [fg(MUTE)(b.tl + b.h.repeat(inner) + b.tr)];
  for (let i = 0; i < H - 2; i++) {
    lines.push(fg(MUTE)(b.v) + ' ' + vpadEnd(rows[i] ?? '', inner - 2) + ' ' + fg(MUTE)(b.v));
  }
  // Guarantee bottom border is always the last visible line
  if (lines.length >= H) lines.length = H - 1;
  while (lines.length < H - 1) lines.push(fg(MUTE)(b.v) + ' '.repeat(inner) + fg(MUTE)(b.v));
  lines.push(fg(MUTE)(b.bl + b.h.repeat(inner) + b.br));
  return lines.slice(0, H);
}

// ============================================================================
// Dossier content — every line is clipped to fit innerW cols
// ============================================================================

function dossierRows(ctx, tier, innerW) {
  const { A, snap } = ctx;
  const meta = TIERS[tier];
  const t = snap.tiers[tier];
  const fg = (c) => A.rgb(c);
  const isAttn = t.verdict === 'attention';
  const isCrit = t.verdict === 'critical';
  const contentW = innerW - 2;

  const fit = (s) => clip(s, Math.max(1, contentW));
  const kv = (label, value) => vfit(fg(STONE)(vpadEnd(label, 8)) + value, contentW);

  const rows = [];
  rows.push(A.bold(fg(PAPER)(fit('DETAILS'))));
  rows.push(fg(LINE)('─'.repeat(Math.max(0, contentW))));

  // Status + Role — grouped
  rows.push(kv('Status', A.bold(fg(isCrit ? AMBER : isAttn ? AMBER : INK)(fit(t.state)))));
  rows.push(kv('Role', fg(INK)(fit(meta.role))));
  rows.push('');

  // Progress — the mandated bar
  rows.push(fg(STONE)(fit('Progress')));
  const barW = Math.min(30, Math.max(4, contentW - 8));
  rows.push(vfit(' ' + bar(t.prog, barW, A, BRASS, { full: '█', empty: '░' }) + ' ' + A.bold(fg(PAPER)(t.prog+'%')), contentW));
  rows.push(vfit(' ' + fg(STONE)('tasks ') + fg(INK)(`${t.done}/${t.total}`) + fg(MUTE)('   ') + fg(STONE)('elapsed ') + fg(INK)(`${t.elapsed}s`), contentW));
  rows.push('');

  // At-risk + Verdict — grouped
  const stuckLabel = t.stuck > 0
    ? A.bold(fg(AMBER)(String(t.stuck) + ' at-risk'))
    : fg(SAGE)('0 at-risk');
  rows.push(kv('Stuck', stuckLabel));
  const verdict = isCrit
    ? A.bold(fg(AMBER)('▲ CRITICAL'))
    : isAttn
    ? A.bold(fg(AMBER)('▲ NEEDS ATTENTION'))
    : A.bold(fg(SAGE)('✓ HEALTHY'));
  rows.push(kv('Verdict', verdict));
  return rows;
}

// ============================================================================
// Layout helpers
// ============================================================================

/** Join blocks horizontally with a gap. Every block line is padded to the
 *  block's max visible width — lines never overflow. */
function joinH(blocks, gap = 1) {
  const h = Math.max(...blocks.map(b => b.length));
  const widths = blocks.map(b => Math.max(...b.map(l => vlen(l))));
  const lines = [];
  for (let i = 0; i < h; i++) {
    lines.push(blocks.map((b, bi) => vpadEnd(b[i] ?? '', widths[bi])).join(' '.repeat(gap)));
  }
  return lines;
}

/** Clamp an ANSI string to exactly maxW visible columns.
 *  Truncates with ellipsis if too long; pads with spaces if too short.
 *  Preserves ANSI escape codes through the visible portion. */
function vfit(s, maxW) {
  const vw = vlen(s);
  if (vw === maxW) return s;
  if (vw < maxW) return vpadEnd(s, maxW);
  // Truncate: walk char-by-char, preserving ANSI codes
  let vis = 0, i = 0, out = '';
  while (i < s.length && vis < maxW - 1) {
    if (s[i] === '\x1b') {
      const start = i;
      while (i < s.length && s[i] !== 'm') i++;
      if (i < s.length) i++; // include 'm'
      out += s.slice(start, i);
    } else {
      out += s[i]; vis++; i++;
    }
  }
  out += '…\x1b[0m';
  return out;
}
