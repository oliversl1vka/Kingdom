import { test, expect } from "@playwright/test";
import {
  openHome,
  settleHero,
  settleDocsAnim,
  scrollToY,
  bridgePaneRect,
  bridgePinRange,
  waitForScrollSettled,
} from "./helpers";

// ──────────────────────────────────────────────────────────────────────────
// Animation BEHAVIOUR (engine-agnostic; runs on Blink/WebKit/Gecko + touch).
// Motion can't be judged from one frame, so these assert the structural
// invariants that make each animation correct.
// ──────────────────────────────────────────────────────────────────────────

test("hero terminal types out fully and freezes (plays once)", async ({ page }) => {
  await openHome(page);
  await settleHero(page);
  // Final line present …
  await expect(page.locator(".hero-terminal")).toContainText("11 tasks queued");
  // … and stays put (no loop): same text a second later.
  await page.waitForTimeout(1200);
  await expect(page.locator(".hero-terminal")).toContainText("11 tasks queued");
});

test("bridge PINS its sticky pane through the scrub (iOS-critical)", async ({ page }) => {
  await openHome(page);
  // Sample WITHIN the actual pin range (independent of how tall the docs are).
  const { start, end } = await bridgePinRange(page);
  for (const frac of [0.2, 0.5, 0.8]) {
    await scrollToY(page, Math.round(start + (end - start) * frac));
    const rect = await bridgePaneRect(page);
    expect(rect, "bridge pane present").not.toBeNull();
    // Pinned: the pane's top edge tracks the viewport top (±2px).
    expect(Math.abs(rect!.top), `pinned at frac ${frac}`).toBeLessThanOrEqual(2);
    // Fills the viewport height (the pinned stage is 100dvh).
    expect(rect!.height).toBeGreaterThan(page.viewportSize()!.height * 0.9);
  }
});

test("bridge SCRUBS — the composition changes with scroll", async ({ page }) => {
  await openHome(page);
  // Two DIFFERENT scroll positions inside the pin range → two different scrubbed
  // frames. Capture the viewport (not the element — an element screenshot would
  // re-scroll it into view and defeat the test).
  const { start, end } = await bridgePinRange(page);
  await scrollToY(page, Math.round(start + (end - start) * 0.25));
  const early = await page.screenshot();
  await scrollToY(page, Math.round(start + (end - start) * 0.75));
  const late = await page.screenshot();

  expect(Buffer.compare(early, late)).not.toBe(0);
});

test("prefers-reduced-motion collapses the bridge", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await openHome(page);
  const { trackH, vh } = await page.evaluate(() => ({
    trackH: (document.querySelector("[data-bridge-stage]") as HTMLElement)
      .offsetHeight,
    vh: window.innerHeight,
  }));
  // Collapsed to a single screen (was ~564vh when animated).
  expect(trackH).toBeLessThanOrEqual(vh * 1.2);
});

test("each docs animation plays once and freezes on its final frame", async ({ page }) => {
  await openHome(page);
  for (const id of ["install", "setup", "decree", "summon", "status"] as const) {
    await settleDocsAnim(page, id);
    const a = await page.locator(`#${id} .docs-anim`).screenshot();
    await page.waitForTimeout(1000);
    const b = await page.locator(`#${id} .docs-anim`).screenshot();
    // Frozen: identical a moment later (no loop, no drift).
    expect(Buffer.compare(a, b), `${id} frozen`).toBe(0);
  }
});

test("step-04 (summon) graph builds; chip syncs on desktop, hidden on phones", async ({ page }) => {
  await openHome(page);
  await settleDocsAnim(page, "summon");
  const anim = page.locator("#summon .docs-anim");
  // The graph + counter are present on every device.
  await expect(anim).toContainText("11 tasks queued");

  const isPhone = (page.viewportSize()?.width ?? 9999) <= 600;
  if (isPhone) {
    // Phones: the "Objective decomposed" chip is intentionally removed.
    await expect(anim).not.toContainText("Objective decomposed");
  } else {
    // Desktop/tablet: the ring resolves to the synced chip. The ring fill +
    // resolve are frame-driven, so this end state is identical on every engine
    // (the sync cannot drift per-engine).
    await expect(anim).toContainText("Objective decomposed");
  }
});

test("docs animations pause until scrolled into view", async ({ page }) => {
  await openHome(page);
  // The last section's anim should NOT have completed while still off-screen.
  await waitForScrollSettled(page);
  const startedOffscreen = await page.evaluate(() => {
    const el = document.querySelector("#status .docs-anim");
    return el ? el.textContent?.includes("142,338") : false;
  });
  expect(startedOffscreen).toBeFalsy();
});
