// ═══════════════════════════════════════════════════════════════════
// Kingdom OS — Pixel Art Rendering Engine (Complete Overhaul)
// Medieval-themed rooms with high-quality NPC-style characters
// Inspired by pixel-agents / SkyOffice aesthetic
// ═══════════════════════════════════════════════════════════════════

// ─── Exported Types ────────────────────────────────────────────────

export type CharacterType =
  | 'king' | 'nobility' | 'knight' | 'squire'
  | 'healer' | 'sentinel' | 'scribe' | 'judge' | 'blacksmith';

export type AnimState =
  | 'idle' | 'working' | 'running' | 'reviewing' | 'stalled' | 'cancelled';

// ─── Internal Types ────────────────────────────────────────────────

interface CharState {
  x: number; y: number;
  tx: number; ty: number;
  dir: string; wf: number;
  moving: boolean; idle: number;
}

interface Particle {
  x: number; y: number;
  vx: number; vy: number;
  life: number; maxLife: number;
  color: string; size: number;
}

interface Bubble {
  text: string;
  timer: number;
  kind: 'speech' | 'thought';
}

interface Room {
  id: string;
  type: CharacterType;
  x: number; y: number;
  w: number; h: number;
}

// ─── Color Constants ───────────────────────────────────────────────

const P = {
  stone:   ['#1e1e2a', '#2d2d3d', '#3f3f52', '#555568', '#6e6e82'] as const,
  wood:    ['#1a0e06', '#2e1a0a', '#3e2a18', '#5c3317', '#7a5030'] as const,
  gold:    ['#806020', '#b08830', '#d4a840', '#f0c040', '#fff080'] as const,
  crimson: ['#3a0a0a', '#6b1010', '#8b2020', '#c03030', '#e04040'] as const,
  royal:   ['#0a0a3a', '#1a1a5a', '#2a2a8a', '#3a50b0', '#5080d0'] as const,
  forest:  ['#0a1a0a', '#102a10', '#1a4a1a', '#2a7a2a', '#40b040'] as const,
  skin:    ['#8a6040', '#b08060', '#d0a080', '#e8c0a0', '#f0d4b8'] as const,
  dark:    ['#0a0a0e', '#14141e', '#1e1e2e', '#282838', '#323248'] as const,
};

// ─── Utility Functions ─────────────────────────────────────────────

function shadeColor(hex: string, pct: number): string {
  const n = parseInt(hex.replace('#', ''), 16);
  const r = Math.max(0, Math.min(255, ((n >> 16) & 0xFF) + Math.round(255 * pct / 100)));
  const g = Math.max(0, Math.min(255, ((n >> 8) & 0xFF) + Math.round(255 * pct / 100)));
  const b = Math.max(0, Math.min(255, (n & 0xFF) + Math.round(255 * pct / 100)));
  return `#${(r << 16 | g << 8 | b).toString(16).padStart(6, '0')}`;
}

