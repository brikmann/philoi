# Feature — Dynamic lock-in pill (Live Activity)

## What
A single dynamic **lock-in pill that lives on the phone's lock screen & home screen** during a
session — the pill IS the notification. Live timer + session name + aura/tier state, rendered as a
glanceable, tappable pill (tap to return to the session). Strava-style, but premium and branded.

Platform surfaces:
- **iOS** — an **ActivityKit Live Activity**: shows on the **Lock Screen** and in the **Dynamic
  Island** (the pill at the top of the screen). This is exactly the "dynamic pill that's always
  visible" idea.
- **Android** — an **ongoing / Live Update notification** promoted to the **lock screen + status-bar
  chip**, so it reads as a persistent live pill rather than something buried in the shade.

## Why
Premium feel + maximum visibility. Because it sits on the Lock Screen and Dynamic Island (not the
notification shade), people — and anyone glancing at their phone — see the active lock-in without
opening anything. That's the status-symbol payoff. It also resolves the earlier concern: a Live
Activity pill is far more visible than a notification you have to pull the shade down to see.

## Scope / important constraint
This is **native, not OTA.** Live Activities need an iOS widget extension (ActivityKit) and Android
needs the ongoing-notification/Live-Update config — both require a config plugin + a fresh **EAS
build**. So it's **build-gated**, same bucket as RevenueCat (#71): batch it into the next native build,
don't expect it to ship over-the-air.

- iOS: ActivityKit + a Widget Extension target; drive updates from the running session timer (and push
  updates if it needs to stay live while backgrounded).
- Android: foreground-service ongoing notification (already partly needed to keep a timer alive in the
  background); promote to lock screen. Android 16 "Live Updates" gives the richer chip where available.
- Expo: needs a config plugin (e.g. a Live Activity plugin) — confirm approach at build time.

## Aura across surfaces — where the pulse can actually live
Goal: the session-tiered aura (30/60/90, PUNCHLIST_14 #3) glowing/pulsing wherever the session is
shown, including the phone home screen. Real platform limits mean the *true pulse* only works on some
surfaces:

| Surface | Live timer | Tier-colored aura | Smooth pulse |
|---|---|---|---|
| In-app (lock-in / home tab) | ✅ | ✅ | ✅ full breathing pulse — no limits |
| Dynamic Island + Lock Screen Live Activity | ✅ | ✅ | ⚠️ limited — subtle pulse within ActivityKit's animation rules |
| **Home-screen widget (iOS WidgetKit / Android AppWidget)** | ✅ (auto-counting) | ✅ (glow that refreshes) | ❌ **not supported** — widgets are timeline snapshots, not a render loop; no continuous animation |

**Bottom line:** real pulsing aura in-app and (subtly) in the Dynamic Island; on the actual home-screen
widget it's a **tier-colored glow + live timer that updates**, not a smooth pulse. That's an OS
constraint, not a scope choice — WidgetKit/AppWidget simply don't allow free-running animation.

## Relationship to existing work
This **supersedes / is the real version of task #73** ("Strava-like live session notification"). Merge
them — #73 becomes this. The session-tiered aura (30/60/90, PUNCHLIST_14 #3) can drive the pill's
color/intensity so a deeper session literally glows on the lock screen.

## Flare = the lock-in aura only (FLARES_SPEC.md, mock 88)
**Decision (UPDATED) — flare is a lock-in cosmetic, not app-wide.** Equipping a flare renders a **faint
glowing border ONLY on the lock-in screen while a session is active** (was: every page — too intense, and it
showed when idle). Scoped to that flare's colour + signature effect (Void Smoke = purple + smoke · Zeus'
Wrath = white + zaps · …). The flex still travels via the session's out-of-app surfaces: during a lock-in the
flare colour tints the **Live Activity card + Dynamic Island** (faint border/accent) and the **Android
notification accent**. Full model + effect table: **FLARES_SPEC.md**. For coordination, the
pill below can tint to the equipped flare's colour.

## ⚠️ Honest OS limit — the aura can't paint the whole lock/home screen
A third-party app **cannot** render a glow around the entire phone lock screen or home screen on iOS or
Android — you only get to draw inside your own app and inside your Live Activity's card / Dynamic
Island region (iOS) or notification (Android). So:
- **Full perimeter aura = in-app only.** ✅ Fully doable.
- **Outside the app = the pill.** The Live Activity card / Dynamic Island shows the flame-coloured glow
  + flare motif; that's the "ambient aura." A literal screen-edge perimeter out there isn't possible.
- Don't scope a full-screen lock-screen perimeter — it will get cut at build. The pill IS the
  out-of-app aura, and it's still premium.

## Design — mock 91 (minimal, APPROVED)
`design-mocks/91-lockin-pill.html`. **One format everywhere, no flame, no widget.** Every surface =
**PHILOI · session** (purple wordmark) on top + the running timer centered underneath. Session name
(Study, Gym, …) is a quiet indicator of what the person is doing; if unset → just PHILOI + timer.
- **Lock Screen (Live Activity):** PHILOI · session, centered timer, **75%-to-Gold rank bar at the
  bottom** (goal always in sight). No upper compact pill.
- **Dynamic Island (expanded):** the same pill — PHILOI · session centered, timer underneath — **no rank
  bar** (no room).
- **In-app pill — RETIRED.** No floating `session · timer` header on other pages; it reflowed clumsily
  page-to-page. In-app, only the lock-in screen shows the session; out of app the Live Activity / Dynamic
  Island / Android notification carry the reminder.
- **Lock-in screen (dedicated active-session view):** **session name** on top, the **flame** hero, big
  timer, **75%-to-Gold bar at the bottom**. (The home screen itself just gets the pill, like any page.)
- **No home-screen widget** (dropped). Flame appears only on the lock-in screen; the pill surfaces are
  text.
- Build notes for Code: timer = ActivityKit native `timer` style (counts with no pushes); PHILOI = purple
  gradient wordmark; session name pulled from the session's label. Rank bar = progress to next rank
  (Gold) with XP numerals.

## Status
Design-approved concept + **premium-polish mock 91**; aura in mock 88; build-gated. The in-app perimeter aura is
OTA-able on its own; the pill / Live Activity is the native piece — spec the ActivityKit + Android
chip alongside the RevenueCat build so one native build covers both.
