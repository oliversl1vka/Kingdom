"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { CompactContext, FrameContext, useMediaQuery } from "../driver";
import { COMPACT_QUERY, FPS } from "../theme";

// Generic play-once-on-view stage for the quickstart doc animations.
//
// Mirrors the hero driver (driver.tsx) but is reusable for any composition:
// a single rAF loop advances an integer frame, capped at `fps`, only while
// the panel is on-screen (IntersectionObserver). It plays through exactly
// ONCE and freezes on the final frame — no looping — matching the hero's
// approved behaviour. The 16:10-ish design canvas (`width`×`height`) is
// scaled to fit its container.
export function AnimStage({
  durationInFrames,
  width,
  height,
  compactWidth,
  compactHeight,
  children,
}: {
  durationInFrames: number;
  width: number;
  height: number;
  /** Phone canvas dims; when set, used below COMPACT_QUERY so the composition
   *  can swap to a denser, larger-typed portrait layout (compact=false on
   *  tablet/desktop → byte-identical to v1). */
  compactWidth?: number;
  compactHeight?: number;
  children: React.ReactNode;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0);
  const [frame, setFrame] = useState(0);
  const [mounted, setMounted] = useState(false);

  const compact =
    useMediaQuery(COMPACT_QUERY) && compactWidth != null && compactHeight != null;
  const canvasW = compact ? (compactWidth as number) : width;
  const canvasH = compact ? (compactHeight as number) : height;

  // Intentional client-mount guard (server renders empty → no hydration
  // mismatch; the stage only appears after mount).
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => setMounted(true), []);

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const measure = () => setScale(el.clientWidth / canvasW);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [canvasW]);

  // Pause when off-screen / tab hidden so the timeline only advances once
  // the section is actually in view.
  const playingRef = useRef(false);
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const visibleRef = { current: false };
    const sync = () => {
      playingRef.current = visibleRef.current && !document.hidden;
    };
    const io = new IntersectionObserver(
      ([entry]) => {
        visibleRef.current = entry.isIntersecting;
        sync();
      },
      { threshold: 0.35 },
    );
    io.observe(el);
    document.addEventListener("visibilitychange", sync);
    return () => {
      io.disconnect();
      document.removeEventListener("visibilitychange", sync);
    };
  }, []);

  useEffect(() => {
    if (!mounted) return;
    let raf = 0;
    let anchor = performance.now();
    let current = 0;
    let done = false;
    const lastFrame = durationInFrames - 1;

    const tick = (now: number) => {
      if (done) return;
      if (playingRef.current) {
        const f = Math.floor(((now - anchor) / 1000) * FPS);
        if (f >= lastFrame) {
          current = lastFrame;
          setFrame(lastFrame);
          done = true;
          return;
        }
        current = f;
        setFrame((prev) => (prev === f ? prev : f));
      } else {
        anchor = now - (current / FPS) * 1000;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [mounted, durationInFrames]);

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
              {children}
            </FrameContext.Provider>
          </CompactContext.Provider>
        </div>
      ) : null}
    </div>
  );
}
