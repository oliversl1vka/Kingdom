import { AbsoluteFill, interpolate, spring } from "remotion";
import { COLORS, MONO, SANS } from "./theme";
import { useFrame, useCfg, useCompact } from "./driver";
import type { TerminalVariant } from "./variants-meta";

export type { TerminalVariant } from "./variants-meta";

// ──────────────────────────────────────────────────────────────
// Typewriter helpers (frame-driven, string-slicing — per Remotion
// best-practices: never per-character opacity, never CSS animation)
// ──────────────────────────────────────────────────────────────

const CHARS_PER_FRAME = 1.0;

function typedSlice(text: string, framesElapsed: number): string {
  const count = Math.floor(Math.max(0, framesElapsed) * CHARS_PER_FRAME);
  return text.slice(0, Math.min(count, text.length));
}

function framesToType(text: string): number {
  return Math.ceil(text.length / CHARS_PER_FRAME);
}

// Install progress bar — frame-driven fill (no CSS animation).
const PROGRESS_FRAMES = 46;
const PROGRESS_WIDTH = 22;

type LineKind = "cmd" | "ok" | "muted" | "progress" | "decree";

interface TerminalLine {
  prompt: string;
  text: string;
  kind: LineKind;
}

function lineFrames(line: TerminalLine): number {
  if (line.kind === "progress") return PROGRESS_FRAMES;
  return framesToType(line.prompt + line.text);
}

// The REAL onboarding flow, mirroring the actual CLI commands & wording.
const SEQUENCE: TerminalLine[] = [
  { prompt: "$ ", text: "curl -fsSL https://kingdomos.dev/install | sh", kind: "cmd" },
  { prompt: "  ", text: "fetching kingdomos", kind: "progress" },
  { prompt: "  ", text: "✓ kingdom v0.1.0 ready", kind: "ok" },
  { prompt: "$ ", text: "kingdom setup camelot", kind: "cmd" },
  { prompt: "  ", text: "✓ Kingdom 'camelot' established", kind: "ok" },
  { prompt: "$ ", text: 'kingdom decree "Integrate Stripe subscription billing"', kind: "cmd" },
  { prompt: "  ", text: "The decree hath been issued", kind: "decree" },
  { prompt: "$ ", text: "kingdom summon", kind: "cmd" },
  { prompt: "  ", text: "King is decomposing the objective…", kind: "muted" },
  { prompt: "  ", text: "✓ 3 epics · 11 tasks queued", kind: "ok" },
];

// Compact (phone) flow — the SAME story with short lines that fit the portrait
// canvas at legible type. Lines stay ≤ ~33 chars so nothing wraps/overflows.
// The closing line matches the desktop flow so completion detection is shared.
const COMPACT_SEQUENCE: TerminalLine[] = [
  { prompt: "$ ", text: "kingdom install", kind: "cmd" },
  { prompt: "  ", text: "fetching", kind: "progress" },
  { prompt: "  ", text: "✓ kingdom v0.1.0 ready", kind: "ok" },
  { prompt: "$ ", text: "kingdom setup camelot", kind: "cmd" },
  { prompt: "  ", text: "✓ 'camelot' established", kind: "ok" },
  { prompt: "$ ", text: 'kingdom decree "Stripe billing"', kind: "cmd" },
  { prompt: "  ", text: "The decree hath been issued", kind: "decree" },
  { prompt: "$ ", text: "kingdom summon", kind: "cmd" },
  { prompt: "  ", text: "King is decomposing…", kind: "muted" },
  { prompt: "  ", text: "✓ 3 epics · 11 tasks queued", kind: "ok" },
];

// ──────────────────────────────────────────────────────────────
// Five FINAL terminal directions, tuned to the dark terminal
// aesthetic: near-black surfaces, monochrome text, one restrained
// dim-green accent, calm whitespace, gentle rounding. Each is a
// distinct treatment of the same live flow.
//
//   1 soft     → chromeless near-black card, dim-green accent
//   2 macos    → realistic macOS window (traffic lights, white accent)
//   3 frosted  → modern macOS vibrancy — whole card frosted dark glass
//   4 editor   → IDE/code-editor look with a filename tab
//   5 label    → ultra-minimal dark card with a slim labelled header
// ──────────────────────────────────────────────────────────────
// (TerminalVariant lives in ./variants-meta — server-safe — and is
//  re-exported above for convenience.)

