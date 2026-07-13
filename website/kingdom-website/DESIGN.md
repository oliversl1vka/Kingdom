# KingdomOS — Design System

> **Status:** v1 (golden). Derived from the KingdomOS marketing site
> (`website/kingdom-website`), the canonical reference implementation.
> **Purpose:** the single source of truth for the KingdomOS visual language. Any
> future site, dashboard, or surface "connected to the Kingdom" should be built
> from these tokens, patterns, and rules so the whole product reads as one system.
> **Reference implementation files:** tokens live in
> `src/remotion/theme.ts` + `src/app/globals.css`; motion primitives in
> `src/remotion/docs/shared.ts` and `src/remotion/bridge/shared.tsx`.

---

## 0. North star

**A terminal kingdom.** Near-black surfaces, monochrome "ink", and exactly one
restrained accent (a dim terminal green). The product is a command-line
orchestration system, and the brand is the terminal itself: calm, precise,
confident, a little medieval in voice, never decorative for its own sake.

Five rules that make something feel "KingdomOS":

1. **Emphasis is brightness, not hue.** Hierarchy comes from light-on-dark
   contrast steps (`#555` → `#9A9A9A` → `#E6E6E6` → `#FFFFFF`), not from color.
2. **One accent, used sparingly.** Dim terminal green `#4ADE80` marks "ok"/success
   only. If everything is accented, nothing is.
3. **Monospace is structural.** Geist Mono is the voice of the machine — commands,
   labels, terminal output, step numbers. Geist Sans is the voice of the product —
   headings and prose.
4. **Motion is frame-driven and earned.** Animations are continuous, calm, play
   once, and respect the user's scroll and motion preferences. No gratuitous loops.
5. **The desktop is sacred; mobile is additive.** Responsive work never alters the
   approved desktop rendering — it adapts below it (see §8, §11).

---

## 1. Color

All values are exact. Page-level tokens are CSS custom properties on `:root`
(`globals.css`); the composition layer mirrors them in `theme.ts` so the live
terminal/animations can never drift off-brand.

### 1.1 Core palette

| Token | Hex | CSS var | Role |
|---|---|---|---|
| Background | `#0A0A0A` | `--kd-bg` | Page background |
| Background deep | `#050505` | `--kd-bg-deep` | Deepest wells (docs section, gradient floor) |
| Surface | `#111111` | `--kd-surface` | Raised cards / chips |
| Surface raised | `#161616` | — | Window bars, elevated tabs |
| Card (terminal) | `#0E0E0E` | — | Terminal body |
| Ink (primary) | `#E6E6E6` | `--kd-fg` | Primary text |
| Ink soft | `#9A9A9A` | `--kd-fg-soft` | Secondary text |
| Ink faint | `#555555` | `--kd-fg-faint` | Tertiary / hints / eyebrows |
| Hairline | `#2A2A2A` | `--kd-hair` | 1px page borders |
| Accent | `#FFFFFF` | `--kd-accent` | Maximum emphasis (= brightness) |
| Accent deep | `#D4D4D4` | — | Pressed/secondary white |

### 1.2 The one accent + terminal palette

| Token | Hex / rgba | Role |
|---|---|---|
| **Sage / terminal-ok** | `#4ADE80` | THE accent — success, "ok", live values, the ring/check. Use sparingly. |
| Sage soft | `rgba(74,222,128,0.12–0.13)` | Accent fills / glows / soft backgrounds |
| Terminal ink | `#D6D6D6` | Terminal body text |
| Terminal prompt | `#FFFFFF` | `$` prompt |
| Terminal muted | `#707070` | De-emphasised terminal lines |
| Pending | `#9A9A9A` / `rgba(255,255,255,0.08)` | Neutral "pending" state |
| Tier: King | `#FFFFFF` | Graph identity by brightness, not hue |
| Tier: Nobility | `#B4B4B4` | … |
| Tier: Knight | `#787878` | … |

### 1.3 Composition hairlines (on dark, over cards)
Use translucent white, not the solid page hairline, so borders read on near-black
cards: `rgba(255,255,255,0.10)` (standard), `rgba(255,255,255,0.08)` (soft),
`rgba(255,255,255,0.06)` (faintest).

