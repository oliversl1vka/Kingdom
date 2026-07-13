import { useFrame, useCfg, useCompact } from "../driver";
import { C, counter, fadeUp, progress, springIn } from "./shared";

export const SUMMON_FRAMES = 144;

// ── Graph layout, per canvas. ALL animation TIMING (springs, ring fill, the
// resolve beat) is identical across layouts — only positions/sizes differ — so
// the step-04 ring↔node-settle sync (full @124) is preserved on every device.
interface Layout {
  king: { x: number; y: number };
  epics: { x: number; y: number }[];
  tasks: { x: number; epic: number }[];
  taskY: number;
  kingW: number;
  epicW: number;
  nodeH: number;
  nodeFs: number;
  taskR: number;
  lineW: number;
  chipTop: number;
  chipFs: number;
  chipSvg: number;
  chipPad: string;
  chipGap: number;
  counterFs: number;
  counterBottom: number;
}

const DESKTOP: Layout = {
  king: { x: 500, y: 118 },
  epics: [
    { x: 230, y: 322 },
    { x: 500, y: 322 },
    { x: 770, y: 322 },
  ],
  tasks: [
    ...[164, 208, 252, 296].map((x) => ({ x, epic: 0 })),
    ...[434, 478, 522, 566].map((x) => ({ x, epic: 1 })),
    ...[726, 770, 814].map((x) => ({ x, epic: 2 })),
  ],
  taskY: 500,
  kingW: 140,
  epicW: 150,
  nodeH: 52,
  nodeFs: 21,
  taskR: 15,
  lineW: 2.5,
  chipTop: 18,
  chipFs: 19,
  chipSvg: 21,
  chipPad: "9px 20px 9px 13px",
  chipGap: 11,
  counterFs: 26,
  counterBottom: 36,
};

// Compact phone graph — fits the 620×470 portrait-ish canvas with legible type.
const COMPACT: Layout = {
  king: { x: 310, y: 72 },
  epics: [
    { x: 135, y: 210 },
    { x: 310, y: 210 },
    { x: 485, y: 210 },
  ],
  tasks: [
    ...[75, 115, 155, 195].map((x) => ({ x, epic: 0 })),
    ...[250, 290, 330, 370].map((x) => ({ x, epic: 1 })),
    ...[445, 485, 525].map((x) => ({ x, epic: 2 })),
  ],
  taskY: 340,
  kingW: 104,
  epicW: 112,
  nodeH: 44,
  nodeFs: 15,
  taskR: 13,
  lineW: 2,
  chipTop: 12,
  chipFs: 14,
  chipSvg: 18,
  chipPad: "7px 15px 7px 10px",
  chipGap: 8,
  counterFs: 17,
  counterBottom: 18,
};

const Node: React.FC<{
  x: number;
  y: number;
  w: number;
  h: number;
  fs: number;
  label: string;
  bg: string;
  fg: string;
  scale: number;
}> = ({ x, y, w, h, fs, label, bg, fg, scale }) => (
  <div
    style={{
      position: "absolute",
      left: x,
      top: y,
      transform: `translate(-50%,-50%) scale(${scale})`,
      width: w,
      height: h,
      borderRadius: 12,
      background: bg,
      color: fg,
      border: `1px solid ${fg}22`,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      fontFamily: "var(--font-geist-mono), monospace",
      fontSize: fs,
      fontWeight: 600,
    }}
  >
    {label}
  </div>
);

