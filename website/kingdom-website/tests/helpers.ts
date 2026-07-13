import { Page, expect } from "@playwright/test";

// ──────────────────────────────────────────────────────────────────────────
// Shared helpers for driving the KingdomOS single-page site to deterministic,
// screenshot-stable states.
//
// The hero terminal and the 5 docs animations are rAF-frame-driven and PLAY
// ONCE then FREEZE on their final frame — so "wait until settled" yields a
// stable image without faking the clock. The bridge is scroll-scrubbed, a pure
// function of the (Lenis-smoothed) scroll position, so we scroll to a target
// and wait for Lenis to converge before capturing.
// ──────────────────────────────────────────────────────────────────────────

export const DOC_IDS = ["install", "setup", "decree", "summon", "status"] as const;

/** Navigate, wait for fonts + first paint of the hero. */
export async function openHome(page: Page): Promise<void> {
  await page.goto("/", { waitUntil: "load" });
  await page.evaluate(() => (document as Document).fonts.ready);
  // Hero stage exists immediately (terminal mounts client-side after this).
  await page.locator(".hero-terminal").first().waitFor({ state: "visible" });
}

/**
 * Wait until the hero terminal has typed its final line and frozen. The last
 * SEQUENCE line is "✓ 3 epics · 11 tasks queued" — once that full string is in
 * the DOM the play-once timeline is at/after its last frame. A short tail wait
 * lets the caret freeze (caret is hidden in screenshots anyway).
 */
export async function settleHero(page: Page): Promise<void> {
  await expect(page.locator(".hero-terminal")).toContainText("11 tasks queued", {
    timeout: 45_000,
  });
  await page.waitForTimeout(800);
}

/**
 * Bring a docs section into view and let its play-once animation freeze.
 * The longest anim is ~144 frames (~4.8s at 30fps); 6s is a safe margin. The
 * IntersectionObserver only advances the timeline while ≥35% visible, so we
 * center the section first.
 */
export async function settleDocsAnim(
  page: Page,
  id: (typeof DOC_IDS)[number],
): Promise<void> {
  await page.locator(`#${id}`).scrollIntoViewIfNeeded();
  await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    el?.scrollIntoView({ block: "center", behavior: "instant" as ScrollBehavior });
  }, `#${id}`);
  await waitForScrollSettled(page);
  await page.waitForTimeout(6000); // play-once freeze
}

/**
 * Scroll to an absolute document position and wait for Lenis' eased scroll to
 * converge there, so a scroll-scrubbed frame is stable before capture.
 */
export async function scrollToY(page: Page, y: number): Promise<void> {
  await page.evaluate((top) => {
    // Native jump; Lenis' animatedScroll eases onto it within a few rAF ticks.
    window.scrollTo({ top, left: 0, behavior: "instant" as ScrollBehavior });
  }, y);
  await waitForScrollSettled(page);
}

/** Resolve once window.scrollY has stopped changing (Lenis lerp converged). */
export async function waitForScrollSettled(page: Page): Promise<void> {
  await page.waitForFunction(
    () => {
      const w = window as unknown as { __lastY?: number; __stableN?: number };
      const y = window.scrollY;
      if (w.__lastY !== undefined && Math.abs(w.__lastY - y) < 0.5) {
        w.__stableN = (w.__stableN ?? 0) + 1;
      } else {
        w.__stableN = 0;
      }
      w.__lastY = y;
      return (w.__stableN ?? 0) > 6;
    },
    undefined,
    { timeout: 10_000, polling: 50 },
  );
  await page.waitForTimeout(150);
}

/** Total scrollable height of the document. */
export function docHeight(page: Page): Promise<number> {
  return page.evaluate(
    () => document.documentElement.scrollHeight - window.innerHeight,
  );
}

/** True if the page scrolls horizontally (a responsive defect). */
export async function hasHorizontalScroll(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const de = document.documentElement;
    // 1px tolerance for sub-pixel rounding.
    return de.scrollWidth > de.clientWidth + 1;
  });
}

/**
 * The scrollY range over which the bridge's sticky pane is pinned, i.e.
 * [trackTop, trackTop + trackHeight − viewportHeight]. Sampling inside this
 * range is the correct way to assert pinning regardless of how tall the docs
 * below are (which shifts where the bridge sits as a fraction of total scroll).
 */
export async function bridgePinRange(page: Page): Promise<{ start: number; end: number }> {
  return page.evaluate(() => {
    const track = document.querySelector("[data-bridge-stage]") as HTMLElement;
    const top = track.getBoundingClientRect().top + window.scrollY;
    return { start: Math.round(top), end: Math.round(top + track.offsetHeight - window.innerHeight) };
  });
}

/** The viewport-relative bounding rect of the bridge's sticky (pinned) pane. */
export async function bridgePaneRect(page: Page) {
  return page.evaluate(() => {
    const track = document.querySelector("[data-bridge-stage]");
    const pane = track?.firstElementChild as HTMLElement | undefined;
    if (!pane) return null;
    const r = pane.getBoundingClientRect();
    return { top: r.top, left: r.left, width: r.width, height: r.height };
  });
}
