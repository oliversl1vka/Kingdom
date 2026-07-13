import { interpolateColors } from "remotion";
import { useFrame, useCfg, useCompact } from "../driver";
import { C, counter, fadeUp, progress, springIn } from "./shared";

export const INSTALL_FRAMES = 132;

// Real-ish install steps that tick off in sequence.
const STEPS = [
  "Fetching kingdomos",
  "Verifying signature",
  "Installing the CLI",
  "Linking kingdom → /usr/local/bin",
];
// On the narrow phone canvas the last step is shortened so it never wraps.
const STEPS_COMPACT = [
  "Fetching kingdomos",
  "Verifying signature",
  "Installing the CLI",
  "Linking → /usr/local/bin",
];

// Install → a step checklist ticks through while a progress bar fills to 100%,
// then the version line confirms ready. Same structured/checklist + counter
// language as the Setup and Status animations.
export const InstallAnim: React.FC = () => {
  const frame = useFrame();
  const { fps, width: W, height: H } = useCfg();
  const compact = useCompact();

  const pct = counter(frame, 12, 72, 100);
  const barP = progress(frame, 12, 72);
  // Smoothly cross-fade white → green as the bar tops out (was a hard switch).
  const FILL_DONE = 84; // frame the bar reaches 100%
  const numColor = interpolateColors(frame, [FILL_DONE, FILL_DONE + 16], [C.ink, C.sage]);
  const pctColor = interpolateColors(frame, [FILL_DONE, FILL_DONE + 16], [C.inkSoft, C.sage]);
  const barColor = interpolateColors(frame, [FILL_DONE, FILL_DONE + 16], [C.accent, C.sage]);

  // Layout metrics — desktop values are the v1 originals (untouched); compact
  // values are tuned for the ~540×600 phone canvas.
  const z = compact
    ? { cardW: W - 44, pad: "30px 30px", headMb: 22, label: 16, pct: 30, pctSm: 19, bar: 13, barMb: 26, gap: 17, circle: 26, tick: 16, step: 18, foot: 26, footPt: 20, ready: 20 }
    : { cardW: 720, pad: "44px 50px", headMb: 30, label: 19, pct: 30, pctSm: 21, bar: 14, barMb: 34, gap: 20, circle: 28, tick: 16, step: 22, foot: 34, footPt: 26, ready: 24 };
  const steps = compact ? STEPS_COMPACT : STEPS;

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
        {/* header */}
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: z.headMb }}>
          <span style={{ fontFamily: "var(--font-geist-mono), monospace", fontSize: z.label, letterSpacing: "0.16em", textTransform: "uppercase", color: C.inkFaint }}>
            Installing
          </span>
          <span style={{ fontFamily: "var(--font-geist-mono), monospace", fontSize: z.pct, fontWeight: 600, color: numColor }}>
            {pct}
            <span style={{ fontSize: z.pctSm, fontWeight: 600, marginLeft: 1, color: pctColor }}>%</span>
          </span>
        </div>

        {/* progress bar */}
        <div style={{ height: z.bar, borderRadius: 999, background: C.hair, overflow: "hidden", marginBottom: z.barMb }}>
          <div style={{ height: "100%", width: `${barP * 100}%`, background: barColor, borderRadius: 999 }} />
        </div>

        {/* steps */}
        <div style={{ display: "flex", flexDirection: "column", gap: z.gap }}>
          {steps.map((s, i) => {
            const start = 18 + i * 17;
            const ticked = frame >= start;
            const tick = springIn(frame, start, fps);
            return (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 16, ...fadeUp(frame, start - 4, fps, 8) }}>
                {ticked ? (
                  <div
                    style={{
                      width: z.circle,
                      height: z.circle,
                      borderRadius: "50%",
                      background: C.sageSoft,
                      color: C.sage,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: z.tick,
                      flex: "0 0 auto",
                      transform: `scale(${tick})`,
                    }}
                  >
                    ✓
                  </div>
                ) : (
                  <div style={{ width: z.circle, height: z.circle, flex: "0 0 auto", borderRadius: "50%", border: `2px solid ${C.hair}` }} />
                )}
                <span
                  style={{
                    fontFamily: "var(--font-geist-mono), monospace",
                    fontSize: z.step,
                    whiteSpace: "nowrap",
                    color: ticked ? C.ink : C.inkFaint,
                  }}
                >
                  {s}
                </span>
              </div>
            );
          })}
        </div>

        {/* ready line */}
        <div
          style={{
            marginTop: z.foot,
            paddingTop: z.footPt,
            borderTop: `1px solid ${C.hair}`,
            display: "flex",
            alignItems: "center",
            gap: 12,
            fontFamily: "var(--font-geist-mono), monospace",
            fontSize: z.ready,
            fontWeight: 600,
            color: C.sage,
            ...fadeUp(frame, 90, fps),
          }}
        >
          <span>✓</span>
          <span style={{ color: C.ink }}>kingdom v0.1.0 ready</span>
        </div>
      </div>
    </div>
  );
};
