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

### C. The nudge (they opened a picked app) — ✨ AI-WRITTEN (Sonnet)
The message is **not canned** — Sonnet writes it from the user's data so it lands like a friend who actually
knows what's going on. This is what makes the loop *actionable*: it steers to **back-to-the-session OR a
genuine break** (not doomscrolling), and it picks which based on the data.
- **What Sonnet reads:** the current session (what they're locked in on, its type, whether it's tied to a
  **personal goal / active challenge**), **session history** (recent frequency/volume, streak, time of day,
  late-night), the **goal's stakes + deadline** (e.g. "need to pass BU111"), **time context**, plus which app
  they opened — **and, if connected, the user's Google Calendar** (`GCAL_INTEGRATION_SPEC.md`): real exams,
  assignment due dates, class times, free/busy. This is what makes deadline lines *true* ("BU111 midterm is
  Friday") instead of guessed, and unlocks **"you're behind"** awareness (upcoming deadlines vs recent effort).
- **It chooses the intent:**
  - **Reinforce (get back to it)** when the session matters and they're not overworked — reads the goal +
    urgency + a push. *E.g. "It's almost exam season and you've got a few weeks left. You need to pass BU111 —
    let's get back to it."*
  - **Permission for a genuine break** when the data says burnout — a lot of recent sessions, long streak, late
    night. *E.g. "You've put in a ton this week — feeling burnt out? Go outside or text a friend, not the feed."*
- **Voice:** supportive friend, not warden. 1–2 sentences, concise (fits a shield / notification).
- 🔴 **Latency pattern (critical):** the iOS shield extension renders **synchronously** and can't wait on a
  network call. So **generate the message server-side at lock-in start** (and refresh on meaningful context
  change), **cache it to the shared app group** (UserDefaults/app-group container); the `ShieldConfiguration`
  extension reads the **latest cached message**. **Static fallback** if none is ready. (Android can generate at
  fire-time but use the same cache-first pattern.)
- **Cost:** one generation per session (not per app-open) + a **uniform rate limit**; cache aggressively.
- **Free** — it's wellbeing utility, not flex; never paywall it (same principle as the AI custom goal). Same
  Sonnet backend as AI goals / the "Cindy" idea — one AI service.
- **Privacy:** sends session/goal context to the AI backend (server-side) — note in the permission/consent copy.
- Actions:
  - **Back to my session** (primary) → returns to Philoi.
  - **Say hi in your campfire** (affordance) → opens the user's campfire chat (turn the pull toward the app's
    own social layer — the healthy version of the urge to check something).
  - **Continue anyway** (ghost) → dismisses, proceeds to the app. **No penalty, no streak loss.**
- **Frequency guard:** don't re-fire on every second — nudge once per app-open, with a short cooldown, so it
  stays a gentle tap on the shoulder, not nagging.

### C-safety. Safety-first bias (wellbeing) — NON-NEGOTIABLE
Repeatedly retreating to social apps during focus time is **not laziness** — it's often avoidance, and a person
who keeps pulling away may be going through something. Philoi is a productivity/competition app, which makes it
*dangerous* to answer distress with "grind harder." So the AI's default, whenever it's uncertain, is
**care and connection over productivity.**
- 🔴 **Never shame. Never imply laziness / falling behind as a character flaw.** Not once.
- **Graduated response, not one tone:**
  - *Occasional drift* → the normal caring nudge (back to it, or a break).
  - *Repeated retreat in a short window / avoidance pattern* → **switch fully to a wellbeing tone**: stop
    pushing productivity, nudge toward **real-world connection and restraint** — "you've been pulling away a
    lot today — that's okay. Step away properly: go outside, or text someone you trust." **Connection, not
    the essay.**
  - *Signs of genuine distress* (persistent late-night retreat, sharp withdrawal) → gently affirm it's okay to
    reach out and **point to real support** (a trusted person / campus resources / a helpline) — warm, brief,
    **never clinical, never alarmist, never diagnosing.** Offer to help find someone to talk to.
- **Safety overrides the goal.** If it's ever a coin-flip between "get back to your session" and "are you ok —
  go connect with someone," it **always** picks the second. A missed study block is nothing; a person who
  needed a check-in and got a productivity nag is a real harm.
- **Behavioral signals only, non-surveillant framing.** It's a friend who noticed, not a monitor. Don't label
  or diagnose; keep it gentle and human. Encode this bias in the **system prompt**, not as an afterthought.
- Pairs with a lightweight **support-resources surface** in-app (a "talk to someone" entry the nudge can link
  to) — build a minimal one if none exists.

### C2. The other direction — ✨ AI re-engagement nudge (BETWEEN sessions)
The same brain runs the opposite way: **when you're NOT locked in**, Sonnet reads your data and estimates *"they've
taken a good break — time to pull them back to their thing."* This makes the AI an actual coach (knows when to
rest, when to re-engage), not just a blocker.
- **Trigger:** a background/scheduled check (not during a session) decides **whether and when** to nudge — it's
  AI-timed, not a fixed hour.
- **Signals it reads:** time since the last lock-in, today's / this week's effort vs the person's norm, **goal
  deadlines**, streak-at-risk, time of day, **and the connected Google Calendar** (real exams/deadlines +
  free/busy — `GCAL_INTEGRATION_SPEC.md`): nudge into a **free window before a deadline**, and **don't nudge
  during class/busy**. Crucially it also reads the **opposite** signal — if they just grinded hard / are
  overworked / nothing's due soon, **stay quiet and let them rest**. It only nudges when the break reads
  *sufficient*, not endless.
- **Delivery:** an **AI-written push** that deep-links to start a lock-in. *E.g. "You've had a solid breather
  since this morning's Orgo session. Exam's in 5 days — ready for round two? 🔥"*
- **Respect:** rate-limited, honors quiet hours + the **Streak & reminders** notification toggle. This
  **upgrades the fixed daily-fire reminder** (NOTIFICATIONS_SPEC) into an AI-timed, contextual re-engagement —
  don't also fire the dumb one.
- **Surface:** when the app is open, this motivational/re-engagement content is **Cindy's home channel**
  (a home speech bubble — `CINDY_SPEC.md`); when it's closed, it's a push. The **warm** voice lives on home;
  the **protective pushback** (this §C + §C-safety) lives at the social intercept. Same brain, routed by surface.
- Same Sonnet backend + free + cost-controlled as the in-session nudge (§C).

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
