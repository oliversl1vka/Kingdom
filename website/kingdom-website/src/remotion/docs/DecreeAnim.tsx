import { interpolate } from "remotion";
import { useFrame, useCfg, useCompact } from "../driver";
import { C, fadeUp, springIn } from "./shared";

export const DECREE_FRAMES = 128;

const OBJECTIVE = "Integrate Stripe subscription billing";

// Decree → an objective "record" card whose fields populate in sequence
// (objective types in, priority, id), then the status flips pending → queued.
// Same structured data-card language as the dashboard/graph the user liked.
export const DecreeAnim: React.FC = () => {
  const frame = useFrame();
  const { fps, width: W, height: H } = useCfg();
  const compact = useCompact();

  const typed = OBJECTIVE.slice(
    0,
    Math.max(
      0,
      Math.floor(
        interpolate(frame, [18, 70], [0, OBJECTIVE.length], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        }),
      ),
    ),
  );
  const caretOn = frame < 70 && frame % 16 < 8;
  const queued = frame >= 86;
  const pillPop = springIn(frame, 86, fps, { damping: 14, stiffness: 150 });

  // Desktop metrics are the v1 originals; compact is tuned for ~560×560.
  const z = compact
    ? { cardW: W - 40, pad: "10px 26px 20px", head: 16, headPad: "15px 0", pill: 16, fieldPad: "15px 0", fieldGap: 16, label: 14, labelW: 92, obj: 18, prio: 11, prioGap: 8, id: 18, foot: 18, footB: 26 }
    : { cardW: 760, pad: "16px 44px 28px", head: 19, headPad: "22px 0", pill: 17, fieldPad: "20px 0", fieldGap: 20, label: 17, labelW: 130, obj: 26, prio: 13, prioGap: 9, id: 22, foot: 22, footB: 40 };

  // Render helper for a label/value record row that fades in at `start`.
  const field = (
    label: string,
    start: number,
    value: React.ReactNode,
    last?: boolean,
  ) => (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: z.fieldGap,
        padding: z.fieldPad,
        borderBottom: last ? "none" : `1px solid ${C.hair}`,
        ...fadeUp(frame, start, fps, 8),
      }}
    >
      <span
        style={{
          flex: `0 0 ${z.labelW}px`,
          fontFamily: "var(--font-geist-mono), monospace",
          fontSize: z.label,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          color: C.inkFaint,
        }}
      >
        {label}
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>{value}</div>
    </div>
  );

  return (
    <div style={{ width: W, height: H, background: C.panel, position: "relative", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div
        style={{
          width: z.cardW,
          background: C.card,
          border: `1px solid ${C.hair}`,
          borderRadius: 20,
          padding: z.pad,
          boxShadow: "0 30px 70px -44px rgba(0,0,0,0.8)",
          ...fadeUp(frame, 4, fps),
        }}
      >
        {/* header: title + status pill */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: z.headPad,
            borderBottom: `1px solid ${C.hair}`,
          }}
        >
          <span style={{ fontFamily: "var(--font-geist-mono), monospace", fontSize: z.head, letterSpacing: "0.16em", textTransform: "uppercase", color: C.inkFaint }}>
            Decree
          </span>
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 9,
              padding: "7px 16px",
              borderRadius: 999,
              fontFamily: "var(--font-geist-mono), monospace",
              fontSize: z.pill,
              letterSpacing: "0.04em",
              background: queued ? C.sageSoft : C.pendingSoft,
              color: queued ? C.sage : C.pending,
              transform: queued ? `scale(${interpolate(pillPop, [0, 1], [1.15, 1])})` : "none",
            }}
          >
            <span style={{ width: 9, height: 9, borderRadius: "50%", background: queued ? C.sage : C.pending }} />
            {queued ? "queued" : "pending"}
          </span>
        </div>

        {/* objective (types in) */}
        {field(
          "objective",
          8,
          <span style={{ fontFamily: "var(--font-geist-mono), monospace", fontSize: z.obj, color: C.ink, fontWeight: 500 }}>
            {typed}
            {caretOn ? <span style={{ color: C.accent }}>▍</span> : null}
          </span>,
        )}

        {/* priority */}
        {field(
          "priority",
          48,
          <div style={{ display: "flex", alignItems: "center", gap: z.prioGap }}>
            {[0, 1, 2, 3, 4].map((i) => (
              <span key={i} style={{ width: z.prio, height: z.prio, borderRadius: "50%", background: C.accent }} />
            ))}
            <span style={{ marginLeft: 8, fontFamily: "var(--font-geist-mono), monospace", fontSize: z.label + 1, color: C.inkSoft }}>5 / 10</span>
          </div>,
        )}

        {/* objective id */}
        {field(
          "objective id",
          68,
          <span style={{ fontFamily: "var(--font-geist-mono), monospace", fontSize: z.id, color: C.inkSoft }}>
            kdm_7a3f09c2
          </span>,
          true,
        )}
      </div>

      <div
        style={{
          position: "absolute",
          bottom: z.footB,
          left: 0,
          right: 0,
          textAlign: "center",
          fontFamily: "var(--font-geist-mono), monospace",
          fontSize: z.foot,
          fontWeight: 600,
          color: C.ink,
          ...fadeUp(frame, 102, fps),
        }}
      >
        The decree hath been issued
      </div>
    </div>
  );
};
