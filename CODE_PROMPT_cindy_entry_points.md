# Code prompt — Cindy entry points & surfacing

Small UI layer on top of the already-built Cindy (chat + voice + coach service exist). This wires **how you
reach her** across the app and the **tap animation**. Source of truth: `CINDY_SPEC.md` → "Entry points &
surfacing (mock 117 — FINAL)". Mocks: `design-mocks/117-cindy-entry-points.html` + the `cindy_tap_ring_pulse`
animation.

**Global rules (already in spec, don't regress):** the Cindy flame is the **mirrored** `PersonalFlame` /
`SessionFlame` (crest opposite the logo) — never the logo asset. **Never render a 🔥 emoji** in Cindy's UI or
dialogue; her avatar/name-tag is the vector flame. Every entry point below is **the flame itself** — no
separate chatbot button.

## 1. Home flame — tap / hold + ring pulse
- Tap the home flame → `router.push('/cindy')` (already wired). **Hold → voice** (`/cindy-voice`): add a
  long-press gesture on the same flame hit-target; a ring appears while held.
- **Ring-pulse press animation** (build into the shared flame component so it's identical everywhere):
  - `onPressIn`: flame **squash → spring** (`scale .9 → 1.06 → 1`, Reanimated `withSequence`).
  - Spawn **3 ember rings**, staggered ~140 ms, each ~0.9 s (`withTiming` scale ~0.2 → 3.6 + opacity .9 → 0).
    Ring stroke = warm ember (`rgba(255,150,70,.7)`).
  - **Tap** → fire once, then navigate. **Hold** → rings pulse **continuously** until release.
- **Proactive bubble sits ABOVE the flame** (under the greeting), auto-dismiss. 🔴 **No notification/attention
  dot on the flame** — removed as surveillance-y.

## 2. Header flame — reachable from every non-home screen
- Add a **small Cindy flame, top-right** of the header on Boards / Challenges / Profile (and any other non-home
  screen) → `router.push('/cindy')`. Uses the equipped cosmetic, mirrored, ~18–20px. No dot.
- ❌ Do **not** add a floating FAB.

## 3. Lock-in — Option A placement + tap quick-sheet
Screen already has: header (`Study · BU111` / campfire name), flame, `LOCKED IN`, timer, "locked in with you"
strip, camera + Stop, optional flare aura. Add Cindy without disturbing that stack:
- 🔴 **Proactive line = ABOVE the flame, directly under the header** (Option A). Keep the flame + LOCKED IN +
  timer as the uninterrupted centerpiece below it. Bubble avatar = vector flame, single short line,
  auto-dismiss. Fires **at milestones only** (30 / 60 / 90 min or a PR) — never continuous.
- **Tap the session flame → quick-sheet** (bottom sheet, NOT full chat): rows *How am I doing? · Add a note to
  this session · Open full chat*. Slides up over the camera/Stop row; dim the screen behind. "Open full chat"
  → `/cindy`.
- Must coexist cleanly with the flare aura and the body-doubles strip (see mock 117 §C Option A).

## Acceptance
- [ ] Home flame: tap → chat, hold → voice, ring-pulse on press; proactive bubble **above** flame; **no dot**.
- [ ] Header flame on every non-home screen opens Cindy; no FAB.
- [ ] Lock-in: proactive line **above the flame under the header**; tap → quick-sheet over the controls;
      milestones-only; coexists with flare + "locked in with you".
- [ ] Ring-pulse lives in the shared flame press state (same on home / lock-in / done).
- [ ] No 🔥 emoji anywhere in Cindy's UI/dialogue; flame is the mirrored asset.
