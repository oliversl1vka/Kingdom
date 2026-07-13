import { test, expect } from "@playwright/test";
import { openHome, waitForScrollSettled, DOC_IDS } from "./helpers";

// ──────────────────────────────────────────────────────────────────────────
// Every link works on every device (acceptance #5): external repo links carry
// the right href + safe rel, and the in-page anchors (Lenis anchors:true) glide
// the section to the top.
// ──────────────────────────────────────────────────────────────────────────

const REPO = "https://github.com/oliversl1vka/Kingdom";

test("external repo links (eyebrow + footer) are correct & safe", async ({ page }) => {
  await openHome(page);

  const eyebrow = page.locator("a.hero-eyebrow");
  await expect(eyebrow).toHaveAttribute("href", REPO);
  await expect(eyebrow).toHaveAttribute("target", "_blank");
  await expect(eyebrow).toHaveAttribute("rel", /noopener/);

  const footer = page.locator(".docs-foot a");
  await expect(footer).toHaveAttribute("href", REPO);
  await expect(footer).toHaveAttribute("rel", /noopener/);
});

test("hero scroll cue anchors to #quickstart", async ({ page }) => {
  await openHome(page);
  await expect(page.locator("a.hero-scroll-cue")).toHaveAttribute(
    "href",
    "#quickstart",
  );
  // The quickstart section exists as the anchor target.
  await expect(page.locator("#quickstart")).toHaveCount(1);
});

test("docs nav links exist for all five steps and target real sections", async ({ page }) => {
  await openHome(page);
  for (const id of DOC_IDS) {
    const link = page.locator(`.docs-nav-link[href="#${id}"]`);
    await expect(link, `nav link #${id}`).toHaveCount(1);
    await expect(page.locator(`#${id}`), `section #${id}`).toHaveCount(1);
  }
});

test("clicking a docs nav link scrolls that section to the top", async ({ page }) => {
  await openHome(page);
  // The jump-nav is intentionally removed on phones (≤600px) — skip there.
  const navShown = await page.locator(".docs-nav").isVisible();
  test.skip(!navShown, "jump-nav is hidden on phones (by design)");
  // Bring the sticky jump-nav into view first (as a user does on reaching the
  // docs) — clicking an off-screen link races Playwright's scroll-into-view
  // against Lenis. With the nav in view, the Lenis anchor glide is reliable.
  await page.locator("#quickstart").scrollIntoViewIfNeeded();
  await waitForScrollSettled(page);

  await page.locator('.docs-nav-link[href="#summon"]').click();
  await waitForScrollSettled(page);
  // Give Lenis' eased anchor scroll time to converge, then settle.
  await page.waitForTimeout(400);
  await waitForScrollSettled(page);

  const top = await page.evaluate(() => {
    const el = document.querySelector("#summon");
    return el ? el.getBoundingClientRect().top : 99999;
  });
  // Lands clear of the sticky nav (scroll-margin-top: 84px desktop, 112/176px
  // on smaller screens where the nav is taller).
  expect(top).toBeGreaterThanOrEqual(-4);
  expect(top).toBeLessThanOrEqual(200);
});
