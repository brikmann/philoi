# Native build config — permissions/capabilities for the Ember native pass

What makes the **Live Activity (iOS)** + **ongoing session notification (Android)** actually build. These are
native declarations in `app.config` + config plugins; they only take effect in a **native EAS build / dev
client** — not OTA, not Expo Go. Add them in the **Ember polish native build (build #1), cut NOW** —
RevenueCat is **decoupled** onto a separate later build, so this one ships without waiting on the paid
agreement.

## iOS — ActivityKit / Live Activities
1. **Info.plist:** `NSSupportsLiveActivities = true`.
   → app.config: `ios.infoPlist.NSSupportsLiveActivities = true`.
2. **Widget Extension target:** Live Activities render inside a Widget Extension (the Lock Screen card +
   Dynamic Island UI live there). Expo prebuild does **not** scaffold one — add it via a config plugin
   (e.g. `@bacons/apple-targets`) or in Xcode.
3. **Deployment target ≥ iOS 16.1** (Dynamic Island 16.1+; a few APIs 16.2).
4. **Apple Developer portal: NO special capability/entitlement needed** for a self-counting Live Activity.
   You'd only need **Push Notifications** (APNs + `aps-environment`) *if* you push updates — we don't; the
   timer self-counts via `Text(timerInterval:)`. **Skip push.**
   - RevenueCat IAP needs no portal toggle beyond the **paid agreement** (StoreKit handles it).

## Android — session notification
**Pick the path first — it changes how much config you need:**
- **Path A — ongoing notification only (simpler, recommended if display-only).** A chronometer notification
  (`ongoing: true` + `showChronometer`, anchored to the start timestamp) ticks itself and persists with
  **no foreground service, no FGS type, no Play justification.** Use this unless we truly need background
  code execution.
- **Path B — foreground service (what the prompt assumed).** Only needed to keep the process alive / survive
  aggressive OEM task-killing. Costs the Android 14 FGS-type + Play review.

**Permissions** (`android.permissions` in app.config):
- `POST_NOTIFICATIONS` — Android 13+, **request at runtime** before showing.
- *(Path B only)* `FOREGROUND_SERVICE` **+ a typed permission.** Android 14 (API 34) requires a
  `foregroundServiceType`; there's no "timer" type, so the honest fit is **`specialUse`** →
  `FOREGROUND_SERVICE_SPECIAL_USE`, with a justification declared in **Play Console** (`dataSync` is the
  fallback). Notifee registers the `<service>`; set its `foregroundServiceType`.
- *(Path B only)* `WAKE_LOCK`.

**Notifee:** install `@notifee/react-native` (native build only — do **not** add blind/OTA after the
white-screen), create a low/default **ongoing channel**, and *(Path B)* register the foreground service.

## app.config snippets
```js
ios: {
  infoPlist: { NSSupportsLiveActivities: true },
  deploymentTarget: '16.1',
},
android: {
  permissions: [
    'POST_NOTIFICATIONS',
    // Path B only ↓
    'FOREGROUND_SERVICE',
    'FOREGROUND_SERVICE_SPECIAL_USE',
    'WAKE_LOCK',
  ],
},
plugins: [
  // Notifee setup + the Live Activity widget-extension plugin go here
],
```

## Reminders
- **All native** → needs a fresh EAS build / dev client; nothing here shows over OTA or in Expo Go.
- **Recommend Path A for Android** unless we find we need background execution — it dodges the Android 14
  FGS-type + Play-review overhead, and the chronometer still ticks.
- **Never push the timer** — iOS `Text(timerInterval:)` and Android's chronometer both count up from a start
  timestamp on their own; pushing ticks burns the ActivityKit budget in minutes.
- Verify exact plugin syntax against the **current Expo SDK + Notifee versions** — these APIs move.
