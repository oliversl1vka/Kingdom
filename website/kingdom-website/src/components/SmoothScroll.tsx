"use client";

// ──────────────────────────────────────────────────────────────
// SmoothScroll — virtualizes the WHOLE page's scroll with Lenis.
//
// Why this exists (the fix): previously only the hero→quickstart
// composition's *frame* was eased, while the page itself scrolled in raw,
// native, steppy increments. The eye caught the mismatch — a smooth
// animation riding on a jumpy scrollbar — and the transition felt "off".
//
// Lenis intercepts wheel/touch and drives ONE eased scroll value via its own
// rAF loop. Every element — text, the pinned terminal, the docs below — now
// moves on that single smoothed number, so the page "glides". The bridge then
// scrubs its animation against this already-smoothed scroll (see BridgeStage),
// which means there is exactly one smoothing layer and the animation is locked
// to the scroll with zero trailing. This is the same technique the reference
// sites (e.g. hydroflowdrink.com) use: Lenis smooth-scroll + scroll-scrubbed
// motion.
//
// prefers-reduced-motion: smoothing is turned off (native scroll) — Lenis
// stays mounted purely so the `useLenis` context contract holds.
// ──────────────────────────────────────────────────────────────

import { ReactLenis } from "lenis/react";
import "lenis/dist/lenis.css";
import { useEffect, useState } from "react";

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

export function SmoothScroll({ children }: { children: React.ReactNode }) {
  const reduce = usePrefersReducedMotion();

  return (
    <ReactLenis
      root
      options={{
        // lerp is the per-frame easing factor — lower = more glide/weight.
        // ~0.09 reads buttery without feeling laggy. Disabled under reduced
        // motion so wheel/touch fall back to native scroll.
        lerp: reduce ? 1 : 0.09,
        smoothWheel: !reduce,
        syncTouch: false,
        wheelMultiplier: 1,
        // In-page anchor links (the "Quickstart ↓" cue, docs nav) glide
        // through Lenis instead of doing a native jump that fights it.
        anchors: true,
      }}
    >
      {children}
    </ReactLenis>
  );
}
