"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useLenis } from "lenis/react";
import { FrameContext } from "../driver";
import { FPS } from "../theme";

// ──────────────────────────────────────────────────────────────
// BridgeStage — a SCROLL-SCRUBBED stage for the hero → quickstart
// transition. Scrolling is the act of transferring the user from the
// landing terminal into the quickstart, so the user drives the motion.
//
// SMOOTHNESS — the whole ballgame for a scroll-linked animation:
//   1. ONE smoothing layer, not two. The PAGE scroll is eased by Lenis
//      (see SmoothScroll); this stage reads that already-smoothed scroll
//      (`lenis.animatedScroll`) and maps it STRAIGHT to a frame. We do NOT
//      ease the frame a second time — double-smoothing is what made the
//      animation trail the scrollbar and feel floaty. The eased scroll value
//      *is* the animation clock, so the motion is locked to the scroll.
//   2. CONTINUOUS (fractional) frame — never `Math.round`. The composition's
//      ramps/springs are all `interpolate`/`spring`, which are continuous, so
//      a fractional frame yields a continuous, sub-pixel scrub instead of the
//      old 180 discrete steps that read as choppiness. (The typewriter stays
//      naturally per-character — that's correct.)
//   3. NEVER read layout inside the scroll callback. The track's position and
//      size are measured ONCE (and on resize); the hot path reads only the
//      cheap, layout-free scroll number. A tiny epsilon dedupes no-op renders.
//
// prefers-reduced-motion: the track collapses to a single screen and the
// composition is shown at its final, settled frame (no scrubbing).
// ──────────────────────────────────────────────────────────────

// Frame-change threshold — below this, skip the re-render (no visible change).
const EPS = 0.01;

function usePrefersReducedMotion(): boolean {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setReduce(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);
  return reduce;
}

export function BridgeStage({
  durationInFrames,
  trackVh = 220,
  background,
  frameMap,
  children,
}: {
  durationInFrames: number;
  /** Total scroll track height (viewport multiples). More = slower scrub. */
  trackVh?: number;
  background?: string;
  /**
   * Optional scroll→frame transfer. Receives normalized scroll progress
   * p∈[0,1] and the last frame, returns the (fractional) frame. Lets the
   * caller spend different amounts of SCROLL on different parts of the SAME
   * animation (e.g. keep the intro at one pace, halve the outro) without
   * touching the composition. Defaults to a straight linear scrub.
   */
  frameMap?: (p: number, lastFrame: number) => number;
  children: React.ReactNode;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [frame, setFrame] = useState(0);
  const [mounted, setMounted] = useState(false);
  const reduce = usePrefersReducedMotion();
  const lastFrame = durationInFrames - 1;

  // Reduced motion: freeze on the settled frame (derived, no setState-in-effect).
  const shownFrame = reduce ? lastFrame : frame;

  // Track geometry, measured OUTSIDE the hot path (mount + resize only).
  const geo = useRef({ top: 0, travel: 1 });

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => setMounted(true), []);

  const measure = useCallback(() => {
    const track = trackRef.current;
    if (!track) return;
    const rect = track.getBoundingClientRect();
    geo.current.top = rect.top + window.scrollY;
    geo.current.travel = Math.max(1, track.offsetHeight - window.innerHeight);
  }, []);

  // Map an absolute scroll position → fractional frame. Layout-free; the only
  // state write the scrub makes, deduped so a settled scroll costs nothing.
  const update = useCallback(
    (scrollPos: number) => {
      const { top, travel } = geo.current;
      const p = Math.min(1, Math.max(0, (scrollPos - top) / travel));
      const f = frameMap ? frameMap(p, lastFrame) : p * lastFrame;
      setFrame((prev) => (Math.abs(prev - f) < EPS ? prev : f));
    },
    [lastFrame, frameMap],
  );

  // PRIMARY driver: Lenis' smoothed scroll. The callback fires once per Lenis
  // rAF tick while the page is moving (and only then), in sync with paint.
  // This is the SOLE source of frame updates while Lenis is active — see below.
  const lenis = useLenis(
    (l) => {
      if (reduce) return;
      update(l.animatedScroll);
    },
    [reduce, update],
  );

  // Measure on mount/resize and paint the correct initial frame. The native
  // `scroll` listener is attached ONLY as a fallback (reduced motion, or the
  // unlikely case Lenis isn't mounted). When Lenis IS driving we deliberately
  // do NOT also listen to window scroll: two sources writing the frame each
  // tick — `animatedScroll` vs a slightly-different `window.scrollY`, possibly
  // on different ticks — is a sub-pixel jitter source. One clock = smoother.
  useEffect(() => {
    if (!mounted) return;
    measure();
    update(window.scrollY); // initial paint (correct with or without Lenis)
    const onResize = () => {
      measure();
      update(window.scrollY);
    };
    window.addEventListener("resize", onResize, { passive: true });

    const needFallback = reduce || !lenis;
    const onScroll = () => update(window.scrollY);
    if (needFallback)
      window.addEventListener("scroll", onScroll, { passive: true });

    return () => {
      window.removeEventListener("resize", onResize);
      if (needFallback) window.removeEventListener("scroll", onScroll);
    };
  }, [mounted, reduce, measure, update, lenis]);

  return (
    <div
      ref={trackRef}
      data-bridge-stage=""
      style={{
        position: "relative",
        height: reduce ? "100dvh" : `${trackVh}vh`,
        background,
      }}
    >
      <div
        style={{
          position: "sticky",
          top: 0,
          height: "100dvh",
          overflow: "hidden",
          background,
          // Promote the scrubbed pane to its own compositor layer so the
          // per-frame transform/opacity changes inside it composite on the GPU
          // instead of repainting — steadier sub-pixel motion during the scrub.
          willChange: "transform",
          transform: "translateZ(0)",
        }}
      >
        <FrameContext.Provider
          value={{ frame: shownFrame, fps: FPS, width: 1280, height: 720 }}
        >
          {children}
        </FrameContext.Provider>
      </div>
    </div>
  );
}
