# Focus Nudge / Family Controls — ops + build runbook

Stand up the iOS Screen Time interception that powers Focus Nudge (open a social app → Cindy's caring nudge).
This is its **own native build**, separate from the Cindy build. The main-app Family Controls distribution
entitlement is already **approved**; the extensions and implementation are the remaining work.

**Constants:** main bundle `com.philoi.app` · Apple Team `WA73L5743X` · everything below is on the **Apple
Developer portal** (developer.apple.com), NOT App Store Connect (that's only for TestFlight/submission later).

---

## The four bundle IDs
| Target | Bundle ID |
|---|---|
| Main app | `com.philoi.app` (Family Controls already approved) |
| Device Activity Monitor | `com.philoi.app.DeviceActivityMonitor` |
| Shield Configuration | `com.philoi.app.ShieldConfiguration` |
| Shield Action | `com.philoi.app.ShieldAction` |
| App Group (shared, all 4) | `group.com.philoi.app` |

The three extensions do the work: **DeviceActivityMonitor** watches the chosen apps, **ShieldConfiguration**
draws the nudge screen over the blocked app, **ShieldAction** handles the buttons on it.

---

## Part A — Apple Developer portal (ops, do these in order)

### A1. Request the distribution entitlement for the 3 extensions
- Family Controls needs a **distribution entitlement request** (a form, not a toggle) — the main app came back
  approved; the extensions still need it.
- developer.apple.com → **Support / Contact → request the Family Controls (Distribution) entitlement**, listing
  the three extension bundle IDs above. Apple grants it to the team; can take days — **start this first.**

### A2. Create the 3 extension App IDs
- Certificates, Identifiers & Profiles → **Identifiers → +** → App ID → create each of the three bundle IDs
  above (Device Activity Monitor, Shield Configuration, Shield Action).

### A3. Enable Family Controls on all 4 App IDs
- On `com.philoi.app` **and** each extension App ID → edit → **Capabilities → enable Family Controls**.
  (Only possible after A1 is granted for the extensions.)

### A4. Create the App Group + enable on all 4
- Identifiers → **App Groups → +** → `group.com.philoi.app`.
- Enable the **App Groups** capability on all four App IDs and assign `group.com.philoi.app`. This is how the app
  hands the pre-fetched nudge text to the shield (extensions can't reliably call the network).

### A5. Provisioning
- Regenerate provisioning profiles for the main app + 3 extensions with the new capabilities (EAS can manage
  this if credentials are set to remote; otherwise create them here).

---

## Part B — Implementation — ✅ BUILT
🔴 Portal steps unlock the capability; this is the code, and it was the real lift.

**Decision: hand-rolled on `@bacons/apple-targets`, NOT `react-native-device-activity`.**
The community package was evaluated first, and it genuinely does cover this well — its shield is
config-driven from JS through the App Group, which is exactly the shape needed here. It was rejected
on one structural conflict: it scaffolds its targets through **`@kingstinct/expo-apple-targets`
0.1.19**, a fork of the very plugin this repo already runs at **`@bacons/apple-targets` 5.0.0**, and
both scan the same `targets/` directory. Running the pair would generate the Live Activity and
notification-service targets *twice*, and the only way out would be porting those two onto a fork
four majors behind — i.e. disturbing the existing Widget/Live Activity config, which the brief rules
out. `@bacons/apple-targets` already understands all three Screen Time target types natively
(`device-activity-monitor`, `shield-config`, `shield-action`) and writes each one's Info.plist,
`NSExtensionPointIdentifier` and principal class, so hand-rolling the Swift on top of it is less code
**and** one Xcode-project mutator instead of two.

### What exists now

| Piece | Where |
|---|---|
| Device Activity Monitor target | `targets/device-activity-monitor/` → `com.philoi.app.DeviceActivityMonitor` |
| Shield Configuration target | `targets/shield-configuration/` → `com.philoi.app.ShieldConfiguration` |
| Shield Action target | `targets/shield-action/` → `com.philoi.app.ShieldAction` |
| App-group contract (4 mirrored copies) | `FocusNudgeShared.swift`, guarded by `npm run check:focus-nudge` |
| Main-app entitlements | `plugins/withFocusNudgeEntitlements.js`, wired in `app.config.ts` |
| RN bridge (auth, picker, arm/disarm, handoff) | `modules/philoi-focus-nudge/` |
| The seam + payload builder | `src/lib/focus-nudge.ts` |
| Arm/disarm on session | `src/components/focus-nudge-sync.tsx`, mounted in `_layout` |
| Setup screen | `src/app/focus-nudge.tsx` (Settings → FOCUS → Focus Nudge) |
| Coach call | `fetchInterceptLine()` in `src/lib/api/coach.ts` → the existing `intercept` op |

### How it actually works
1. **Arming.** The app applies `ManagedSettingsStore(named: .focusNudge).shield.*` itself the moment
   a lock-in starts — instant, no waiting on a system callback. Alongside it a
   `DeviceActivitySchedule` is registered for a **12-hour failsafe window**: the monitor's
   `intervalDidEnd` is what takes the shield down if Philoi is force-quit mid-session (§D). A
   usage-threshold event re-arms after a "continue anyway" cooldown.
2. **The handoff.** At lock-in start the app calls the coach's `intercept` surface, splits the line
   into a headline + blurb, and writes JSON into `group.com.philoi.app`. The shield reads it
   synchronously and offline. **Nothing in any extension networks.** The payload also carries the
   §C-safety escalation card, so repeated retreat turns caring with no connection required.
3. **The buttons.** Primary opens Philoi — `philoi://lock-in` on a reinforce card,
   `philoi://support` on wellbeing/support. Secondary is the pass-through: it disarms the store for
   10 minutes and returns `.close`. **iOS has no `ShieldActionResponse` meaning "let them straight
   through"**, so after the disarm the app opens on the next tap. That extra tap is the entire cost
   of continuing — no penalty, no streak loss, nothing recorded.
4. **Safety (§C-safety).** The ShieldConfiguration extension records each presentation (debounced
   30s). Three inside an hour and it draws the wellbeing card instead — productivity push dropped,
   primary becomes "Talk to someone" → `src/app/support.tsx`. Escalation is **one-way**: a line the
   coach already marked wellbeing/support is never downgraded back to a push.

### Deliberately cut
- **The campfire affordance** ("Say hi in your campfire", mock 109 frame 2). An iOS shield gets
  exactly two buttons; the two that survive are the ones the spec makes non-negotiable — a way back
  in and a way through. It can return on the Android notification, which has room for three actions.
- **Android** — no longer cut. Built, on its own mechanism; see **Part D** below. The original plan
  in this slot was `UsageStatsManager` + a foreground service, and it was abandoned for a reason
  worth keeping: `UsageStatsManager` only answers when polled, so the nudge lands up to a second
  after the feed is already on screen — and that second IS the habit loop the feature exists to
  interrupt. A nudge that arrives after the dopamine is not a nudge.

---

## Part C — Build + verify

**🔴 BEFORE BUILDING — verify in the portal.** Neither can be checked from the repo, and both fail
*silently* rather than failing the build:
- [ ] App Group `group.com.philoi.app` **exists** and is enabled on **all four** App IDs. Missing on
      an extension → `UserDefaults(suiteName:)` is nil there → blank shield. Missing on the **main
      app** → everything looks wired and the shield shows the built-in fallback copy forever.
- [ ] Family Controls enabled on all four App IDs, and the three extensions' provisioning profiles
      **regenerated since** (a profile predating the capability signs fine and fails at runtime).

Then:
- New native targets → **its own `eas build`**, development-signed. `runtimeVersion` changes; can't
  OTA, and Expo Go cannot run extensions.
- On device: Settings → **Focus Nudge** → grant Screen Time auth → pick Instagram → start a lock-in →
  open Instagram → shield appears with Cindy's line → **primary** returns to the session,
  **secondary** lets you through on the next tap → repeated opens escalate to the wellbeing card and
  its "Talk to someone" button.
- **Airplane mode is the real test of the handoff.** Start a lock-in with the network on (so the line
  is fetched and cached), then turn airplane mode on and open a picked app. The shield must still
  show Cindy's *specific* line — the generic fallback instead means the App Group is not wired on the
  main app.
- Force-quit Philoi mid-session: the shield must come down within the failsafe window
  (`intervalDidEnd`), and immediately on the next launch (`FocusNudgeSync`'s cold-start sweep).

---

---

## Part D — Android — ✅ BUILT

No Family Controls, no Screen Time, no system picker. A different mechanism end to end, joined to
iOS at `src/lib/focus-nudge.ts` — which is where the shared half lives: the payload format, the
10-minute deferral, the two buttons, the escalation rule, the coach call, and
`src/components/focus-nudge-sync.tsx`, which drives both platforms without a single `Platform.OS`
check in it.

### The mechanism, and why it costs a Play review

**AccessibilityService**, subscribed to `typeWindowStateChanged` only, reading **only**
`event.getPackageName()`. On a match against the user's guarded list it attaches a
`TYPE_APPLICATION_OVERLAY` view **synchronously, inside the same event dispatch** — so the nudge is
on screen in the frame the guarded app comes forward, with no glimpse of the feed.

That instantness is the whole justification. `UsageStatsManager` needs no accessibility permission
and no review, and it is the wrong tool: it answers only when polled, ~1s late, which is exactly
long enough to deliver the hit the nudge was meant to interrupt. An Activity would be wrong for the
same reason at a smaller scale — a window transition animates, and the app underneath is visible for
all of it. Hence a WindowManager overlay, not a screen.

The cost is Google's **sensitive permission declaration** (`PLAY_ACCESSIBILITY_DECLARATION.md`) and
its multi-week extended review, accepted deliberately.

### What exists now

| Piece | Where |
|---|---|
| The service (detection only) | `modules/philoi-focus-nudge/android/…/PhiloiFocusNudgeAccessibilityService.kt` |
| The overlay (the nudge itself) | `…/FocusNudgeOverlay.kt` |
| Prefs contract + payload parsing | `…/FocusNudgeShared.kt` (the Kotlin twin of `FocusNudgeShared.swift`) |
| RN bridge (permissions, picker, arm/disarm) | `…/PhiloiFocusNudgeModule.kt` |
| Manifest, config XML, `<queries>`, strings | `plugins/withFocusNudgeAndroid.js` |
| The curated app catalog | `modules/philoi-focus-nudge/android-guarded-apps.json` |
| Setup screen (shared, Android branch) | `src/app/focus-nudge.tsx` |

### 🔴 The three things that must stay true

The declaration is only honest if the code matches it. Check all three before any Android release:

1. `android:canRetrieveWindowContent="false"` and `android:accessibilityEventTypes="typeWindowStateChanged"`
   — and nothing else — in `res/xml/philoi_focus_nudge_accessibility_config.xml`.
2. The service reads `event.getPackageName()` and no other field. No `getSource()`, no
   `rootInActiveWindow`, no `event.text`, no `performGlobalAction`.
3. No data egress. The Android library has **zero** gradle dependencies precisely so nothing
   transitive can ever open a socket.

Verify from the generated manifest, not from memory:

```bash
FOCUS_NUDGE_ANDROID=1 npx expo prebuild --platform android --no-install
cat android/app/src/main/res/xml/philoi_focus_nudge_accessibility_config.xml
grep -n "philoifocusnudge" -A 10 android/app/src/main/AndroidManifest.xml
grep -c "QUERY_ALL_PACKAGES" android/app/src/main/AndroidManifest.xml   # must be 0
```

### The picker: curated, not "any app"

Android has no `FamilyActivityPicker`, and enumerating installed apps needs `QUERY_ALL_PACKAGES` —
**a second sensitive-permission declaration**, reviewed separately from the AccessibilityService one.
So v1 guards a **curated list of ~14 known distracting apps** by package name, shown only if
installed. That needs only a `<queries>` allow-list and **no declaration at all**. One JSON file
feeds both the manifest and the picker so they cannot drift. "Pick any app" is a v2 upgrade that
buys a second review — take it only if people actually ask.

Deliberately absent from the catalog: browsers, messaging apps, phone/maps/banking. Guarding
WhatsApp catches far more genuine need than drift, and this feature must never be why someone could
not answer a message.

### The build flag — and why it is not in `feature-flags.ts`

`FOCUS_NUDGE_ANDROID=1` is a **build-time env var**, read by `app.config.ts` for *both* the config
plugin and `extra.focusNudgeAndroid` (which `FOCUS_NUDGE_ANDROID_ENABLED` reads back). It has to be,
because Play decides an app "uses the AccessibilityService API" by reading the **manifest** — a JS
constant would hide the setup screen and change nothing about the review.

**Where the flag is set — Noah's call, reversing the original plan.** The service ships **in** the
Android test build: it is a key feature testers have to exercise, so hiding it from them to protect
the closed test's schedule was optimising the wrong thing. `FOCUS_NUDGE_ANDROID=1` therefore sits in
`eas.json` on:

| Profile | Flag | Why |
|---|---|---|
| `preview` | **1** | the profile the Android test build ships from — testers get Focus Nudge |
| `production` | **1** | the Play release |
| `focus-nudge-dev` | **1** | dev-signed APK for on-device smoke and the demo video (extends `development`) |
| `development` | off | the one flag-off profile; keeps a plain dev client free of the service |

`focus-nudge-play` is **gone**. It existed only to add this flag on top of `production`, which now
carries it — leaving it in place would mean two names for one identical build, which is how the
wrong one gets built.

The accepted consequence: a manifest declaring an AccessibilityService is not distributable on the
closed track until Google's extended review clears (up to several weeks). That is lead time, not a
blocker — see the sequencing section of `PLAY_ACCESSIBILITY_DECLARATION.md`, including the
**Internal testing** fast path for getting a small group onto a flag-on build before the review lands.

```bash
# dev-signed APK, service ON — for on-device smoke and the demo video
eas build --platform android --profile focus-nudge-dev

# the Android test build testers install — service ON
eas build --platform android --profile preview

# AAB for the Play track that carries the declaration (starts the extended-review clock)
eas build --platform android --profile production
```

Confirm the flag actually took: a `preview` / `production` / `focus-nudge-dev` build's manifest must
contain `expo.modules.philoifocusnudge.PhiloiFocusNudgeAccessibilityService`; a `development` build's
must not.

**Verified on this branch**, by prebuilding both ways rather than reading the plugin:

| | flag OFF | flag ON |
|---|---|---|
| `philoifocusnudge` in manifest | 0 | the `<service>`, `BIND_ACCESSIBILITY_SERVICE`-guarded |
| any `accessibility` string | 0 | the config XML + its strings |
| `res/xml/philoi_focus_nudge_accessibility_config.xml` | absent | `typeWindowStateChanged`, `canRetrieveWindowContent="false"`, `isAccessibilityTool="false"` |
| guarded-app `<package>` entries | 0 | 15, from `android-guarded-apps.json` |
| `QUERY_ALL_PACKAGES` | 0 | 0 |

(The lone `<service>` in a flag-off manifest is expo-audio's `AudioControlsService`, and the lone
`SYSTEM_ALERT_WINDOW` is the bare template's — both predate Focus Nudge, as the plugin's comment
predicted.)

### On-device verification

- Settings → **Focus Nudge** → the disclosure card appears **before** the Accessibility hand-off
  (this is a policy requirement, not a nicety) → enable **both** switches → pick Instagram.
- Start a lock-in → open Instagram → the nudge is there **instantly, with no visible glimpse of the
  feed**. If you can see the feed at all, something has been added between the event and `addView`.
- **Primary** opens Philoi into the lock-in. **"Continue anyway"** drops you straight into Instagram
  and holds for **exactly 10 minutes** — check at ~9 min (still quiet) and ~11 min (nudges again).
- **Back** goes home rather than through; it is not a free bypass.
- **Airplane mode**, same as iOS: start the session online so the line is cached, then fly and open
  a guarded app. Cindy's *specific* line must still appear — the generic fallback means
  `writePayload` never landed.
- Open the app a third time inside an hour: the wellbeing card, with **"Talk to someone"**.

### Deliberate divergences from iOS

Everything user-facing matches — same copy, same two buttons, same 10-minute deferral, same one-way
escalation. Three things underneath do not, and all three are the platform forcing it:

- **Permission is two switches, not one prompt**, and no app can grant either. Hence the disclosure
  card and two hand-offs to Settings, where iOS raises one dialog.
- **"Continue anyway" continues in one tap.** iOS costs an extra one, because `ShieldActionResponse`
  has no value meaning "let them straight through"; the Android overlay just comes down onto the app
  they were already opening. Android is the better of the two here.
- **No mid-scroll re-arm.** iOS's DeviceActivity usage-threshold event puts the shield back once ten
  minutes of guarded-app usage have actually been spent, so a continuous forty-minute scroll after a
  "continue anyway" gets interrupted again. On Android the deferral only lifts at the next window
  change, so it does not. Left open deliberately — closing it means a delayed callback inside a
  service the OS may unbind at any moment, whose failure mode is an overlay stranded over the wrong
  app, and the iOS re-arm only exists because a shield there is *applied state* that had to be
  restored. Nothing is applied here. Reconsider if real use shows it matters.

### Known limit: OEM battery killers

Xiaomi, Samsung, Oppo and friends aggressively kill background work, and some will unbind an
accessibility service. **The guard is best-effort, not ironclad**, and it is honest to say so.

No foreground service was added to fight this, deliberately. It would not help — the system unbinds
the *accessibility* service, and a foreground service of ours cannot prevent that — and
`FOREGROUND_SERVICE_SPECIAL_USE` carries its own Play Console justification, i.e. a second review to
buy nothing. If a real device shows the service dying in practice, the fix is the OEM's own
autostart/battery allow-list, surfaced as a note on the setup screen.

---

## Related release ops (not Focus Nudge, but open — track together)
- [ ] Commit the untracked pile on the working tree: the two audio files (`sfx-emberfall-strike`, hearth hum),
      the prod-live-but-untracked `0116_goal_drip`/`0117` migrations, `#6` `lockin-goal-picker.tsx`.
- [ ] Merge `add-marketing-site` → `master` (DB is ahead of client for the reward reveal).
- [ ] Run `CODE_PROMPT_cindy_lockin.md` (mid-session Cindy) → then cut the **Cindy native build**
      (`SHIP_CINDY_BUILD.md`): flame assets + both sounds + Cindy + reward-reveal client.
- [ ] GCal: flip `GOOGLE_CALENDAR_ENABLED`, add yourself as a Google **test user**; submit OAuth verification
      for general availability.
- [ ] Google Play closed test (12 testers × 14 days) — tracker #68.
- [ ] Focus Nudge (this doc) — its **own** native build, after the above.