### 1.4 macOS traffic-light dots (only for the "mac" terminal chrome)
`#FF5F57` red · `#FEBC2E` amber · `#28C840` green (accurate Big Sur+ values).

### 1.5 Rules
- `color-scheme: dark` is declared globally; honor it.
- Never introduce a second hue for emphasis. If you need "danger", derive it from
  brightness/weight first; only reach for a hue if semantically unavoidable.
- The page background gradient: `radial-gradient(140% 120% at 50% -10%, #121212 0%, transparent 46%)` over `--kd-bg` — a single soft top vignette, baked, never animated full-screen.

---

## 2. Typography

Two families, loaded with `next/font/google` and exposed as CSS vars.

| Family | Var | Fallback stack | Voice |
|---|---|---|---|
| **Geist Sans** | `--font-geist-sans` | `ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif` | Product — headings, prose |
| **Geist Mono** | `--font-geist-mono` | `"JetBrains Mono", ui-monospace, "SFMono-Regular", Menlo, monospace` | Machine — commands, labels, terminal, numerals |

### 2.1 Type scale (exact, fluid)

All large type uses `clamp()` for fluid scaling — never fixed px for headings.

| Element | Font | Size | Weight | Tracking | Transform | Color |
|---|---|---|---|---|---|---|
| Hero title | Sans | `clamp(28px, 4.2vw, 54px)` | 540 (accent 640) | `-0.022em` | uppercase | ink / accent |
| Hero subtitle | Sans | `clamp(13px, 1.25vw, 15px)` | — | — | — | ink-soft |
| Hero eyebrow (link) | Mono | 12px | 500 | `0.04em` | — | ink-faint |
| Scroll cue | Mono | 11px | 500 | `0.22em` | uppercase | ink-faint |
| Section eyebrow | Mono | 11px | 500 | `0.36em` | uppercase | ink-faint |
| Section title (h2) | Sans | `clamp(24px, 3vw, 36px)` | 540 | `-0.02em` | — | ink |
| Sub-section title (h3) | Sans | `clamp(22px, 2.4vw, 30px)` | 560 | `-0.012em` | — | ink |
| Step number | Mono | 14px | 600 | — | — | accent |
| Body | Sans | 16px (15px ≤520) | — | line-height 1.7 | — | ink-soft |
| Inline code | Mono | 0.86em | — | — | — | ink on `rgba(255,255,255,0.07)`, radius 5, pad `1px 6px` |
| Command chip | Mono | 14px (13px ≤520) | prompt 600 | — | nowrap | prompt accent, code `#C4C4C4` |
| Nav link | Mono | 12px | — | `0.02em` | — | ink-soft |

### 2.2 Rules
- Line-heights: display 1.08–1.12; body 1.6–1.7; terminal 1.72–1.95.
- Negative tracking on large sans display; positive, wide tracking (`0.16–0.36em`)
  + uppercase on small mono eyebrows/labels — this contrast is a signature.
- Numerals and any "computed/live" value are mono.

---

## 3. Spacing, layout & grid

- **Containers:** intro/copy `max-width: 760px`; section grid `max-width: 1120px`;
  body prose `max-width: 28–32rem`. Center with `margin-inline: auto`.
- **Section rhythm:** docs sections are a 2-column grid `1fr 1fr`, `gap: 56px`,
  `padding: 64px 0`, hairline `border-bottom`, **alternating** (`--rev` flips copy
  to `order: 2`). `scroll-margin-top: 84px` for anchored jumps.
- **Page padding:** hero `64px 24px 72px`; docs root `96px 24px 120px` (phones
  tighten to `56/18/64` and `72/18/96`).
- **Spacing feel:** generous vertical whitespace, calm. Prefer 8px-ish increments
  but follow the section/element values above rather than a rigid scale.

---

## 4. Radii

`5` inline code · `8` nav-link hover · `10` command chip · `12` graph nodes ·
`14` jump-nav / labels · `16` terminal panel · `18` docs-anim / tiles ·
`20–22` content cards (`TermCard` 22) · `44` backdrop glow · `999` pills ·
`50%` dots & corner badge.

Heuristic: small interactive ≈ 8–12; panels ≈ 16–20; cards ≈ 20–22; pills 999.

---

## 5. Elevation, borders & glass

