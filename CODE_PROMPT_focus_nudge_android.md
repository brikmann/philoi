# Code Prompt — Focus Nudge for Android (AccessibilityService, instant, zero-glimpse)

Build the Android half of Focus Nudge. iOS is done (Family Controls, `worktree-focus-nudge`); Android needs its **own** native path because Android has no Family Controls. **It must be instant / zero-glimpse** — a `UsageStatsManager` poll leaves a ~1s peek at the distracting app, and that peek is the exact habit-loop the feature exists to kill. Instant on Android is only possible via **AccessibilityService** (event-driven `TYPE_WINDOW_STATE_CHANGED`), so that's the mechanism, and its Play-review cost is accepted.

**Branch:** new worktree off `integration-wave0` (not the iOS branch). **Reuse the shared layer** — `src/lib/focus-nudge.ts`, the module interface in `modules/philoi-focus-nudge/index.ts`, the setup screen, the coach `intercept` call, the 10-min `DEFER_MS`. Only the Android native side is new. Read `FOCUS_NUDGE_SETUP.md`, `PLAY_ACCESSIBILITY_DECLARATION.md`, and the iOS implementation for parity.

## Decision up front — the app picker (has a Play-permission consequence)
Android has no FamilyActivityPicker, and enumerating **all** installed apps needs `QUERY_ALL_PACKAGES` — itself a sensitive-permission declaration you'd have to justify separately.
- **Recommended v1:** a **curated list of known distracting apps** (Instagram, TikTok, X, YouTube, Reddit, Snapchat, Facebook, …) by hardcoded package name, shown only if installed. Checking specific packages needs only a `<queries>` allow-list — **no `QUERY_ALL_PACKAGES`, no extra declaration.**
- Full "pick any app" is a v2 upgrade that adds a second sensitive-permission review. **Do v1 curated** unless told otherwise; flag if you disagree.

## Build

### 1 · AccessibilityService — detection only
`modules/philoi-focus-nudge/android` → a service (e.g. `PhiloiFocusNudgeAccessibilityService`). On `TYPE_WINDOW_STATE_CHANGED`, read **only `event.getPackageName()`**, compare to the user's guarded list (in `SharedPreferences`), and if it matches **and** the defer cooldown isn't active, launch the overlay. **This is the crux for the Play declaration — it must be TRUE:** the accessibility config sets `canRetrieveWindowContent="false"`, subscribes to **only** `typeWindowStateChanged`, and the service **never reads screen content, text, or input, performs no automation, and sends nothing off-device.** Anything more breaks the declaration.

### 2 · The nudge overlay
`SYSTEM_ALERT_WINDOW` / `TYPE_APPLICATION_OVERLAY` — a full-screen view drawing Cindy's nudge (title / body / primary / secondary), copy read from `SharedPreferences` (the Android analog of iOS's App-Group handoff; **JS writes the pre-fetched copy locally, the overlay reads it — no network in the overlay**). Buttons, matching iOS: **primary → deep-link into Philoi and start a lock-in; secondary "Continue anyway" → set defer-until = now + `DEFER_MS` (10 min), dismiss.** Two buttons only, same survivors as iOS.

### 3 · JS side — same interface, Android branch
Keep `focus-nudge.ts`'s contract. `arm()` → verify Accessibility access **and** Draw-over-other-apps are granted (both can only be granted by the user in system Settings — open the right settings intents and guide them; you cannot enable an AccessibilityService programmatically), write the guarded list + nudge payload to `SharedPreferences`, mark enabled. `disarm()` → mark disabled + tear down any overlay. Setup screen reuses the shared one with the curated Android picker.

### 4 · Config plugin (Expo prebuild)
A `withAndroidManifest`-style plugin (mirror `plugins/withFocusNudgeEntitlements.js`): register the `<service>` with `BIND_ACCESSIBILITY_SERVICE` + `meta-data` → `res/xml/accessibility_service_config.xml`; add `SYSTEM_ALERT_WINDOW`; add the `<queries>` allow-list for the curated packages; write the accessibility config XML (**`typeWindowStateChanged` only, `canRetrieveWindowContent="false"`, minimal flags**). Additive — don't disturb the existing Android config or the iOS plugin.

## Guardrails
- **Minimal-scope is not optional** — `canRetrieveWindowContent=false`, package-name-only, no content/text/input, no data egress. The Play declaration (`PLAY_ACCESSIBILITY_DECLARATION.md`) asserts exactly this; the code must match it or the review is a rejection.
- **OEM battery-killers** (Xiaomi/Samsung/etc.) can kill background services → the guard is best-effort, not ironclad. Note it; a light foreground service to stay alive is acceptable but don't over-engineer.
- **Behind a flag** so the closed-test build can ship WITHOUT Focus Nudge (the AccessibilityService build is a separate Play submission that starts the review clock; the closed test doesn't wait on it).
- Parity with iOS: 10-min defer, two buttons, coach intercept, opt-in + revocable.

## Build outputs
- A **dev-signed APK** to smoke on-device (Metro reachable).
- An **AAB** to submit to a Play track **with the declaration** — that submission is what starts the extended-review clock. (Record the short demo video the declaration needs against this build.)

## Done =
On-device: enable it, pick a guarded app, open it → the nudge overlay appears **instantly, with no visible glimpse of the app** → primary opens Philoi into a lock-in → "Continue anyway" holds exactly 10 min → and confirm from the manifest/config that the service has **`canRetrieveWindowContent=false` and only `typeWindowStateChanged`** (the declaration's honesty depends on it). Report the picker approach taken (curated vs full) and confirm no `QUERY_ALL_PACKAGES`.