// Per-variant text palette, threaded through every row.
interface TermTheme {
  cmd: string;
  prompt: string;
  ok: string;
  muted: string;
  decree: string;
  caret: string;
  barFill: string;
  barTrack: string;
}

const INK: TermTheme = {
  cmd: COLORS.termInk,
  prompt: COLORS.accent,
  ok: COLORS.termOk,
  muted: COLORS.termMuted,
  decree: COLORS.ink,
  caret: COLORS.accent,
  barFill: COLORS.accent,
  barTrack: "rgba(255,255,255,0.14)",
};

// Green — monochrome body with the dim terminal-green accent.
const GREEN: TermTheme = {
  cmd: "#CFCFCF",
  prompt: "#4ADE80",
  ok: "#4ADE80",
  muted: "#707070",
  decree: "#F0F0F0",
  caret: "#4ADE80",
  barFill: "#4ADE80",
  barTrack: "rgba(255,255,255,0.12)",
};

type ChromeKind = "mac" | "tab" | "label" | "none";

interface VariantConfig {
  chrome: ChromeKind;
  title: string;
  cardBg: string;
  cardBackdrop?: string; // set → frosted glass surface
  bodyPad: string;
  // Title-bar surface
  barBg: string;
  barBorder: string;
  barBackdrop?: string;
  titleColor: string;
  accentDot: string; // brand dot for tab/label chrome
  theme: TermTheme;
}

const VARIANTS: Record<TerminalVariant, VariantConfig> = {
  1: {
    chrome: "none",
    title: "",
    cardBg: "#0E0E0E",
    bodyPad: "58px 66px 60px",
    barBg: "transparent",
    barBorder: "transparent",
    titleColor: COLORS.inkSoft,
    accentDot: "#4ADE80",
    theme: GREEN,
  },
  2: {
    chrome: "mac",
    title: "kingdom — -zsh",
    cardBg: "#0E0E0E",
    bodyPad: "40px 64px 56px",
    barBg: "#161616",
    barBorder: "rgba(255,255,255,0.10)",
    titleColor: COLORS.inkSoft,
    accentDot: COLORS.accent,
    theme: INK,
  },
  3: {
    chrome: "mac",
    title: "kingdom — -zsh",
    cardBg: "rgba(16,16,16,0.60)",
    cardBackdrop: "blur(30px) saturate(180%)",
    bodyPad: "40px 64px 56px",
    barBg: "rgba(22,22,22,0.55)",
    barBorder: "rgba(255,255,255,0.08)",
    barBackdrop: "blur(30px) saturate(180%)",
    titleColor: COLORS.inkSoft,
    accentDot: COLORS.accent,
    theme: INK,
  },
  4: {
    chrome: "tab",
    title: "kingdom — zsh",
    cardBg: "#0E0E0E",
    bodyPad: "36px 58px 52px",
    barBg: "#161616",
    barBorder: "rgba(255,255,255,0.10)",
    titleColor: COLORS.inkSoft,
    accentDot: COLORS.accent,
    theme: INK,
  },
  5: {
    chrome: "label",
    title: "kingdom — zsh",
    cardBg: "#0E0E0E",
    bodyPad: "44px 62px 56px",
    barBg: "transparent",
    barBorder: "rgba(255,255,255,0.08)",
    titleColor: COLORS.inkSoft,
    accentDot: "#4ADE80",
    theme: GREEN,
  },
};

const LINE_GAP_FRAMES = 6;
const OPEN_FRAME = 8;
const TYPE_START_FRAME = 26;

function colorFor(kind: LineKind, t: TermTheme): string {
  if (kind === "ok") return t.ok;
  if (kind === "muted") return t.muted;
  if (kind === "decree") return t.decree;
  return t.cmd;
}

