# Focus Nudge — gentle intervention on lock-in

The #1 feature real users asked for — but **not a hard block.** When you open a distracting app during a
lock-in, Philoi greets you with a warm, concerned message that offers *affordances* ("tired? go talk to your
friends or step outside, then come back strong") instead of a willpower wall. You **can** continue if you
really want — no penalty. It changes your mind through empathy, not force. Simpler to build, kinder, and more
"Philoi" than every blocker on the market.

## Decisions (locked)
- **Soft, pass-through caring message** — no block, no session-ending consequence, no friction gate. Opening a
  picked app during a session surfaces the message; the user can tap **Back to my session** or **Continue
  anyway** (allowed, no penalty).
- **Affordances, not willpower** — the message points to *real actions*: come back to the session, go say hi
  in your campfire (routes into Philoi's own social layer), or take an honest break. Concern + a next step.
- **User-picked apps** — the user chooses which apps trigger the nudge.
- **Auto every lock-in** — armed with the session; disarms when it ends. Global on/off in settings.

## Platform mechanics (still native — the intercept needs the OS)
Knowing an app was *opened* is a privileged OS capability. Use **`expo-app-blocker`** / `react-native-device-
activity`; requires a **custom dev client**, not Expo Go.

**iOS — Apple Screen Time API** (`FamilyControls` + `ManagedSettings` + `DeviceActivity`):
- iOS gives no other way to detect "user opened Instagram." The intercept is the **shield** — but we render it
  as the **caring message** (`ShieldConfiguration` extension), and the buttons are handled by a **`ShieldAction`**
  extension: **primary → Back to Philoi**, **secondary → Continue anyway** (dismisses the shield for that app,
  no penalty). So the "shield" is a soft interstitial, not a lock.
- User picks apps via Apple's **`FamilyActivityPicker`** (opaque tokens — we never see the identities), armed
  for the session window via `DeviceActivity`.
- 🔴 **Family Controls entitlement still required** — per bundle ID: main app + each extension
  (Device Activity Monitor, Shield Configuration, Shield Action) ≈ **4 requests**, **days–weeks** approval,
  digital-wellbeing use case (we qualify). **File now — launch-gating for iOS.** Develop against the Family
  Controls (Development) capability meanwhile.

**Android** — an **Accessibility Service** / UsageStats detects the picked app entering the foreground and
Philoi posts the caring message as a **notification / light interstitial** with the same actions. Fully custom.

## Flows

### A. Setup (Settings → Focus Nudge, offered on first lock-in)
1. Explainer: "When you drift to a distracting app mid-session, we'll gently pull you back — not lock you
   out." → **Grant permission** (iOS Screen Time / Android Accessibility).
2. **Pick apps** — Apple picker (iOS) / installed-app list (Android).
3. Toggle **"Nudge me automatically when I lock in"** (default ON).

### B. During a lock-in (auto)
- Arm the picked apps for the session window. Lock-in screen shows a small badge: **"🫶 Focus Nudge on."**
- No apps picked / no permission → feature off, a subtle "Set up Focus Nudge" prompt; **never blocks locking
  in.**

### C. The nudge (they opened a picked app)
- Warm message (iOS shield / Android notification-interstitial). Voice = concerned friend, not warden:
  > **"Come on — you said you'd lock in."** Your {Study} session's still running ({12:47}). If you're tired,
  > that's fair — go say hi to your friends or step outside, then come back strong.
- Actions:
  - **Back to my session** (primary) → returns to Philoi.
  - **Say hi in your campfire** (affordance) → opens the user's campfire chat (turn the pull toward the app's
    own social layer — the healthy version of the urge to check something).
  - **Continue anyway** (ghost) → dismisses, proceeds to the app. **No penalty, no streak loss.**
- **Frequency guard:** don't re-fire on every second — nudge once per app-open, with a short cooldown, so it
  stays a gentle tap on the shoulder, not nagging.

### D. End
- Session ends → disarm automatically. Failsafe: never leave the nudge armed past the session (schedule end =
  max session length; disarm on app-kill recovery). Since it's pass-through, there's no stranding risk, but
  still disarm cleanly so a stray tap post-session doesn't nag.

## What this model drops (vs a hard blocker)
No break-the-block friction, no session-ending consequence, no "broke focus" campfire notification, no
overlay-that-traps. Kinder and much less to build. (Accountability still lives elsewhere in Philoi — streaks,
challenges, the campfire — it just isn't enforced by trapping people here.)

## Edge cases
- **No apps / no permission** → feature off; never blocks locking in.
- **Permission revoked** → detect, show "Focus Nudge is off — re-enable in Settings," don't crash.
- **Continue-anyway** is always available and silent — this is a nudge, not a gate.
- **Privacy:** iOS selection is opaque; don't try to read or log app identities.

## Build order
1. **File the entitlement (×4 bundle IDs) now** — the long pole (iOS).
2. `expo-app-blocker` behind the dev client; permission + picker in Setup.
3. Arm on session start, disarm on end (+ failsafe).
4. iOS `ShieldConfiguration` (the caring message) + `ShieldAction` (Back / Continue). Android foreground
   detect → notification-interstitial with the same actions.
5. "Say hi in your campfire" affordance routes into the campfire.

## iOS — how to actually get the barriers working (checklist)
1. **Request the entitlement** `com.apple.developer.family-controls` via Apple's **Family Controls
   (Distribution)** request form (developer.apple.com → Support → request). Describe the digital-wellbeing use
   case (helping students stay focused during study lock-ins). **Submit one request per bundle ID**: the main
   app + each extension below. Approval = days–weeks.
2. **Develop while you wait:** add the **Family Controls (Development)** capability in Xcode — it works on your
   own devices for testing without the distribution entitlement. (You just can't ship to TestFlight/App Store
   until Distribution is approved.)
3. **Enable the capability** on each App ID in the Developer portal (Certificates, Identifiers & Profiles),
   regenerate provisioning profiles, and add the Family Controls capability to the app + extension targets.
4. **Create three Screen Time extensions** (their own bundle IDs, each entitlement-requested):
   - **Device Activity Monitor** — arms/disarms the shield to the session window.
   - **Shield Configuration** — renders the caring message (our copy + flame).
   - **Shield Action** — handles the buttons (Back → return; Continue anyway → dismiss for that app).
5. **In-app wiring (Swift under the hood):**
   - `AuthorizationCenter.shared.requestAuthorization(for: .individual)` — user grants Screen Time access.
   - Present **`FamilyActivityPicker`** → get a `FamilyActivitySelection` (opaque tokens). Persist it.
   - Lock-in start → `ManagedSettingsStore().shield.applications = selection.applicationTokens`, scheduled via
     `DeviceActivityCenter`. Lock-in end → set it back to `nil`.
6. **Do it through Expo, not from scratch:** add **`expo-app-blocker`** (or `react-native-device-activity`) —
   their **config plugin scaffolds the extensions + entitlements**. Requires a **custom dev client via EAS
   build** (not Expo Go). Add the plugin to `app.json`, set the entitlement, `eas build`.
7. **App Review:** these apps get scrutinized — put a clear explanation + a demo account/flow in the review
   notes so the reviewer sees the wellbeing purpose.

**Bottom line:** the long pole is step 1 (entitlement approval, ×4 bundle IDs). File it today; everything else
can be built and tested against the Development capability in parallel.

## Acceptance
- [ ] Setup: permission grant + user picks apps + auto-on toggle.
- [ ] Lock-in arms the picked apps; lock-in screen shows the "Focus Nudge on" badge.
- [ ] Opening a picked app shows the warm message (iOS shield / Android notification) with Back / campfire /
      Continue-anyway.
- [ ] **Continue anyway proceeds with no penalty** (pass-through, not a block).
- [ ] Nudge disarms at session end + failsafe; frequency-guarded so it doesn't nag.
- [ ] No apps / no permission never blocks the ability to lock in.
