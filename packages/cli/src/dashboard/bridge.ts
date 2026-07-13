import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { DashboardSnapshot } from './snapshot.js';

// ---- Path resolution ----------------------------------------------------
// At runtime this module is at  <repo>/packages/cli/dist/dashboard/bridge.js
// Walking 4 levels up reaches the repo root.
const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..', '..', '..', '..');

// ---- Engine loader ------------------------------------------------------

let _core: any = null;

async function loadCore() {
  if (_core) return _core;
  const corePath = join(PROJECT_ROOT, 'packages', 'cli', 'src', 'dashboard', 'core.mjs');
  _core = await import(pathToFileURL(corePath).href);
  // Override the frame directory so portrait loading works from the CLI's location
  const frameDir = join(PROJECT_ROOT, 'assets', 'terminal-portraits', 'frames');
  if (_core.setFrameDir) _core.setFrameDir(frameDir);
  return _core;
}

// ---- Dashboard renderer loader ------------------------------------------
// There is a single dashboard layout — Throne Hall, XL braille. The themed
// color variants and smaller breakpoints were removed; this loads the one
// renderer the CLI ships.

let _renderer: ((ctx: any) => string) | null = null;

export async function getDashboardRenderer(): Promise<(ctx: any) => string> {
  if (_renderer) return _renderer;

  const mod = await import(
    pathToFileURL(
      join(PROJECT_ROOT, 'packages', 'cli', 'src', 'dashboard', 'v3-throne-hall.mjs')
    ).href
  );
  const fn = mod.renderThroneHall as (ctx: any) => string;
  if (!fn) throw new Error('Dashboard renderer missing export renderThroneHall');

  _renderer = fn;
  return fn;
}

// ---- Context builder ----------------------------------------------------

export interface DashboardContext {
  A: any;
  color: boolean;
  width: number;
  /** Terminal rows available; 0 means unconstrained (variants use design heights). */
  height: number;
  frame: number;
  selected?: number;
  snap: DashboardSnapshot;
  TIERS: Record<string, any>;
  TIER_ORDER: string[];
}

export async function buildContext(
  snapshot: DashboardSnapshot,
  opts: { color?: boolean; width?: number; height?: number; frame?: number; selected?: number }
): Promise<DashboardContext> {
  const core = await loadCore();
  return {
    A: core.makeAnsi(opts.color !== false),
    color: opts.color !== false,
    width: opts.width ?? (process.stdout.columns || 120),
    height: opts.height ?? 0,
    frame: opts.frame ?? 0,
    selected: opts.selected,
    snap: snapshot,
    TIERS: core.TIERS,
    TIER_ORDER: core.TIER_ORDER,
  };
}
