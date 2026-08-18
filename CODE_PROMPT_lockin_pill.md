# Code prompt — Lock-in pill / Live Activity (#87, supersedes #73 · NATIVE build)

Design: **`design-mocks/91-lockin-pill.html`** + **`FEATURE_LOCKIN_PILL.md`**. Native, build-gated —
needs an iOS Widget Extension (ActivityKit) + a config plugin + a fresh EAS build. **Cut this as its own native
build NOW — it's a big polish. RevenueCat (#71) is decoupled onto a separate later native build.** This **supersedes #73** (Strava-style live notification) — merge.

## The one pattern
While a lock-in runs, show a live timer on the **out-of-app surfaces** (Live Activity / notification) and
the **in-app lock-in screen**, in one consistent treatment:
- **PHILOI** — purple gradient wordmark (`linear-gradient(180deg,#C99BFF,#8A4FFF)`, bold, letter-spaced).
- **session name** — the user's session label (Study, Gym, …), same purple wordmark style; omit if unset.
- **timer** — counts up from session start, tabular-nums, **white**.
- **rank bar** — progress to the next **division** (e.g. 75% to Gold III), **filled in the current tier's
  colour** (not fixed gold), with a pulsing **ember-orange** projection cue (see **Rank bar + projection**).
- **flare tint (if equipped)** — the flare is now a **lock-in-only** cosmetic, so the session surfaces
  reflect it: a **faint flare-coloured border/accent** on the iOS Live Activity card + Dynamic Island, and
  the flare colour as the **Android notification accent `color`**. No flare → default styling. The flare
  tints the *frame* only — rank bar stays tier colour, timer white, PHILOI purple.

## Surfaces
1. **iOS Live Activity (ActivityKit)** — out of app:
   - **Lock Screen:** centered `PHILOI · session`, timer under it, **75%-to-Gold rank bar at the bottom**.
   - **Dynamic Island:** *expanded* = same minus the bar (`PHILOI · session` + timer, centered — no room
     for the bar). *compact* = timer trailing + a small purple dot leading. *minimal* = timer.
   - Drive the timer with SwiftUI `Text(timerInterval:)` (`.timer` style) so it counts on the Lock Screen
     with **no push updates**. Push an update only when the session ends or the rank bar changes.
2. **Android** — an **ongoing notification** on the lock screen. ~~Recommend **Notifee**~~ — **BUILT WITHOUT
   IT** (2026-08-17): Notifee's last release is 9.1.8 (Dec 2024), its Android module targets compileSdk 34
   against our 36, and it has no Live Updates support, so `modules/philoi-live-activity/android/` calls
   `NotificationCompat` directly. Also **no foreground service** — Path A in NATIVE_BUILD_CONFIG.md, since
   the OS ticks the chronometer itself. It's OS notification chrome, not a branded card (no gradient, no
   pulse — see the platform note). What carries:
   - **Live timer, no repeated updates:** show a chronometer — Notifee `showChronometer: true`,
     `chronometerDirection: 'up'`, `timestamp: sessionStartMillis`; native equivalent
     `setUsesChronometer(true)` + `setWhen(start)` + `setChronometerCountDown(false)`. Android ticks it
     itself.
   - **Title** = `PHILOI · session`. contentText = the rank line, e.g. `~2h to Gold III` (static text — no
     pulse).
   - **Rank %** = a determinate progress bar: Notifee `android.progress = { max: xpForNextTier, current:
     xpIntoTier }` / native `setProgress(max, current, false)`. Update on XP change (cheap). Hide the bar
     at Primordial (max).
   - `ongoing: true` (non-dismissible while running), `visibility: PUBLIC` (shows on the lock screen),
     category stopwatch/progress. Tear down the FGS + cancel the notification when the session stops.
   - **Android 16+ "Live Updates":** promote to the progress-style status-bar chip where the API exists;
     fall back to the plain ongoing notification below 16.
3. **In-app lock-in screen** (dedicated active-session view): **session name** on top, the **flame** hero
   (SVG, ember gradient), big timer, rank bar at the bottom.

**The in-app pill is RETIRED.** No floating `session · timer` header on other pages — it reflowed clumsily
page-to-page and adjusting every header was too fiddly. Inside the app, only the lock-in screen shows the
session; out of app the Live Activity / Dynamic Island / Android notification carry the glanceable reminder.

## Data
- session name + start time from the active session; timer = now − start (count up).
- rank bar = progress toward the next **division** (see Rank bar + projection). Reuse the rank screen's
  source (universal_score / 0066).

## Rank bar + projection
- **Target the next DIVISION — already built, just consume it.** The ladder already has III → II → I per
  tier (`RANK_TIER_ORDER` in `src/lib/rank-tiers.ts`: bronze · silver · gold · platinum · diamond · hero ·
  titan · olympian · immortal; division 1 = top) and **Primordial as the singular apex with no divisions**.
  Use **`formatRankTier(tier, division)`** for the label — it already returns "Gold III" for tiers and just
  "Primordial" for the apex, so Immortal I → Primordial reads **"X% to Primordial"** (no numeral). Bar % +
  thresholds come from **`get_my_ranks()`** (`xpIntoTier` / `xpForNextTier`, already per-division; 0 at
  Primordial = max). **No rank-system change needed.**
- **Projection ghost (the "≈ time to next division" cue):**
  - Fill = the **current tier's colour** (current % into the division). A **pulsing ember-orange segment**
    fills the remaining gap to the next division, with a **tiny "~2h" label in the same orange** above it —
    small on purpose, so the eye lands on the pulse and reads "close." (Tier colour = where you are; orange
    = what you're chasing — see DESIGN_LANGUAGE_EMBER.md §7.)
  - Projection = (`xpForNextTier` − `xpIntoTier`) ÷ the user's recent XP/hour rate, rounded ("~2h"). **No
    rate yet (new user) → hide the projection**, show just the % bar.
  - **Animation is in-app only.** In-app (lock-in + rank screen) the ghost + label **pulse** live. On the
    Lock Screen / Dynamic Island they **show and update** on ActivityKit content refreshes but do **not**
    pulse (OS animation limit — same as the flame).
- On the lock-in screen this **replaces** the raw "1,480 / 2,000 XP" numerals with: division label + pulse
  + "~h". Keep the XP numerals on the full rank screen if useful there.

## Assets / tokens
- PHILOI wordmark = purple gradient. Flame = the SVG glyph (ember gradient `#ff5a1a→#ffc061`), shipped as
  an asset, **used on the lock-in screen only**. Rank bar fill = the **current tier's colour** (from
`RANK_TIER_METAL`); projection segment/label = **ember orange** `#F2A33C→#E0612C`.

## Build
- iOS: Widget Extension target (ActivityKit) + Expo config plugin for Live Activities. Start the activity
  when a session begins, end it when the session ends; handle stale / no-session states.
- Android: a foreground service (already partly needed to keep the timer alive) hosting the Notifee
  ongoing notification (chronometer + progress). Declare the FGS type + notification permission.
- One native EAS build alongside RevenueCat (#71).

## Verify
- Timer counts on the Lock Screen with the app backgrounded, no pushes; ends cleanly.
- Dynamic Island expand/collapse renders; compact/minimal show the timer.
- No floating in-app pill on other pages (retired) — only the lock-in screen shows the session in-app.
- Rank bar shows the correct % + XP + next-division name (`formatRankTier`); "Primordial" shows with no numeral.
- Android: the ongoing notification shows on the lock screen, the chronometer ticks on its own, the
  progress bar tracks the rank %, and both clear when the session ends.
