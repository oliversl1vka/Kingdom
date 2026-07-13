// Shared design tokens for the KingdomOS hero — dark terminal theme
// (minimal black & white). Kept in one module so the Remotion composition
// and the surrounding page stay perfectly in sync (single source of truth).
// The previous light "parchment" palette is archived at
// archive/website-light-theme-2026-06-09/.

export const COLORS = {
  // Page / card surfaces
  bg: "#0A0A0A",
  bgDeep: "#050505",
  surface: "#111111",
  surfaceRaised: "#161616",

  // Foreground "ink" — light on dark
  ink: "#E6E6E6",
  inkSoft: "#9A9A9A",
  inkFaint: "#555555",

  // Hairline borders
  hair: "#2A2A2A",

  // Accent — emphasis is brightness, not hue
  accent: "#FFFFFF",
  accentDeep: "#D4D4D4",

  // Terminal traffic-light dots — accurate modern macOS (Big Sur+) colours
  dotRed: "#FF5F57",
  dotAmber: "#FEBC2E",
  dotGreen: "#28C840",

  // Terminal text
  termInk: "#D6D6D6",
  termPrompt: "#FFFFFF",
  termOk: "#4ADE80", // the single restrained accent — dim terminal green
  termMuted: "#707070",
} as const;

export const MONO =
  "var(--font-geist-mono), 'JetBrains Mono', ui-monospace, 'SFMono-Regular', Menlo, monospace";

export const SANS =
  "var(--font-geist-sans), ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif";

// Composition timing
export const FPS = 30;
export const HERO_DURATION_IN_FRAMES = 520;
export const HERO_WIDTH = 1280;
export const HERO_HEIGHT = 720;

// ── Compact (phone) mode ───────────────────────────────────────
// The decorative fixed-canvas compositions swap to a denser, larger-typed
// layout below this viewport width. The SAME px value gates the matching CSS
// (aspect-ratio overrides in globals.css) so the JS canvas choice and the CSS
// container aspect can never disagree at the boundary.
export const COMPACT_MAX_PX = 600;
export const COMPACT_QUERY = `(max-width: ${COMPACT_MAX_PX}px)`;

// Portrait canvas for the hero terminal on phones — taller so all ten lines fit
// with comfortably large type (≈22px design → ~13–22px on-screen on phones).
export const HERO_COMPACT_WIDTH = 560;
export const HERO_COMPACT_HEIGHT = 720;