### 5.1 Shadows (layered, very soft, large negative spread)
The house style is a tall soft drop + a tight contact shadow, both with large
negative spread so they read as depth, not a hard box.

| Surface | box-shadow |
|---|---|
| Terminal panel | `0 40px 80px -42px rgba(0,0,0,.85), 0 8px 24px -16px rgba(0,0,0,.6)` |
| Content card (`TermCard`) | `0 44px 90px -52px rgba(0,0,0,.85), 0 12px 32px -22px rgba(0,0,0,.55)` |
| Docs animation panel | `0 30px 64px -42px rgba(0,0,0,.85), 0 8px 22px -16px rgba(0,0,0,.6)` |
| In-composition card | `0 18px 44px -34px rgba(0,0,0,.8)` |
| Command chip | `0 12px 30px -26px rgba(0,0,0,.9)` |
| Floating label / badge | `0 8px 22px -16px rgba(0,0,0,.8)` / `0 6px 16px -8px rgba(0,0,0,.8)` |

### 5.2 Borders
Page: `1px solid var(--kd-hair)`. On dark cards: `1px solid rgba(255,255,255,.08–.10)`.

### 5.3 Glass / backdrop-filter
- Slim UI (jump-nav, hero label): `backdrop-filter: blur(10px)` + translucent bg
  (`rgba(5,5,5,.82)` / `rgba(10,10,10,.72)`). **Always pair with `-webkit-backdrop-filter`.**
- Frosted terminal variants: `blur(30px) saturate(160–180%)` over a translucent card.
- Accent glow (e.g. resolved ring): `box-shadow: 0 0 26px -6px rgba(74,222,128,α)`,
  fades in with state — never always-on.

---

## 6. Motion

Motion is a first-class part of the brand and follows strict engineering rules.

### 6.1 Principles
- **Frame-driven, not CSS, for anything non-trivial.** Complex compositions render
  off an integer frame from a single rAF driver (`driver.tsx` / `AnimStage`), not
  CSS keyframes — so they're deterministic, refresh-rate-independent (re-render
  only when the integer frame changes), and pausable.
- **Play once, then freeze.** Showcase animations play through exactly once and
  settle on their final frame. No idle loops. They start when scrolled into view
  and pause when off-screen or the tab is hidden (`IntersectionObserver` +
  `visibilitychange`).
- **Typewriter = string slicing**, ~1 char/frame. Never per-character opacity,
  never CSS animation of text.
- **Scroll-scrubbed transitions** are driven by **one** smoothing layer: Lenis
  smooths the page scroll, and the scrubbed composition reads that already-eased
  value and maps it straight to a (fractional, continuous) frame. Never double-smooth.
  Measure layout once (mount + resize); the hot path reads only the scroll number.
- **GPU-promote** scrubbed panes (`transform: translateZ(0); will-change: transform`).

### 6.2 Tokens

| Token | Value | Use |
|---|---|---|
| FPS (compositions) | `30` | Frame driver |
| Easing (tweens) | `cubic-bezier(0.16, 1, 0.3, 1)` | Calm ease-out (`Easing.bezier` in Remotion) |
| Spring (entrances) | `{ damping: 200, stiffness: 120, mass: 0.8 }` | Fade/rise/scale-in |
| Spring (terminal open) | `{ damping: 200, stiffness: 120, mass: 0.7 }` | Panel reveal |
| Lenis | `lerp: 0.09, smoothWheel: true, syncTouch: false, anchors: true` | Page smooth-scroll + anchor glide |
| Cue bob | `1.8s ease-in-out infinite`, `translateY(3px)` | The one ambient CSS loop (scroll hint) |
| Micro-transitions | `0.16–0.18s ease` | Link/hover color shifts |

### 6.3 Reduced motion (mandatory)
`@media (prefers-reduced-motion: reduce)`: Lenis `lerp: 1` (native scroll);
scroll-scrubbed tracks collapse to a single screen showing the final settled frame.
Provide a static, complete state — never a broken half-animation.

---

## 7. Components (catalog)

Each is a reusable pattern; specs above apply.

- **Terminal panel** — fixed design canvas (1280×720) CSS-scaled to fit; 5 chrome
  variants: `none` (chromeless), `mac` (traffic lights + title), `tab` (IDE filename
  tab), `label` (slim header), `frosted` (vibrancy glass). Radius 16, hairline, soft shadow.
