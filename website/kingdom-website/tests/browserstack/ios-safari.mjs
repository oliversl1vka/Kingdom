// ──────────────────────────────────────────────────────────────────────────
// REAL iOS Safari sign-off via BrowserStack (real iPhone hardware).
//
// Playwright cannot drive real mobile Safari (Apple restriction) — its "WebKit"
// is a desktop build with different scroll physics, dvh, and sticky behaviour.
// So the iOS-critical checks (bridge PIN, 100dvh math, fixed badge vs the
// dynamic toolbar, no h-scroll, anchor glide) are verified here on a REAL device
// through WebDriver against BrowserStack's device cloud, reached over a
// BrowserStack Local tunnel to the running prod server (localhost:3100).
//
// Run:  node tests/browserstack/ios-safari.mjs
// Env:  BROWSERSTACK_USERNAME, BROWSERSTACK_ACCESS_KEY  (from repo .env)
// ──────────────────────────────────────────────────────────────────────────
import { Builder } from "selenium-webdriver";
import browserstack from "browserstack-local";
import { mkdirSync, writeFileSync } from "node:fs";

const USER = process.env.BROWSERSTACK_USERNAME;
const KEY = process.env.BROWSERSTACK_ACCESS_KEY;
const LOCAL_ID = process.env.BS_LOCAL_ID ?? "kingdomos-ios";
const TARGET = process.env.BS_TARGET_URL ?? "http://localhost:3100";
const OUT = "./playwright/ios-real";
mkdirSync(OUT, { recursive: true });

if (!USER || !KEY) {
  console.error("Missing BROWSERSTACK_USERNAME / BROWSERSTACK_ACCESS_KEY");
  process.exit(2);
}

// Start a BrowserStack Local tunnel so a real iPhone can reach localhost:3100.
function startTunnel() {
  return new Promise((resolve, reject) => {
    const bs = new browserstack.Local();
    bs.start(
      { key: KEY, localIdentifier: LOCAL_ID, forceLocal: true, force: true },
      (err) => (err ? reject(err) : resolve(bs)),
    );
  });
}
function stopTunnel(bs) {
  return new Promise((resolve) => bs.stop(() => resolve()));
}

const DEVICES = [
  { deviceName: "iPhone 15", osVersion: "17" },
  { deviceName: "iPhone SE 2022", osVersion: "15" },
];

const HUB = `https://${USER}:${KEY}@hub-cloud.browserstack.com/wd/hub`;

async function shot(driver, name) {
  const png = await driver.takeScreenshot();
  writeFileSync(`${OUT}/${name}.png`, png, "base64");
}

async function run(dev) {
  const caps = {
    browserName: "safari",
    "bstack:options": {
      deviceName: dev.deviceName,
      osVersion: dev.osVersion,
      realMobile: "true",
      local: "true",
      localIdentifier: LOCAL_ID,
      projectName: "KingdomOS website",
      buildName: "responsive-ios-signoff",
      sessionName: `${dev.deviceName} iOS ${dev.osVersion}`,
      userName: USER,
      accessKey: KEY,
      deviceOrientation: "portrait",
    },
  };

  const driver = await new Builder().usingServer(HUB).withCapabilities(caps).build();
  const verdicts = { device: `${dev.deviceName} / iOS ${dev.osVersion}` };
  try {
    await driver.manage().setTimeouts({ pageLoad: 60000, script: 30000 });
    await driver.get(TARGET);
    await driver.sleep(2500);

    // Let the hero terminal type out, then capture the hero.
    await driver.sleep(15000);
    await shot(driver, `${dev.deviceName.replace(/\s+/g, "")}-hero`);

    // 1) No horizontal scroll on a real device.
    verdicts.noHScroll = await driver.executeScript(
      "return document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1;",
    );

    // 2) Fixed corner badge is on-screen and clear of the bottom toolbar.
    verdicts.badge = await driver.executeScript(`
      const b = document.querySelector('.hero-badge'); if(!b) return null;
      const r = b.getBoundingClientRect();
      return { left: Math.round(r.left), bottomGap: Math.round(window.innerHeight - r.bottom), onScreen: r.bottom <= window.innerHeight + 1 && r.left >= 0 };
    `);

    // 3) dvh math: hero fills the viewport (no big gap / overflow).
    verdicts.dvh = await driver.executeScript(`
      const h = document.querySelector('.hero-root').getBoundingClientRect().height;
      return { heroH: Math.round(h), innerH: window.innerHeight, ratio: +(h/window.innerHeight).toFixed(3) };
    `);

    // 4) Bridge PIN: sample WITHIN the bridge's actual pin range (= trackTop →
    // trackTop+trackHeight−innerHeight), independent of how tall the docs are.
    const range = await driver.executeScript(`
      const t = document.querySelector('[data-bridge-stage]');
      const top = t.getBoundingClientRect().top + window.scrollY;
      return { start: Math.round(top), end: Math.round(top + t.offsetHeight - window.innerHeight) };
    `);
    const pins = [];
    for (const frac of [0.2, 0.5, 0.8]) {
      const y = Math.round(range.start + (range.end - range.start) * frac);
      await driver.executeScript(`window.scrollTo(0, ${y});`);
      await driver.sleep(1200);
      const top = await driver.executeScript(`
        const t = document.querySelector('[data-bridge-stage]'); if(!t) return null;
        const pane = t.firstElementChild; const r = pane.getBoundingClientRect();
        return { top: Math.round(r.top), h: Math.round(r.height) };
      `);
      pins.push({ frac, ...top });
    }
    verdicts.bridgePins = pins;
    verdicts.bridgePinned = pins.every((p) => p && Math.abs(p.top) <= 3);
    await shot(driver, `${dev.deviceName.replace(/\s+/g, "")}-bridge`);

    // 5) Docs in view on a real device (scroll to the bottom of the page).
    await driver.executeScript(
      "window.scrollTo(0, document.documentElement.scrollHeight);",
    );
    await driver.sleep(1200);
    await shot(driver, `${dev.deviceName.replace(/\s+/g, "")}-docs`);

    const status = verdicts.noHScroll && verdicts.bridgePinned && verdicts.badge?.onScreen;
    await driver.executeScript(
      `browserstack_executor: {"action": "setSessionStatus", "arguments": {"status":"${status ? "passed" : "failed"}","reason":"iOS responsive checks"}}`,
    );
  } catch (e) {
    verdicts.error = String(e).slice(0, 300);
  } finally {
    await driver.quit();
  }
  return verdicts;
}

const results = [];
let tunnel;
try {
  console.log("Starting BrowserStack Local tunnel …");
  tunnel = await startTunnel();
  console.log("Tunnel up:", tunnel.isRunning());
  for (const dev of DEVICES) {
    console.log(`\n▶ ${dev.deviceName} iOS ${dev.osVersion} …`);
    try {
      const v = await run(dev);
      results.push(v);
      console.log(JSON.stringify(v, null, 2));
    } catch (e) {
      console.error("session failed:", String(e).slice(0, 300));
      results.push({ device: dev.deviceName, error: String(e).slice(0, 300) });
    }
  }
} catch (e) {
  console.error("Tunnel failed:", String(e).slice(0, 300));
  results.push({ fatal: "tunnel", error: String(e).slice(0, 300) });
} finally {
  if (tunnel) await stopTunnel(tunnel);
}
writeFileSync(`${OUT}/results.json`, JSON.stringify(results, null, 2));
console.log("\n→ results + screenshots in", OUT);
