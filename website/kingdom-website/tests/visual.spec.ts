import { test, expect } from "@playwright/test";
import {
  openHome,
  settleHero,
  settleDocsAnim,
  scrollToY,
  docHeight,
  DOC_IDS,
} from "./helpers";

// ──────────────────────────────────────────────────────────────────────────
// Visual regression.
//
// Desktop projects (desktop-*): baselines are generated from the v1 tag
// (website-v1-desktop worktree on :3200) — so these assertions ENFORCE that the
// responsive branch renders ≥1280px pixel-identically to v1 (THE unbreakable
// rule). Tolerance is ~0.
//
// Mobile/tablet projects: baselines are generated from THIS branch — they guard
// the responsive layouts against future regressions (v1's mobile was broken, so
// it is not a meaningful baseline there).
//
// Every captured surface is at a DETERMINISTIC settled frame: the hero terminal
// and each docs animation play once and freeze on their last frame; the bridge
// is a pure function of scroll position.
// ──────────────────────────────────────────────────────────────────────────

const isDesktop = (name: string) => name.startsWith("desktop-");

test.describe("visual regression", () => {
  test("hero (settled)", async ({ page }, testInfo) => {
    await openHome(page);
    await settleHero(page);
    // Desktop enforces v1 identity (~0). Mobile tolerance is looser to absorb
    // sub-pixel anti-aliasing of thin graph lines on high-DPR phones (e.g. the
    // Summon connectors at dpr3) — still tight enough to catch real regressions.
    const ratio = isDesktop(testInfo.project.name) ? 0.001 : 0.04;
    await expect(page.locator(".hero-root")).toHaveScreenshot("hero.png", {
      maxDiffPixelRatio: ratio,
    });
  });

  for (const id of DOC_IDS) {
    test(`docs section · ${id} (settled)`, async ({ page }, testInfo) => {
      await openHome(page);
      await settleDocsAnim(page, id);
      // Desktop enforces v1 identity (~0). Mobile tolerance is looser to absorb
    // sub-pixel anti-aliasing of thin graph lines on high-DPR phones (e.g. the
    // Summon connectors at dpr3) — still tight enough to catch real regressions.
    const ratio = isDesktop(testInfo.project.name) ? 0.001 : 0.04;
      await expect(page.locator(`#${id}`)).toHaveScreenshot(`docs-${id}.png`, {
        maxDiffPixelRatio: ratio,
      });
    });
  }

  // Bridge: sample the scroll-scrubbed transition at three points. The pinned
  // pane fills the viewport, so a viewport screenshot captures the composition.
  for (const [label, frac] of [
    ["intro", 0.12],
    ["manifest", 0.55],
    ["heading", 0.92],
  ] as const) {
    test(`bridge · ${label}`, async ({ page }, testInfo) => {
      await openHome(page);
      const max = await docHeight(page);
      // The bridge track sits between the hero and docs; sampling absolute
      // document fractions lands inside it for both v1 and the branch (same
      // track height at desktop).
      await scrollToY(page, Math.round(max * frac));
      const ratio = isDesktop(testInfo.project.name) ? 0.002 : 0.03;
      await expect(page).toHaveScreenshot(`bridge-${label}.png`, {
        maxDiffPixelRatio: ratio,
        fullPage: false,
      });
    });
  }
});
