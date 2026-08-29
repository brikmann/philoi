# Google Play — AccessibilityService Permission Declaration (paste-ready)

For Philoi's Focus Nudge on Android. This is the declaration you submit in Play Console → **App content → Sensitive app permissions / AccessibilityService**, filed **with a release build** that contains the service.

🔴 **The review clock starts on upload.** Have the demo video recorded and this form filled *before* the AAB goes up, not after — everything below is ready to paste, so the only thing on the critical path is the recording.

**One thing to get right up front:** Focus Nudge is **not** an assistive tool for people with disabilities, so it does **NOT** qualify for `isAccessibilityTool`. Declare the non-assistive use honestly and lean on the "reads only the foreground package name, nothing leaves the device" framing — that's what carries it.

---

## Field-by-field

**Does your app use the AccessibilityService API?** → **Yes.**

**Is your app's use of AccessibilityService to help users with disabilities?** → **No.** (Do not claim `isAccessibilityTool` — Philoi is a focus/digital-wellbeing tool, not an assistive one. Claiming it falsely is a hard rejection.)

**What is the core functionality of your app?**
> Philoi is a social accountability app that helps students stay focused. Users run timed "lock-in" focus sessions, set goals, and stay accountable with friends. **Focus Nudge** is an opt-in feature: the user chooses specific distracting apps (e.g. social media), and when one is opened, Philoi shows a brief full-screen reminder encouraging them to return to their focus session instead.