- **Window controls** — accurate macOS dots (§1.4), 24px (12px in tab chrome).
- **Progress bar** — terminal style uses block glyphs `█`/`░`; UI style uses a
  rounded track (`height 13–16`, radius 999) with a fill that cross-fades white→sage at 100%.
- **Block caret** — frame-driven; blinks while typing (`interpolate` over a period),
  goes solid + still on completion. `width: 0.6ch`, `height: 1.05em`.
- **Status chip / pill** — radius 999; an SVG ring fills (linearly, synced to the
  work it represents) then resolves into a ✓ with a soft sage glow; label crossfades
  in place (sized to the resolved text so the pill hugs it). *Hidden on phones.*
- **Data/record card** — label/value rows; mono uppercase labels (`0.08em`,
  fixed-width column), value right of it; hairline dividers; status pill in header.
- **File-tree** — mono, `white-space: pre`, lines fade/rise in sequence; primary
  line bright, children `ink-soft`.
- **Stat tile + counter** — card with a colored status dot, mono uppercase label,
  and a large mono number that eases up via a frame counter.
- **Graph** — rounded nodes (radius 12) connected by SVG lines drawn with
  `pathLength={1}` + animated `strokeDashoffset`; tier color = brightness.
- **Command chip** — copyable; `$` prompt in accent, command in mono `#C4C4C4`,
  `white-space: nowrap`, `overflow-x: auto` (scrolls internally rather than
  breaking layout — this is what keeps narrow screens from h-scrolling).
- **Eyebrow link / scroll cue / corner badge / sticky jump-nav / footer / custom
  scrollbar (6px, `#2A2A2A` thumb)** — see `globals.css`.

---

## 8. Responsive architecture (the rulebook)

> **The unbreakable rule:** the approved desktop rendering (≥1280px, tag
> `website-v1-desktop`) is sacred. Every responsive change is **additive** and
> **gated below desktop**, or is a property that is provably identical on desktop.
> A visual-regression suite enforces ~0 pixel diff at 1280/1440/1920.

### 8.1 Breakpoint tiers

| Tier | Range | What happens |
|---|---|---|
| **Desktop (golden)** | `≥ 1280px` | Untouched. Never enter modified code paths here. |
| Tablet / small-laptop | `721–1199px` | Enlarge canvas-scaled panels (e.g. hero terminal `min(68vw, 660px)`). |
| Docs single-column | `≤ 1024px` | Two-col → one wide column. |
| Title wrap | `≤ 700px` | Release `white-space: nowrap` on display lines. |
| **Compact (phone)** | `≤ 600px` | The phone tier (see §8.3). `COMPACT_QUERY = (max-width: 600px)`. |
| Phone polish | `≤ 520px` | Tighter padding / type. |
| Touch | `(pointer: coarse)` | Hit areas ≥ 44px. |

### 8.2 Cross-browser / cross-device invariants
- **Viewport meta:** `width=device-width, initial-scale=1, viewport-fit=cover`,
  `themeColor: #0a0a0a`, `colorScheme: dark`. **Never disable zoom.**
- **iOS:** use `100dvh` (not `100vh`) for full-height regions; honor
  `env(safe-area-inset-*)` for fixed elements (e.g. the corner badge).
- **No horizontal scroll, ever.** Give grid/flex children `min-width: 0` so a
  `nowrap` chip scrolls internally instead of widening the page.
- **The scrollbar/media-query trap:** WebKit & Firefox resolve `@media` against
  `clientWidth` (viewport **minus** scrollbar). A `…1279px` rule can fire at a
  1280px viewport. **Keep below-desktop upper bounds well clear of 1280** (we use
  `≤ 1199px`) so no scrollbar width can leak into the sacred tier.
- **Touch targets ≥ 44px**, scoped to `(pointer: coarse)` so the mouse-driven
  desktop baseline is unaffected.

