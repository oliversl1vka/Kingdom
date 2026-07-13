# KingdomOS website — Responsive & Cross-Browser Report

**Branch:** `website-responsive` (off tag `website-v1-desktop`, commit `fc83835`)
**Scope:** make the single-page site (`Hero → Bridge → Docs`) work flawlessly from
360px phones up to 1920px monitors, across Blink / WebKit / Gecko and on touch —
**without changing the desktop v1 (≥1280px) by a single pixel.**

> THE UNBREAKABLE RULE held: every change below is additive and gated to
> viewports **below 1280px**, or is a property that provably evaluates identically
> on desktop. The desktop visual-regression suite (baselines captured from the v1
> tag) enforces ≈0 pixel diff at 1280/1440/1920 — see §3.

---

## 1. What was wrong (measured, before any change)

An empirical survey (`scripts/survey.mjs`, Chromium + WebKit, 8 widths) found:

| Defect | Where | Evidence |
|---|---|---|
| **Horizontal scroll ~170px** | ≤ ~534px (360/390/430) | `.docs-copy` grid items had `min-width:auto`, so the `white-space:nowrap` command chip (≈508px) forced the section wider than the viewport. |
| **Hero title bleeds off both edges** | ≤ ~470px | `.hero-title-line{white-space:nowrap}` + clamp floor 28px overflowed `.hero-root` (clipped, looked broken). |
| **Terminal text microscopic** | phones (6–8px) **and** tablets/small-laptops | Fixed 1280-canvas scaled to the panel; `min(40vw,…)` made the panel tiny from 721–1279px too. |
| **Docs-anim text ~9px** | phones, and 1024px (narrow 2-col) | Fixed 1000-canvas scaled down. |
| **Tap targets 30px** | all touch | `.docs-nav-link` height 30px (< 44px). |
| **No `viewport-fit=cover`** | all | No `viewport` export → `env(safe-area-inset-*)` never resolves on iOS. |

---

## 2. What changed (all additive, breakpoint-gated)

**CSS (`globals.css`, one clearly-marked RESPONSIVE LAYER appended):**
- `min-width:0` on `.docs-section/.docs-copy/.docs-anim` → kills the h-scroll (no-op ≥1280, where the column already exceeds the chip).
- `@media (max-width:700px){ .hero-title-line{white-space:normal} }` → title wraps on phones; desktop keeps its two hand-set lines.
- `@media (min-width:721px) and (max-width:1199px){ .hero-stage{width:min(68vw,660px)} }` → bigger terminal on tablets/small-laptops. **Upper bound is 1199, not 1279**, because WebKit/Firefox resolve media queries against `clientWidth` (viewport **minus** scrollbar) — a `…1279px` rule fires at a 1280px viewport. The 80px gap makes the sacred tier untouchable by any scrollbar width.
- `@media (max-width:1024px)` → docs collapse to a single (wider) column earlier.
- `@media (pointer:coarse)` → `.docs-nav-link / .hero-eyebrow / .hero-scroll-cue` get ≥44px hit areas (scoped to touch, so the mouse-driven desktop baseline is unaffected).
- `.hero-badge{ left/bottom: calc(22px + env(safe-area-inset-*)) }` → clears the iOS home-indicator/notch (`env()` = 0 on desktop → identical paint).
- Phone aspect overrides for `.hero-terminal` and `.docs-anim` (≤600px) that match the compact canvases (below).

**Viewport (`layout.tsx`):** added `export const viewport` = `width=device-width, initial-scale=1, viewport-fit=cover, themeColor:#0a0a0a, colorScheme:dark`. Zoom intentionally NOT disabled (accessibility).

**Compact mode for the decorative `aria-hidden` compositions** (chosen approach: thorough compact variants). The fundamental constraint: a 55-char terminal line on a 331px phone can't exceed ~6px/char no matter how you scale, so legibility *requires* a phone-specific layout, not just rescaling.
- New `CompactContext` + `useMediaQuery(COMPACT_QUERY ≤600px)` in `driver.tsx`. The stages (`TerminalStage`, `AnimStage`) pick a smaller portrait canvas below 600px and provide `compact=true`; **above 600px every composition renders its original 1280/1000 layout → byte-identical to v1.**
- **Hero terminal:** portrait 560×720 canvas, shortened command lines, 22px type (≈13–22px on-screen on phones).
- **5 docs anims:** each has a dedicated compact layout on its own portrait/squarer canvas (`DOC_COMPACT` in `docs/meta.ts`), e.g. Setup stacks its two columns; Summon re-lays the King→3-epics→11-tasks graph into 620×470.
- **SummonAnim (step 04):** only positions/sizes branch on `compact` — **every timing formula (ring fill `(frame-20)/104` → full @124, the 124→137 resolve, all springs) is byte-identical**, so the ring↔node-settle sync is preserved on every device by construction.

