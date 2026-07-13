import { test, expect } from "@playwright/test";
import { openHome, hasHorizontalScroll, docHeight, scrollToY } from "./helpers";

// ──────────────────────────────────────────────────────────────────────────
// Responsive correctness — pass/fail assertions that hold on EVERY project in
// the matrix (acceptance criterion #2): no horizontal scroll, nothing clipped
// off-screen, touch targets ≥44px, viewport meta present.
// ──────────────────────────────────────────────────────────────────────────

const isDesktop = (name: string) => name.startsWith("desktop-");

test("viewport meta enables safe-area (viewport-fit=cover)", async ({ page }) => {
  await openHome(page);
  const content = await page
    .locator('meta[name="viewport"]')
    .getAttribute("content");
  expect(content).toBeTruthy();
  expect(content).toContain("width=device-width");
  expect(content).toContain("viewport-fit=cover");
});

test("no horizontal scroll (top / bridge / docs)", async ({ page }) => {
  await openHome(page);
  expect(await hasHorizontalScroll(page), "hero top").toBe(false);

  const max = await docHeight(page);
  await scrollToY(page, Math.round(max * 0.5));
  expect(await hasHorizontalScroll(page), "bridge mid").toBe(false);

  await scrollToY(page, max);
  expect(await hasHorizontalScroll(page), "docs bottom").toBe(false);
});

test("hero title never overflows the viewport", async ({ page }) => {
  await openHome(page);
  const overflow = await page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    let worst = 0;
    for (const el of document.querySelectorAll(".hero-title-line")) {
      const r = el.getBoundingClientRect();
      worst = Math.max(worst, r.right - vw, -r.left);
    }
    return worst;
  });
  expect(overflow).toBeLessThanOrEqual(1);
});

test("touch targets are ≥44px on touch devices", async ({ page }, testInfo) => {
  test.skip(isDesktop(testInfo.project.name), "tap-target rule is for touch");
  await openHome(page);
  // Bring the docs nav (the densest cluster of links) into view.
  await page.locator("#install").scrollIntoViewIfNeeded();
  const tooSmall = await page.evaluate(() => {
    const sels = [".docs-nav-link", ".hero-eyebrow", ".hero-scroll-cue"];
    const bad: { sel: string; w: number; h: number }[] = [];
    for (const sel of sels) {
      for (const el of document.querySelectorAll(sel)) {
        const r = el.getBoundingClientRect();
        if (r.width === 0 && r.height === 0) continue; // not rendered here
        // A target passes if it is ≥44px on its smaller axis OR ≥44 tall
        // (links are wide but the constraint that bites on touch is height).
        if (r.height < 44 - 0.5) bad.push({ sel, w: Math.round(r.width), h: Math.round(r.height) });
      }
    }
    return bad;
  });
  expect(tooSmall, JSON.stringify(tooSmall)).toEqual([]);
});

test("corner badge stays on-screen", async ({ page }) => {
  await openHome(page);
  const ok = await page.evaluate(() => {
    const b = document.querySelector(".hero-badge");
    if (!b) return false;
    const r = b.getBoundingClientRect();
    return (
      r.left >= 0 &&
      r.bottom <= window.innerHeight + 1 &&
      r.right <= document.documentElement.clientWidth + 1
    );
  });
  expect(ok).toBe(true);
});
