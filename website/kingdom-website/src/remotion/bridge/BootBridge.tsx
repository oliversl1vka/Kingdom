"use client";

// ──────────────────────────────────────────────────────────────
// BOOT — the hero terminal reboots into the quickstart.
//
// The session continues from the hero's last lines, a fresh prompt types
// `kingdom quickstart`, a dim-green scanline wipes the screen clear, the five
// steps print as a manifest, and the quickstart heading rises above the card
// to hand off to the docs below. Continuity: the same terminal becomes your
// guide. Frame-driven; reads the scrubbed frame from <BridgeStage>.
// ──────────────────────────────────────────────────────────────

import { useFrame, useMediaQuery } from "../driver";
import { COMPACT_QUERY } from "../theme";
import {
  Backdrop,
  C,
  Caret,
  clamp01,
  fadeUp,
  MONO,
  ramp,
  SANS,
  STEPS,
  TermCard,
  typed,
} from "./shared";

const FONT = "clamp(15px, 1.5vw, 22px)";

function Row({
  children,
  opacity = 1,
}: {
  children: React.ReactNode;
  opacity?: number;
}) {
  return (
    <div
      style={{
        fontFamily: MONO,
        fontSize: FONT,
        lineHeight: 1.85,
        whiteSpace: "pre",
        opacity,
      }}
    >
      {children}
    </div>
  );
}

export function BootBridge() {
  const frame = useFrame();
  // On phones the grey gloss ("one line, global CLI", …) overflows the screen,
  // so the manifest shows ONLY the white step titles. Desktop is unchanged.
  const compact = useMediaQuery(COMPACT_QUERY);

  // Old session fades as the screen is wiped; manifest + heading settle in.
  const clear = ramp(frame, 32, 16); // 0→1 screen-clear progress
  const oldOpacity = clamp01(1 - clear);
  const cmd = typed("kingdom quickstart", frame - 6); // responds immediately

  const headRise = fadeUp(frame, 118, 28, 22);
  const cardRecede = clamp01(ramp(frame, 118, 38)); // 0→1
  const scrollHint = ramp(frame, 160, 14);

  return (
    <div style={{ position: "absolute", inset: 0, fontFamily: MONO }}>
      <Backdrop />

      {/* Quickstart heading rises above the card for the hand-off. */}
      <div
        style={{
          position: "absolute",
          top: "13%",
          left: 0,
          right: 0,
          textAlign: "center",
          ...headRise,
        }}
      >
        <p
          style={{
            margin: 0,
            fontFamily: MONO,
            fontSize: "clamp(10px, 1vw, 12px)",
            letterSpacing: "0.36em",
            textTransform: "uppercase",
            color: C.inkFaint,
          }}
        >
          Quickstart
        </p>
        <h2
          style={{
            margin: "12px 0 0",
            fontFamily: SANS,
            fontWeight: 560,
            fontSize: "clamp(22px, 3vw, 38px)",
            letterSpacing: "-0.02em",
            color: C.ink,
          }}
        >
          From zero to a working kingdom
        </h2>
      </div>

      {/* The terminal card, centered. */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <TermCard
          style={{
            width: "min(760px, 92vw)",
            // Stable height + top-aligned content so the manifest sits at the
            // top of the card (no empty band above it), terminal-style.
            minHeight: "clamp(232px, 30vh, 304px)",
            display: "flex",
            flexDirection: "column",
            justifyContent: "flex-start",
            padding: "clamp(28px, 3vw, 46px) clamp(34px, 3.4vw, 56px)",
            transform: `translateY(${cardRecede * 40}px) scale(${1 - cardRecede * 0.04})`,
            opacity: 1 - cardRecede * 0.12,
          }}
        >
          {/* ── Continuing session — wiped, then removed so the manifest
               takes the top of the card (fixes the empty band). ── */}
          {clear < 1 ? (
            <div style={{ position: "relative", opacity: oldOpacity }}>
              <Row>
                <span style={{ color: C.sage }}>$ </span>
                <span style={{ color: C.ink }}>kingdom summon</span>
              </Row>
              <Row>
                <span style={{ color: C.sage }}>✓ 3 epics · 11 tasks queued</span>
              </Row>
              <Row>
                <span style={{ color: C.sage }}>$ </span>
                <span style={{ color: C.ink }}>{cmd}</span>
                {frame >= 6 && frame < 40 ? <Caret color={C.sage} on /> : null}
              </Row>

              {/* Dim-green clear-screen scanline. */}
              {clear > 0 ? (
                <div
                  aria-hidden
                  style={{
                    position: "absolute",
                    left: -8,
                    right: -8,
                    top: `${clear * 100}%`,
                    height: 2,
                    background: C.sage,
                    boxShadow: `0 0 18px 2px ${C.sageSoft}`,
                    opacity: 0.9,
                  }}
                />
              ) : null}
            </div>
          ) : null}

          {/* ── The quickstart manifest — top-aligned, printed line by line. ── */}
          {clear >= 1 ? (
            <div>
              <Row opacity={ramp(frame, 48, 10)}>
                <span style={{ color: C.inkFaint }}>{"# 5 steps to your first run"}</span>
              </Row>
              {STEPS.map((s, i) => {
                const start = 54 + i * 12;
                if (frame < start) return null;
                const t = typed(`${s.title}`, frame - start, 1.4);
                const last = i === STEPS.length - 1;
                const typing = t.length < s.title.length;
                return (
                  <Row key={s.id} opacity={clamp01(ramp(frame, start, 6))}>
                    <span style={{ color: C.sage }}>{s.n}</span>
                    <span style={{ color: C.inkFaint }}>{"  "}</span>
                    <span style={{ color: C.ink }}>{t}</span>
                    {!typing && !compact ? (
                      <span style={{ color: C.inkFaint }}>
                        {"   ·   "}
                        {s.gloss}
                      </span>
                    ) : null}
                    {last && typing ? <Caret color={C.sage} /> : null}
                  </Row>
                );
              })}
            </div>
          ) : null}
        </TermCard>
      </div>

      {/* Scroll hand-off hint. */}
      <div
        style={{
          position: "absolute",
          bottom: "6%",
          left: 0,
          right: 0,
          textAlign: "center",
          fontFamily: MONO,
          fontSize: "clamp(10px, 0.9vw, 12px)",
          letterSpacing: "0.22em",
          textTransform: "uppercase",
          color: C.inkFaint,
          opacity: scrollHint,
        }}
      >
        keep scrolling ↓
      </div>
    </div>
  );
}