### 8.3 Compact mode (canvas-scaled content on phones)
Fixed-canvas decorative compositions (the terminal, the animations) become
microscopic when scaled to a phone, and the limit is physical (a 55-char line on a
331px screen can't exceed ~6px/char). So phones get a **dedicated compact layout**,
not just a smaller scale:

- A shared `CompactContext` + `useMediaQuery(COMPACT_QUERY)` in the stage. Below
  600px the stage selects a **smaller portrait canvas** and sets `compact = true`.
- **Above 600px every composition renders its original canvas byte-for-byte** →
  desktop/tablet identical to v1.
- In compact, content is re-laid (shorter copy, larger type, stacked columns,
  re-positioned graph) — never just shrunk. Timing/animation formulas stay
  identical so synced motion (e.g. a ring tracking a graph build) is preserved.
- Decorative compositions are `aria-hidden`; all real content (commands,
  descriptions) lives in normal, fully-legible HTML.

---

## 9. Voice & content

- **Terminal-authentic.** Commands are real and mirror the CLI; output lines read
  like a real session. Lowercase mono for commands.
- **The court metaphor.** The system is a medieval court: the **King** decomposes
  an objective → **Nobility** break epics into tasks → **Knights** execute → the
  **Judge** reviews → the **Healer** recovers. Use these consistently.
- **Tone:** confident, spare, a wink of medieval flourish over precise technical
  substance ("The decree hath been issued", "Summon the court", "From zero to a
  working kingdom"). Never verbose, never hypey.
- **Numbers tell the story** (epics/tasks/tokens/%); show live-looking values.

---

## 10. Accessibility

- Decorative animations are `aria-hidden="true"`; meaning is carried by real text.
- `prefers-reduced-motion` is fully honored (§6.3).
- Touch targets ≥ 44px on coarse pointers; zoom never disabled.
- `color-scheme: dark`; contrast is high by construction (ink `#E6E6E6` on
  `#0A0A0A`). Keep secondary text at `≥ #9A9A9A` on the page background.
- Links carry `rel="noopener noreferrer"` + `target="_blank"` for external.

---

## 11. Tech stack & implementation conventions

- **Next.js (App Router).** Server Components by default; add `"use client"` only
  at real interactivity boundaries (smooth-scroll provider, players, frame stages).
  Export `metadata` + `viewport` from `layout.tsx`.
- **Styling:** Tailwind v4 + a single `globals.css` that defines tokens as CSS
  custom properties and the component classes. Keep tokens in `:root`.
- **Fonts:** `next/font` (Geist Sans/Mono) → CSS vars; never raw `@font-face`.
- **Tokens single-source-of-truth:** `src/remotion/theme.ts` holds the palette +
  timing the live compositions use, mirroring the page tokens so they can't drift.
- **Animation engine:** a lightweight frame driver (`driver.tsx`, `AnimStage`,
  `BridgeStage`) — a drop-in replacement for `@remotion/player` for ambient,
  non-interactive scenes — plus **Lenis** for smooth scroll. Compositions read the
  frame from a `FrameContext`; the "design canvas" (fixed `W×H`) is scaled with a
  single `transform: scale()`.
- **One component per file**, colocated under `src/components` (page) and
  `src/remotion` (compositions).

---

## 12. Quality bar & governance

This is how the system stays trustworthy as it grows:

- **Golden-standard tags.** `website-v1-desktop` (desktop) and `website-v1-mobile`
  (responsive) are the sacred baselines. Treat them like protected references.
- **Visual regression per breakpoint** with Playwright (`tests/`,
  baselines in `tests/__screenshots__/`). Desktop baselines are captured **from the
  v1 tag** and enforce ~0 diff; mobile baselines guard the responsive layouts.
- **Cross-engine + real-device.** Verify on Blink, WebKit, and Gecko, plus **real
  iOS Safari** on a device cloud (Playwright cannot drive real mobile Safari).
- **Additive-only responsive changes**, gated by breakpoint; if a change could
  touch ≥1280px, gate it or prove (and test) it's identical there.
- **Capture motion as video / stepped frames** when reviewing — never judge a
  scroll-scrubbed or play-once animation from a single screenshot.

---

### Appendix — quickest start for a new "Kingdom-connected" surface
1. Copy the tokens (§1, §2, §4, §5) into `:root` + a `theme.ts`.
2. Background `#0A0A0A`, ink `#E6E6E6`, one accent `#4ADE80`, Geist Sans + Mono.
3. Build desktop first; make it your golden. Then add responsive **below** it (§8).
4. Frame-drive any non-trivial motion; honor reduced-motion; play once.
5. Add visual-regression baselines per breakpoint before you call it done.
