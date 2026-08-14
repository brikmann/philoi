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

## Status
Design-approved concept; build-gated. Spec the ActivityKit + Android pieces alongside the RevenueCat
native build so one build covers both.