// Summon → the King decomposes the objective: connector lines draw from the
// King to 3 epics, then fan out to 11 tier-coloured task nodes, while the
// counter ticks up to "3 epics · 11 tasks".
export const SummonAnim: React.FC = () => {
  const frame = useFrame();
  const { fps, width: W, height: H } = useCfg();
  const compact = useCompact();
  const L = compact ? COMPACT : DESKTOP;
  const half = L.nodeH / 2;

  const line = (
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    start: number,
    color: string,
    key: string,
  ) => {
    const p = progress(frame, start, 12);
    return (
      <line
        key={key}
        x1={x1}
        y1={y1}
        x2={x2}
        y2={y2}
        stroke={color}
        strokeWidth={L.lineW}
        strokeLinecap="round"
        pathLength={1}
        strokeDasharray={1}
        strokeDashoffset={1 - p}
        opacity={p > 0 ? 1 : 0}
      />
    );
  };

  const epics = counter(frame, 40, 22, 3);
  const tasks = counter(frame, 66, 46, 11);

  return (
    <div style={{ width: W, height: H, background: C.panel, position: "relative" }}>
      {/* Step-04 caption — an animated status chip. A sage ring fills as the
          King decomposes the objective into the graph below, then resolves
          into a check with a soft glow; the label crossfades in place.
          Hidden on phones (the pill can't fit) — the graph stands on its own. */}
      {!compact && (() => {
        // Perfectly synced to the graph build — TIMING IS CANVAS-INDEPENDENT.
        // The last task node (spring start @104) is still visibly growing until
        // ~frame 124; fill the ring LINEARLY so it completes exactly as the
        // nodes settle, then the check + label resolve as one finishing beat.
        const fill = Math.max(0, Math.min(1, (frame - 20) / 104)); // full @124
        const done = progress(frame, 124, 13); // resolve 124 → 137
        const FF = "var(--font-geist-mono), monospace";
        return (
          <div
            style={{
              position: "absolute",
              top: L.chipTop,
              left: 0,
              right: 0,
              display: "flex",
              justifyContent: "center",
              ...fadeUp(frame, 6, fps),
            }}
          >
            <div
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: L.chipGap,
                padding: L.chipPad,
                borderRadius: 999,
                background: `rgba(74,222,128,${0.045 + done * 0.05})`,
                border: `1px solid rgba(74,222,128,${0.14 + done * 0.28})`,
                boxShadow:
                  done > 0
                    ? `0 0 26px -6px rgba(74,222,128,${done * 0.55})`
                    : "none",
              }}
            >
              <svg width={L.chipSvg} height={L.chipSvg} viewBox="0 0 20 20">
                <circle
                  cx={10}
                  cy={10}
                  r={8}
                  fill="none"
                  stroke="rgba(255,255,255,0.12)"
                  strokeWidth={2}
                />
                <circle
                  cx={10}
                  cy={10}
                  r={8}
                  fill="none"
                  stroke={C.sage}
                  strokeWidth={2.2}
                  strokeLinecap="round"
                  strokeDasharray={2 * Math.PI * 8}
                  strokeDashoffset={2 * Math.PI * 8 * (1 - fill)}
                  transform="rotate(-90 10 10)"
                  opacity={1 - done * 0.35}
                />
                {done > 0 ? (
                  <path
                    d="M6.2 10.4 L8.9 13 L13.9 7.3"
                    fill="none"
                    stroke={C.sage}
                    strokeWidth={2.2}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    pathLength={1}
                    strokeDasharray={1}
                    strokeDashoffset={1 - done}
                  />
                ) : null}
              </svg>
              {/* label — box sized to the RESOLVED text so the pill hugs it
                  snugly; both states are centered and crossfade in place. */}
              <div style={{ position: "relative", display: "inline-block" }}>
                <span
                  style={{
                    visibility: "hidden",
                    fontFamily: FF,
                    fontSize: L.chipFs,
                    fontWeight: 600,
                    letterSpacing: "0.005em",
                    whiteSpace: "nowrap",
                  }}
                >
                  Objective decomposed
                </span>
                <span
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    right: 0,
                    textAlign: "center",
                    fontFamily: FF,
                    fontSize: L.chipFs,
                    fontWeight: 600,
                    letterSpacing: "0.005em",
                    whiteSpace: "nowrap",
                    color: C.inkSoft,
                    opacity: 1 - done,
                  }}
                >
                  Decomposing…
                </span>
                <span
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    right: 0,
                    textAlign: "center",
                    fontFamily: FF,
                    fontSize: L.chipFs,
                    fontWeight: 600,
                    letterSpacing: "0.005em",
                    whiteSpace: "nowrap",
                    color: C.sage,
                    opacity: done,
                  }}
                >
                  Objective decomposed
                </span>
              </div>
            </div>
          </div>
        );
      })()}

      {/* connector lines */}
      <svg width={W} height={H} style={{ position: "absolute", inset: 0 }}>
        {L.epics.map((e, i) =>
          line(L.king.x, L.king.y + half, e.x, e.y - half, 20 + i * 8, C.noble, `ke${i}`),
        )}
        {L.tasks.map((t, i) =>
          line(
            L.epics[t.epic].x,
            L.epics[t.epic].y + half,
            t.x,
            L.taskY - L.taskR,
            50 + i * 5,
            C.knight,
            `et${i}`,
          ),
        )}
      </svg>

      {/* King */}
      <Node x={L.king.x} y={L.king.y} w={L.kingW} h={L.nodeH} fs={L.nodeFs} label="King" bg={C.accentSoft} fg={C.king} scale={springIn(frame, 8, fps)} />

      {/* Epics */}
      {L.epics.map((e, i) => (
        <Node
          key={i}
          x={e.x}
          y={e.y}
          w={L.epicW}
          h={L.nodeH}
          fs={L.nodeFs}
          label={`Epic ${i + 1}`}
          bg="rgba(255,255,255,0.07)"
          fg={C.noble}
          scale={springIn(frame, 28 + i * 8, fps)}
        />
      ))}

      {/* Tasks */}
      {L.tasks.map((t, i) => {
        const s = springIn(frame, 54 + i * 5, fps);
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: t.x,
              top: L.taskY,
              transform: `translate(-50%,-50%) scale(${s})`,
              width: L.taskR * 2,
              height: L.taskR * 2,
              borderRadius: "50%",
              background: C.pendingSoft,
              border: `2px solid ${C.knight}`,
            }}
          />
        );
      })}

      {/* counter */}
      <div
        style={{
          position: "absolute",
          bottom: L.counterBottom,
          left: 0,
          right: 0,
          textAlign: "center",
          fontFamily: "var(--font-geist-mono), monospace",
          fontSize: L.counterFs,
          fontWeight: 600,
          color: C.ink,
          ...fadeUp(frame, 40, fps),
        }}
      >
        <span style={{ color: C.noble }}>{epics} epics</span>
        <span style={{ color: C.inkFaint }}> · </span>
        <span style={{ color: C.knight }}>{tasks} tasks</span>
        <span style={{ color: C.inkFaint }}> queued</span>
      </div>
    </div>
  );
};
