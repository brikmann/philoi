# Agent task — make the Cindy flame the global mark EVERYWHERE

**Goal:** the **Cindy flame = our logo flipped horizontally (mirrored 180° on the vertical axis)** becomes the
single flame mark on **every** surface. One orientation, no exceptions. This unifies the brand and matches
`CINDY_SPEC.md` rendering rule 1 (updated).

## The one rule
There is now **exactly one flame orientation** app-wide: the logo **flipped horizontally**. Flip it **once at
the source**, then make sure **nothing downstream applies a second mirror** (or it double-flips back). After
this task, every flame — icon, favicon, splash, in-app, website, ambient — points the same way.

## Source of truth
- `src/components/ui/flame-logo.tsx` → `FLAME_PATH` is the master glyph (viewBox 0 0 24 24) used by the brand
  mark and every raster asset. **Flip it horizontally.** Either transform the path data, or wrap the `<Path>`
  in a horizontal mirror (`transform="translate(24,0) scale(-1,1)"` on a `<G>`, viewBox width 24). Prefer the
  transform so the glyph stays legible/diffable.

## 1. In-app components (audit every flame so none double-flips)
Make all of these render the **flipped** orientation, and remove any *existing* `scaleX(-1)` / mirror that
would now cancel it out:
- `src/components/ui/flame-logo.tsx` (brand mark — home / done / daily-fire hero, wordmark, empty states)
- `src/components/personal-flame.tsx`, `src/components/session-flame.tsx`, `src/components/lock-in-flame.tsx`,
  `src/components/heat-flame.tsx`, `src/components/flame-completion-card.tsx`,
  `src/components/flame-meter.tsx` / `flame-meter-complete.tsx`, `src/components/cindy/cindy-flame-press.tsx`
- Leave `src/components/flame-icon.tsx` (the campfire cosmetic ramp glyph) alone unless it's used as a brand
  mark anywhere — it's a different job.
- Verify the screens: `src/app/(tabs)/index.tsx` (home), `src/components/lockin-done-screen.tsx` (done),
  daily-fire surface (`src/hooks/use-daily-fire.ts` / wherever it renders).

## 2. Native raster assets (regenerate from the flipped glyph)
All under `assets/images/`. These only apply on a **native build** (not OTA), so they must land before the next
`eas build`:
- `icon.png` (iOS + `app.config.ts` lines 9, 24)
- `android-icon-foreground.png`, `android-icon-monochrome.png` (adaptive; background stays) — `app.config.ts`
  46–50
- `splash-icon.png` (launch screen; `app.config.ts` 156)
- `notification-icon.png` (white flame silhouette on transparent — Live Activity / ambient; there's a
  generator noted at `app.config.ts` ~230, `scripts/gen-notification-icon.js` — flip its source too)
- `favicon.png` (Expo web; `app.config.ts` 101)
- Match each file's existing pixel dimensions exactly.

## 3. Website (`site/`)
- `site/favicon.svg` — the flame is an inline `<g transform="translate(13.6 9) scale(0.3067)">…`. Add a
  horizontal mirror to that group (keep it centered in the 64×64 rounded tile).
- Regenerate the rasters via `site/_assets/build-assets.mjs` (+ `icon.html` / `og.html`): `favicon.png`,
  `apple-touch-icon.png`, `og.png`. Confirm `site/index.html` + `site/privacy.html` `<link rel=icon>` /
  `apple-touch-icon` still resolve.

## 4. Ambient (iOS/Android lock screen)
- iOS Live Activity / Dynamic Island and the Android persistent notification use `notification-icon.png` (small
  icon) — covered in §2. If the Live Activity module bundles its own flame asset, flip that too.

## Verify
- `npx tsc --noEmit` clean; app boots.
- Screenshot home / done / daily-fire / lock-in → flame points the **new** way, identical everywhere (no screen
  shows the old orientation, none double-flipped).
- Open `site/index.html` locally → favicon + hero flame flipped.
- Icons/splash/notification only prove out on a native build — call that out so Noah folds it into the next
  `eas build` (delete + reinstall to clear the icon cache).
- List every file changed + the exact dimensions of each regenerated PNG.
