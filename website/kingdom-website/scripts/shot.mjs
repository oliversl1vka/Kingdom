// Flexible settled-state screenshotter for eyeballing during development.
//   node scripts/shot.mjs <engine> <W>x<H> [<W>x<H> ...] [--docs] [--tag NAME]
// Captures the hero AFTER the terminal has fully typed + frozen (deterministic),
// and optionally each docs section after its play-once anim settles.
import { chromium, webkit, firefox } from "@playwright/test";
import { mkdirSync } from "node:fs";

const ENGINES = { chromium, webkit, firefox };
const args = process.argv.slice(2);
const engine = ENGINES[args[0]] ?? chromium;
const engName = ENGINES[args[0]] ? args[0] : "chromium";
const docs = args.includes("--docs");
const tagIdx = args.indexOf("--tag");
const tag = tagIdx >= 0 ? args[tagIdx + 1] : "shot";
const vps = args
  .slice(1)
  .filter((a) => /^\d+x\d+$/.test(a))
  .map((s) => s.split("x").map(Number));

const BASE = process.env.SURVEY_URL ?? "http://localhost:3100";
const OUT = "./playwright/shots";
mkdirSync(OUT, { recursive: true });

const b = await engine.launch();
for (const [w, h] of vps) {
  const ctx = await b.newContext({
    viewport: { width: w, height: h },
    isMobile: w < 1024,
    hasTouch: w < 1024,
    deviceScaleFactor: w < 600 ? 2 : 1,
  });
  const p = await ctx.newPage();
  await p.goto(BASE, { waitUntil: "load" });
  await p.evaluate(() => document.fonts.ready);
  // hero settle: last line typed
  try {
    await p.locator(".hero-terminal").getByText("11 tasks queued").waitFor({ timeout: 30000 });
  } catch {
    await p.waitForTimeout(18000);
  }
  await p.waitForTimeout(700);
  await p.screenshot({ path: `${OUT}/${tag}-${engName}-${w}-hero.png` });
  console.log(`${engName} ${w}x${h} hero ✓`);

  if (docs) {
    for (const id of ["install", "setup", "decree", "summon", "status"]) {
      await p.evaluate((s) => {
        document.querySelector(s)?.scrollIntoView({ block: "center", behavior: "instant" });
      }, `#${id}`);
      await p.waitForTimeout(6000);
      await p.screenshot({ path: `${OUT}/${tag}-${engName}-${w}-${id}.png` });
      console.log(`${engName} ${w}x${h} ${id} ✓`);
    }
  }
  await ctx.close();
}
await b.close();
console.log("→", OUT);
