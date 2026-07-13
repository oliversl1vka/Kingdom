"use client";

import { AnimStage } from "./AnimStage";
import { DOC_W, DOC_H } from "./shared";
import { DOC_COMPACT, type DocAnimId } from "./meta";
import { InstallAnim, INSTALL_FRAMES } from "./InstallAnim";
import { SetupAnim, SETUP_FRAMES } from "./SetupAnim";
import { DecreeAnim, DECREE_FRAMES } from "./DecreeAnim";
import { SummonAnim, SUMMON_FRAMES } from "./SummonAnim";
import { StatusAnim, STATUS_FRAMES } from "./StatusAnim";

export type { DocAnimId } from "./meta";

const REGISTRY: Record<
  DocAnimId,
  { Comp: React.FC; frames: number }
> = {
  install: { Comp: InstallAnim, frames: INSTALL_FRAMES },
  setup: { Comp: SetupAnim, frames: SETUP_FRAMES },
  decree: { Comp: DecreeAnim, frames: DECREE_FRAMES },
  summon: { Comp: SummonAnim, frames: SUMMON_FRAMES },
  status: { Comp: StatusAnim, frames: STATUS_FRAMES },
};

// One client boundary that renders the right play-once animation for a doc
// section. Server components (Docs) can drop this in by id.
export function DocAnim({ id }: { id: DocAnimId }) {
  const { Comp, frames } = REGISTRY[id];
  const compact = DOC_COMPACT[id];
  return (
    <AnimStage
      durationInFrames={frames}
      width={DOC_W}
      height={DOC_H}
      compactWidth={compact.w}
      compactHeight={compact.h}
    >
      <Comp />
    </AnimStage>
  );
}
