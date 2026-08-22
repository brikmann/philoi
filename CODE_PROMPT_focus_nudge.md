# Code prompt — Focus Nudge (social-media app-open push)

Build the gentle intervention: when you open a picked distracting app **during a live lock-in**, Philoi surfaces
a warm, pass-through message ("Come on — you said you'd lock in… go say hi to your friends or step outside,
then come back strong") with real affordances. **Soft, not a wall** — you can always continue, no penalty.

Independent of the campfire A/B work (native / plugin layer) → **safe to run in parallel in its own worktree.**

**⚠ Coordination:** clear any `.git/index.lock` + commit first. Own worktree. Don't edit the spec/mock.

**Source of truth:** `APP_BLOCKER_SPEC.md` + mock **109** (`design-mocks/109-focus-shield.html`).

## Entitlement status (unblocked)
- **Family Controls (Distribution) is APPROVED** for the main app ID. Enable **Family Controls** on the App ID
  in the portal + regenerate profiles (EAS can manage). 🔴 **Each Screen Time extension you scaffold gets its
  own bundle ID → request the entitlement for each** (Device Activity Monitor · Shield Configuration · Shield
  Action), or they fail to sign at distribution.
- Build/test against the **Family Controls (Development)** capability meanwhile.

## Build
1. Add **`expo-app-blocker`** (iOS Screen Time + Android UsageStats/overlay) behind a **custom EAS dev client**
   (not Expo Go). Its config plugin scaffolds the extensions + entitlements.
2. **Setup screen** (Settings → Focus Nudge, offered on first lock-in): grant permission (iOS Screen Time auth
   / Android Accessibility) → **pick apps** (Apple `FamilyActivityPicker` / Android app list) → toggle "Nudge
   me automatically when I lock in" (default ON). No consequences to configure.
3. **Arm on lock-in start** → the picked apps for the session window; **disarm on end**. 🔴 **Failsafe:** never
   leave it armed past the session (DeviceActivity end-schedule = max session length; disarm on kill/crash).
4. **✨ AI message (Sonnet) — the message is generated, not canned.** Server-side Sonnet writes a
   supportive-friend line from the user's data (current session, whether it's tied to a goal/challenge, session
   history, streak, time-of-day, the goal's stakes + deadline, exam-season context, which app they opened). It
   **chooses the intent**: *reinforce* ("almost exam season, you need to pass BU111 — back to it") when the
   session matters and they're fresh, or *permission for a genuine break* ("you've grinded all week — go
   outside or text a friend, not the feed") when the data reads burnout. 1–2 sentences.
   - 🔴 **Latency:** the iOS `ShieldConfiguration` extension renders **synchronously** — it can't await a
     network call. **Generate at lock-in start** (refresh on meaningful context change), **cache to the shared
     app-group container**; the extension reads the **latest cached message**; **static fallback** if none.
     Android can generate at fire-time but keep the cache-first pattern.
   - **Cost:** one generation per session (not per app-open) + a **uniform rate limit**; cache aggressively.
     **Free** (wellbeing utility — never paywall). Same Sonnet backend as AI custom goals.
   - 🔴 **Safety-first bias (NON-NEGOTIABLE — `APP_BLOCKER_SPEC §C-safety`).** Encode in the **system prompt**:
     **never shame / never imply laziness.** Repeated retreat to socials = possible avoidance/distress, not
     slacking → on a repeated-retreat pattern, **drop productivity and switch to a wellbeing tone** (go
     outside, text someone you trust); on distress signals, gently point to **real support** (trusted person /
     campus resources / helpline) — warm, brief, non-clinical, non-diagnosing. **Safety always overrides "get
     back to the session."** Add a minimal in-app "talk to someone" support surface the nudge can link to.
   - **Privacy:** context goes to the server-side AI — note it in the permission/consent copy.
5. **The nudge (open a picked app):**
   - **iOS:** render the shield as that message (`ShieldConfiguration`) + flame. Buttons via `ShieldAction`:
     **Back to my session** · **Continue anyway** (dismiss for that app, **no penalty**).
   - **Android:** on the picked app foregrounding (Accessibility/UsageStats), post the message as a
     **notification / light interstitial** with the same actions.
   - **"Say hi in your campfire"** affordance routes into the user's campfire.
   - **Frequency guard** — once per app-open + short cooldown; never nag.
6. Voice = mock 109 (concerned friend, not warden). Continue-anyway is always available and silent.
7. **✨ Re-engagement nudge (the other direction) — `APP_BLOCKER_SPEC §C2`.** When **not** in a session, a
   background/scheduled check lets Sonnet decide **whether + when** to nudge the user back: reads time since
   last lock-in, effort vs their norm, goal deadlines, streak risk, time of day — and **stays quiet if they're
   overworked** (only nudges when the break reads sufficient). Fires an **AI-written push** deep-linking to
   start a lock-in ("solid breather since this morning's Orgo session — exam's in 5 days, round two? 🔥").
   **This upgrades the fixed daily-fire reminder** — don't fire both. Rate-limited, honors quiet hours + the
   Streak-&-reminders toggle, free, same Sonnet backend.
8. **📅 Google Calendar as a data source (if connected) — `GCAL_INTEGRATION_SPEC.md`.** When the user has
   connected GCal (read-only OAuth, a **separate integration build** in Connected Apps), **feed the upcoming
   window (server-side, fetched at message time) into the AI context** so both nudge directions reason over
   **real** exams/deadlines/free-busy: true "exam Friday" lines, "you're behind" awareness, nudge into free
   windows, and **stay quiet during class/busy**. The coach must still work **without** it (less precise). Don't
   warehouse the calendar — fetch the relevant window, use it, don't store the whole thing.

## Guardrails
- No apps / permission not granted → feature simply off; **never blocks the ability to lock in**.
- Permission revoked → "Focus Nudge is off — re-enable in Settings," don't crash.
- Privacy: iOS selection is opaque tokens — don't read/log app identities.

## Acceptance (from `APP_BLOCKER_SPEC.md`)
- [ ] Setup: permission + pick apps + auto-on toggle.
- [ ] Lock-in arms the picked apps; badge "Focus Nudge on" on the lock-in screen.
- [ ] Opening a picked app shows the **AI-written** message (iOS shield / Android notification) with Back /
      campfire / Continue-anyway; **Continue proceeds with no penalty**.
- [ ] Message is Sonnet-generated from the user's data (goal/deadline/burnout aware), cached at session start
      for the shield, static fallback if not ready; one gen/session + rate-limited; free.
- [ ] Disarms at session end + failsafe on kill/crash; frequency-guarded.
- [ ] No apps / no permission never blocks locking in.
- [ ] All 3 extension bundle IDs carry the Family Controls entitlement (distribution-signable).
