# Native build config — permissions/capabilities for the Ember native pass

What makes the **Live Activity (iOS)** + **ongoing session notification (Android)** actually build. These are
native declarations in `app.config` + config plugins; they only take effect in a **native EAS build / dev
client** — not OTA, not Expo Go. Add them in the **Ember polish native build (build #1), cut NOW** —
RevenueCat is **decoupled** onto a separate later build, so this one ships without waiting on the paid
agreement.

> **STATUS (2026-08-17): all of this is now IMPLEMENTED and in the tree**, verified against the Expo **v57**
> docs. What's below is the record of what landed and why, not a to-do list. Three of the original
> recommendations turned out to be wrong on this stack and were corrected — each is called out as
> **CORRECTED** so the reasoning isn't lost.
>
> | Piece | Where |
> |---|---|
> | Declarations | [`app.config.ts`](app.config.ts) |
> | iOS widget extension (SwiftUI + ActivityKit) | [`targets/lockin/`](targets/lockin/) |
> | JS→native bridge (iOS + Android) | [`modules/philoi-live-activity/`](modules/philoi-live-activity/) |
> | JS seam (all calls go through here) | [`src/lib/live-activity.ts`](src/lib/live-activity.ts) |
> | Lifecycle wiring | [`src/components/live-activity-sync.tsx`](src/components/live-activity-sync.tsx) |
> | Drift guard | `npm run check:live-activity` (runs inside `npm run typecheck`) |

## iOS — ActivityKit / Live Activities
1. **Info.plist:** `NSSupportsLiveActivities = true`. → `ios.infoPlist.NSSupportsLiveActivities = true`. ✅ set.
   Without it `Activity.request()` throws `.attributesNotSupported` at *runtime* — it is not a build error.
2. **Widget Extension target:** Live Activities render out of process, so the Lock Screen card + Dynamic
   Island UI must live in a Widget Extension. Expo prebuild does **not** scaffold one → added via
   **`@bacons/apple-targets` 5.0.0** (peer `expo >= 52`), configured in `targets/lockin/expo-target.config.js`
   with `frameworks: ['SwiftUI', 'WidgetKit', 'ActivityKit']`.
3. ~~**Deployment target ≥ iOS 16.1**~~ — **CORRECTED: do not set this.** SDK 57's own minimum is **iOS
   16.4+**, so pinning `16.1` would *lower* the target below what the SDK supports rather than raise it.
   ActivityKit's 16.1 floor is already satisfied by the baseline, so `ios.deploymentTarget` stays **unset**.
   (The *widget target* does pin `16.4` — it doesn't inherit the app's, and apple-targets defaults it lower.)
   Note SDK 57 exposes `ios.deploymentTarget` directly in app config; `expo-build-properties` is no longer
   the only route.
4. **Apple Developer portal: NO special capability/entitlement needed.** Confirmed — the timer self-counts
   via `Text(timerInterval:)`, so we never push, so no **Push Notifications** / `aps-environment`.
   `pushType: nil` on the request keeps it that way.
   - RevenueCat IAP needs no portal toggle beyond the **paid agreement** (StoreKit handles it).

## Android — session notification
**Path A chosen** (ongoing notification, **no foreground service**). A chronometer notification anchored to
the start timestamp ticks itself, so keeping our process alive buys nothing — and skipping the service skips
the Android 14 `foregroundServiceType` declaration and the Play Console special-use justification entirely.
Path B (`FOREGROUND_SERVICE` + `FOREGROUND_SERVICE_SPECIAL_USE` + `WAKE_LOCK`) is **not** wired; revisit only
if OEM task-killing proves to need it.

**Permissions** (`android.permissions` in app.config) — ✅ both set:
- `POST_NOTIFICATIONS` — Android 13+, **requested at runtime** before showing (reuses the existing
  `requestNotificationPermissions()` in `src/lib/notifications.ts`).
- `POST_PROMOTED_NOTIFICATIONS` — **CORRECTED: this was missing from this doc and is mandatory** for the
  Android 16 status-bar chip. Without it `setRequestPromotedOngoing(true)` is silently ignored — a plain
  notification, no error.

**CORRECTED — Notifee was rejected, not used.** The recommendation to install `@notifee/react-native` doesn't
survive contact with this stack: its latest release is **9.1.8 (December 2024)**, its Android module still
targets **compileSdk 34** against this app's 36, and it has **no Live Updates support**. Everything it would
have provided — chronometer, determinate progress, ongoing behaviour — is four calls on `NotificationCompat`,
so `modules/philoi-live-activity/android/` does it directly instead of taking on an unmaintained native
dependency in a fresh EAS build. What that means concretely:
- **Live timer:** `setWhen(startedAtMs)` + `setUsesChronometer(true)` + `setChronometerCountDown(false)`.
- **Rank %:** `setProgress(100, percent, false)`; hidden at the apex rather than pinned full.
- **Android 16+ Live Updates:** `setRequestPromotedOngoing(true)` behind `SDK_INT >= 36`, needing
  **androidx.core 1.17+** (which is why the module pins it). Below 36 the plain ongoing notification is the
  fallback.
- `setOngoing(true)` + `VISIBILITY_PUBLIC` + `CATEGORY_STOPWATCH`; channel importance **DEFAULT**, not LOW —
  Android 16 won't promote a low-importance notification to the chip — with sound/vibration stripped so it
  still doesn't buzz.

**Also rejected: `expo-widgets`.** First-party and does Live Activities, but as of SDK 57 it's **alpha**,
`@expo/ui` **can't render images** (we need the flame), and it has **no self-counting timer component**. The
entire design rests on the OS ticking the clock. Revisit when it exits alpha and exposes a timer.

## app.config snippets — as landed
```ts
ios: {
  // NO deploymentTarget — SDK 57's floor is already 16.4 (see §3 above).
  infoPlist: { NSSupportsLiveActivities: true },
},
android: {
  permissions: [
    'android.permission.POST_NOTIFICATIONS',
    'android.permission.POST_PROMOTED_NOTIFICATIONS', // Android 16 Live Updates chip
    // NOT Path B: no FOREGROUND_SERVICE / _SPECIAL_USE / WAKE_LOCK.
  ],
},
plugins: [
  '@bacons/apple-targets', // generates the widget extension from targets/lockin/
],
```

## The duplicated `ActivityAttributes` — the trap to know about
`Attributes.swift` exists **twice** and must stay byte-identical:
`targets/lockin/Attributes.swift` ↔ `modules/philoi-live-activity/ios/Attributes.swift`.

They can't share a module — the widget is its own Xcode target, the bridge builds as its own CocoaPod — so
each compiles its own copy and **ActivityKit matches them structurally at runtime**, by field name and type.
Drift produces **no build error and no visible runtime error**: the widget's decoder throws inside a system
daemon and the Lock Screen card simply never appears. `npm run check:live-activity` diffs them and fails
loudly; it runs as part of `npm run typecheck`.

## Reminders
- **All native** → needs a fresh EAS build / dev client; nothing here shows over OTA or in Expo Go. Every
  function in `src/lib/live-activity.ts` degrades to a **no-op** on a build without the module (lazy
  `require()` + `requireOptionalNativeModule`), which is the RevenueCat white-screen lesson applied.
- **Never push the timer** — `Text(timerInterval:)` and Android's chronometer both count up from a start
  timestamp on their own; pushing ticks burns the ActivityKit budget in minutes. There is deliberately no
  elapsed-seconds field anywhere in the data path.
- **Always tear down on "no session"** — including cold start, not just an explicit Stop. An activity
  outliving its session is the worst failure this feature has.
- Verify exact plugin syntax against the **current Expo SDK + library versions** — these APIs move. AGENTS.md
  points at the v57 docs; bump it with the SDK.
