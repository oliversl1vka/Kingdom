// Server-safe variant metadata — NO Remotion import, so the Hero (a server
// component) can read frame hints without dragging the Remotion runtime (which
// needs React.createContext / a client component) into the server bundle. The
// visual composition itself lives in TerminalInstall.

export type TerminalVariant = 1 | 2 | 3 | 4 | 5;

// Frame (the surrounding clipped container) presentation — each variant brings
// its own rounding / shadow / optional colour glow bled behind the card.
export interface FrameHint {
  radius: number;
  shadow: string;
  border: string;
  glow?: string;
  // Opaque base painted on the clipped container so the backdrop `glow`
  // shows only as a halo AROUND the card, never bleeding over its face
  // while the composition springs in. Omitted for frosted variants, whose
  // whole point is to let the glow refract through.
  frameBg?: string;
}

const SHADOW_SOFT =
  "0 44px 90px -52px rgba(0,0,0,0.85), 0 12px 32px -22px rgba(0,0,0,0.55)";
const SHADOW_MAC =
  "0 30px 70px -42px rgba(0,0,0,0.9), 0 8px 24px -16px rgba(0,0,0,0.65)";

export const VARIANT_FRAMES: Record<TerminalVariant, FrameHint> = {
  1: {
    radius: 26,
    shadow: SHADOW_SOFT,
    border: "1px solid rgba(255,255,255,0.08)",
    frameBg: "#0E0E0E",
  },
  2: {
    radius: 14,
    shadow: SHADOW_MAC,
    border: "1px solid rgba(255,255,255,0.10)",
    frameBg: "#0E0E0E",
  },
  3: {
    radius: 18,
    shadow:
      "0 40px 80px -46px rgba(0,0,0,0.9), 0 8px 24px -16px rgba(0,0,0,0.6)",
    border: "1px solid rgba(255,255,255,0.16)",
    glow: "radial-gradient(70% 80% at 50% 30%, rgba(255,255,255,0.10), rgba(255,255,255,0.05), transparent 75%)",
  },
  4: {
    radius: 12,
    shadow: SHADOW_MAC,
    border: "1px solid rgba(255,255,255,0.10)",
    frameBg: "#0E0E0E",
  },
  5: {
    radius: 20,
    shadow: SHADOW_SOFT,
    border: "1px solid rgba(255,255,255,0.08)",
    frameBg: "#0E0E0E",
  },
};

export const VARIANT_LIST: {
  id: TerminalVariant;
  label: string;
  blurb: string;
}[] = [
  {
    id: 1,
    label: "Soft",
    blurb:
      "Chromeless near-black card with a dim terminal-green accent and calm whitespace.",
  },
  {
    id: 2,
    label: "macOS",
    blurb:
      "Realistic macOS window — accurate traffic lights, flat dark title bar, white accent.",
  },
  {
    id: 3,
    label: "Frosted",
    blurb:
      "Modern macOS vibrancy — the whole card is frosted dark glass that refracts the page behind it.",
  },
  {
    id: 4,
    label: "Editor",
    blurb:
      "Developer-tool feel — an IDE-style tab bar with a filename tab above the session.",
  },
  {
    id: 5,
    label: "Label",
    blurb:
      "Ultra-minimal dark card with a slim labelled header — premium and quiet, green accent.",
  },
];
