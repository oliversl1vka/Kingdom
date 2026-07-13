"use client";

// The hero → quickstart transition. Client boundary that mounts the
// scroll-scrubbed "Boot" composition (the terminal reboots into the
// quickstart) so the surrounding page can stay a server component.
//
// TIMING IS PER-PHASE (not one linear track). The animation frames are
// untouched — we only choose how much SCROLL each phase of it spends:
//   • Phase 1 (frames 0→118): the command typing + screen-wipe + the 5-step
//     manifest printing. Kept at the ORIGINAL pace (3.13vh / frame, exactly
//     as the old 660vh linear track) — this part already felt perfect.
//   • Phase 2 (frames 118→179): the "QUICKSTART" heading rising in and the
//     card receding (the final screen). HALVED — same frames, half the scroll.
// The split at frame 118 is the precise instant the heading begins to rise.
import { BridgeStage } from "@/remotion/bridge/BridgeStage";
import { BootBridge } from "@/remotion/bridge/BootBridge";

const FRAMES = 180;

// Per-phase scroll budget, in viewport heights (vh). `toFrame` is the frame the
// phase ends on; `vh` is how much scrolling it spans.
const PHASES = [
  { toFrame: 118, vh: 369 }, // intro + manifest — unchanged feel (369/118 = 3.13vh/frame)
  { toFrame: FRAMES - 1, vh: 95 }, // heading rise / final screen — half (95/61 ≈ 1.56vh/frame)
];

// Track height = total phase scroll + one viewport (the sticky pane). The
// scrubbable travel (trackVh − 100) therefore equals the summed phase vh.
const TRACK_VH = PHASES.reduce((s, p) => s + p.vh, 0) + 100;

// Build a piecewise-linear scroll(p∈[0,1]) → frame map from the phases, so each
// phase consumes its share of scroll while the frames stay continuous.
function buildFrameMap(phases: { toFrame: number; vh: number }[]) {
  const total = phases.reduce((s, p) => s + p.vh, 0);
  let accVh = 0;
  let accFrame = 0;
  const segs = phases.map((ph) => {
    const seg = {
      pStart: accVh / total,
      pEnd: (accVh + ph.vh) / total,
      fStart: accFrame,
      fEnd: ph.toFrame,
    };
    accVh += ph.vh;
    accFrame = ph.toFrame;
    return seg;
  });
  return (p: number): number => {
    for (let i = 0; i < segs.length; i++) {
      const s = segs[i];
      if (p <= s.pEnd || i === segs.length - 1) {
        const span = s.pEnd - s.pStart || 1;
        const t = Math.min(1, Math.max(0, (p - s.pStart) / span));
        return s.fStart + t * (s.fEnd - s.fStart);
      }
    }
    return phases[phases.length - 1].toFrame;
  };
}

const FRAME_MAP = buildFrameMap(PHASES);

export function Bridge() {
  return (
    <BridgeStage
      durationInFrames={FRAMES}
      trackVh={TRACK_VH}
      frameMap={FRAME_MAP}
      background="var(--kd-bg)"
    >
      <BootBridge />
    </BridgeStage>
  );
}