**Describe how your app uses the AccessibilityService API and why it is required.**
> Focus Nudge uses AccessibilityService **solely to detect, in real time, when a user-selected app is brought to the foreground** (the `TYPE_WINDOW_STATE_CHANGED` event's package name). On that event it displays an overlay reminder. It is required because Android provides **no other real-time signal that a specific app has been opened** — `UsageStatsManager` only polls after the fact, which lets the distracting app appear for up to a second before the reminder, defeating the feature's purpose (that brief exposure is exactly the habit loop the feature exists to interrupt). Instant detection is only possible via AccessibilityService.
>
> The service reads **only the foreground app's package name**, to compare it against the list of apps the user explicitly chose to guard. It does **not** read screen content, text, form fields, or any on-screen information; it performs **no** automation or input on the user's behalf; and it collects, stores, and transmits **no** data — everything stays on-device. The user turns the feature on, selects which apps it applies to, and can disable it at any time in Settings.

**Prominent disclosure & consent** → **Yes** (see the in-app copy below; show it *before* requesting the permission).

**Demo video** → required in practice; see the shot list below.

---

## Demo video — shot list

Google asks for a short screen recording. Three beats, in this order, unbroken if you can manage it — a reviewer who has to trust a cut is a reviewer looking for a reason. 60–90 seconds is plenty. Record it on a real device against a **flag-on build** (`preview` or `production` — both carry `FOCUS_NUDGE_ANDROID=1`; `development` does not and has no service to enable).

1. **The disclosure.** Settings → Focus Nudge. Let the disclosure card sit on screen long enough to read — this is the shot that proves the prominent disclosure came *before* the permission, which is the policy requirement. Do not tap through it quickly.
2. **Enabling it.** Tap through to Settings → Accessibility → Philoi Focus Nudge, show Android's own confirmation dialog (it renders `philoi_focus_nudge_description` — the same words as the declaration above), accept, then the overlay permission switch. Come back into Philoi and pick a guarded app.
3. **The nudge firing.** Start a lock-in, background Philoi, open the guarded app. The nudge must be on screen with **no visible glimpse of the feed** — that instantness is the entire justification for using this API instead of `UsageStatsManager`, so it is the single most valuable second of the video. Then show "Continue anyway" letting the user straight through, and the off-switch back in Philoi's settings.

Do not narrate claims the build does not make. The video should show nothing the declaration doesn't say.

---

## In-app prominent disclosure (show this BEFORE sending the user to enable the service)
> **Focus Nudge needs Accessibility access.**
> Philoi uses Android's Accessibility service to notice the moment you open an app you've chosen to stay away from, so it can show you a quick reminder to lock in instead.
> It only checks *which* app is in front — it never reads your screen, your messages, or anything you type, and nothing leaves your phone.
> You pick which apps this applies to, and you can turn it off anytime in Settings.
> **[ Turn on Focus Nudge ]   [ Not now ]**

---

## Store-listing line (must match the declaration — mismatches trigger rejection)
Add to the Play description:
> **Focus Nudge (optional):** choose the apps that distract you, and Philoi will nudge you back to your focus session the moment you open one. Uses Accessibility access only to detect which app is open — never reads your screen, and no data leaves your device.

---

## Why this passes (the reviewer's checklist, pre-answered)
- **Legitimate non-assistive use:** digital-wellbeing / self-control is an accepted category; the declaration states it plainly instead of hiding behind `isAccessibilityTool`.
- **Minimal scope:** foreground package name only — the narrowest possible use of the API, explicitly no content reading, no automation, no data egress.
- **User-initiated + revocable:** opt-in, user-selected app list, off-switch in Settings.
- **Description ↔ behavior match:** the store line, the disclosure, and the declaration all say the same thing. This is the single biggest rejection cause — keep all three identical.
- **Prominent disclosure before the permission prompt**, per policy.

---

## What the shipped manifest actually declares

Verified against a real `FOCUS_NUDGE_ANDROID=1 npx expo prebuild --platform android` on this branch, not asserted from the plugin source. Re-run it if any of `plugins/withFocusNudgeAndroid.js`, `app.config.ts`, or the service's Kotlin changes — the declaration is only honest while these hold.

```
android:accessibilityEventTypes="typeWindowStateChanged"   ← one event type, nothing else
android:canRetrieveWindowContent="false"                   ← the OS enforces "never reads your screen"
android:isAccessibilityTool="false"                        ← matches "not an assistive tool", above
android:canPerformGestures="false"
android:canRequestFilterKeyEvents="false"
android:canRequestTouchExplorationMode="false"
android:notificationTimeout="0"
```

Also confirmed on that prebuild:
- `QUERY_ALL_PACKAGES` is **absent** (count 0). The curated `<queries>` allow-list — 15 named packages from `modules/philoi-focus-nudge/android-guarded-apps.json` — needs no declaration of its own. "Pick any app" would buy a **second** sensitive-permission review; it is deliberately not in v1.
- The service is `android:exported="true"` guarded by `android:permission="android.permission.BIND_ACCESSIBILITY_SERVICE"`, so only the system can bind it.
- The Android library has **zero** gradle dependencies, so nothing transitive can open a socket.
- The service body reads `event.eventType` and `event.packageName` and no other field of the event.

---

## Sequencing

**Noah's call: the AccessibilityService ships IN the Android test build.** It is a key feature testers have to exercise, so `FOCUS_NUDGE_ANDROID=1` is set on **`preview`** (the profile the Android test build ships from) and on **`production`**. Only `development` — and `focus-nudge-dev`, which extends it *with* the flag — remains flag-off, and a flag-off build's manifest contains no `<service>`, no accessibility config, and none of the guarded-app `<queries>` entries.

The consequence, accepted deliberately: a build whose manifest declares an AccessibilityService is not distributable on the closed track until the extended review clears, which can take **several weeks**. That is lead time, not a blocker — but it is only lead time if the paperwork is already done, hence the "record before you upload" line at the top of this file.

So: build with the flag on → **record the demo video** → upload the AAB → fill this form on that release → submit → extended review.

### If testers are needed before the review clears

The **Internal testing** track has far lighter review than the closed track. A flag-on build can reach a small internal group (up to 100 testers, no 14-day requirement) quickly, which is enough to exercise Focus Nudge on real devices while the 12×14-day closed test (#68) runs its own course on whatever build is on that track.

This is offered as a fast path, not a requirement. It is worth taking if Focus Nudge feedback is on the critical path; it is not worth taking if the closed test is already giving you what you need.
