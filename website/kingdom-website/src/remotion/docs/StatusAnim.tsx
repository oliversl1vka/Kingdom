import { useFrame, useCfg, useCompact } from "../driver";
import { C, counter, fadeUp, progress } from "./shared";

export const STATUS_FRAMES = 126;

const TILES = [
  { label: "completed", to: 8, color: C.green, soft: C.sageSoft, dot: C.green },
  { label: "running", to: 2, color: C.accent, soft: C.accentSoft, dot: C.accent },
  { label: "queued", to: 1, color: C.pending, soft: C.pendingSoft, dot: C.pending },
];

// Status → a live dashboard: stat tiles count up, the token odometer rolls to
// 142,338, and a completion bar fills toward done.
export const StatusAnim: React.FC = () => {
  const frame = useFrame();
  const { fps, width: W, height: H } = useCfg();
  const compact = useCompact();

  const tokens = counter(frame, 48, 62, 142338);
  const barP = progress(frame, 62, 42) * (8 / 11); // completion fraction

  // Desktop metrics are the v1 originals; compact is tuned for ~540×660.
  const z = compact
    ? { rootPad: "32px 26px", rootGap: 22, rootJustify: "center", tileGap: 12, tilePad: "18px 14px", dot: 11, dotGap: 8, tileMb: 8, tileLabel: 13, tileLs: "0.04em", tileNum: 46, cardPad: "24px 24px", secLabel: 13, secLs: "0.05em", rowGap: 12, tokenNum: 34, progTop: 22, progPct: 18, bar: 14 }
    : { rootPad: "60px 60px", rootGap: 30, rootJustify: "flex-start", tileGap: 26, tilePad: "28px 30px", dot: 12, dotGap: 10, tileMb: 14, tileLabel: 18, tileLs: "0.06em", tileNum: 64, cardPad: "30px 34px", secLabel: 18, secLs: "0.06em", rowGap: 0, tokenNum: 44, progTop: 26, progPct: 22, bar: 16 };

  return (
    <div style={{ width: W, height: H, background: C.panel, position: "relative", padding: z.rootPad, display: "flex", flexDirection: "column", justifyContent: z.rootJustify, gap: z.rootGap }}>
      {/* stat tiles */}
      <div style={{ display: "flex", gap: z.tileGap }}>
        {TILES.map((t, i) => (
          <div
            key={t.label}
            style={{
              flex: 1,
              minWidth: 0,
              background: C.card,
              border: `1px solid ${C.hair}`,
              borderRadius: 18,
              padding: z.tilePad,
              boxShadow: "0 18px 44px -36px rgba(0,0,0,0.8)",
              ...fadeUp(frame, 10 + i * 10, fps),
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: z.dotGap, marginBottom: z.tileMb }}>
              <span style={{ width: z.dot, height: z.dot, flex: "0 0 auto", borderRadius: "50%", background: t.dot }} />
              <span style={{ fontFamily: "var(--font-geist-mono), monospace", fontSize: z.tileLabel, letterSpacing: z.tileLs, textTransform: "uppercase", color: C.inkFaint, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {t.label}
              </span>
            </div>
            <div style={{ fontFamily: "var(--font-geist-mono), monospace", fontSize: z.tileNum, fontWeight: 600, color: t.color, lineHeight: 1 }}>
              {counter(frame, 16 + i * 9, 30, t.to)}
            </div>
          </div>
        ))}
      </div>

      {/* token odometer + completion bar */}
      <div
        style={{
          background: C.card,
          border: `1px solid ${C.hair}`,
          borderRadius: 18,
          padding: z.cardPad,
          boxShadow: "0 18px 44px -36px rgba(0,0,0,0.8)",
          ...fadeUp(frame, 44, fps),
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: z.rowGap }}>
          <span style={{ fontFamily: "var(--font-geist-mono), monospace", fontSize: z.secLabel, letterSpacing: z.secLs, textTransform: "uppercase", color: C.inkFaint, whiteSpace: "nowrap" }}>
            tokens used
          </span>
          <span style={{ fontFamily: "var(--font-geist-mono), monospace", fontSize: z.tokenNum, fontWeight: 600, color: C.ink }}>
            {tokens.toLocaleString()}
          </span>
        </div>

        <div style={{ marginTop: z.progTop, marginBottom: 12, display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: z.rowGap }}>
          <span style={{ fontFamily: "var(--font-geist-mono), monospace", fontSize: z.secLabel, letterSpacing: z.secLs, textTransform: "uppercase", color: C.inkFaint, whiteSpace: "nowrap" }}>
            objective progress
          </span>
          <span style={{ fontFamily: "var(--font-geist-mono), monospace", fontSize: z.progPct, fontWeight: 600, color: C.green }}>
            {Math.round(barP * 100)}%
          </span>
        </div>
        <div style={{ height: z.bar, borderRadius: 999, background: C.hair, overflow: "hidden" }}>
          <div style={{ height: "100%", width: `${barP * 100}%`, background: C.green, borderRadius: 999 }} />
        </div>
      </div>
    </div>
  );
};
