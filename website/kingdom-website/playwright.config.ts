import { defineConfig, devices } from "@playwright/test";

// ──────────────────────────────────────────────────────────────────────────
// KingdomOS website — responsive / cross-browser verification matrix.
//
// Engines:  Chromium (Blink — also represents Edge/Brave),
//           Firefox  (Gecko),
//           WebKit   (Apple's engine — closest local proxy for Safari; real
//                     iOS Safari is verified separately on BrowserStack, see
//                     tests/browserstack/ and RESPONSIVE-REPORT.md).
//
// The site is a single long-scroll page whose hero terminal + 5 docs
// animations are rAF-frame-driven (NOT CSS), and whose hero→quickstart bridge
// is scroll-scrubbed. Plain `animations:'disabled'` cannot freeze rAF/scroll
// motion, so the specs drive each composition to its deterministic *settled*
// frame (play-once compositions freeze on their last frame; the bridge is a
// pure function of scrollY) before asserting — see tests/helpers.ts.
//
// Screenshots are captured against a PRODUCTION build (`next start`) so there
// is no dev overlay/indicator polluting the corner badge or the captures.
// ──────────────────────────────────────────────────────────────────────────

const PORT = Number(process.env.PW_PORT ?? 3100);
// PW_BASE_URL points the suite at an already-running server (used to generate
// the v1 baselines from the website-v1-desktop worktree on :3200). When set,
// the managed webServer is skipped.
const EXTERNAL_BASE = process.env.PW_BASE_URL;
export const BASE_URL = EXTERNAL_BASE ?? `http://localhost:${PORT}`;

// A custom Android tablet (Chromium) — Playwright has no built-in descriptor.
const androidTablet = {
  ...devices["Galaxy Tab S4"],
};

export default defineConfig({
  testDir: "./tests",
  // Visual-regression baselines live next to the specs, keyed by project.
  snapshotPathTemplate:
    "{testDir}/__screenshots__/{testFilePath}/{arg}-{projectName}{ext}",
  outputDir: "./playwright/test-results",
  fullyParallel: false, // long-running animation waits — keep machine calm
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : 4,
  timeout: 90_000, // hero terminal alone takes ~17s to settle
  expect: {
    timeout: 15_000,
    toHaveScreenshot: {
      // Default tolerance; the desktop-regression spec tightens this to
      // ~0 to enforce the "v1 is sacred" pixel-identity rule at ≥1280px.
      maxDiffPixelRatio: 0.01,
      animations: "disabled",
      caret: "hide",
    },
  },
  reporter: [
    ["list"],
    ["html", { outputFolder: "./playwright/report", open: "never" }],
  ],
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    video: "on",
    screenshot: "only-on-failure",
  },

  projects: [
    // ── Desktop — the SACRED tier. ≥1280px must match v1 baselines. ──────────
    {
      name: "desktop-chromium-1920",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1920, height: 1080 } },
    },
    {
      name: "desktop-chromium-1440",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
    },
    {
      name: "desktop-chromium-1280",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } },
    },
    {
      name: "desktop-firefox-1440",
      use: { ...devices["Desktop Firefox"], viewport: { width: 1440, height: 900 } },
    },
    {
      name: "desktop-firefox-1280",
      use: { ...devices["Desktop Firefox"], viewport: { width: 1280, height: 800 } },
    },
    {
      name: "desktop-webkit-1440",
      use: { ...devices["Desktop Safari"], viewport: { width: 1440, height: 900 } },
    },
    {
      name: "desktop-webkit-1280",
      use: { ...devices["Desktop Safari"], viewport: { width: 1280, height: 800 } },
    },

    // ── Tablet ──────────────────────────────────────────────────────────────
    {
      name: "ipad-gen7",
      use: { ...devices["iPad (gen 7)"] }, // WebKit, 810×1080
    },
    {
      name: "ipad-pro-11",
      use: { ...devices["iPad Pro 11"] }, // WebKit, 834×1194
    },
    {
      name: "android-tablet",
      use: { ...androidTablet }, // Chromium
    },

    // ── Phone — WebKit (iOS proxy) ─────────────────────────────────────────
    {
      name: "iphone-15",
      use: { ...devices["iPhone 15"] }, // WebKit, 393×852
    },
    {
      name: "iphone-se",
      use: { ...devices["iPhone SE"] }, // WebKit, 320×568 (smallest)
    },

    // ── Phone — Blink / Chromium (Android, Samsung Internet proxy) ──────────
    {
      name: "pixel-8",
      use: { ...devices["Pixel 7"], viewport: { width: 412, height: 915 } },
    },
    {
      name: "galaxy-s9",
      use: { ...devices["Galaxy S9+"] }, // Chromium, 320×658 dpr3
    },
    {
      name: "android-360",
      use: {
        ...devices["Pixel 7"],
        viewport: { width: 360, height: 800 },
        isMobile: true,
        hasTouch: true,
      },
    },
  ],

  webServer: EXTERNAL_BASE
    ? undefined
    : {
        command: `npm run start -- -p ${PORT}`,
        url: BASE_URL,
        timeout: 120_000,
        reuseExistingServer: !process.env.CI,
        stdout: "ignore",
        stderr: "pipe",
      },
});