// ── Caret (frame-driven, no CSS). Blinks while typing; goes solid and
//    still once `blink` is false, so the final resting cursor doesn't
//    flicker (it freezes cleanly at the end of the sequence). ─────────
const Caret: React.FC<{
  color: string;
  blink?: boolean;
  blinkPeriod?: number;
}> = ({ color, blink = true, blinkPeriod = 16 }) => {
  const frame = useFrame();
  const opacity = blink
    ? interpolate(
        frame % blinkPeriod,
        [0, blinkPeriod / 2, blinkPeriod],
        [1, 0, 1],
        { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
      )
    : 1;
  return (
    <span
      style={{
        display: "inline-block",
        width: "0.6ch",
        height: "1.05em",
        background: color,
        marginLeft: "0.1ch",
        transform: "translateY(0.16em)",
        opacity,
      }}
    />
  );
};

// ── Traffic-light dot (realistic macOS proportions) ────────────
const Dot: React.FC<{ color: string; size?: number }> = ({
  color,
  size = 24,
}) => (
  <div
    style={{
      width: size,
      height: size,
      borderRadius: "50%",
      background: color,
      boxShadow: "inset 0 0 0 1px rgba(0,0,0,0.25)",
    }}
  />
);

// ── Window chrome — four styles ────────────────────────────────
const WindowBar: React.FC<{ cfg: VariantConfig }> = ({ cfg }) => {
  if (cfg.chrome === "none") return null;

  if (cfg.chrome === "mac") {
    return (
      <div
        style={{
          position: "relative",
          display: "flex",
          alignItems: "center",
          height: 56,
          padding: "0 24px",
          borderBottom: `1px solid ${cfg.barBorder}`,
          background: cfg.barBg,
          backdropFilter: cfg.barBackdrop,
          WebkitBackdropFilter: cfg.barBackdrop,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Dot color={COLORS.dotRed} />
          <Dot color={COLORS.dotAmber} />
          <Dot color={COLORS.dotGreen} />
        </div>
        <span
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            textAlign: "center",
            fontFamily: SANS,
            fontSize: 18,
            fontWeight: 500,
            letterSpacing: "0.01em",
            color: cfg.titleColor,
            pointerEvents: "none",
          }}
        >
          {cfg.title}
        </span>
      </div>
    );
  }

  if (cfg.chrome === "tab") {
    // IDE-style: a raised strip carrying an elevated filename tab.
    return (
      <div
        style={{
          display: "flex",
          alignItems: "flex-end",
          height: 58,
          padding: "0 0 0 18px",
          borderBottom: `1px solid ${cfg.barBorder}`,
          background: cfg.barBg,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 7, paddingBottom: 18 }}>
          <Dot color={COLORS.dotRed} size={12} />
          <Dot color={COLORS.dotAmber} size={12} />
          <Dot color={COLORS.dotGreen} size={12} />
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            marginLeft: 18,
            padding: "12px 22px",
            background: "#0E0E0E",
            borderRadius: "10px 10px 0 0",
            borderTop: `1px solid ${cfg.barBorder}`,
            borderLeft: `1px solid ${cfg.barBorder}`,
            borderRight: `1px solid ${cfg.barBorder}`,
          }}
        >
          <span
            style={{
              width: 9,
              height: 9,
              borderRadius: "50%",
              background: cfg.accentDot,
            }}
          />
          <span
            style={{
              fontFamily: MONO,
              fontSize: 17,
              letterSpacing: "0.01em",
              color: cfg.titleColor,
            }}
          >
            {cfg.title}
          </span>
        </div>
      </div>
    );
  }

  // label — a slim, quiet header: accent dot · path · shell tag.
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        height: 50,
        padding: "0 30px",
        borderBottom: `1px solid ${cfg.barBorder}`,
        background: cfg.barBg,
      }}
    >
      <span
        style={{
          width: 10,
          height: 10,
          borderRadius: "50%",
          background: cfg.accentDot,
          boxShadow: `0 0 0 4px ${cfg.accentDot}1f`,
        }}
      />
      <span
        style={{
          fontFamily: MONO,
          fontSize: 18,
          letterSpacing: "0.04em",
          color: cfg.titleColor,
        }}
      >
        {cfg.title}
      </span>
      <span
        style={{
          marginLeft: "auto",
          fontFamily: MONO,
          fontSize: 14,
          letterSpacing: "0.16em",
          textTransform: "uppercase",
          color: COLORS.inkFaint,
        }}
      >
        zsh
      </span>
    </div>
  );
};

// ── A single typed terminal line ───────────────────────────────
const TerminalLineRow: React.FC<{
  line: TerminalLine;
  typed: string;
  showCaret: boolean;
  caretBlink: boolean;
  theme: TermTheme;
  font?: number;
}> = ({ line, typed, showCaret, caretBlink, theme, font = 26 }) => {
  const isCmd = line.prompt.trim() === "$";
  const bodyColor = isCmd ? theme.cmd : colorFor(line.kind, theme);
  const weight = line.kind === "decree" ? 600 : 400;
  return (
    <div
      style={{
        fontFamily: MONO,
        fontSize: font,
        lineHeight: 1.72,
        whiteSpace: "pre",
        color: bodyColor,
        fontWeight: weight,
      }}
    >
      {isCmd ? <span style={{ color: theme.prompt }}>$ </span> : line.prompt}
      <span style={{ color: bodyColor }}>
        {isCmd ? typed.slice(2) : typed.slice(line.prompt.length)}
      </span>
      {showCaret ? <Caret color={theme.caret} blink={caretBlink} /> : null}
    </div>
  );
};