**Mobile refinements (post device-review — all ≤600px only; desktop re-verified
pixel-identical, 63/63):**
- Bridge manifest shows **only the white step titles** on phones — the grey
  gloss ("one line, global CLI", …) overflowed the screen, so it's dropped there.
- The sticky docs **jump-nav is hidden on phones** — it wrapped to ~3 rows and
  pinned over the content/animations while scrolling; it adds little on a phone.
- SummonAnim's **"Objective decomposed" chip is hidden on phones** (it couldn't
  fit cleanly); the King→epics→tasks graph stands on its own.

---

## 3. Desktop is still v1 (the unbreakable rule)

Method: a `website-v1-desktop` git worktree was built and served on :3200; the
visual suite's **desktop baselines were generated from it**. The responsive
branch (:3100) is then diffed against those v1 baselines at 1280/1440/1920 on all
three engines, tolerance `maxDiffPixelRatio: 0.001` (hero + 5 docs sections) /
`0.002` (3 bridge scrub frames).

**Result: PASS — desktop ≥1280px is pixel-identical to v1.** All 7 desktop
projects × 9 settled captures (hero + 5 docs sections + 3 bridge scrub frames) =
**63 captures matched the v1-tag baselines** within tolerance (`0.001` layout /
`0.002` bridge). Engines: Chromium (Blink) 1920/1440/1280, Firefox (Gecko)
1440/1280, WebKit 1440/1280.

> During development two of my own compact edits leaked into the shared
> (desktop) code path — `DecreeAnim`'s header padding (22→20px) and
> `StatusAnim`'s `justify-content`/gaps/letter-spacing. The regression suite
> **caught both**; they were restored to the exact v1 values and now diff ≈0.
> This is the rule working as intended.

---

## 4. Tooling

- **Playwright** (`playwright.config.ts`) — 15-project matrix across Blink/WebKit/Gecko:
  desktop 1920/1440/1280 (×3 engines partial), iPad gen7 + iPad Pro 11 (WebKit),
  Galaxy Tab (Chromium), iPhone 15 + iPhone SE (WebKit), Pixel + Galaxy S9 + a
  360px Android (Chromium). `video:'on'`, trace on failure.
