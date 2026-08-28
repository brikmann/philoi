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

## Part B — Implementation (the actual build)
🔴 Portal steps unlock the capability; this is the code, and it's the real lift.

1. **Add native targets.** Expo managed can't add extra native targets alone. Either adopt
   **`react-native-device-activity`** (wraps the 3 extensions + the JS API) or write a **config plugin** that
   injects the entitlement + three extension targets at prebuild. Add the Family Controls + App Groups
   entitlements to the main app and each extension.
2. **JS flow (main app):**
   - Request **Screen Time authorization** (`FamilyControls` — `AuthorizationCenter`).
   - **FamilyActivityPicker** so the user chooses which apps to shield (store the opaque selection).
   - Set a **DeviceActivitySchedule** so the monitor watches those apps.
3. **The nudge text via the App Group.** The *brain* is already built — the coach has an **`intercept`** surface
   (`_shared/coach/index.ts`). Pre-fetch the line (e.g. at lock-in start, per the coach comment) and **write it
   to the shared App Group**; the **ShieldConfiguration** extension reads it from there and displays it. Wire
   the **ShieldAction** buttons ("okay, back to it" / "I really need a sec") to dismiss or defer.
4. **Safety (APP_BLOCKER_SPEC §C-safety):** repeated retreat → the wellbeing/support surface, never shame.
5. **Android is a separate implementation** — no Family Controls. Detect app opens via `UsageStatsManager`
   (needs `PACKAGE_USAGE_STATS`, user-granted in Settings) + a foreground/accessibility service, then post the
   nudge. Plan it as its own task; don't block iOS on it.

---

## Part C — Build + verify
- New native targets → **its own `eas build`** (not the Cindy build). `runtimeVersion` changes; can't OTA.
- Test on device: grant Screen Time auth → pick Instagram → open it → shield appears with Cindy's line →
  buttons behave → repeated opens escalate to the support surface.

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
