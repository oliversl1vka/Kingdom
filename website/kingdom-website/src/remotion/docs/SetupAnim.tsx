import { useFrame, useCfg, useCompact } from "../driver";
import { C, fadeUp, springIn } from "./shared";

export const SETUP_FRAMES = 136;

const TREE: { text: string; dim?: boolean }[] = [
  { text: "kingdom/" },
  { text: "├─ kingdom.config.json", dim: true },
  { text: "├─ kingdom.db", dim: true },
  { text: "├─ agents/", dim: true },
  { text: "│   ├─ king.md", dim: true },
  { text: "│   └─ knight.md", dim: true },
  { text: "└─ memory/", dim: true },
];

const STEPS = [
  "Preparing the royal grounds",
  "Sealing the configuration",
  "Forging the ledger",
  "Summoning the agent court",
  "Raising the banners",
];

// Setup → a kingdom/ file-tree writes itself line-by-line on the left while
// the real scaffolding steps tick off on the right; an "established" banner
// settles in at the end. On phones the two columns stack vertically.
export const SetupAnim: React.FC = () => {
  const frame = useFrame();
  const { fps, width: W, height: H } = useCfg();
  const compact = useCompact();

  // Desktop metrics are the v1 originals; compact is tuned for ~540×640.
  const z = compact
    ? { rootPad: "26px 26px", rootGap: 16, col: "column" as const, treeFlex: "0 0 auto", treePad: "20px 22px", treeFs: 17, treeLh: 1.7, stepsGap: 14, circle: 26, tickFs: 16, stepFs: 17, closeFs: 17, closeMt: 8, closePt: 18 }
    : { rootPad: "56px 60px", rootGap: 36, col: "row" as const, treeFlex: "0 0 440px", treePad: "30px 32px", treeFs: 22, treeLh: 1.95, stepsGap: 22, circle: 30, tickFs: 18, stepFs: 23, closeFs: 23, closeMt: 14, closePt: 26 };

  return (
    <div style={{ width: W, height: H, background: C.panel, position: "relative", display: "flex", flexDirection: z.col, alignItems: compact ? "stretch" : "stretch", justifyContent: compact ? "center" : "flex-start", gap: z.rootGap, padding: z.rootPad }}>
      {/* file tree */}
      <div
        style={{
          flex: z.treeFlex,
          background: C.card,
          border: `1px solid ${C.hair}`,
          borderRadius: 16,
          padding: z.treePad,
          boxShadow: "0 18px 44px -34px rgba(0,0,0,0.8)",
        }}
      >
        {TREE.map((line, i) => (
          <div
            key={i}
            style={{
              fontFamily: "var(--font-geist-mono), monospace",
              fontSize: z.treeFs,
              lineHeight: z.treeLh,
              whiteSpace: "pre",
              color: line.dim ? C.inkSoft : C.ink,
              fontWeight: line.dim ? 400 : 600,
              ...fadeUp(frame, 10 + i * 10, fps, 10),
            }}
          >
            {line.text}
          </div>
        ))}
      </div>

      {/* steps checklist + closing beat (settles directly under the list) */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", gap: z.stepsGap }}>
        {STEPS.map((s, i) => {
          const start = 24 + i * 13;
          const tick = springIn(frame, start, fps);
          return (
            <div
              key={i}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 16,
                ...fadeUp(frame, start - 2, fps, 8),
              }}
            >
              <div
                style={{
                  width: z.circle,
                  height: z.circle,
                  flex: "0 0 auto",
                  borderRadius: "50%",
                  background: C.sageSoft,
                  color: C.sage,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: z.tickFs,
                  transform: `scale(${tick})`,
                }}
              >
                ✓
              </div>
              <span style={{ fontSize: z.stepFs, color: C.inkSoft }}>{s}</span>
            </div>
          );
        })}

        {/* closing beat — sits beneath the checklist as the final result */}
        <div
          style={{
            marginTop: z.closeMt,
            paddingTop: z.closePt,
            borderTop: `1px solid ${C.hair}`,
            display: "flex",
            alignItems: "center",
            gap: 13,
            fontFamily: "var(--font-geist-mono), monospace",
            fontSize: z.closeFs,
            fontWeight: 600,
            color: C.ink,
            ...fadeUp(frame, 98, fps, 10),
          }}
        >
          <span
            style={{
              width: 11,
              height: 11,
              flex: "0 0 auto",
              borderRadius: "50%",
              background: C.sage,
              boxShadow: `0 0 0 5px ${C.sageSoft}`,
            }}
          />
          <span>Kingdom &apos;camelot&apos; established</span>
        </div>
      </div>
    </div>
  );
};
