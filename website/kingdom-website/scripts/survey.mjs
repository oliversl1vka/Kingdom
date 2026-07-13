// Empirical responsive survey — measures the real breakages across breakpoints
// BEFORE any responsive fix, so the fixes target measured problems (not guesses).
// Run against the prod server: `node scripts/survey.mjs`
import { chromium, webkit } from "@playwright/test";
import { mkdirSync } from "node:fs";

const BASE = process.env.SURVEY_URL ?? "http://localhost:3100";
const OUT = "./playwright/survey";
mkdirSync(OUT, { recursive: true });

const VIEWPORTS = [
  { name: "360", w: 360, h: 800 },
  { name: "390", w: 390, h: 844 },
  { name: "430", w: 430, h: 932 },
  { name: "768", w: 768, h: 1024 },
  { name: "1024", w: 1024, h: 768 },
  { name: "1280", w: 1280, h: 800 },
  { name: "1440", w: 1440, h: 900 },
  { name: "1920", w: 1920, h: 1080 },
];

async function measure(page) {
  return page.evaluate(() => {
    const de = document.documentElement;
    const hScroll = de.scrollWidth - de.clientWidth;
    const titleLine = document.querySelector(".hero-title-line");
    const term = document.querySelector(".hero-terminal");
    const badge = document.querySelector(".hero-badge");
    const eyebrow = document.querySelector(".hero-eyebrow");
    const cue = document.querySelector(".hero-scroll-cue");
    const r = (el) => (el ? el.getBoundingClientRect() : null);
    const termW = term ? term.getBoundingClientRect().width : 0;
    const tlRect = r(titleLine);
    return {
      hScroll,
      scrollWidth: de.scrollWidth,
      clientWidth: de.clientWidth,
      titleOverflow: titleLine
        ? titleLine.scrollWidth - titleLine.clientWidth
        : null,
      titleLineRight: tlRect ? Math.round(tlRect.right) : null,
      heroTermWidth: Math.round(termW),
      // Effective on-screen px of the terminal's 26px canvas font.
      effTerminalFontPx: +(26 * (termW / 1280)).toFixed(1),
      badge: r(badge) && {
        left: Math.round(r(badge).left),
        bottom: Math.round(window.innerHeight - r(badge).bottom),
        size: Math.round(r(badge).width),
      },
      eyebrowFs: eyebrow
        ? getComputedStyle(eyebrow).fontSize
        : null,
      cuePresent: !!cue,
    };
  });
}

async function measureDocs(page) {
  return page.evaluate(() => {
    const anims = [...document.querySelectorAll(".docs-anim")];
    const w = anims[0] ? anims[0].getBoundingClientRect().width : 0;
    const nav = document.querySelector(".docs-nav");
    const navLinks = [...document.querySelectorAll(".docs-nav-link")];
    const minTap = navLinks.reduce((m, a) => {
      const r = a.getBoundingClientRect();
      return Math.min(m, Math.min(r.width, r.height));
    }, 999);
    const cmd = document.querySelector(".docs-cmd");
    const cmdOverflow = cmd ? cmd.scrollWidth - cmd.clientWidth : null;
    return {
      docsAnimWidth: Math.round(w),
      // 1000px-canvas; the King/counter use ~26px, task labels 21px.
      effDocsFontPx21: +(21 * (w / 1000)).toFixed(1),
      navWraps: nav ? nav.getBoundingClientRect().height : null,
      minNavTapPx: Math.round(minTap),
      cmdOverflow,
    };
  });
}

async function run(engine, label) {
  const browser = await engine.launch();
  const results = [];
  for (const vp of VIEWPORTS) {
    const ctx = await browser.newContext({
      viewport: { width: vp.w, height: vp.h },
      deviceScaleFactor: 1,
      hasTouch: vp.w < 1024,
      isMobile: vp.w < 1024,
    });
    const page = await ctx.newPage();
    await page.goto(BASE, { waitUntil: "load" });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(1200);
    const hero = await measure(page);
    await page.screenshot({ path: `${OUT}/${label}-${vp.name}-hero.png` });

    // jump to docs to measure them
    await page.evaluate(() => {
      const el = document.querySelector("#install");
      el?.scrollIntoView({ block: "center", behavior: "instant" });
    });
    await page.waitForTimeout(800);
    const docs = await measureDocs(page);
    await page.screenshot({ path: `${OUT}/${label}-${vp.name}-docs.png` });

    results.push({ vp: vp.name, ...hero, ...docs });
    await ctx.close();
  }
  await browser.close();
  console.log(`\n===== ${label} =====`);
  for (const r of results) {
    console.log(
      `${r.vp.padEnd(5)} hScroll=${String(r.hScroll).padStart(4)} ` +
        `titleOverflow=${String(r.titleOverflow).padStart(4)} ` +
        `termW=${String(r.heroTermWidth).padStart(4)} effTermFont=${String(r.effTerminalFontPx).padStart(5)} ` +
        `docsW=${String(r.docsAnimWidth).padStart(4)} effDocs21=${String(r.effDocsFontPx21).padStart(5)} ` +
        `navTap=${String(r.minNavTapPx).padStart(3)} cmdOvf=${String(r.cmdOverflow).padStart(4)} ` +
        `badge=${r.badge ? `${r.badge.left},${r.badge.bottom},${r.badge.size}` : "n/a"}`,
    );
  }
}

await run(chromium, "chromium");
await run(webkit, "webkit");
console.log("\nScreenshots →", OUT);
