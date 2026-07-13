import { TerminalPlayer } from "@/components/TerminalPlayer";
import {
  VARIANT_FRAMES,
  type TerminalVariant,
} from "@/remotion/variants-meta";

// KingdomOS — single hero screen. Dark terminal theme (minimal black &
// white). The terminal panel is a live Remotion composition; its
// rounding / shadow / backdrop glow come from the chosen variant so the
// frosted treatments can refract the page behind them.
export function Hero({
  variant = 1,
  label,
  scrollCue = false,
}: {
  variant?: TerminalVariant;
  label?: string;
  scrollCue?: boolean;
}) {
  const frame = VARIANT_FRAMES[variant];

  return (
    <section className="hero-root">
      {label ? <span className="hero-variant-label">{label}</span> : null}

      {/* Eyebrow — links to the GitHub repo */}
      <a
        className="hero-eyebrow"
        href="https://github.com/oliversl1vka/Kingdom"
        target="_blank"
        rel="noopener noreferrer"
      >
        github.com/oliversl1vka/Kingdom
      </a>

      {/* Title */}
      <h1 className="hero-title">
        <span className="hero-title-line">
          Your Agents. <span className="hero-title-accent">Your Terminal.</span>
        </span>
        <span className="hero-title-line">Your Kingdom.</span>
      </h1>

      {/* Subtitle */}
      <p className="hero-subtitle">
        Plan, execute, review, heal — all from the command line. No browser
        required. No babysitting needed.
      </p>

      {/* Live terminal animation */}
      <div className="hero-stage">
        {frame.glow ? (
          <div
            className="hero-glow"
            aria-hidden="true"
            style={{ background: frame.glow }}
          />
        ) : null}
        <div
          className="hero-terminal"
          aria-hidden="true"
          style={{
            borderRadius: frame.radius,
            boxShadow: frame.shadow,
            border: frame.border,
            background: frame.frameBg,
          }}
        >
          <TerminalPlayer variant={variant} />
        </div>
      </div>

      {/* Scroll cue → quickstart docs (home page only) */}
      {scrollCue ? (
        <a className="hero-scroll-cue" href="#quickstart">
          Quickstart <span aria-hidden="true">↓</span>
        </a>
      ) : null}

      {/* Corner badge */}
      <div className="hero-badge" aria-hidden="true">
        N
      </div>
    </section>
  );
}
