"use client";

import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { TerminalInstall, type TerminalVariant } from "./TerminalInstall";
import {
  FPS,
  HERO_DURATION_IN_FRAMES,
  HERO_WIDTH,
  HERO_HEIGHT,
  HERO_COMPACT_WIDTH,
  HERO_COMPACT_HEIGHT,
  COMPACT_QUERY,
} from "./theme";

// SSR-safe media-query subscription. Returns false on the server and during the
// first client render, then syncs after mount — the compositions only render
// post-mount, so the first painted frame already reflects the real viewport.
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const sync = () => setMatches(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, [query]);
  return matches;
}

// ──────────────────────────────────────────────────────────────
// Lightweight frame driver — a drop-in replacement for
// @remotion/player for an ambient, non-interactive hero.
//
// WHY: <Player> advances via requestAnimationFrame and re-renders
// the whole composition on EVERY animation frame. On a high-refresh
// display (120/144/240 Hz) that is 2–4× the React work of a 60 Hz
// screen → visible lag; when the window is backgrounded rAF is
// throttled → the animation appears frozen.
//
// This driver runs a single rAF loop but only triggers a React
// re-render when the INTEGER composition frame (capped at `fps`)
// actually changes, so paint cost is identical regardless of the
// monitor's refresh rate. It also pauses when scrolled off-screen
// or when the tab is hidden, and resumes seamlessly.
// ──────────────────────────────────────────────────────────────

interface FrameCtx {
  frame: number;
  fps: number;
  width: number;
  height: number;
}

export const FrameContext = createContext<FrameCtx>({
  frame: 0,
  fps: FPS,
  width: HERO_WIDTH,
  height: HERO_HEIGHT,
});

// ──────────────────────────────────────────────────────────────
// Compact mode — a viewport-conditional flag the stages set when the
// composition is rendered into a NARROW container (phones). The fixed-canvas
// compositions are decorative (aria-hidden); at desktop/tablet widths they
// render their original 1280/1000-wide layouts (compact=false → byte-identical
// to v1). When compact, a composition swaps to a denser, larger-typed layout
// drawn for a small canvas, so its text is legible instead of microscopic.
// ──────────────────────────────────────────────────────────────
export const CompactContext = createContext<boolean>(false);

export function useCompact(): boolean {
  return useContext(CompactContext);
}

// Drop-in equivalents of remotion's hooks, backed by this driver.
export function useFrame(): number {
  return useContext(FrameContext).frame;
}

export function useCfg(): { fps: number; width: number; height: number } {
  const { fps, width, height } = useContext(FrameContext);
  return { fps, width, height };
}

export function TerminalStage({
  variant = 1,
}: {
  variant?: TerminalVariant;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0);
  const [frame, setFrame] = useState(0);
  const [mounted, setMounted] = useState(false);

  // Phones get a portrait canvas + denser layout (see CompactContext). Driven
  // off the same media query the CSS aspect-ratio override uses, so the canvas
  // dims and the container aspect always agree.
  const compact = useMediaQuery(COMPACT_QUERY);
  const canvasW = compact ? HERO_COMPACT_WIDTH : HERO_WIDTH;
  const canvasH = compact ? HERO_COMPACT_HEIGHT : HERO_HEIGHT;

  // Render the animated stage only after the client has mounted so the
  // server-rendered markup (empty container) matches first paint.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => setMounted(true), []);

  // Measure the container and keep the (compact-aware) stage scaled to fit.
  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const measure = () => setScale(el.clientWidth / canvasW);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [canvasW]);

  // Pause when off-screen or when the tab is hidden — save CPU and
  // avoid janky catch-up when the user returns.
  const playingRef = useRef(true);
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const visibleRef = { current: true };
    const sync = () => {
      playingRef.current = visibleRef.current && !document.hidden;
    };
    const io = new IntersectionObserver(
      ([entry]) => {
        visibleRef.current = entry.isIntersecting;
        sync();
      },
      { threshold: 0.01 },
    );
    io.observe(el);
    document.addEventListener("visibilitychange", sync);
    return () => {
      io.disconnect();
      document.removeEventListener("visibilitychange", sync);
    };
  }, []);

  // Single rAF loop. Re-render only when the integer frame changes, so
  // the React/paint cost is capped at `fps` regardless of display Hz.
  useEffect(() => {
    if (!mounted) return;
    let raf = 0;
    let anchor = performance.now();
    let current = 0; // live frame, tracked locally (no stale closure)
    let done = false; // latched true once the sequence has played out
    const lastFrame = HERO_DURATION_IN_FRAMES - 1;

    const tick = (now: number) => {
      if (done) return;
      if (playingRef.current) {
        const f = Math.floor(((now - anchor) / 1000) * FPS);
        // Play through exactly once, then freeze on the final frame — no
        // looping, ever. Time only accrues while on-screen (see the
        // IntersectionObserver), so it starts when the user reaches the
        // page and stops for good once the text has written out.
        if (f >= lastFrame) {
          current = lastFrame;
          setFrame(lastFrame);
          done = true;
          return; // permanent stop — never reschedules
        }
        current = f;
        setFrame((prev) => (prev === f ? prev : f));
      } else {
        // Paused (off-screen / tab hidden): shift the anchor so the frozen
        // frame is preserved and we resume exactly where we left off.
        anchor = now - (current / FPS) * 1000;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [mounted]);

  return (
    <div
      ref={containerRef}
      style={{ position: "absolute", inset: 0, overflow: "hidden" }}
    >
      {mounted && scale > 0 ? (
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: canvasW,
            height: canvasH,
            transform: `scale(${scale})`,
            transformOrigin: "top left",
          }}
        >
          <CompactContext.Provider value={compact}>
            <FrameContext.Provider
              value={{ frame, fps: FPS, width: canvasW, height: canvasH }}
            >
              <TerminalInstall variant={variant} />
            </FrameContext.Provider>
          </CompactContext.Provider>
        </div>
      ) : null}
    </div>
  );
}
