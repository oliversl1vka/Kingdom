// ──────────────────────────────────────────────────────────────
// Shared primitives for the hero → quickstart "bridge" transitions.
//
// Five bridge compositions (boot / rail / court / scan / index) carry the
// user from the landing terminal into the quickstart. They are all
// frame-driven (no CSS animation, per Remotion best-practices) and read the
// current frame from the scroll-scrubbed <BridgeStage> via the shared
// FrameContext. Everything here stays inside the established dark-terminal
// palette: near-black surfaces, monochrome ink, one restrained dim-green
// accent (#4ADE80), Geist Sans + Geist Mono.
// ──────────────────────────────────────────────────────────────
import { Easing, interpolate, spring } from "remotion";
import { COLORS, MONO, SANS } from "../theme";

export { COLORS, MONO, SANS };

// Premium, calm easing (matveyan-style) — matches the docs animations so the
// whole site shares one motion signature.
export const EASE = Easing.bezier(0.16, 1, 0.3, 1);

// Palette, narrowed to exactly what the bridges use. Single source so a
// variant can never drift off-brand.
export const C = {
  bg: COLORS.bg, // #0A0A0A page
  bgDeep: COLORS.bgDeep, // #050505 deepest well
  surface: COLORS.surface, // #111111 raised card
  card: "#0E0E0E", // terminal body (matches hero variant)
  ink: COLORS.ink, // #E6E6E6 primary
  inkSoft: COLORS.inkSoft, // #9A9A9A secondary
  inkFaint: COLORS.inkFaint, // #555555 hint
  hair: "rgba(255,255,255,0.10)", // 1px hairline on dark
  hairSoft: "rgba(255,255,255,0.06)",
  accent: COLORS.accent, // #FFFFFF emphasis-by-brightness
  sage: COLORS.termOk, // #4ADE80 the one restrained accent
  sageSoft: "rgba(74,222,128,0.13)",
  dotRed: COLORS.dotRed,
  dotAmber: COLORS.dotAmber,
  dotGreen: COLORS.dotGreen,
} as const;

// The five quickstart steps — wording mirrors components/Docs.tsx and the
// real CLI so the transition reads as a true table of contents, not decoration.
export interface Step {
  n: string;
  id: string;
  title: string;
  cmd: string;
  gloss: string;
}

export const STEPS: Step[] = [
  { n: "01", id: "install", title: "Install", cmd: "curl -fsSL … | sh", gloss: "one line, global CLI" },
  { n: "02", id: "setup", title: "Set up a kingdom", cmd: "kingdom setup", gloss: "scaffold the court" },
  { n: "03", id: "decree", title: "Decree an objective", cmd: "kingdom decree", gloss: "state the goal" },
  { n: "04", id: "summon", title: "Summon the court", cmd: "kingdom summon", gloss: "agents go to work" },
  { n: "05", id: "status", title: "Watch progress", cmd: "kingdom status", gloss: "status snapshot" },
];

// ── Tiny math helpers ──────────────────────────────────────────
export const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

/** Spring entrance 0→1, gently damped — the site-wide settle. */
export function springIn(
  frame: number,
  start: number,
  fps: number,
  config?: Partial<{ damping: number; stiffness: number; mass: number }>,
): number {
  return spring({
    frame: frame - start,
    fps,
    config: { damping: 200, stiffness: 120, mass: 0.8, ...config },
  });
}

/** Linear-eased 0→1 over a window — for line draws, wipes, bar fills. */
export function ramp(frame: number, start: number, dur: number): number {
  return interpolate(frame, [start, start + dur], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: EASE,
  });
}

/** Fade + rise → inline style. */
export function fadeUp(
  frame: number,
  start: number,
  fps: number,
  dist = 16,
): { opacity: number; transform: string } {
  const p = springIn(frame, start, fps);
  return { opacity: clamp01(p), transform: `translateY(${(1 - p) * dist}px)` };
}

/** Window of full opacity that fades in then back out (for hand-off labels). */
export function pulseInOut(
  frame: number,
  start: number,
  inDur: number,
  hold: number,
  outDur: number,
): number {
  return interpolate(
    frame,
    [start, start + inDur, start + inDur + hold, start + inDur + hold + outDur],
    [0, 1, 1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: EASE },
  );
}

/** Frame-driven typewriter (string slicing — never per-char opacity). */
export function typed(text: string, framesElapsed: number, cps = 1): string {
  const n = Math.floor(Math.max(0, framesElapsed) * cps);
  return text.slice(0, Math.min(n, text.length));
}

// ── Reusable: a steady (non-blinking when scrubbed) block caret ────────────
export function Caret({
  color = C.accent,
  on = true,
  h = "1.05em",
}: {
  color?: string;
  on?: boolean;
  h?: string;
}) {
  return (
    <span
      style={{
        display: "inline-block",
        width: "0.58ch",
        height: h,
        background: color,
        marginLeft: "0.12ch",
        transform: "translateY(0.16em)",
        opacity: on ? 1 : 0,
      }}
    />
  );
}

// ── Reusable: the chromeless near-black terminal card (hero "soft" look) ────
export function TermCard({
  children,
  style,
  glass = false,
}: {
  children?: React.ReactNode;
  style?: React.CSSProperties;
  glass?: boolean;
}) {
  return (
    <div
      style={{
        position: "relative",
        background: glass ? "rgba(14,14,14,0.66)" : C.card,
        backdropFilter: glass ? "blur(30px) saturate(160%)" : undefined,
        WebkitBackdropFilter: glass ? "blur(30px) saturate(160%)" : undefined,
        border: "1px solid rgba(255,255,255,0.08)",
        borderRadius: 22,
        boxShadow:
          "0 44px 90px -52px rgba(0,0,0,0.85), 0 12px 32px -22px rgba(0,0,0,0.55)",
        ...style,
      }}
    >
      {children}
    </div>
  );
}

// ── Reusable: a full-bleed bridge backdrop (page bg → deepest well) ─────────
// STATIC — painted once, never per-frame. A baked vertical gradient settles
// from the hero page background (top) to the docs' deepest well (bottom) so the
// hand-off is seamless WITHOUT animating a full-viewport repaint every frame
// (which is what was tearing the scroll-scrubbed motion).
export function Backdrop() {
  return (
    <div
      aria-hidden
      style={{
        position: "absolute",
        inset: 0,
        backgroundColor: C.bg,
        backgroundImage:
          "radial-gradient(120% 90% at 50% -10%, rgba(255,255,255,0.03) 0%, transparent 46%), linear-gradient(180deg, #0A0A0A 0%, #0A0A0A 52%, #050505 100%)",
      }}
    />
  );
}
