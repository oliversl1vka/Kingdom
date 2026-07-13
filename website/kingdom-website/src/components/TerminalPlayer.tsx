"use client";

import { TerminalStage } from "@/remotion/driver";
import { type TerminalVariant } from "@/remotion/TerminalInstall";

// Live, looping terminal animation. Driven by a lightweight, refresh-rate
// independent frame loop (see driver.tsx) instead of @remotion/player, so it
// stays smooth on high-Hz displays and pauses cleanly when off-screen.
export function TerminalPlayer({
  variant = 1,
}: {
  variant?: TerminalVariant;
}) {
  return <TerminalStage variant={variant} />;
}
