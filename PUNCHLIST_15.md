# Punchlist 15 — two bugs (audio silence · flare intensity/scope)

## Bug 1 — equipped audio never plays (even at full volume)
**Root cause:** `src/lib/sound.ts:154` sets `await setAudioModeAsync({ playsInSilentMode: false })`. On iOS
that honours the ringer/mute switch, so **when the phone is on silent (the common case) ALL cosmetic audio
is muted** — the equipped ambient loops *and* the reward SFX — no matter the volume. That's exactly the
symptom: "not loading even from no volume to high volume" — it's the **silent switch, not volume**, gating
it. The current comment even notes expo-audio's default is `true`; someone deliberately flipped it to
`false` "to respect silent mode," which silences opt-in media.

**Fix:** set **`playsInSilentMode: true`** (the expo-audio default).
```ts
await setAudioModeAsync({ playsInSilentMode: true });
```
Equipped ambient environments + reward SFX are **deliberate, opt-in media** (the user equipped them and has
the in-app sound toggle + device volume) — they should play through the mute switch like a music/meditation
app. The in-app `sound` preference and device volume stay the real controls.

**Nothing else is wrong** — `AMBIENT_SOURCES`, the catalog ids (`audio-heavy-bonfire-crackle`, `audio-edm-
pulse`, …), `startAmbientLoop`, and the `activeSession → startEquippedAmbient()` trigger all line up. Purely
the audio-session flag.

## Bug 2 — flare is app-wide + full-screen + too intense
**Wanted:** a **very faint, cool border** on the **lock-in screen only**.
**Currently:** two problems in `src/components/economy/flare-perimeter.tsx` + its mount:
1. **Scope — it's mounted app-wide.** `EquippedFlarePerimeter` renders at ROOT (`src/app/_layout.tsx:307`),
   so an equipped flare paints on **every screen, always** (by the old FLARES_SPEC "app-wide flex" call, #86).
2. **Intensity/coverage.** `PEAK_OPACITY = 0.38`, `EDGE = 92` (a 92-px band from each edge), **plus roaming
   full-screen effects** — blobs travelling the whole height, drops falling full height, 110-px flame
   tongues, corner plasma. So it reads as a **full-screen wash**, not a faint border.

**Fixes:**
- **Scope to the lock-in screen.** Remove `<EquippedFlarePerimeter />` from `_layout.tsx`; render
  `FlarePerimeter` **inside the lock-in/session view** (`src/app/lock-in/index.tsx`) only while a session is
  active. ⚠️ This **reverses #86 / FLARES_SPEC's "app-wide flex."** Update FLARES_SPEC.md + mock 88 to match.
- **Make it faint.** `PEAK_OPACITY 0.38 → ~0.14`; keep the slow breath but shrink its range.
- **Border, not full-screen.** `EDGE 92 → ~40`; **tame every effect to hug the edges** — halve the effect
  peak opacities (smoke `.16→.08`, plasma `.20→.10`, drops `.42→.20`, zaps `.50→.25`, flames `.16+.16 →
  .08+.08`), shrink blob size/travel, cut the flame tongue height `110 → ~44` and keep it low on the bottom
  edge. Net: a quiet coloured rim + a whisper of the effect, not a screen-filling animation.

**CONFIRMED — lock-in only.** The flare is now a **lock-in cosmetic**: the faint border renders **only on the
lock-in screen while a session is active** (not app-wide). This reverses #86 / FLARES_SPEC's app-wide flex —
update FLARES_SPEC.md + mock 88.

**Plus — the session's out-of-app surfaces reflect the flare** (so the flex still travels, tied to the
session): during a lock-in with a flare equipped, tint the **iOS Live Activity card + Dynamic Island** with a
faint flare-coloured border/accent, and set the **Android notification accent `color`** to the flare colour.
No flare → default styling. See `CODE_PROMPT_lockin_pill.md`.

## 3 · Flare catalog changes (from mock 88 — all in `src/lib/economy/catalog.ts`)
Apply these to the `FLARES` entries; visual reference is **`design-mocks/88-flare-auras.html`**.
- **Renames** (collided with FLAME cosmetic names — free them up):
  - `flare-stormforge` "Stormforge" → **"Asgardian Valor"**, id **`flare-asgardian-valor`** (blue `#2E7BFF` · zaps).
  - `flare-toxic` "Toxic" → **"Acid Rain Flare"**, id **`flare-acid-rain`** (green `#6FE22A` · falling).
- **Zeus' Wrath colour** → cream-gold **`#FFE87A`** (was white) so the zaps read as lightning. Update
  `flare.colour` on `flare-zeus-wrath`.
- **Emberfall Ascendant — bespoke effect.** Add **`'emberfall'`** to the `FlareEffect` union and to
  `FlarePerimeter`: a faint **lava aura pooling at the bottom** + **embers raining from the top** (flames +
  falling combined). Set `flare-emberfall-ascendant` effect to `'emberfall'` (colour `#FF5A2E`).
- **Rarities** (by pizzazz — glow = epic, particles = legendary, brand-signature = mythic):
  - **Mythic:** `flare-zeus-wrath`, `flare-inferno`, `flare-emberfall-ascendant` (Forge Pass).
  - **Legendary:** `flare-void-purple-aura` (Void Smoke), `flare-void-plasma`, `flare-asgardian-valor`,
    `flare-acid-rain`.
  - **Epic:** `flare-white-incandescence`, `flare-solar`.
