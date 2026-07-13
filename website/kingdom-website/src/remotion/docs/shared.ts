import { Easing, interpolate, spring } from "remotion";

// ── Design canvas for every doc animation ──────────────────────
export const DOC_W = 1000;
export const DOC_H = 660;

// Premium, calm easing (matveyan-style) — used for non-spring tweens.
export const EASE = Easing.bezier(0.16, 1, 0.3, 1);

// Palette — shared with the page theme (dark terminal, minimal black &
// white; one restrained dim-green accent for "ok" states; tier identity
// expressed through brightness, not hue).
export const C = {
  ink: "#E6E6E6",
  inkSoft: "#9A9A9A",
  inkFaint: "#555555",
  hair: "rgba(255,255,255,0.10)",
  card: "#111111",
  panel: "#0A0A0A",
  accent: "#FFFFFF",
  accentSoft: "rgba(255,255,255,0.10)",
  sage: "#4ADE80", // "ok" accent — dim terminal green
  sageSoft: "rgba(74,222,128,0.12)",
  green: "#4ADE80",
  pending: "#9A9A9A",
  pendingSoft: "rgba(255,255,255,0.08)",
  king: "#FFFFFF",
  noble: "#B4B4B4",
  knight: "#787878",
} as const;

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

// Spring entrance (0→1), gently damped, frame-driven.
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

// Fade + rise entrance → inline style object.
export function fadeUp(
  frame: number,
  start: number,
  fps: number,
  dist = 14,
): { opacity: number; transform: string } {
  const p = springIn(frame, start, fps);
  return {
    opacity: clamp01(p),
    transform: `translateY(${(1 - p) * dist}px)`,
  };
}

// Linear-eased 0→1 progress over a window (for line draws / bars).
export function progress(
  frame: number,
  start: number,
  durFrames: number,
): number {
  return interpolate(frame, [start, start + durFrames], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: EASE,
  });
}

// Number counter that eases up to `to` over a window.
export function counter(
  frame: number,
  start: number,
  durFrames: number,
  to: number,
): number {
  return Math.round(progress(frame, start, durFrames) * to);
}
