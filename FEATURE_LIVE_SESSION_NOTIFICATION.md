# Feature concept — Live session notification (Strava-style)

**Status:** logged pre-launch (Noah). Not yet specced for build. Captures the idea + the platform
reality (this one is NATIVE / build-gated, not OTA).

## The idea
While a lock-in is running, show a **persistent, tappable notification** on the lock screen / status
bar with the **session name + live elapsed time** — just like Strava's *"Walk · 12:05"*. Tapping it
returns you straight into the running session. So people stay informed and connected to their lock-in
**even after they leave the app**, and it's one tap back in.

It's the out-of-app twin of the existing in-app **live-session bar** (`live-session-bar.tsx` /
mock 25) — same info (name + timer + "return"), just surfaced by the OS when the app is backgrounded.

## Platform reality — this is native (needs a build, NOT OTA)
The two platforms do this very differently, and both require native work:

- **Android → foreground service + ongoing notification.** A persistent, non-swipeable notification
  that shows the running timer and a tap-to-return intent. Needs a foreground service (so the timer
  keeps running/updating while backgrounded) + `FOREGROUND_SERVICE` / notification permissions.
- **iOS → Live Activity (ActivityKit).** The proper Strava-equivalent: a live-updating card on the
  lock screen + Dynamic Island, with a native timer style (updates without constant pushes). Requires
  a **Widget Extension** target + Info.plist keys + a config plugin — real native setup.

**→ Build-gated.** Both sides add native code, so this ships in a **new build**, not over OTA. It
could ride the same freeze build as RevenueCat rather than forcing its own.

## Behavior
- Starts when a lock-in starts; shows `{session name} · MM:SS` counting up.
- **Tap → deep-links back into the running session** (reuse the existing session route + the
  live-session-bar's return logic).
- Ends/clears when the session is stopped or finished.
- Respects notification permission; degrade gracefully if denied (in-app bar still works).

## MVP vs later
- **MVP:** Android foreground-service notification first (simpler, and covers your Play-test
  audience) — name + live timer + tap-to-return.
- **Then:** iOS Live Activity (Dynamic Island + lock screen) — more work but the real payoff on
  iPhone; the feature that makes it feel premium.
- **Later:** action buttons on the notification (pause/stop), richer Live Activity layout (flame,
  XP-so-far).

## Gotchas
- **Timer accuracy:** don't push an update every second — use the native live-timer styles (iOS
  ActivityKit timer; Android chronometer) seeded from the session start time, so it ticks without
  draining battery.
- **Foreground service policy:** Android is increasingly strict about foreground-service types;
  declare the correct type + rationale or Play review flags it.
- **iOS Live Activities** need the app to request/start the activity from the running session and end
  it reliably (a stranded Live Activity is a bad look).

## Open questions
- Launch scope, or fast-follow? (Native → rides a build; Android-only first is a smaller lift.)
- Bundle into the RevenueCat freeze build, or its own build later?
- Android-first for launch, iOS Live Activity as a fast-follow?
