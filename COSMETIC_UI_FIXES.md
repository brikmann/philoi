# Cosmetic UI — the applied-layer fixes (the real #127/#132 work)
_The item-art **thumbnails** render fine. The bugs are all in the **applied** layer — the cosmetic on the live surface. Each item below is a real defect Noah is seeing, traced to its file. Reproduce first, then fix to match the scoped mock. Flames are fine — leave them._

## 1 · Cards are buggy
- **File:** `src/components/economy/applied-art.tsx` → `EquippedCardBackdrop` (144) + `CardTextureLayer` (182: brushed/weave/mesh/cracks/grid/plated/plain).
- **Symptom:** the equipped profile/showcase card doesn't render correctly.
- **Fix:** reproduce on the profile (and anywhere a card backdrop applies), find why the texture layer isn't painting / is clipping / mis-sizing, and make each of the 7 textures render cleanly behind content. Reference: mock 107 (profile + card).

## 2 · Halos don't align and look bad
- **File:** same file → `EquippedAvatarHalo` (284) + `HaloRing` (316: ring/double/glow/prism/flare/aura/crown).
- **Symptom:** the halo doesn't center on the avatar and reads poorly.
- **Fix:** the ring must be **centered on the avatar and scale with its diameter** (absolute-positioned, size derived from the avatar size, not a fixed value). Fix each style's geometry so it hugs the avatar. Then confirm it renders on **profile, and the new Agora post authors** (mock 162 halo flex). Reference: mock 107.

## 3 · No way to add a banner to a campfire
- **File:** `src/components/campfire-banner-art.tsx` — the render component **exists** (owner's equipped banner → header background) but nothing lets an owner **choose** it.
- **Fix:** add the affordance: in the campfire options/settings sheet (`campfire-options-sheet.tsx`), let the **campfire owner pick from their owned banners**, persist it on the group, and confirm the campfire header actually invokes `CampfireBannerArt`. Reference: mock 110 (`.banner` header art).

## 4 · Flares are choppy / load as blobs (rain + Emberfall Ascendant)
- **File:** `src/components/economy/flare-perimeter.tsx` (452).
- **Symptom:** on load, flares appear as static blobs before animating; the **rain** effect and **Emberfall Ascendant** especially look like blobs, not the scoped effect.
- **Fix:** the animated shared values start at 0/1 and `withRepeat` only begins after mount, so the **first painted frame is a static blob**. Seed each effect's value mid-cycle (and stagger/`withDelay` the particle loops) so it's never shown static; make the rain read as **falling embers**, and give **Emberfall Ascendant** its scoped motion. Match mocks **119 + 126 + 167**.
- **Color bug — Zeus' Wrath renders blue, should be gold.** Its palette is `from:#2A5AE0` (blue) → `to:#FFE87A` (gold); the applied flare is leaning on the `from` stop so the aura reads blue. Zeus = golden thunderbolts — it should render **gold-dominant** (blue only as a faint storm undertone). Either swap `from`/`to` for `flare-zeus-wrath` in catalog, or have the flare renderer lead with the brighter stop. (Asgardian Valor stays blue — that's the intended blue zap.) Reference: mock 167.

## 5 · Flame particle effects don't render AT ALL
- **Finding:** there is **no applied particle layer**. `item-art` has a `particle` *thumbnail* case and `catalog.ts` has PARTICLE items (Floating Sparks, Falling Ash, Ember Swarm), but **nothing paints particles around the live flame** — the applied component was never built.
- **Fix:** build an **applied particle emitter** around the home/session flame (reuse flare-perimeter's `Glow` primitive, scoped to the flame), driven by the equipped PARTICLE cosmetic's palette. Reference: mock 126 (flames + particles).

## 6 · Audio — needs an off switch + per-session change
- **File:** `src/lib/sound.ts` (`startAmbientLoop`/`stopAmbientLoop`/`AMBIENT_SOURCES` — swap-capable, idempotent) + `equipped-audio.ts`. SFX/audio playback itself is fine.
- **Fix, two parts:**
  1. **Disable toggle** — add a **"Session audio" on/off** setting (Settings). When off, don't call `startAmbientLoop`. People want their own music, **especially at the gym** — so the ambient loop must be silenceable. Also revisit `playsInSilentMode: true` (sound.ts ~147): it plays *over* the user's music on silent; at minimum honor the toggle, ideally duck to their music.
  2. **Change between sessions** — surface an **audio switcher on the lock-in start sheet** (pick which equipped ambient this session uses, or none). `startAmbientLoop(newId)` already swaps idempotently, so the plumbing exists — this is UI + wiring.

## 7 · 🔴 The screen sleeps mid-lock-in and kills everything
- **Root cause:** `expo-keep-awake` is **not installed** and there is **no iOS background-audio mode** (sound.ts only sets `playsInSilentMode: true`, no `staysActiveInBackground` / `UIBackgroundModes: ['audio']`). So when the display auto-sleeps during a session, the flare + flame animations stop AND the ambient loop pauses. Both die at once. This undercuts every cosmetic above.
- **Fix:**
  1. `npx expo install expo-keep-awake`.
  2. In `src/app/lock-in/index.tsx`, while a session is active, hold the screen on — `useKeepAwake()` (or `activateKeepAwakeAsync()` on start / `deactivateKeepAwake()` on end + unmount), **gated on a setting**.
  3. **Settings toggle** "Keep screen awake" (default **on**), same pattern as the existing `SettingsToggleRow` + `reward-settings` prefs. Mock 164 panel 1 (Lock-in screen section).
- **Note / optional follow-on:** keep-awake fixes the *auto-sleep* case (the reported bug). If the user *manually* locks the phone or backgrounds the app, audio still stops unless true background audio is enabled (`staysActiveInBackground: true` + `UIBackgroundModes: ['audio']` in app.config) — a bigger change with review implications. Recommend keep-awake now; treat background-audio as a separate decision.

## Not a bug
- **Flames** — fine, leave them.
- **SFX / audio playback** — fine; only the controls in §6 and the screen-sleep in §7 are the gaps.

## Order
Quick wins first: **6** (audio toggle — user-blocking at the gym) and **3** (campfire banner — pure missing UI, component exists). Then the rendering fixes **1, 2, 4, 5** (reproduce → fix → compare to the mock). Commit + push so it lands.
