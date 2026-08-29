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
- **Android**, which has no Family Controls at all. Detect app opens via `UsageStatsManager` (needs
  `PACKAGE_USAGE_STATS`, user-granted in Settings) plus a foreground/accessibility service, then post
  the nudge. Its own task; don't block iOS on it. The setup screen already says so honestly rather
  than showing a dead toggle.

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
