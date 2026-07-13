// Server-safe doc-animation metadata. Kept OUT of the "use client" DocAnim
// module so the server component <Docs> can import the real values (importing
// non-component data from a client module yields a client reference, not the
// object — that previously crashed prerendering).

export type DocAnimId = "install" | "setup" | "decree" | "summon" | "status";

// Per-animation phone canvas dimensions. Each composition has a dedicated
// compact (portrait/squarer) layout drawn for these dims; the value also feeds
// the matching `.docs-anim` aspect-ratio in Docs.tsx so the scaled canvas fills
// its box with no letterboxing. Single source of truth.
export const DOC_COMPACT: Record<DocAnimId, { w: number; h: number }> = {
  install: { w: 540, h: 600 },
  setup: { w: 540, h: 640 },
  decree: { w: 560, h: 560 },
  summon: { w: 620, h: 470 },
  status: { w: 540, h: 560 },
};