// ── Install progress bar line (frame-driven fill) ──────────────
const ProgressBarRow: React.FC<{
  frac: number;
  label: string;
  theme: TermTheme;
  font?: number;
  width?: number;
}> = ({ frac, label, theme, font = 26, width = PROGRESS_WIDTH }) => {
  const filled = Math.round(frac * width);
  const empty = width - filled;
  const pct = Math.round(frac * 100);
  return (
    <div
      style={{
        fontFamily: MONO,
        fontSize: font,
        lineHeight: 1.72,
        whiteSpace: "pre",
      }}
    >
      <span style={{ color: theme.muted }}>{"  "}</span>
      <span style={{ color: theme.barFill }}>{"█".repeat(filled)}</span>
      <span style={{ color: theme.barTrack }}>{"░".repeat(empty)}</span>
      <span style={{ color: theme.muted }}>{`  ${pct}%  ${label}`}</span>
    </div>
  );
};

// ──────────────────────────────────────────────────────────────
// Main composition
// ──────────────────────────────────────────────────────────────
export const TerminalInstall: React.FC<{ variant?: TerminalVariant }> = ({
  variant = 1,
}) => {
  const frame = useFrame();
  const { fps } = useCfg();
  const compact = useCompact();
  const cfg = VARIANTS[variant];
  const theme = cfg.theme;
  const bodyBg = cfg.cardBackdrop ? "transparent" : cfg.cardBg;

  // Phone canvas: the same flow with short lines, larger relative type, and a
  // tighter body so it reads clearly when scaled down. Desktop/tablet keep the
  // original SEQUENCE/metrics → byte-identical to v1.
  const seq = compact ? COMPACT_SEQUENCE : SEQUENCE;
  const font = compact ? 22 : 26;
  const progWidth = compact ? 14 : PROGRESS_WIDTH;
  const bodyPad = compact ? "30px 30px 34px" : cfg.bodyPad;

  const open = spring({
    frame: frame - OPEN_FRAME,
    fps,
    config: { damping: 200, stiffness: 120, mass: 0.7 },
  });
  const opacity = interpolate(open, [0, 1], [0, 1]);
  const lift = interpolate(open, [0, 1], [14, 0]);

  const starts: number[] = [];
  let cursor = TYPE_START_FRAME;
  for (const line of seq) {
    starts.push(cursor);
    cursor += lineFrames(line) + LINE_GAP_FRAMES;
  }
  const lastIndex = seq.length - 1;
  const lastStart = starts[lastIndex];
  const lastLine = seq[lastIndex];
  const lastFullyTyped = frame - lastStart >= lineFrames(lastLine);

  return (
    <AbsoluteFill
      style={{
        fontFamily: MONO,
        textAlign: "left",
        flexDirection: "column",
        background: cfg.cardBg,
        backdropFilter: cfg.cardBackdrop,
        WebkitBackdropFilter: cfg.cardBackdrop,
        opacity,
      }}
    >
      <WindowBar cfg={cfg} />
      <div
        style={{
          flex: 1,
          padding: bodyPad,
          background: bodyBg,
          transform: `translateY(${lift}px)`,
        }}
      >
        {seq.map((line, i) => {
          const start = starts[i];
          if (frame < start) return null;
          if (line.kind === "progress") {
            const frac = Math.min(
              1,
              Math.max(0, (frame - start) / PROGRESS_FRAMES),
            );
            return (
              <ProgressBarRow
                key={i}
                frac={frac}
                label={line.text}
                theme={theme}
                font={font}
                width={progWidth}
              />
            );
          }
          const typed = typedSlice(line.prompt + line.text, frame - start);
          const isTyping = typed.length < (line.prompt + line.text).length;
          const isActiveLast = i === lastIndex && (isTyping || lastFullyTyped);
          return (
            <TerminalLineRow
              key={i}
              line={line}
              typed={typed}
              showCaret={isActiveLast}
              caretBlink={!lastFullyTyped}
              theme={theme}
              font={font}
            />
          );
        })}
      </div>
    </AbsoluteFill>
  );
};