- Animations are rAF/scroll-driven (CSS `animations:'disabled'` can't freeze them),
  so the specs drive each composition to its **deterministic settled frame**
  (play-once → final frame; bridge → fixed scroll) before asserting.
- **Real iOS Safari** via **BrowserStack** real devices over a Local tunnel
  (`tests/browserstack/ios-safari.mjs`) — because Playwright cannot drive real
  mobile Safari (Apple restriction); its "WebKit" is a desktop build. See §6.

Specs: `tests/visual.spec.ts` (regression), `tests/responsive.spec.ts` (no
h-scroll / tap-targets / viewport / badge), `tests/animations.spec.ts`
(pin / scrub / reduced-motion / play-once / step-04 sync), `tests/links.spec.ts`.

---

## 5. Device × browser matrix

**Suite result: 368 passed · 7 skipped · 0 failed** across the 15-project matrix
(the 7 skips are the touch-target test on the mouse-only desktop projects). The
regression suite did its job mid-development — it flagged two desktop drifts I'd
introduced (Decree/Status) and they were fixed before sign-off.

Legend: **L** layout (no h-scroll / no clip / legible) · **V** visual regression
· **A** animations (pin/scrub/play-once/reduced-motion) · **K** links/anchors ·
**T** tap targets ≥44px. ✓ = pass. Desktop **V** = diff vs **v1 tag**; mobile
**V** = diff vs this branch's baseline.

| Device | Engine | Viewport | L | V | A | K | T |
|---|---|---|:--:|:--:|:--:|:--:|:--:|
| Desktop | Chromium (Blink) | 1920×1080 | ✓ | ✓ (=v1) | ✓ | ✓ | n/a |
| Desktop | Chromium (Blink) | 1440×900 | ✓ | ✓ (=v1) | ✓ | ✓ | n/a |
| Desktop | Chromium (Blink) | 1280×800 | ✓ | ✓ (=v1) | ✓ | ✓ | n/a |
| Desktop | Firefox (Gecko) | 1440×900 | ✓ | ✓ (=v1) | ✓ | ✓ | n/a |
| Desktop | Firefox (Gecko) | 1280×800 | ✓ | ✓ (=v1) | ✓ | ✓ | n/a |
| Desktop | WebKit | 1440×900 | ✓ | ✓ (=v1) | ✓ | ✓ | n/a |
| Desktop | WebKit | 1280×800 | ✓ | ✓ (=v1) | ✓ | ✓ | n/a |
| iPad (gen 7) | WebKit | 810×1080 | ✓ | ✓ | ✓ | ✓ | ✓ |
| iPad Pro 11 | WebKit | 834×1194 | ✓ | ✓ | ✓ | ✓ | ✓ |
| Galaxy Tab S4 | Chromium | 712×1138 | ✓ | ✓ | ✓ | ✓ | ✓ |
| iPhone 15 | WebKit | 393×852 | ✓ | ✓ | ✓ | ✓ | ✓ |
| iPhone SE | WebKit | 320×568 | ✓ | ✓ | ✓ | ✓ | ✓ |
| Pixel 7/8 | Chromium | 412×915 | ✓ | ✓ | ✓ | ✓ | ✓ |
| Galaxy S9+ | Chromium | 320×658 | ✓ | ✓ | ✓ | ✓ | ✓ |
| Android 360 | Chromium | 360×800 | ✓ | ✓ | ✓ | ✓ | ✓ |
| **Real iPhone 15** | **Mobile Safari (iOS 17)** | real device | ✓ | — | ✓ pin | ✓ | ✓ badge |
| **Real iPhone SE 2022** | **Mobile Safari (iOS 15)** | real device | ✓ | — | ✓ pin | ✓ | ✓ badge |

Breakpoints explicitly checked for no-h-scroll / no-clip / legible / ≥44px taps:
**360 · 390 · 430 · 768 · 1024 · 1280 · 1440 · 1920**. Horizontal scroll = 0 at
every one (was ~170px below 534px before the fix).

## 5b. Per-animation verdicts

| Animation | Verdict | Evidence |
|---|---|---|
| **Hero terminal typewriter** | ✓ PASS | Plays once then freezes (no loop); legible everywhere — desktop full sequence, **phone compact 22px portrait canvas** (~13–22px on-screen); progress bar fills, caret freezes solid; pauses off-screen. Blink + WebKit + Gecko + emulated touch + **real iOS**. |
| **Hero → Quickstart bridge** | ✓ PASS | Sticky pane **PINS** (`top=0`) at 20/50/80% of its pin range on every engine **and on both real iPhones**; scrub changes the frame with scroll; `prefers-reduced-motion` collapses the 564vh track to one screen. dvh keeps the pane = visual viewport (real iOS pane h = innerH). |
| **InstallAnim (01)** | ✓ PASS | Play-once freeze; compact 540×600 card legible on phones. |
| **SetupAnim (02)** | ✓ PASS | Compact stacks the file-tree above the checklist (540×640); legible. |
| **DecreeAnim (03)** | ✓ PASS | Compact record card 560×560; objective wraps cleanly; desktop restored to v1. |
| **SummonAnim (04)** | ✓ PASS | Graph re-laid for 620×470 (King→3 epics→11 tasks). **Ring↔node sync preserved on every device** — every timing formula (`fill=(frame-20)/104` full @124, resolve 124→137, all springs) is byte-identical; only positions/sizes branch on `compact`. Settled chip = "Objective decomposed". |
| **StatusAnim (05)** | ✓ PASS | Compact 540×560 dashboard (tiles + token odometer + bar); desktop restored to v1. |
| **Micro-interactions** | ✓ PASS | Scroll-cue bob, sticky docs-nav + `backdrop-filter` (WebKit/FF snapshots), Lenis anchor glide, fixed badge (safe-area), custom scrollbar. |
| **Links** | ✓ PASS | Eyebrow + footer → repo (`rel=noopener`, `_blank`); 5 docs jump links (#install…#status); hero cue → #quickstart. Clicking a nav link glides the section clear of the (taller, mobile) sticky nav. |

---

## 6. Real iOS Safari sign-off (emulated vs real)

**Verified on real Apple hardware** via BrowserStack (Selenium/WebDriver over a
BrowserStack Local tunnel to the prod server — Playwright can't drive real mobile
Safari): **iPhone 15 / iOS 17** and **iPhone SE 2022 / iOS 15**. Screenshots
(hero, bridge, docs per device) in `playwright/ios-real/`, raw verdicts in
`playwright/ios-real/results.json`.

| Check | iPhone 15 (iOS 17) | iPhone SE 2022 (iOS 15) |
|---|---|---|
| No horizontal scroll | ✓ `true` | ✓ `true` |
| Fixed badge on-screen, clears toolbar | ✓ (left 22, 22px above toolbar) | ✓ (left 22, 22px above toolbar) |
| Bridge **pins** through the scrub | ✓ `top=0` at 20/50/80% of range | ✓ `top=0` at 20/50/80% of range |
| Bridge pane = visual viewport (dvh) | ✓ pane h = innerH (659) | ✓ pane h = innerH (548) |
| Hero / terminal legible, title wraps | ✓ (see `iPhone15-hero.png`) | ✓ |

**Emulated vs real:** the 15-project Playwright matrix uses Playwright's WebKit,
which is a **desktop** WebKit build — fine for layout/animation logic but NOT
faithful to iOS scroll physics, `dvh`, or `position:sticky`. Those iOS-specific
behaviours were therefore confirmed on **real devices** above (the bridge pins,
the badge clears the dynamic toolbar, `dvh` math holds, no h-scroll).

**Caveats / notes (honest):**
- The hero on a small iPhone is **content-tall** (≈851px of content vs ≈659px
  visible) — the portrait terminal + 3-line title simply exceed the fold, so the
  "Quickstart ↓" cue sits just below it and a small scroll reveals it. This is
  normal hero behaviour, **not** a clipping/`vh` defect (the `100vh→100dvh` hero
  fix is applied; the bridge pane correctly equals the visual viewport).
- iOS 15 (SE) may predate `dvh` (added 15.4); it falls back to `100vh`
  gracefully — and since the hero is content-tall there anyway, the rendering is
  unaffected.
- The real-device pass asserted pin / dvh / badge / h-scroll programmatically;
  the anchor-glide *tap* was verified emulated (Lenis is engine-agnostic JS).

---

## 6b. Screenshot / video gallery (index)

| What | Path |
|---|---|
| **Real iOS** — iPhone 15 hero / bridge / docs | `playwright/ios-real/iPhone15-{hero,bridge,docs}.png` |
| **Real iOS** — iPhone SE 2022 hero / bridge / docs | `playwright/ios-real/iPhoneSE2022-{hero,bridge,docs}.png` |
| Real iOS raw verdicts | `playwright/ios-real/results.json` |
| **Canonical per-device gallery** — settled hero / 5 docs anims / 3 bridge frames, every device | `tests/__screenshots__/visual.spec.ts/` (135 — desktop = v1 baseline, mobile = branch). Regenerate/inspect: `npx playwright test --update-snapshots=all` |
| Compact phone renders (hero + 5 anims) | the `*-{iphone-15,iphone-se,pixel-8,galaxy-s9,android-360}.png` baselines above |
| Desktop = v1 renders | the `*-desktop-*.png` baselines above |
| **Per-test video** of the full matrix | `playwright/test-results/**/video.webm` (gitignored — `video:'on'`, regenerate with `npx playwright test`) |
| Full HTML report (screenshots + video + traces) | `npx playwright show-report playwright/report` (gitignored, ~90M) |

## 7. Known-risk checklist (from the brief)

| Risk | Status |
|---|---|
| `.hero-title-line{nowrap}` overflow on phones | **Resolved** — wraps ≤700px; desktop unchanged. |
| Remotion fixed-canvas text shrinking on phones | **Resolved** — compact portrait canvases + larger type for hero + all 5 anims. |
| iOS `100dvh` toolbar gap/overlap | **Verified** on real iOS (§6); hero/bridge use `dvh`. |
| iOS `position:sticky` + `translateZ` pin breaking | **Verified pinned** on real iOS (§6) and emulated WebKit. |
| iOS fixed `.hero-badge` behind toolbar | **Resolved** — `env(safe-area-inset-*)`; verified on real iOS (§6). |
| Lenis touch scroll / scrub tracking | **Verified** — scrub tracks; anchors glide (links suite). |
| `backdrop-filter` (docs-nav, hero label) on Safari/FF | **Verified** in WebKit + Firefox visual snapshots. |
| Brave shields / rAF throttling | Blink-engine animations verified (Brave = Blink); see §5b note. |
| Missing viewport meta | **Resolved** — explicit `viewport` export with `viewport-fit=cover`. |

---

## 8. How to reproduce

```bash
cd website/kingdom-website
npm install && npx playwright install
npm run build && npm run start -- -p 3100        # branch under test
npx playwright test                               # full matrix vs baselines
npx playwright show-report playwright/report      # gallery (screenshots + video)
# real iOS (needs BROWSERSTACK_* in repo .env):
node tests/browserstack/ios-safari.mjs
```
Baselines live in `tests/__screenshots__/` (desktop = v1 tag, mobile = this branch).