function lightenColor(color: string, frac: number): string {
  const c = color.startsWith('#') ? color : '#000000';
  const r = parseInt(c.slice(1, 3), 16);
  const g = parseInt(c.slice(3, 5), 16);
  const b = parseInt(c.slice(5, 7), 16);
  const nr = Math.min(255, Math.round(r + (255 - r) * frac));
  const ng = Math.min(255, Math.round(g + (255 - g) * frac));
  const nb = Math.min(255, Math.round(b + (255 - b) * frac));
  return `#${nr.toString(16).padStart(2, '0')}${ng.toString(16).padStart(2, '0')}${nb.toString(16).padStart(2, '0')}`;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function seededRand(seed: number): number {
  const x = Math.sin(seed * 127.1 + seed * 311.7) * 43758.5453;
  return x - Math.floor(x);
}

// ─── Character Palette System ──────────────────────────────────────

function charPal(
  skin: string, hair: string, pri: string, sec: string,
  acc: string, cape?: string,
): Record<string, string> {
  return {
    O: '#12101a',
    S: skin, s: shadeColor(skin, -25),
    H: hair, h: shadeColor(hair, -30),
    P: pri, p: shadeColor(pri, -22),
    C: sec, c: shadeColor(sec, -22),
    A: acc, a: shadeColor(acc, -22),
    K: cape ?? pri, k: shadeColor(cape ?? pri, -30),
    W: '#ffffff', w: '#c0c0cc',
    E: '#1a1020',
    B: '#3e2a18', b: '#2a1c0e',
    G: P.gold[3], g: P.gold[2],
    M: '#7f8c8d', m: '#5a6570',
    R: '#c0392b', L: '#2980b9', F: '#27ae60',
    T: '#f5e6ca', t: '#d4c5a9',
    D: '#8b7355', d: '#6b5340',
    X: lightenColor(skin, 0.15),
    Y: lightenColor(pri, 0.2),
    Z: lightenColor(sec, 0.2),
    '1': '#e8d5b0', '2': '#d2b88c',
    '3': '#b89968', '4': '#9a7b50',
    N: '#222222',
  };
}

const PAL: Record<CharacterType, Record<string, string>> = {
  king:       charPal('#e8c0a0', '#8B6914', '#8B0020', '#f0c040', '#d4a840', '#6B0018'),
  knight:     charPal('#d8b088', '#3a2510', '#5a6570', '#8a9aaa', '#2a70b0'),
  healer:     charPal('#e8c0a0', '#e0d0b0', '#ecf0f1', '#4aaa80', '#2ecc71'),
  sentinel:   charPal('#c09060', '#1a1010', '#34495e', '#2c3e50', '#c0392b'),
  nobility:   charPal('#e8c0a0', '#4a3728', '#6a2a8a', '#c088d0', '#f0c040'),
  squire:     charPal('#e8c0a0', '#b0703a', '#2a8a40', '#6a5530', '#d0c0a0'),
  scribe:     charPal('#e8c0a0', '#5a3018', '#6a5a40', '#c0b080', '#2c3e50'),
  judge:      charPal('#e8c0a0', '#aaaaaa', '#1a1a30', '#c0b8a0', '#c0392b'),
  blacksmith: charPal('#c89060', '#1a1010', '#4a4040', '#b08830', '#c04020'),
};

// ─── Character Sprites (24 × 32) ──────────────────────────────────
// High-quality chibi RPG style
// O=outline S/s=skin H/h=hair P/p=primary C/c=secondary A/a=accent
// K/k=cape E=eyes B/b=boots G/g=gold M/m=metal W/w=white D/d=leather
// X=skin-hi Y=prim-hi Z=sec-hi T/t=parchment N=dark

const KING_SPRITE = [
  '                        ',
  '        gGGGGGg         ',
  '       GgAGAGgAG        ',
  '       GAAAGAAAG        ',
  '      gGGGGGGGGg        ',
  '      OHHHHHHHhO        ',
  '     OHHHhHHHhHHO       ',
  '     OHXSSSSSSXHO       ',
  '     OSWEESWEESX        ',
  '      SSSsSSSsSS        ',
  '      OSsSSSsSsO        ',
  '       OSSSSSSO         ',
  '     OKKPPPPPPKKO       ',
  '    OKKPYPCCPYPKkO      ',
  '    OKKPPGCCCGPKKO      ',
  '    OKKPPcGGGcPKkO      ',
  '    OKKPPCCCCCPKkO      ',
  '     OKPPPPPPPPKk       ',
  '     OKKSPPPPSKkO       ',
  '      OKSPppPSKO        ',
  '      OkKSpPSKkO        ',
  '       OSPp pSO         ',
  '       OSPp pSO         ',
  '        OPp pPO         ',
  '        OBB BBO         ',
  '        OBBOOBBO        ',
  '        OBB BBO         ',
  '        OBb bBO         ',
  '        Obb bbO         ',
  '         O   O          ',
  '                        ',
  '                        ',
];

const KNIGHT_SPRITE = [
  '                        ',
  '        OMMMMMO         ',
  '       OMMMMMMMMO       ',
  '      OMMMMMMMMMO       ',
  '      OMMmMMmMMM        ',
  '     OMMmMMMmMMO        ',
  '     OMMSSSSSSMMO       ',
  '     OMWEESWEESX        ',
  '      MSSsSSSsSM        ',
  '      OMSSSSSsMO        ',
  '       OMSSSSMO         ',
  '     OMPPMMMPPMO        ',
  '     OMPPPPPPPMMO       ',
  '     OMPPAaAAPPMO       ',
  '     OMPAAaAAPPMO       ',
  '     OMPPAAAAPMmO       ',
  '      OMPPPPPMMMS       ',
  '      OMPPPPPMmm        ',
  '      OMSPpppSMO        ',
  '       OMp   pMO        ',
  '       OMp   pMO        ',
  '       OMM   MMO        ',
  '       OMM   MMO        ',
  '       OMM   MMO        ',
  '       OMM   MMO        ',
  '       OMm   mMO        ',
  '        mm   mm         ',
  '                        ',
  '                        ',
  '                        ',
  '                        ',
  '                        ',
];

const HEALER_SPRITE = [
  '                        ',
  '       OHHHHHHO         ',
  '      OHHHHHHHhO        ',
  '     OHHHHHHHHHhO       ',
  '     OHHhHHHhHHHO       ',
  '     OHXSSSSXSHHO       ',
  '     OSSWEESWESX        ',
  '      SSSsSSSsSS        ',
  '      OSsSSSsSsO        ',
  '       OSSSSSSO         ',
  '      OPPPPPPPO         ',
  '     OPPPPPPPPPFO       ',
  '     OPPPPFFFPFPO       ',
  '     OPPPFfFPFFPO       ',
  '     OPPPPFFFPPPfO      ',
  '     OPPPPPPPPPPffO     ',
  '      OSPPPPPPSFffO     ',
  '      OSSPpppPSSfFO     ',
  '       OSPp pPS fO      ',
  '       OSPp pPSO        ',
  '        OPp pPO         ',
  '        OPP PPO         ',
  '        OBB BBO         ',
  '        OBB BBO         ',
  '        OBb bBO         ',
  '        Obb bbO         ',
  '         O   O          ',
  '                        ',
  '                        ',
  '                        ',
  '                        ',
  '                        ',
];

const SENTINEL_SPRITE = [
  '                        ',
  '       OPPPPPPO         ',
  '      OPPPPPPPO         ',
  '     OPPPPPPPPPO        ',
  '     OPPmPPPmPPO        ',
  '     OPPmSSSmPPO        ',
  '     OPSWEESWEPX        ',
  '      PSSsSSSsPP        ',
  '      OPSSSSsPPO        ',
  '       OPSSSSPPO        ',
  '      OCCPPPPCC         ',
  '     OCCPPPPPPCCО       ',
  '     OCCPAAAPPCCO       ',
  '     OCCPAaAPPCcO       ',
  '     OCCPPPPPPCcO       ',
  '      OCCPPPPCCO        ',
  '      OCCPcpPCCO        ',
  '       OSSPppSSO        ',
  '       OSPp pPSO        ',
  '        OCp pCO         ',
  '        OCp pCO         ',
  '        OCC CCO         ',
  '        OBB BBO         ',
  '        OBB BBO         ',
  '        OBb bBO         ',
  '        Obb bbO         ',
  '         O   O          ',
  '                        ',
  '                        ',
  '                        ',
  '                        ',
  '                        ',
];

const NOBILITY_SPRITE = [
  '                        ',
  '        OgGGgO          ',
  '       OgGGGGgO         ',
  '      OHHHHHHHO         ',
  '     OHHHHHHHHHHO       ',
  '     OHHhHHHhHHHO       ',
  '     OHXSSSSXSHHO       ',
  '     OSSWEESWESX        ',
  '      SSSsSSSsSS        ',
  '      OSsSSSsSsO        ',
  '       OSSSSSSO         ',
  '     OKKPPPPPPKKO       ',
  '    OKKPZCCCCZPKkO      ',
  '    OKKPCCGGGCCPKkO     ',
  '    OKKPCCCCCCCPKkO     ',
  '     OKPPPPPPPPKkO      ',
  '     OKKSPPPPSKkO       ',
  '      OKKSppPSKkO       ',
  '       OSPp pPSO        ',
  '       OSPp pSO         ',
  '        OPp pPO         ',
  '        OCC CCO         ',
  '        OBB BBO         ',
  '        OBB BBO         ',
  '        OBb bBO         ',
  '        Obb bbO         ',
  '         O   O          ',
  '                        ',
  '                        ',
  '                        ',
  '                        ',
  '                        ',
];

const SQUIRE_SPRITE = [
  '                        ',
  '       OHHHHHO          ',
  '      OHHHHHHHHO        ',
  '     OHHHhHHhHHO        ',
  '     OHXSSSSXSHO        ',
  '     OSSWEESWESX        ',
  '      SSSsSSSsSS        ',
  '      OSsSSSsSsO        ',
  '       OSSSSSSO         ',
  '      OPPPPPPPO         ',
  '     OPPPPCCCPPPO       ',
  '     OPPPCsCssPPO       ',
  '     OPPPPCCCPPPO       ',
  '     OPPPPPPPPPDO       ',
  '     OPPPAaAPPPDdO      ',
  '      OSPPPPPPSO dO     ',
  '      OSSPpppSSO        ',
  '       OSPp pPSO        ',
  '        OPp pPO         ',
  '        OPp pPO         ',
  '        OCC CCO         ',
  '        OBB BBO         ',
  '        OBB BBO         ',
  '        OBb bBO         ',
  '        Obb bbO         ',
  '         O   O          ',
  '                        ',
  '                        ',
  '                        ',
  '                        ',
  '                        ',
  '                        ',
];

const SCRIBE_SPRITE = [
  '                        ',
  '       OHHHHHHO         ',
  '      OHHHHHHHHO        ',
  '     OHHHhHHhHHHO       ',
  '     OHXSSSSXSHHO       ',
  '     OSSWEESWESX        ',
  '      SSSsSSSsSS        ',
  '      OSsSSSsSsO        ',
  '       OSSSSSSO         ',
  '      OPPPPPPPO         ',
  '     OPPPPPPPPPPtO      ',
  '     OPPCPPPPCCPTtO     ',
  '     OPPPPPPPPPPTtO     ',
  '     OPPPPPPPPPO TtO    ',
  '     OPPPPPPPPSTtO      ',
  '      OSPPPPPPSO TO     ',
  '      OSSPpppPSO        ',
  '       OSPp pPO         ',
  '       OSPp pPO         ',
  '        OPp pPO         ',
  '        OPP PPO         ',
  '        OBB BBO         ',
  '        OBB BBO         ',
  '        OBb bBO         ',
  '        Obb bbO         ',
  '         O   O          ',
  '                        ',
  '                        ',
  '                        ',
  '                        ',
  '                        ',
  '                        ',
];

const JUDGE_SPRITE = [
  '                        ',
  '      OWWWWWWWO         ',
  '     OWWWWWWWWWO        ',
  '     OWWwWWWwWWO        ',
  '     OWWWWWWWWWWO       ',
  '     OWXSSSSXWWO        ',
  '     OSSWEESWESX        ',
  '      SSSsSSSsSS        ',
  '      OSsSSSsSsO        ',
  '       OSSSSSSO         ',
  '     OPPPPPPPPPPO       ',
  '    OPPPPPPPPPPPO       ',
  '    OPPPCCRCCPPPpO      ',
  '    OPPPCPCPCPPpO       ',
  '    OPPPCCRCCPPpO       ',
  '    OPPPPPPPPPPPO       ',
  '     OSPPPPPPPSOpO      ',
  '     OSSPpppPSSO        ',
  '      OSPp pPSO         ',
  '       OPp pPO          ',
  '       OPp pPO          ',
  '       OPP PPO          ',
  '       OBB BBO          ',
  '       OBB BBO          ',
  '       OBb bBO          ',
  '       Obb bbO          ',
  '        O   O           ',
  '                        ',
  '                        ',
  '                        ',
  '                        ',
  '                        ',
];

const BLACKSMITH_SPRITE = [
  '                        ',
  '       OHHHHHHO         ',
  '      OHHHHHHHHO        ',
  '     OHHHhHHhHHO        ',
  '     OHXSSSSXSHO        ',
  '     OSSWEESWESX        ',
  '      SSSsSSSsSS        ',
  '      OSsSSSsSsO        ',
  '       OSSSSSSO         ',
  '     ODDPPMMPPDDO       ',
  '     ODPPPMMMPPDO       ',
  '     ODPPMMMMPPMDO      ',
  '     ODPPMMMMPPDMO      ',
  '     ODPPPPPPPDmmO      ',
  '     ODPPAaAPPDAMO      ',
  '      OSPPPPPSAAmO      ',
  '      OSSPppPSSO mO     ',
  '       OSPp pPSO        ',
  '        OPp pPO         ',
  '        OPp pPO         ',
  '        OPP PPO         ',
  '        OBB BBO         ',
  '        OBB BBO         ',
  '        OBb bBO         ',
  '        Obb bbO         ',
  '         O   O          ',
  '                        ',
  '                        ',
  '                        ',
  '                        ',
  '                        ',
  '                        ',
];

const SPRITES: Record<CharacterType, string[]> = {
  king: KING_SPRITE, knight: KNIGHT_SPRITE, healer: HEALER_SPRITE,
  sentinel: SENTINEL_SPRITE, nobility: NOBILITY_SPRITE, squire: SQUIRE_SPRITE,
  scribe: SCRIBE_SPRITE, judge: JUDGE_SPRITE, blacksmith: BLACKSMITH_SPRITE,
};

// ─── Animation Frames ──────────────────────────────────────────────

function blinkFrame(sp: string[]): string[] { return sp.map(l => l.replace(/E/g, 'S')); }

function mkIdle(sp: string[]): string[][] {
  const base = sp;
  const breathe = sp.map((l, i) => (i >= 10 && i <= 18) ? ' ' + l.slice(0, -1) : l);
  return [base, base, breathe, blinkFrame(sp)];
}

function mkWalk(sp: string[]): string[][] {
  return [
    sp.map(l => l.replace(/B/g, 'b')),
    sp,
    sp.map(l => l.replace(/b/g, 'B')),
    sp,
  ];
}

const IDLE: Record<CharacterType, string[][]> = {} as any;
const WALK: Record<CharacterType, string[][]> = {} as any;
for (const t of Object.keys(SPRITES) as CharacterType[]) {
  IDLE[t] = mkIdle(SPRITES[t]);
  WALK[t] = mkWalk(SPRITES[t]);
}

const IDLE_DUR = 180;

// ─── Character State ───────────────────────────────────────────────

const charStates = new Map<string, CharState>();

export function getCS(id: string, sx: number, sy: number): CharState {
  if (!charStates.has(id)) {
    charStates.set(id, {
      x: sx, y: sy, tx: sx, ty: sy,
      dir: 'down', wf: 0, moving: false,
      idle: Math.random() * 200,
    });
  }
  return charStates.get(id)!;
}

interface SmoothState { x: number; y: number; tx: number; ty: number; prevX: number; prevY: number; }
const sStates = new Map<string, SmoothState>();

// Threshold (px) below which we consider the character "arrived"
const ARRIVE_THRESHOLD = 2;
// Lerp speed — higher = snappier; lower = floatier
const LERP_SPEED = 0.10;
// Walk-frame advance rate (lower = slower leg cycle — pixel-art-animator "10 FPS classic" cadence)
const WF_RATE = 0.15;

/**
 * Unified movement update.
 *
 * Smoothly interpolates position toward the target (lerp) **and** drives
 * the CharState movement fields (`moving`, `dir`, `wf`) that drawCharacter
 * depends on for sprite selection and orientation.
 *
 * Optionally accepts `roomBounds` so that idle characters perform
 * micro-wandering within their room — avoids the "dead statue" look
 * (pixel-art-animator: "2-frame idle breathing" / subtle movement).
 */
export function updateCharacterPosition(
  id: string, cx: number, cy: number,
  tx: number, ty: number, _dt: number,
  roomBounds?: { x: number; y: number; w: number; h: number },
): { x: number; y: number } {
  /* ---- smooth state (position interpolation) ---- */
  let s = sStates.get(id);
  if (!s) { s = { x: cx, y: cy, tx, ty, prevX: cx, prevY: cy }; sStates.set(id, s); }

  s.prevX = s.x;
  s.prevY = s.y;
  s.tx = tx; s.ty = ty;
  s.x = lerp(s.x, tx, LERP_SPEED);
  s.y = lerp(s.y, ty, LERP_SPEED);

  /* ---- character state (animation / direction) ---- */
  const cs = getCS(id, cx, cy);

  const dx = s.tx - s.x;
  const dy = s.ty - s.y;
  const dist = Math.sqrt(dx * dx + dy * dy);

  if (dist > ARRIVE_THRESHOLD) {
    // Character is actively moving toward target
    cs.moving = true;

    // Direction — favour the dominant axis (pixel-art 4-dir convention)
    cs.dir = Math.abs(dx) > Math.abs(dy)
      ? (dx > 0 ? 'right' : 'left')
      : (dy > 0 ? 'down' : 'up');

    // Walk-frame counter — advance proportional to actual distance covered
    // Uses pixel-art-animator "classic 10 FPS" cadence mapped through WF_RATE
    const moved = Math.sqrt((s.x - s.prevX) ** 2 + (s.y - s.prevY) ** 2);
    cs.wf = (cs.wf + moved * WF_RATE) % 4;
  } else {
    // Arrived — settle into idle
    if (cs.moving) {
      // Follow-through: keep last direction so the character faces where it walked
      cs.moving = false;
      cs.wf = 0;
    }

    // Idle micro-wandering within room bounds
    // (pixel-art-animator "breathing idle" — subtle positional drift keeps life)
    if (roomBounds) {
      cs.idle--;
      if (cs.idle <= 0) {
        const mx = roomBounds.w * 0.12;
        const my = roomBounds.h * 0.15;
        s.tx = roomBounds.x + mx + Math.random() * (roomBounds.w - mx * 2);
        s.ty = roomBounds.y + my + Math.random() * (roomBounds.h - my * 2);
        cs.idle = 150 + Math.random() * 350;
      }
    }
  }

  return { x: s.x, y: s.y };
}

// ─── Sprite Drawing ────────────────────────────────────────────────

function drawSprite(
  ctx: CanvasRenderingContext2D,
  sp: string[], pal: Record<string, string>,
  x: number, y: number, s: number, flipH: boolean,
) {
  for (let r = 0; r < sp.length; r++) {
    const line = sp[r];
    for (let c = 0; c < line.length; c++) {
      const ch = line[c];
      if (ch === ' ') continue;
      const color = pal[ch];
      if (!color) continue;
      ctx.fillStyle = color;
      const dx = flipH ? x + (line.length - 1 - c) * s : x + c * s;
      ctx.fillRect(dx, y + r * s, s + 0.5, s + 0.5);
    }
  }
}

function drawOutline(
  ctx: CanvasRenderingContext2D,
  sp: string[],
  x: number, y: number, s: number, flipH: boolean,
) {
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
  for (let r = 0; r < sp.length; r++) {
    const line = sp[r];
    for (let c = 0; c < line.length; c++) {
      if (line[c] === ' ') continue;
      for (const [ox, oy] of dirs) {
        const nr = r + oy, nc = c + ox;
        if (nr < 0 || nr >= sp.length || nc < 0 || nc >= line.length || sp[nr][nc] === ' ') {
          const dx = flipH ? x + (line.length - 1 - (c + ox)) * s : x + (c + ox) * s;
          ctx.fillRect(dx, y + (r + oy) * s, s + 0.5, s + 0.5);
        }
      }
    }
  }
}

function drawShadow(ctx: CanvasRenderingContext2D, x: number, y: number, s: number) {
  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,0.22)';
  ctx.beginPath();
  ctx.ellipse(x + 12 * s, y + 30 * s, 9 * s, 2.5 * s, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

// ─── Bubbles ───────────────────────────────────────────────────────

const QUIPS = [
  'For the realm!', 'By decree...', 'Hmm...', 'The scrolls speak.',
  'Guards!', 'Fascinating.', 'Another day...', 'The kingdom grows.',
  'To battle!', 'Justice prevails.', 'The forge calls.', 'Heal thyself.',
  'Onwards!', 'The stars align...', 'Hark!', 'A fine day.',
];

const bubbles = new Map<string, Bubble>();

function tickBubble(id: string, state: AnimState, job: string | null, frame: number) {
  const b = bubbles.get(id);
  if (b) { b.timer--; if (b.timer <= 0) bubbles.delete(id); return; }
  if ((state === 'working' || state === 'running') && job && frame % 300 < 2) {
    bubbles.set(id, { text: job.length > 24 ? job.slice(0, 22) + '..' : job, timer: 180, kind: 'speech' });
  } else if (state === 'idle' && frame % 600 < 2) {
    bubbles.set(id, { text: QUIPS[Math.floor(Math.random() * QUIPS.length)], timer: 120, kind: 'thought' });
  }
}

function renderBubble(ctx: CanvasRenderingContext2D, id: string, x: number, y: number) {
  const b = bubbles.get(id);
  if (!b) return;
  const alpha = b.timer < 30 ? b.timer / 30 : 1;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.font = '9px monospace';
  const tw = ctx.measureText(b.text).width;
  const bw = tw + 14, bh = 20;
  const bx = x - bw / 2, by = y - bh - 12;

  ctx.shadowColor = 'rgba(0,0,0,0.25)';
  ctx.shadowBlur = 4;
  ctx.shadowOffsetY = 2;

  const isSpeech = b.kind === 'speech';
  ctx.fillStyle = isSpeech ? '#f5ead0' : '#d8e8f8';
  ctx.strokeStyle = isSpeech ? '#8a7040' : '#6080a0';
  ctx.lineWidth = 1.5;
  roundRect(ctx, bx, by, bw, bh, 4);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.stroke();

  // Tail
  ctx.beginPath();
  ctx.moveTo(x - 4, by + bh); ctx.lineTo(x, by + bh + 6); ctx.lineTo(x + 4, by + bh);
  ctx.fillStyle = isSpeech ? '#f5ead0' : '#d8e8f8';
  ctx.fill(); ctx.stroke();

  ctx.fillStyle = '#2a1a08';
  ctx.fillText(b.text, bx + 7, by + 14);

  if (!isSpeech) {
    ctx.fillStyle = '#d8e8f8'; ctx.strokeStyle = '#6080a0';
    ctx.beginPath(); ctx.arc(x - 2, by + bh + 10, 2, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.arc(x - 5, by + bh + 14, 1.5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  }
  ctx.restore();
}

export function drawSpeechBubble(ctx: CanvasRenderingContext2D, x: number, y: number, text: string) {
  ctx.save();
  ctx.font = '10px monospace';
  const tw = ctx.measureText(text).width;
  const bw = tw + 14, bh = 22, bx = x - bw / 2, by = y - bh - 10;
  ctx.fillStyle = '#f5ead0'; ctx.strokeStyle = '#8a7040'; ctx.lineWidth = 1.5;
  roundRect(ctx, bx, by, bw, bh, 5); ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#2a1a08'; ctx.fillText(text, bx + 7, by + 15);
  ctx.restore();
}

export function drawThoughtBubble(ctx: CanvasRenderingContext2D, x: number, y: number, text: string) {
  ctx.save();
  ctx.font = '10px monospace';
  const tw = ctx.measureText(text).width;
  const bw = tw + 14, bh = 22, bx = x - bw / 2, by = y - bh - 10;
  ctx.fillStyle = '#d8e8f8'; ctx.strokeStyle = '#6080a0'; ctx.lineWidth = 1.5;
  roundRect(ctx, bx, by, bw, bh, 5); ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#1a2a40'; ctx.fillText(text, bx + 7, by + 15);
  ctx.restore();
}

// ─── Status Effects ────────────────────────────────────────────────

function drawStatus(ctx: CanvasRenderingContext2D, state: AnimState, x: number, y: number, s: number, f: number) {
  if (state === 'working' || state === 'running') {
    for (let i = 0; i < 3; i++) {
      const ang = (f * 0.06 + i * 2.1) % (Math.PI * 2);
      const sx = x + 12 * s + Math.cos(ang) * 14 * s;
      const sy = y + 14 * s + Math.sin(ang) * 8 * s;
      const sz = (Math.sin(f * 0.12 + i) * 0.5 + 1.2) * s;
      ctx.fillStyle = P.gold[3 + (i % 2)];
      ctx.globalAlpha = 0.8;
      ctx.fillRect(sx, sy, sz, sz);
    }
    ctx.globalAlpha = 1;
  } else if (state === 'idle') {
    for (let i = 0; i < 3; i++) {
      const px = x + 16 * s + i * 4 + Math.sin(f * 0.04 + i) * 2;
      const py = y - 4 * s - (f * 0.4 + i * 10) % 20;
      const a = Math.max(0, (20 - ((f * 0.4 + i * 10) % 20)) / 20);
      ctx.fillStyle = `rgba(180,180,220,${a.toFixed(2)})`;
      ctx.font = `${Math.max(6, 7 * Math.min(s, 2))}px monospace`;
      ctx.fillText('Z', px, py);
    }
  } else if (state === 'stalled') {
    const pulse = Math.sin(f * 0.1) * 0.2 + 0.2;
    ctx.fillStyle = `rgba(200,50,40,${pulse.toFixed(2)})`;
    ctx.fillRect(x, y, 24 * s, 30 * s);
    ctx.fillStyle = '#e74c3c';
    ctx.font = `bold ${Math.max(8, 10 * Math.min(s, 2.5))}px sans-serif`;
    ctx.fillText('!', x + 20 * s, y + 4 * s);
  } else if (state === 'reviewing') {
    ctx.strokeStyle = P.gold[2]; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(x + 22 * s, y + 2 * s, 3 * s, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x + 24 * s, y + 4 * s); ctx.lineTo(x + 26 * s, y + 6 * s); ctx.stroke();
  } else if (state === 'cancelled') {
    ctx.fillStyle = 'rgba(40,40,50,0.45)';
    ctx.fillRect(x, y, 24 * s, 30 * s);
  }
}

// ─── Main Character Drawing ───────────────────────────────────────

export function drawCharacter(
  ctx: CanvasRenderingContext2D,
  type: CharacterType,
  state: AnimState,
  x: number, y: number, s: number, frame: number,
  agentId?: string,
  currentJob?: string | null,
) {
  const id = agentId ?? `${type}-${Math.round(x)}`;
  const pal = PAL[type];
  const cs = getCS(id, x, y);

  const bob =
    cs.moving ? Math.sin(cs.wf * Math.PI * 0.5) * 1.2 :
    state === 'idle' ? Math.sin(frame * 0.04) * 1.0 :
    (state === 'working' || state === 'running') ? Math.sin(frame * 0.08) * 0.6 : 0;
  const drawY = cs.y + bob;
  const flipH = cs.dir === 'left';

  let sp: string[];
  if (cs.moving) {
    sp = WALK[type][Math.floor(cs.wf) % 4];
  } else {
    sp = IDLE[type][Math.floor(frame / IDLE_DUR) % 4];
  }

  drawShadow(ctx, cs.x, drawY, s);
  drawOutline(ctx, sp, cs.x, drawY, s, flipH);
  drawSprite(ctx, sp, pal, cs.x, drawY, s, flipH);

  // Walk leg overlay
  if (cs.moving) {
    const lp = Math.sin(cs.wf * 0.3) * 2 * s;
    ctx.fillStyle = pal.B;
    ctx.fillRect(cs.x + 8 * s, drawY + 26 * s + lp, 3 * s, 2 * s);
    ctx.fillRect(cs.x + 13 * s, drawY + 26 * s - lp, 3 * s, 2 * s);
  }

  drawStatus(ctx, state, cs.x, drawY, s, frame);
  if (agentId) {
    tickBubble(id, state, currentJob ?? null, frame);
    renderBubble(ctx, id, cs.x + 12 * s, drawY - 4);
  }
}

// ─── Particle System ───────────────────────────────────────────────

const particles = new Map<string, Particle[]>();

function getP(id: string): Particle[] {
  if (!particles.has(id)) particles.set(id, []);
  return particles.get(id)!;
}

function spawn(id: string, x: number, y: number, col: string, vx = 0, vy = -0.5, sz = 2, life = 60) {
  const arr = getP(id);
  if (arr.length > 50) return;
  arr.push({
    x, y, vx: vx + (Math.random() - 0.5) * 0.3, vy,
    life, maxLife: life, color: col, size: sz,
  });
}

function tickParticles(ctx: CanvasRenderingContext2D, id: string) {
  const arr = getP(id);
  for (let i = arr.length - 1; i >= 0; i--) {
    const p = arr[i];
    p.x += p.vx; p.y += p.vy; p.life--;
    if (p.life <= 0) { arr.splice(i, 1); continue; }
    ctx.globalAlpha = p.life / p.maxLife;
    ctx.fillStyle = p.color;
    ctx.fillRect(Math.round(p.x), Math.round(p.y), p.size, p.size);
  }
  ctx.globalAlpha = 1;
}

function spawnRoomParticles(type: CharacterType, rid: string, x: number, y: number, w: number, h: number, f: number) {
  const pid = `p-${rid}`;
  if (type === 'blacksmith' && f % 3 === 0) {
    spawn(pid, x + w * 0.7 + Math.random() * 30, y + h * 0.5,
      `rgba(255,${140 + Math.floor(Math.random() * 60)},0,1)`,
      (Math.random() - 0.5) * 0.3, -0.6 - Math.random() * 0.5, 1.5, 30 + Math.floor(Math.random() * 20));
  }
  if (type === 'healer' && f % 6 === 0) {
    spawn(pid, x + w * 0.3 + Math.random() * w * 0.4, y + h * 0.6,
      `rgba(0,${180 + Math.floor(Math.random() * 60)},80,0.8)`,
      (Math.random() - 0.5) * 0.1, -0.25, 1.5, 50);
  }
  if (type === 'scribe' && f % 10 === 0) {
    spawn(pid, x + Math.random() * w, y + Math.random() * h,
      'rgba(200,180,140,0.4)', 0, -0.02, 1, 80);
  }
  if (type === 'sentinel' && f % 5 === 0) {
    spawn(pid, x + w + 2, y + Math.random() * h,
      'rgba(140,170,210,0.35)', -0.5 - Math.random() * 0.2, 0, 2, 50);
  }
  if (type === 'king' && f % 8 === 0) {
    spawn(pid, x + w * 0.5 + Math.random() * 20 - 10, y + h * 0.25,
      'rgba(240,192,64,0.5)', (Math.random() - 0.5) * 0.1, -0.15, 1, 60);
  }
}

// ─── Torch / Flame ─────────────────────────────────────────────────

function drawTorch(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, f: number) {
  ctx.save();
  // Bracket
  ctx.fillStyle = '#5a3f21';
  ctx.fillRect(x, y + 4 * s, 3 * s, 10 * s);
  ctx.fillStyle = '#3a2510';
  ctx.fillRect(x + 0.5 * s, y + 5 * s, 2 * s, 8 * s);
  // Flame
  const flick = Math.sin(f * 0.25) * s;
  const fx = x + 1.5 * s + flick * 0.4;
  const fy = y + 2 * s + Math.cos(f * 0.3) * 0.5 * s;
  const r = 4 * s;
  const g = ctx.createRadialGradient(fx, fy, 0, fx, fy, r);
  g.addColorStop(0, 'rgba(255,220,100,0.9)');
  g.addColorStop(0.4, 'rgba(255,160,40,0.6)');
  g.addColorStop(1, 'rgba(255,80,0,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.ellipse(fx, fy, r * 0.7, r, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,200,0.8)';
  ctx.beginPath();
  ctx.ellipse(fx, fy, r * 0.2, r * 0.35, 0, 0, Math.PI * 2);
  ctx.fill();
  // Glow halo
  const glow = ctx.createRadialGradient(fx, fy, 0, fx, fy, 22 * s);
  glow.addColorStop(0, 'rgba(255,180,60,0.12)');
  glow.addColorStop(1, 'rgba(255,100,20,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(fx - 22 * s, fy - 22 * s, 44 * s, 44 * s);
  ctx.restore();
}

// ─── Detailed Furniture ────────────────────────────────────────────

function drawThrone(ctx: CanvasRenderingContext2D, x: number, y: number, s: number) {
  ctx.save(); ctx.translate(x, y);
  // Back panel
  ctx.fillStyle = '#c4992a';
  ctx.fillRect(2 * s, 0, 20 * s, 22 * s);
  ctx.fillStyle = '#d4a840';
  ctx.fillRect(4 * s, 2 * s, 16 * s, 18 * s);
  // Arch top
  ctx.fillStyle = '#e0bd50';
  ctx.beginPath();
  ctx.moveTo(2 * s, 0);
  ctx.bezierCurveTo(12 * s, -8 * s, 12 * s, -8 * s, 22 * s, 0);
  ctx.fill();
  // Crown spikes
  ctx.fillStyle = '#f0c040';
  ctx.fillRect(8 * s, -4 * s, 2 * s, 4 * s);
  ctx.fillRect(12 * s, -5 * s, 2 * s, 5 * s);
  ctx.fillRect(16 * s, -4 * s, 2 * s, 4 * s);
  // Gems
  ctx.fillStyle = '#e04040';
  ctx.fillRect(9 * s, -2 * s, 1 * s, 1 * s);
  ctx.fillStyle = '#4080e0';
  ctx.fillRect(13 * s, -3 * s, 1 * s, 1 * s);
  ctx.fillStyle = '#e04040';
  ctx.fillRect(17 * s, -2 * s, 1 * s, 1 * s);
  // Cushion
  ctx.fillStyle = '#a82020';
  ctx.fillRect(4 * s, 14 * s, 16 * s, 8 * s);
  ctx.fillStyle = '#c83030';
  ctx.fillRect(5 * s, 15 * s, 14 * s, 5 * s);
  ctx.fillStyle = '#801818';
  ctx.fillRect(4 * s, 19 * s, 16 * s, 3 * s);
  // Armrests
  ctx.fillStyle = '#b08830';
  ctx.fillRect(0, 10 * s, 4 * s, 12 * s);
  ctx.fillRect(20 * s, 10 * s, 4 * s, 12 * s);
  ctx.fillStyle = '#d4a840';
  ctx.fillRect(1 * s, 11 * s, 2 * s, 10 * s);
  ctx.fillRect(21 * s, 11 * s, 2 * s, 10 * s);
  // Legs
  ctx.fillStyle = '#a07020';
  ctx.fillRect(2 * s, 22 * s, 4 * s, 4 * s);
  ctx.fillRect(18 * s, 22 * s, 4 * s, 4 * s);
  ctx.restore();
}

function drawTable(ctx: CanvasRenderingContext2D, x: number, y: number, tw: number, s: number) {
  ctx.save(); ctx.translate(x, y);
  // Top
  ctx.fillStyle = '#6b4c2b';
  ctx.fillRect(0, 0, tw, 10 * s);
  ctx.fillStyle = '#5a3f21';
  for (let i = 2; i < tw; i += 6 * s) ctx.fillRect(i, 1 * s, 1, 8 * s);
  ctx.fillStyle = '#7a5a35';
  ctx.fillRect(1 * s, 1 * s, tw - 2 * s, 1 * s);
  // Legs
  ctx.fillStyle = '#5a3f21';
  ctx.fillRect(2 * s, 10 * s, 3 * s, 6 * s);
  ctx.fillRect(tw - 5 * s, 10 * s, 3 * s, 6 * s);
  // Scroll on table
  ctx.fillStyle = '#e8d8b0';
  ctx.fillRect(6 * s, 2 * s, 12 * s, 6 * s);
  ctx.fillStyle = '#d0c090';
  ctx.fillRect(6 * s, 2 * s, 12 * s, 1 * s);
  ctx.strokeStyle = '#a09060'; ctx.lineWidth = 0.5;
  for (let ly = 4 * s; ly < 7 * s; ly += 1.5 * s) {
    ctx.beginPath(); ctx.moveTo(7 * s, ly); ctx.lineTo(17 * s, ly); ctx.stroke();
  }
  // Candle
  ctx.fillStyle = '#e8d8a0';
  ctx.fillRect(tw - 10 * s, 1 * s, 2 * s, 5 * s);
  ctx.fillStyle = '#ffa020';
  ctx.beginPath();
  ctx.ellipse(tw - 9 * s, 1 * s, 1.5 * s, 2 * s, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,200,60,0.25)';
  ctx.beginPath();
  ctx.ellipse(tw - 9 * s, 1 * s, 4 * s, 4 * s, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawBookshelf(ctx: CanvasRenderingContext2D, x: number, y: number, s: number) {
  ctx.save(); ctx.translate(x, y);
  const sw = 22 * s, sh = 28 * s;
  ctx.fillStyle = '#3a2510';
  ctx.fillRect(0, 0, sw, sh);
  ctx.fillStyle = '#5a3f21';
  ctx.fillRect(0, 0, 2 * s, sh);
  ctx.fillRect(sw - 2 * s, 0, 2 * s, sh);
  ctx.fillRect(0, 0, sw, 2 * s);
  for (let si = 0; si < 3; si++) {
    const sy = 8 * s + si * 9 * s;
    ctx.fillStyle = '#6b4c2b';
    ctx.fillRect(0, sy, sw, 2 * s);
    ctx.fillStyle = '#7a5a35';
    ctx.fillRect(1 * s, sy, sw - 2 * s, 1 * s);
  }
  const bc = ['#8b2020', '#2a2a8a', '#2a6a2a', '#8a6020', '#6a2a6a', '#2a6a6a', '#8a4020', '#4a4a6a'];
  for (let si = 0; si < 3; si++) {
    const st = 2 * s + si * 9 * s;
    let bx = 3 * s;
    for (let bi = 0; bi < 4; bi++) {
      const bw = (1.5 + seededRand(si * 31 + bi * 17) * 1.5) * s;
      const bh = (5 + seededRand(si * 7 + bi * 3) * 2) * s;
      const ci = (si * 4 + bi) % bc.length;
      ctx.fillStyle = bc[ci];
      ctx.fillRect(bx, st + (7 * s - bh), bw, bh);
      ctx.fillStyle = lightenColor(bc[ci], 0.3);
      ctx.fillRect(bx, st + (7 * s - bh), Math.max(0.5, 0.5 * s), bh);
      bx += bw + 0.5 * s;
    }
  }
  ctx.restore();
}

function drawAnvil(ctx: CanvasRenderingContext2D, x: number, y: number, s: number) {
  ctx.save(); ctx.translate(x, y);
  ctx.fillStyle = '#4a4a58';
  ctx.fillRect(2 * s, 10 * s, 16 * s, 6 * s);
  ctx.fillStyle = '#6a6a78';
  ctx.fillRect(0, 4 * s, 20 * s, 6 * s);
  ctx.fillStyle = '#8a8a98';
  ctx.fillRect(1 * s, 5 * s, 18 * s, 4 * s);
  ctx.fillStyle = '#6a6a78';
  ctx.beginPath();
  ctx.moveTo(0, 6 * s); ctx.lineTo(-4 * s, 7 * s); ctx.lineTo(0, 8 * s); ctx.fill();
  ctx.fillStyle = '#b0b0c0';
  ctx.fillRect(2 * s, 5 * s, 16 * s, 1 * s);
  ctx.restore();
}

function drawForge(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, f: number) {
  ctx.save(); ctx.translate(x, y);
  ctx.fillStyle = '#3a3a48';
  ctx.fillRect(0, 0, 24 * s, 20 * s);
  ctx.fillStyle = '#4a4a58';
  ctx.fillRect(2 * s, 2 * s, 20 * s, 16 * s);
  ctx.fillStyle = '#1a0808';
  ctx.fillRect(4 * s, 6 * s, 16 * s, 12 * s);
  const fc = ['#ff4020', '#ff6020', '#ff8040', '#ffa040', '#ffc040', '#ffe060'];
  for (let i = 0; i < 5; i++) {
    const fx = 6 * s + i * 3 * s;
    const fh = (4 + Math.sin(f * 0.15 + i * 1.5) * 3) * s;
    const fy = 18 * s - fh;
    ctx.fillStyle = fc[(i + f) % fc.length];
    ctx.fillRect(fx, fy, 2.5 * s, fh);
  }
  const glow = ctx.createRadialGradient(12 * s, 12 * s, 0, 12 * s, 12 * s, 16 * s);
  glow.addColorStop(0, 'rgba(255,120,30,0.25)');
  glow.addColorStop(1, 'rgba(255,60,0,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(-4 * s, -4 * s, 32 * s, 28 * s);
  ctx.restore();
}

function drawHealCircle(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, f: number) {
  ctx.save(); ctx.translate(x, y);
  const r = 10 * s;
  const pulse = Math.sin(f * 0.06) * 0.15 + 0.85;
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, r * 1.5);
  g.addColorStop(0, `rgba(50,200,120,${(0.2 * pulse).toFixed(2)})`);
  g.addColorStop(1, 'rgba(50,200,120,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.ellipse(0, 0, r * 1.5, r * 0.8, 0, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = `rgba(50,200,120,${(0.5 * pulse).toFixed(2)})`;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.ellipse(0, 0, r * 0.8, r * 0.5, 0, 0, Math.PI * 2); ctx.stroke();
  ctx.strokeStyle = `rgba(50,200,120,${(0.6 * pulse).toFixed(2)})`;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, -4 * s); ctx.lineTo(0, 4 * s);
  ctx.moveTo(-4 * s, 0); ctx.lineTo(4 * s, 0);
  ctx.stroke();
  ctx.restore();
}

function drawChair(ctx: CanvasRenderingContext2D, x: number, y: number, s: number) {
  ctx.save(); ctx.translate(x, y);
  ctx.fillStyle = '#5a3f21';
  ctx.fillRect(1 * s, 0, 8 * s, 10 * s);
  ctx.fillStyle = '#6b4c2b';
  ctx.fillRect(2 * s, 1 * s, 6 * s, 8 * s);
  ctx.fillStyle = '#6b4c2b';
  ctx.fillRect(0, 10 * s, 10 * s, 4 * s);
  ctx.fillStyle = '#4a2f1a';
  ctx.fillRect(1 * s, 14 * s, 2 * s, 4 * s);
  ctx.fillRect(7 * s, 14 * s, 2 * s, 4 * s);
  ctx.restore();
}

function drawBanner(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, color: string, trim: string) {
  ctx.save(); ctx.translate(x, y);
  ctx.fillStyle = '#b08830';
  ctx.fillRect(-2, 0, w + 4, 2);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(0, 2); ctx.lineTo(w, 2); ctx.lineTo(w, h - 4);
  ctx.lineTo(w / 2, h); ctx.lineTo(0, h - 4); ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = trim; ctx.lineWidth = 1.5; ctx.stroke();
  ctx.fillStyle = trim;
  ctx.fillRect(w / 2 - 1, h / 2 - 4, 2, 8);
  ctx.fillRect(w / 2 - 3, h / 2 - 1, 6, 2);
  ctx.restore();
}

function drawPotions(ctx: CanvasRenderingContext2D, x: number, y: number, s: number) {
  const cols = ['#cc3333', '#3366cc', '#33aa55', '#cc8833'];
  for (let i = 0; i < cols.length; i++) {
    const px = x + i * 5 * s;
    ctx.fillStyle = cols[i];
    ctx.fillRect(px, y + 2 * s, 3 * s, 5 * s);
    ctx.fillRect(px + 0.5 * s, y, 2 * s, 3 * s);
    ctx.fillStyle = '#8a6040';
    ctx.fillRect(px + 0.5 * s, y - 1 * s, 2 * s, 1.5 * s);
    ctx.fillStyle = 'rgba(255,255,255,0.3)';
    ctx.fillRect(px + 0.5 * s, y + 2.5 * s, 1 * s, 3 * s);
  }
}

function drawStarWindow(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, f: number) {
  ctx.save(); ctx.translate(x, y);
  ctx.fillStyle = '#4a4a58';
  ctx.fillRect(0, 0, 18 * s, 14 * s);
  ctx.fillStyle = '#0a0a20';
  ctx.fillRect(1 * s, 1 * s, 16 * s, 12 * s);
  for (let i = 0; i < 8; i++) {
    const sx = 2 * s + seededRand(i * 17) * 14 * s;
    const sy = 2 * s + seededRand(i * 31) * 10 * s;
    const tw = Math.sin(f * 0.08 + i * 2) * 0.4 + 0.6;
    ctx.fillStyle = `rgba(255,255,255,${tw.toFixed(2)})`;
    ctx.fillRect(sx, sy, 1 * s, 1 * s);
  }
  ctx.fillStyle = '#e0e0f0';
  ctx.beginPath(); ctx.arc(13 * s, 4 * s, 2 * s, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#4a4a58';
  ctx.fillRect(8 * s, 1 * s, 1.5 * s, 12 * s);
  ctx.fillRect(1 * s, 6 * s, 16 * s, 1.5 * s);
  ctx.restore();
}

function drawTelescope(ctx: CanvasRenderingContext2D, x: number, y: number, s: number) {
  ctx.save(); ctx.translate(x, y);
  ctx.strokeStyle = '#5a3f21'; ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(8 * s, 6 * s); ctx.lineTo(2 * s, 18 * s);
  ctx.moveTo(8 * s, 6 * s); ctx.lineTo(14 * s, 18 * s);
  ctx.moveTo(8 * s, 6 * s); ctx.lineTo(8 * s, 20 * s);
  ctx.stroke();
  ctx.fillStyle = '#b08830';
  ctx.save(); ctx.translate(8 * s, 6 * s); ctx.rotate(-0.5);
  ctx.fillRect(-1.5 * s, -10 * s, 3 * s, 12 * s);
  ctx.fillStyle = '#d4a840';
  ctx.fillRect(-2 * s, -10 * s, 4 * s, 2 * s);
  ctx.restore();
  ctx.restore();
}

function drawScales(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, f: number) {
  ctx.save(); ctx.translate(x, y);
  ctx.fillStyle = '#b08830';
  ctx.fillRect(9 * s, 4 * s, 2 * s, 14 * s);
  ctx.fillStyle = '#8a6820';
  ctx.fillRect(4 * s, 16 * s, 12 * s, 3 * s);
  const tilt = Math.sin(f * 0.03) * 0.08;
  ctx.save(); ctx.translate(10 * s, 4 * s); ctx.rotate(tilt);
  ctx.fillStyle = '#c4992a';
  ctx.fillRect(-10 * s, -1 * s, 20 * s, 2 * s);
  ctx.strokeStyle = '#8a6820'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(-8 * s, 0); ctx.lineTo(-8 * s, 6 * s); ctx.stroke();
  ctx.fillStyle = '#c4992a';
  ctx.beginPath(); ctx.ellipse(-8 * s, 7 * s, 4 * s, 1.5 * s, 0, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.moveTo(8 * s, 0); ctx.lineTo(8 * s, 6 * s); ctx.stroke();
  ctx.beginPath(); ctx.ellipse(8 * s, 7 * s, 4 * s, 1.5 * s, 0, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
  ctx.restore();
}

// ─── Room Furniture Compositions ───────────────────────────────────

function drawRoomFurniture(
  ctx: CanvasRenderingContext2D, type: CharacterType,
  x: number, y: number, w: number, h: number, f: number,
) {
  const s = Math.min(w / 140, h / 100);
  const wh = h * 0.38;

  switch (type) {
    case 'king':
      drawThrone(ctx, x + w * 0.42, y + wh - 2, s);
      drawTable(ctx, x + w * 0.12, y + h * 0.55, w * 0.35, s);
      drawBanner(ctx, x + w * 0.06, y + 4, 12 * s, 24 * s, '#8B0020', '#f0c040');
      drawBanner(ctx, x + w * 0.84, y + 4, 12 * s, 24 * s, '#8B0020', '#f0c040');
      drawChair(ctx, x + w * 0.18, y + h * 0.72, s);
      drawChair(ctx, x + w * 0.36, y + h * 0.72, s);
      break;
    case 'nobility':
      drawTable(ctx, x + w * 0.22, y + h * 0.45, w * 0.5, s);
      drawBookshelf(ctx, x + w * 0.02, y + wh + 2, s);
      drawChair(ctx, x + w * 0.28, y + h * 0.66, s);
      drawChair(ctx, x + w * 0.48, y + h * 0.66, s);
      drawChair(ctx, x + w * 0.64, y + h * 0.66, s);
      drawBanner(ctx, x + w * 0.88, y + 4, 10 * s, 20 * s, '#6a2a8a', '#f0c040');
      break;
    case 'knight':
      drawTable(ctx, x + w * 0.05, y + h * 0.45, w * 0.4, s);
      drawBookshelf(ctx, x + w * 0.02, y + wh + 2, s);
      ctx.fillStyle = '#4a2f1a';
      ctx.fillRect(x + w * 0.75, y + wh + 4, 16 * s, 24 * s);
      ctx.fillStyle = '#5a3f21';
      ctx.fillRect(x + w * 0.75 + 1 * s, y + wh + 5, 14 * s, 22 * s);
      ctx.strokeStyle = '#a0a0b0'; ctx.lineWidth = 2;
      for (let i = 0; i < 3; i++) {
        const sx = x + w * 0.75 + 4 * s + i * 5 * s;
        ctx.beginPath();
        ctx.moveTo(sx, y + wh + 8); ctx.lineTo(sx, y + wh + 24); ctx.stroke();
        ctx.fillStyle = '#6a5530';
        ctx.fillRect(sx - 2 * s, y + wh + 7, 4 * s, 2 * s);
      }
      drawChair(ctx, x + w * 0.15, y + h * 0.72, s);
      drawChair(ctx, x + w * 0.32, y + h * 0.72, s);
      break;
    case 'squire':
      drawTable(ctx, x + w * 0.08, y + h * 0.45, w * 0.45, s);
      drawChair(ctx, x + w * 0.18, y + h * 0.66, s);
      drawBookshelf(ctx, x + w * 0.7, y + wh + 2, s);
      ctx.fillStyle = '#4a2f1a';
      ctx.fillRect(x + w * 0.58, y + wh + 4, 10 * s, 18 * s);
      ctx.strokeStyle = '#8a8a98'; ctx.lineWidth = 1.5;
      for (let i = 0; i < 3; i++) {
        ctx.beginPath();
        ctx.moveTo(x + w * 0.58 + 2 * s + i * 3 * s, y + wh + 8);
        ctx.lineTo(x + w * 0.58 + 2 * s + i * 3 * s, y + wh + 18);
        ctx.stroke();
      }
      break;
    case 'healer':
      drawHealCircle(ctx, x + w * 0.5, y + h * 0.65, s, f);
      drawPotions(ctx, x + w * 0.06, y + wh + 6, s);
      drawBookshelf(ctx, x + w * 0.72, y + wh + 2, s);
      drawTable(ctx, x + w * 0.12, y + h * 0.42, w * 0.3, s);
      drawChair(ctx, x + w * 0.2, y + h * 0.6, s);
      break;
    case 'sentinel':
      drawStarWindow(ctx, x + w * 0.35, y + 4, s, f);
      drawTelescope(ctx, x + w * 0.6, y + h * 0.4, s);
      drawTable(ctx, x + w * 0.06, y + h * 0.5, w * 0.3, s);
      drawChair(ctx, x + w * 0.14, y + h * 0.72, s);
      ctx.fillStyle = '#3a2510';
      ctx.fillRect(x + w * 0.78, y + wh + 4, 14 * s, 10 * s);
      ctx.fillStyle = '#d8c8a0';
      ctx.fillRect(x + w * 0.78 + 1 * s, y + wh + 5, 12 * s, 8 * s);
      ctx.fillStyle = '#c03030';
      for (let i = 0; i < 4; i++) {
        ctx.beginPath();
        ctx.arc(x + w * 0.78 + 3 * s + i * 3 * s, y + wh + 9 + (i % 2) * 2 * s, 1 * s, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    case 'blacksmith':
      drawForge(ctx, x + w * 0.55, y + wh - 2, s, f);
      drawAnvil(ctx, x + w * 0.28, y + h * 0.55, s);
      ctx.fillStyle = '#5a3f21';
      ctx.fillRect(x + w * 0.08, y + h * 0.5, 10 * s, 14 * s);
      ctx.fillStyle = '#6b4c2b';
      ctx.fillRect(x + w * 0.08 + 1 * s, y + h * 0.5 + 1 * s, 8 * s, 12 * s);
      ctx.fillStyle = '#8a6820';
      ctx.fillRect(x + w * 0.08, y + h * 0.5 + 3 * s, 10 * s, 1.5 * s);
      ctx.fillRect(x + w * 0.08, y + h * 0.5 + 9 * s, 10 * s, 1.5 * s);
      break;
    case 'scribe':
      drawBookshelf(ctx, x + w * 0.02, y + wh + 2, s);
      drawBookshelf(ctx, x + w * 0.72, y + wh + 2, s);
      drawTable(ctx, x + w * 0.26, y + h * 0.45, w * 0.4, s);
      drawChair(ctx, x + w * 0.34, y + h * 0.66, s);
      drawChair(ctx, x + w * 0.5, y + h * 0.66, s);
      ctx.fillStyle = '#5a3f21';
      ctx.fillRect(x + w * 0.06, y + h * 0.66, 14 * s, 8 * s);
      ctx.fillStyle = '#f5e6ca';
      ctx.fillRect(x + w * 0.06 + 2 * s, y + h * 0.66 + 1 * s, 10 * s, 5 * s);
      break;
    case 'judge':
      drawScales(ctx, x + w * 0.45, y + wh + 2, s, f);
      drawTable(ctx, x + w * 0.18, y + h * 0.5, w * 0.55, s);
      drawChair(ctx, x + w * 0.34, y + h * 0.7, s);
      drawBookshelf(ctx, x + w * 0.02, y + wh + 2, s);
      ctx.fillStyle = '#5a3f21';
      ctx.fillRect(x + w * 0.55, y + h * 0.52, 5 * s, 2 * s);
      ctx.fillStyle = '#3a2510';
      ctx.fillRect(x + w * 0.56, y + h * 0.52 - 1 * s, 1.5 * s, 4 * s);
      drawBanner(ctx, x + w * 0.86, y + 4, 10 * s, 20 * s, '#1a1a30', '#c0392b');
      break;
  }
}

// ─── Room Lighting ─────────────────────────────────────────────────

function drawLighting(ctx: CanvasRenderingContext2D, type: CharacterType, x: number, y: number, w: number, h: number) {
  const corners = [
    { cx: x, cy: y }, { cx: x + w, cy: y },
    { cx: x, cy: y + h }, { cx: x + w, cy: y + h },
  ];
  for (const c of corners) {
    const g = ctx.createRadialGradient(c.cx, c.cy, 0, c.cx, c.cy, w * 0.3);
    g.addColorStop(0, 'rgba(0,0,0,0.3)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x, y, w, h);
  }
  const glowMap: Partial<Record<CharacterType, { cx: number; cy: number; color: string }>> = {
    king:       { cx: 0.5, cy: 0.3, color: '240,192,64' },
    healer:     { cx: 0.5, cy: 0.65, color: '50,200,120' },
    blacksmith: { cx: 0.65, cy: 0.45, color: '255,120,30' },
  };
  const gl = glowMap[type];
  if (gl) {
    const g = ctx.createRadialGradient(x + w * gl.cx, y + h * gl.cy, 0, x + w * gl.cx, y + h * gl.cy, w * 0.4);
    g.addColorStop(0, `rgba(${gl.color},0.1)`);
    g.addColorStop(1, `rgba(${gl.color},0)`);
    ctx.fillStyle = g;
    ctx.fillRect(x, y, w, h);
  }
}

// ─── Wall Rendering ────────────────────────────────────────────────

function drawTiledWall(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, type: CharacterType) {
  const wc: Record<CharacterType, [string, string, string]> = {
    king:       ['#3e3650', '#484060', '#353048'],
    nobility:   ['#3a3850', '#44405a', '#323048'],
    knight:     ['#384050', '#404858', '#303848'],
    squire:     ['#384038', '#404840', '#303830'],
    healer:     ['#303850', '#384058', '#282e48'],
    sentinel:   ['#303848', '#3a4050', '#282e40'],
    scribe:     ['#3a3430', '#443c38', '#322c28'],
    judge:      ['#383040', '#403848', '#302838'],
    blacksmith: ['#383028', '#403830', '#302820'],
  };
  const [base, light, dark] = wc[type];
  ctx.fillStyle = base;
  ctx.fillRect(x, y, w, h);

  const bW = 18, bH = 9;
  const seed = Math.round(x * 7 + y * 13);

  for (let row = 0; row < Math.ceil(h / bH); row++) {
    const offX = (row % 2) * (bW / 2);
    for (let col = -1; col < Math.ceil(w / bW) + 1; col++) {
      const bx = x + col * bW + offX;
      const by = y + row * bH;
      if (bx + bW < x || bx > x + w) continue;
      const hash = ((bx * 31 + by * 17 + seed) & 0xFF) / 255;
      const bc = hash > 0.6 ? light : hash > 0.3 ? base : dark;
      ctx.fillStyle = bc;
      ctx.fillRect(bx + 1, by + 1, bW - 2, bH - 2);
      ctx.fillStyle = '#222228';
      ctx.fillRect(bx, by, bW, 1.5);
      ctx.fillRect(bx, by, 1.5, bH);
      ctx.fillStyle = lightenColor(bc, 0.12);
      ctx.fillRect(bx + 2, by + 2, bW - 4, 1);
      ctx.fillRect(bx + 2, by + 2, 1, bH - 4);
      ctx.fillStyle = shadeColor(bc, -12);
      ctx.fillRect(bx + 2, by + bH - 3, bW - 4, 1);
      ctx.fillRect(bx + bW - 3, by + 2, 1, bH - 4);
      if (hash > 0.82) {
        ctx.fillStyle = 'rgba(40,80,30,0.22)';
        ctx.fillRect(bx + 4, by + 3, 5, 3);
      }
    }
  }
  ctx.fillStyle = 'rgba(255,255,255,0.04)';
  ctx.fillRect(x, y, w, 2);
}

// ─── Floor Rendering ───────────────────────────────────────────────

function drawTiledFloor(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, type: CharacterType) {
  const fc: Record<CharacterType, [string, string, string]> = {
    king:       ['#4a3520', '#3e2a18', '#54402a'],
    nobility:   ['#3e3020', '#342818', '#48382a'],
    knight:     ['#3a3030', '#302828', '#443838'],
    squire:     ['#3a3820', '#302e18', '#444228'],
    healer:     ['#303540', '#282e38', '#383e48'],
    sentinel:   ['#2a2e34', '#22262c', '#32363c'],
    scribe:     ['#4a3520', '#3e2a18', '#54402a'],
    judge:      ['#383038', '#302830', '#403840'],
    blacksmith: ['#2e2820', '#261e18', '#383028'],
  };
  const [base, dark, _light] = fc[type];
  ctx.fillStyle = base;
  ctx.fillRect(x, y, w, h);

  const ts = 16;
  const seed = Math.round(x * 3 + y * 7);

  for (let row = 0; row < Math.ceil(h / ts); row++) {
    for (let col = 0; col < Math.ceil(w / ts); col++) {
      const tx = x + col * ts, ty = y + row * ts;
      const hash = seededRand(col * 31 + row * 17 + seed);
      const alt = (col + row) % 2 === 0;
      ctx.fillStyle = alt ? base : dark;
      ctx.fillRect(tx, ty, ts, ts);

      if (['king', 'nobility', 'scribe', 'squire'].includes(type)) {
        ctx.fillStyle = 'rgba(0,0,0,0.05)';
        for (let g = 3; g < ts; g += 4) ctx.fillRect(tx + 1, ty + g, ts - 2, 1);
      }
      if (['knight', 'sentinel', 'judge'].includes(type) && hash > 0.85) {
        ctx.strokeStyle = 'rgba(0,0,0,0.12)';
        ctx.lineWidth = 0.5;
        ctx.beginPath();
        ctx.moveTo(tx + 3, ty + hash * ts);
        ctx.lineTo(tx + ts - 3, ty + (1 - hash) * ts);
        ctx.stroke();
      }
      ctx.fillStyle = lightenColor(alt ? base : dark, 0.06);
      ctx.fillRect(tx, ty, ts, 1);
      ctx.fillRect(tx, ty, 1, ts);
      ctx.fillStyle = 'rgba(0,0,0,0.08)';
      ctx.fillRect(tx + ts - 1, ty, 1, ts);
      ctx.fillRect(tx, ty + ts - 1, ts, 1);
    }
  }
}

// ─── Main Room Drawing ─────────────────────────────────────────────

export function drawRoom(
  ctx: CanvasRenderingContext2D,
  type: CharacterType,
  x: number, y: number, w: number, h: number,
  frame: number,
) {
  const bg: Record<CharacterType, string> = {
    king: '#1e0e1a', nobility: '#141828', knight: '#141820',
    squire: '#141814', healer: '#101828', sentinel: '#0e1218',
    scribe: '#1a1408', judge: '#14101a', blacksmith: '#181008',
  };
  ctx.fillStyle = bg[type];
  ctx.fillRect(x, y, w, h);

  const wh = h * 0.36;
  drawTiledWall(ctx, x, y, w, wh, type);
  drawTiledFloor(ctx, x, y + wh, w, h - wh, type);

  // Wall-floor shadow
  const gs = ctx.createLinearGradient(x, y + wh, x, y + wh + 10);
  gs.addColorStop(0, 'rgba(0,0,0,0.4)');
  gs.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = gs;
  ctx.fillRect(x, y + wh, w, 10);

  // Torches
  const ts = Math.min(w / 140, h / 100);
  drawTorch(ctx, x + w * 0.12, y + wh * 0.3, ts, frame);
  drawTorch(ctx, x + w * 0.88, y + wh * 0.3, ts, frame);

  drawRoomFurniture(ctx, type, x, y, w, h, frame);
  drawLighting(ctx, type, x, y, w, h);

  const rid = `${type}-${Math.round(x)}`;
  spawnRoomParticles(type, rid, x, y, w, h, frame);
  tickParticles(ctx, `p-${rid}`);
}

// ─── Workstation Positions ─────────────────────────────────────────

export function getWorkstationPosition(roomType: string): { x: number; y: number } {
  const pos: Record<string, { x: number; y: number }> = {
    king:       { x: 0.35, y: 0.6 },
    nobility:   { x: 0.45, y: 0.55 },
    knight:     { x: 0.25, y: 0.55 },
    squire:     { x: 0.3, y: 0.55 },
    healer:     { x: 0.35, y: 0.52 },
    sentinel:   { x: 0.25, y: 0.6 },
    scribe:     { x: 0.45, y: 0.55 },
    judge:      { x: 0.4, y: 0.6 },
    blacksmith: { x: 0.35, y: 0.6 },
  };
  return pos[roomType] ?? { x: 0.5, y: 0.5 };
}

// ─── Tooltip ───────────────────────────────────────────────────────

export function drawTooltip(
  ctx: CanvasRenderingContext2D,
  x: number, y: number,
  name: string, role: string, status: string, task: string | null,
) {
  const pad = 8, lh = 15;
  const lines = [`Name: ${name}`, `Role: ${role}`, `Status: ${status}`];
  if (task) lines.push(`Task: ${task}`);
  ctx.font = '13px serif';
  let tw = 0;
  for (const l of lines) { const m = ctx.measureText(l).width; if (m > tw) tw = m; }
  tw = Math.min(tw, 220);
  const bw = tw + pad * 2, bh = lines.length * lh + pad * 2;
  let bx = x + 12, by = y - bh - 12;
  if (bx + bw > ctx.canvas.width) bx = x - bw - 12;
  if (by < 0) by = y + 12;
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.4)'; ctx.shadowBlur = 6;
  ctx.fillStyle = '#f2e4b8'; ctx.strokeStyle = '#a67c00'; ctx.lineWidth = 2;
  roundRect(ctx, bx, by, bw, bh, 6); ctx.fill();
  ctx.shadowBlur = 0; ctx.stroke();
  ctx.restore();
  ctx.fillStyle = '#4a2a00'; ctx.font = '13px serif'; ctx.textBaseline = 'top';
  for (let i = 0; i < lines.length; i++)
    ctx.fillText(lines[i], bx + pad, by + pad + i * lh);
}

// ─── Sound Indicator ───────────────────────────────────────────────

export function drawSoundIndicator(
  ctx: CanvasRenderingContext2D,
  x: number, y: number,
  type: 'music' | 'hammer' | 'quill',
  frame: number,
) {
  ctx.save(); ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.lineWidth = 2;
  if (type === 'music') {
    for (let i = 0; i < 3; i++) {
      const ph = (frame * 0.1 + i * 2) % (Math.PI * 2);
      const ox = Math.sin(ph * 1.5) * 6, oy = -Math.abs(Math.sin(ph)) * 12 - i * 8;
      const a = 0.6 + 0.4 * Math.sin(ph);
      ctx.strokeStyle = `rgba(50,50,120,${a.toFixed(2)})`;
      ctx.fillStyle = `rgba(100,100,200,${a.toFixed(2)})`;
      ctx.beginPath(); ctx.moveTo(x + ox, y + oy); ctx.lineTo(x + ox, y + oy - 10); ctx.stroke();
      ctx.beginPath(); ctx.ellipse(x + ox + 3, y + oy - 5, 3, 5, Math.PI / 4, 0, Math.PI * 2); ctx.fill();
    }
  } else if (type === 'hammer') {
    for (let i = 0; i < 5; i++) {
      const ang = (i / 5) * Math.PI * 2 + frame * 0.15;
      const len = 8 + 3 * Math.sin(frame * 0.3 + i);
      const a = 0.5 + 0.5 * Math.cos(frame * 0.2 + i);
      ctx.strokeStyle = `rgba(200,100,50,${a.toFixed(2)})`;
      ctx.beginPath();
      ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(ang) * len, y + Math.sin(ang) * len); ctx.stroke();
    }
  } else if (type === 'quill') {
    const fl = Math.sin(frame * 0.3) * 2;
    ctx.strokeStyle = 'rgba(80,80,80,0.6)';
    for (let i = 0; i < 3; i++) {
      const ox = i * 4 - 4, oy = fl * (i % 2 === 0 ? 1 : -1);
      ctx.beginPath(); ctx.moveTo(x + ox, y + oy); ctx.lineTo(x + ox + 3, y + oy - 5); ctx.stroke();
    }
  }
  ctx.restore();
}

// ─── Wall Decoration ───────────────────────────────────────────────

export function drawWallDecoration(
  ctx: CanvasRenderingContext2D,
  type: 'banner' | 'shield' | 'weaponDisplay' | 'painting' | 'sconce',
  x: number, y: number, scale: number, frame: number,
) {
  if (type === 'banner') drawBanner(ctx, x, y, 14 * scale, 28 * scale, '#8B2020', '#f0c040');
  else if (type === 'sconce') drawTorch(ctx, x, y, scale, frame);
}

// ─── Castle Overview ───────────────────────────────────────────────

export function drawCastleOverview(ctx: CanvasRenderingContext2D, rooms: Room[], scale: number) {
  const cols: Record<CharacterType, string> = {
    king: '#8b2020', nobility: '#5a2a8a', knight: '#2a5a8a',
    squire: '#2a6a2a', healer: '#2a8a5a', sentinel: '#6a4a2a',
    scribe: '#4a4a7a', judge: '#7a3a3a', blacksmith: '#4a4a4a',
  };
  for (const r of rooms) {
    ctx.fillStyle = cols[r.type] || '#444';
    ctx.fillRect(r.x * scale, r.y * scale, r.w * scale, r.h * scale);
    ctx.strokeStyle = '#666'; ctx.lineWidth = 1;
    ctx.strokeRect(r.x * scale, r.y * scale, r.w * scale, r.h * scale);
  }
}

// ─── Furniture (legacy API) ────────────────────────────────────────

export function drawFurniture(ctx: CanvasRenderingContext2D, roomType: string, x: number, y: number, scale: number) {
  switch (roomType) {
    case 'throneRoom': drawThrone(ctx, x, y, scale); break;
    case 'armory': drawAnvil(ctx, x, y, scale); break;
    default: drawTable(ctx, x, y, 40, scale); break;
  }
}

// ─── Interaction ───────────────────────────────────────────────────

export function getInteractionPose(type: CharacterType, _furniture: string): { offsetX: number; offsetY: number; facing: string } | null {
  switch (type) {
    case 'king': return { offsetX: 0, offsetY: -4, facing: 'down' };
    case 'scribe': return { offsetX: 2, offsetY: -2, facing: 'down' };
    case 'blacksmith': return { offsetX: -2, offsetY: 0, facing: 'right' };
    default: return { offsetX: 0, offsetY: 0, facing: 'down' };
  }
}

export function drawInteractionIndicator(ctx: CanvasRenderingContext2D, x: number, y: number, s: number) {
  ctx.fillStyle = 'rgba(240,192,64,0.5)';
  ctx.beginPath(); ctx.arc(x, y, 3 * s, 0, Math.PI * 2); ctx.fill();
}

export function getNearbyFurniture(): string { return 'planningTable'; }

export function drawCharacterWithInteraction(
  ctx: CanvasRenderingContext2D,
  type: CharacterType, state: AnimState,
  x: number, y: number, s: number, frame: number,
  agentId?: string, currentJob?: string | null,
) {
  drawCharacter(ctx, type, state, x, y, s, frame, agentId, currentJob);
}

// ─── Room Transitions ──────────────────────────────────────────────

const trans = {
  active: false,
  fromType: null as CharacterType | null,
  toType: null as CharacterType | null,
  progress: 0, duration: 30,
  effect: 'fade' as 'fade' | 'slide',
  direction: 'left' as 'left' | 'right' | 'up' | 'down',
  ease: (t: number) => t * t * (3 - 2 * t),
};

export function transitionToRoom(
  from: CharacterType, to: CharacterType,
  effect: 'fade' | 'slide' = 'fade', duration = 30,
  dir: 'left' | 'right' | 'up' | 'down' = 'left',
) {
  if (trans.active) return;
  Object.assign(trans, { active: true, fromType: from, toType: to, progress: 0, duration, effect, direction: dir });
}

export function updateTransition(): boolean {
  if (!trans.active) return false;
  trans.progress += 1 / trans.duration;
  if (trans.progress >= 1) { trans.progress = 1; trans.active = false; return false; }
  return true;
}

export function renderRoomTransition(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, frame: number) {
  if (!trans.active || !trans.fromType || !trans.toType) return;
  const t = trans.ease(trans.progress);
  if (trans.effect === 'fade') {
    ctx.save(); ctx.globalAlpha = 1 - t;
    drawRoom(ctx, trans.fromType, x, y, w, h, frame); ctx.restore();
    ctx.save(); ctx.globalAlpha = t;
    drawRoom(ctx, trans.toType, x, y, w, h, frame); ctx.restore();
  } else {
    let ox = 0, oy = 0;
    if (trans.direction === 'left') ox = -t * w;
    else if (trans.direction === 'right') ox = t * w;
    else if (trans.direction === 'up') oy = -t * h;
    else if (trans.direction === 'down') oy = t * h;
    ctx.save(); ctx.translate(ox, oy);
    drawRoom(ctx, trans.fromType, x, y, w, h, frame); ctx.restore();
    ctx.save();
    ctx.translate(
      ox + (trans.direction === 'left' ? w : trans.direction === 'right' ? -w : 0),
      oy + (trans.direction === 'up' ? h : trans.direction === 'down' ? -h : 0),
    );
    drawRoom(ctx, trans.toType, x, y, w, h, frame); ctx.restore();
  }
}

// ─── Minimap ───────────────────────────────────────────────────────

export function drawMinimap(
  ctx: CanvasRenderingContext2D,
  rooms: Room[],
  characters: { id: string; type: CharacterType; x: number; y: number; roomId: string }[],
  currentRoomId: string | null,
  px: number, py: number, pw: number, ph: number,
) {
  if (rooms.length === 0) return;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const r of rooms) {
    if (r.x < minX) minX = r.x; if (r.y < minY) minY = r.y;
    if (r.x + r.w > maxX) maxX = r.x + r.w; if (r.y + r.h > maxY) maxY = r.y + r.h;
  }
  const lw = maxX - minX, lh = maxY - minY;
  if (lw <= 0 || lh <= 0) return;
  const m = 4;
  const sc = Math.min((pw - m * 2) / lw, (ph - m * 2) / lh);
  ctx.save();
  ctx.fillStyle = 'rgba(20,20,20,0.85)';
  ctx.fillRect(px, py, pw, ph);
  ctx.strokeStyle = '#666'; ctx.lineWidth = 1;
  ctx.strokeRect(px, py, pw, ph);
  const rc: Record<CharacterType, string> = {
    king: '#cc4444', nobility: '#7755cc', knight: '#336699', squire: '#228833',
    healer: '#2e8b57', sentinel: '#8b4513', scribe: '#5555aa', judge: '#aa4444', blacksmith: '#666666',
  };
  for (const r of rooms) {
    const rx = px + m + (r.x - minX) * sc, ry = py + m + (r.y - minY) * sc;
    const rw = r.w * sc, rh = r.h * sc;
    ctx.fillStyle = rc[r.type] || '#555';
    ctx.fillRect(rx, ry, rw, rh);
    if (currentRoomId === r.id) {
      ctx.strokeStyle = '#ffff00'; ctx.lineWidth = 2;
      ctx.strokeRect(rx - 1, ry - 1, rw + 2, rh + 2);
    } else {
      ctx.strokeStyle = '#333'; ctx.lineWidth = 1;
      ctx.strokeRect(rx, ry, rw, rh);
    }
  }
  const cc: Record<CharacterType, string> = {
    king: '#ffcc00', nobility: '#aa88ff', knight: '#6699cc', squire: '#44aa44',
    healer: '#55cc88', sentinel: '#cc8855', scribe: '#8888cc', judge: '#cc6666', blacksmith: '#999999',
  };
  for (const ch of characters) {
    const r = rooms.find(rm => rm.id === ch.roomId);
    if (!r) continue;
    const cx = px + m + (r.x - minX) * sc + (ch.x - r.x) * sc;
    const cy = py + m + (r.y - minY) * sc + (ch.y - r.y) * sc;
    ctx.fillStyle = cc[ch.type] || '#ccc';
    ctx.beginPath(); ctx.ellipse(cx, cy, 2, 2, 0, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
}

// ─── Day/Night Cycle ───────────────────────────────────────────────

export function getTimeOfDay(): number {
  const now = new Date();
  return ((now.getHours() + now.getMinutes() / 60) % 24) / 24;
}

export function applyTimeTheme(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement) {
  const t = getTimeOfDay();
  const brightness = Math.cos(t * 2 * Math.PI) * 0.5 + 0.5;
  const nightAlpha = 0.5 * (1 - brightness);
  ctx.save();
  ctx.fillStyle = `rgba(0,0,30,${nightAlpha.toFixed(3)})`;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = `rgba(255,140,60,${(nightAlpha * 0.25).toFixed(3)})`;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.restore();
}
