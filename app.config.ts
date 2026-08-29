import type { ExpoConfig } from 'expo/config';

/**
 * Focus Nudge on Android — a BUILD-TIME flag, and it has to be one.
 *
 * Everything else in src/constants/feature-flags.ts is a JS constant, because everything else only
 * decides what the app DOES. This one decides what the app's MANIFEST SAYS, and that is a different
 * kind of switch: Play treats a manifest containing an AccessibilityService as a sensitive-
 * permission app, which owes the declaration in PLAY_ACCESSIBILITY_DECLARATION.md and a multi-week
 * extended review, whether or not a single line of JS ever reaches the feature. A runtime flag
 * would hide the UI and change nothing about the review.
 *
 * So: OFF by default. The Google Play closed test (12 testers x 14 days) ships with no trace of the
 * service and is not gated on a review it does not need. Focus Nudge for Android is its own build
 * and its own submission —
 *
 *     FOCUS_NUDGE_ANDROID=1 eas build --platform android --profile development
 *
 * — and that submission is what starts the extended-review clock.
 *
 * ONE flag drives both halves: the plugin below (the manifest) and extra.focusNudgeAndroid (the JS
 * gate, read by src/constants/feature-flags.ts). They cannot disagree, which matters — a build
 * whose JS offers a setup screen for a service its manifest never registered would send people to
 * an Accessibility list that has no Philoi row in it.
 */
const FOCUS_NUDGE_ANDROID = process.env.FOCUS_NUDGE_ANDROID === '1';

const config: ExpoConfig = {
  name: 'Philoi',
  slug: 'philoi-app',
  owner: 'philoi',
  version: '1.0.0',
  orientation: 'portrait',
  icon: './assets/images/icon.png',
  scheme: 'philoi',
  userInterfaceStyle: 'automatic',
  backgroundColor: '#3A2E5C',
  ios: {
    bundleIdentifier: 'com.philoi.app',
    // REQUIRED by @bacons/apple-targets to generate and sign the Live Activity widget target
    // (#87) — without it prebuild warns "iOS builds may fail until this is corrected".
    //
    // Committed rather than read from the environment, deliberately. A Team ID is NOT a secret:
    // it ships inside every provisioning profile and is readable from any IPA. Env-driven, the
    // failure mode is a build that silently misconfigures the widget when the variable is unset —
    // which is exactly what happened before this was set at all. The env var stays as an override
    // for anyone building under a different team.
    appleTeamId: process.env.APPLE_TEAM_ID ?? 'WA73L5743X',
    icon: './assets/images/icon.png',
    // philoi.app is the live invite domain (FEATURE_feedback_and_domain / CAMPFIRE_REDESIGN_SPEC);
    // getphiloi.com stays claimed so invite links shared before the switch still open the app.
    associatedDomains: ['applinks:philoi.app', 'applinks:getphiloi.com'],
    // NOTE: no `deploymentTarget` here on purpose. NATIVE_BUILD_CONFIG.md called for 16.1
    // (ActivityKit's floor, Dynamic Island 16.1+), but SDK 57's own minimum is iOS 16.4+ —
    // pinning 16.1 would LOWER the target below what the SDK supports, not raise it. The
    // Live Activity requirement is already satisfied by the baseline, so this stays unset.
    infoPlist: {
      ITSAppUsesNonExemptEncryption: false,
      NSHealthShareUsageDescription:
        'Philoi reads only the activity your challenge needs — like steps or distance — to verify it automatically. Your health data stays on your device.',
      // Live Activities (#87) — without this the Lock Screen card + Dynamic Island never
      // appear, and Activity.request() throws .attributesNotSupported at runtime rather
      // than failing at build time. No push entitlement: the timer self-counts via
      // Text(timerInterval:), so we never push a tick (see modules/philoi-live-activity).
      NSSupportsLiveActivities: true,
      // Background audio (#147). The equipped ambient loop is the whole point of the Audio
      // cosmetics, and without this iOS tears the session down the moment the screen locks — so
      // the one time people most want a bonfire crackle running, a locked phone on a desk during
      // a study session, is exactly when it stopped.
      //
      // 'audio' ONLY. Not 'fetch', not 'processing', not 'remote-notification': each background
      // mode is separately justified at review, and the only thing that needs to survive
      // backgrounding is playback that the user started and can hear.
      //
      // expo-audio's config plugin adds this too when enableBackgroundPlayback is on (set
      // explicitly below). Declared here as well because it is a review-visible capability and it
      // should be readable in this file rather than inferred from a plugin default.
      UIBackgroundModes: ['audio'],
    },
  },
  android: {
    package: 'com.philoi.app',
    googleServicesFile: './google-services.json',
    adaptiveIcon: {
      backgroundColor: '#3A2E5C',
      foregroundImage: './assets/images/android-icon-foreground.png',
      backgroundImage: './assets/images/android-icon-background.png',
      monochromeImage: './assets/images/android-icon-monochrome.png',
    },
    predictiveBackGestureEnabled: false,
    intentFilters: [
      {
        action: 'VIEW',
        autoVerify: true,
        data: [
          // philoi.app first — it's what fetchInviteLink() now mints. getphiloi.com is kept so
          // codes already out in the wild keep resolving into the app.
          {
            scheme: 'https',
            host: 'philoi.app',
            pathPrefix: '/join',
          },
          {
            scheme: 'https',
            host: 'getphiloi.com',
            pathPrefix: '/join',
          },
        ],
        category: ['BROWSABLE', 'DEFAULT'],
      },
    ],
    // Health Connect (§17/19b) — minimal, read-only, one entry per record type this app
    // actually reads. Expo's own `android.permissions` field merges these into the manifest
    // directly; the rationale intent-filter half is react-native-health-connect's bundled
    // plugin, below in the plugins array.
    permissions: [
      'android.permission.health.READ_STEPS',
      'android.permission.health.READ_DISTANCE',
      'android.permission.health.READ_ACTIVE_CALORIES_BURNED',
      'android.permission.health.READ_EXERCISE',
      // Ongoing lock-in notification (#87). Android 13+ gates ALL notifications behind this
      // and it must be requested at RUNTIME, not just declared — see requestPermission() in
      // src/lib/live-activity.ts.
      'android.permission.POST_NOTIFICATIONS',
      // Android 16 (API 36) "Live Updates" — promotes the ongoing notification to the
      // status-bar chip. Undocumented in NATIVE_BUILD_CONFIG.md but mandatory: without it
      // setRequestPromotedOngoing(true) is silently ignored and you get a plain notification
      // with no error. Harmless on older versions (unknown permissions are dropped).
      'android.permission.POST_PROMOTED_NOTIFICATIONS',
      // Background audio (#147). Android will not let a process keep playing once it is no
      // longer foreground unless a foreground service is holding it up, so the ambient loop needs
      // these two. expo-audio's plugin declares the AudioControlsService that uses them.
      'android.permission.FOREGROUND_SERVICE',
      'android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK',
      // NOTE ON PATH A vs PATH B (NATIVE_BUILD_CONFIG.md). Path A was chosen for the SESSION
      // NOTIFICATION and that reasoning still holds untouched: a chronometer anchored to a start
      // timestamp ticks in the OS, so nothing of ours needs to run for the timer to stay right.
      //
      // Audio is a different requirement that argument never covered — a sound cannot be played
      // by a timestamp. So this is not Path B arriving late: the type here is MEDIA_PLAYBACK, the
      // ordinary one Android designed for exactly this, and not SPECIAL_USE, which is the type
      // that carries the Play Console justification Path A was avoiding. Media playback the user
      // started and can hear is the least contentious foreground service there is.
      //
      // Still deliberately NOT here: FOREGROUND_SERVICE_SPECIAL_USE and WAKE_LOCK.
    ],
  },
  web: {
    output: 'static',
    favicon: './assets/images/favicon.png',
  },
  plugins: [
    'expo-router',
    'expo-secure-store',
    'expo-image',
    'expo-status-bar',
    'expo-web-browser',
    // Background playback is opt-in territory and the default is not something this build should
    // depend on — it decides whether the plugin writes UIBackgroundModes and the Android
    // foreground-service permissions at all (#147). Stated, not inherited.
    //
    // microphonePermission is left alone on purpose: expo-speech-recognition sets the mic string
    // later in this array and therefore wins, which is the arrangement Cindy's copy already
    // depends on. Touching it here is how that regression comes back.
    ['expo-audio', { enableBackgroundPlayback: true }],
    'expo-sharing',
    'expo-updates',
    // Cindy's voice (CINDY_SPEC "STT-only architecture"). ON-DEVICE speech-to-text — the platform
    // recognizer, so transcription is free and no microphone audio ever leaves the phone. Only
    // her spoken REPLY costs anything (ElevenLabs TTS, server-side).
    //
    // Needs a dev-client rebuild: this ships native code, so it will not appear in an existing
    // binary until the next `eas build`. Cindy's text chat has no such dependency and works on
    // the current build — which is why voice is the layer on top rather than the way in.
    [
      'expo-speech-recognition',
      {
        // ONE string for both microphone consumers. iOS has a single
        // NSMicrophoneUsageDescription, so the LAST plugin to set it wins — expo-camera sits
        // further down this array and was overwriting Cindy's copy with the set-clip one, so the
        // prompt shown on the first tap-to-talk described filming a video. Both entries now carry
        // the same combined sentence, which makes the outcome independent of plugin order.
        microphonePermission:
          'Philoi needs your microphone so you can talk to Cindy, and to record sound when you film a set clip.',
        speechRecognitionPermission: 'Allow Philoi to transcribe what you say to Cindy, on your device.',
        // Android routes recognition through a speech service; without naming Google's, the
        // recognizer silently finds nothing on devices where it is not the default.
        androidSpeechServicePackages: ['com.google.android.googlequicksearchbox'],
      },
    ],
    [
      '@sentry/react-native/expo',
      {
        organization: 'philoi',
        project: 'react-native',
      },
    ],
    [
      'expo-font',
      {
        fonts: [
          'node_modules/@expo-google-fonts/inter/400Regular/Inter_400Regular.ttf',
          'node_modules/@expo-google-fonts/inter/500Medium/Inter_500Medium.ttf',
          'node_modules/@expo-google-fonts/inter/600SemiBold/Inter_600SemiBold.ttf',
        ],
      },
    ],
    [
      'expo-splash-screen',
      {
        backgroundColor: '#3A2E5C',
        image: './assets/images/splash-icon.png',
        imageWidth: 180,
      },
    ],
    [
      'expo-image-picker',
      {
        photosPermission: 'Philoi needs photo access to post a check-in.',
        cameraPermission: 'Philoi uses your camera so your circle can see you show up.',
      },
    ],
    [
      'expo-media-library',
      {
        photosPermission: 'Philoi needs photo access to save a campfire photo to your library.',
        savePhotosPermission: 'Philoi needs photo access to save a campfire photo to your library.',
        isAccessMediaLocationEnabled: false,
      },
    ],
    [
      '@kingstinct/react-native-healthkit',
      {
        // §17 — read-only, minimal scope. NSHealthUpdateUsageDescription: false opts OUT of the
        // write/update capability description entirely (the plugin otherwise adds a generic one
        // by default) since this app never calls a save*/write API. background: false skips the
        // background-delivery entitlement too — foreground sync only for this pass; wiring true
        // background delivery is left for later, not something to declare-and-not-use.
        NSHealthShareUsageDescription:
          'Philoi reads only the activity your challenge needs — e.g. steps — to verify it automatically. Your health data stays on your device.',
        NSHealthUpdateUsageDescription: false,
        background: false,
      },
    ],
    [
      'expo-build-properties',
      {
        // Health Connect on Android 14+ is part of the OS; older versions use the installable
        // APK (react-native-health-connect / src/lib/health-connect.ts detects and falls back
        // to manual entry — never a hard crash). These SDK levels are what its own setup docs
        // call for.
        android: {
          // Bumped to 36: newer AndroidX libs (androidx.activity 1.11.0, androidx.core 1.18.0,
          // pulled in transitively) require compiling against Android API 36+ (AAR metadata check).
          // compileSdk (which APIs compile) is independent of targetSdk (runtime behavior opt-in),
          // so target stays 35 — no new runtime behavior changes to re-test.
          compileSdkVersion: 36,
          targetSdkVersion: 35,
          minSdkVersion: 26,
        },
      },
    ],
    // Adds the OS "why does this app want my health data" rationale intent-filter — the
    // permission declarations themselves are android.permissions above.
    'react-native-health-connect',
    // Registers HealthConnectPermissionDelegate.setPermissionDelegate(this) in MainActivity.onCreate.
    // react-native-health-connect's bundled plugin does NOT do this, so requestPermission() otherwise
    // crashes with "lateinit property requestPermission has not been initialized" (issue #214).
    './plugins/withHealthConnectPermissionDelegate',
    // Declares com.google.android.apps.healthdata in <queries> so Android 11+ package visibility
    // doesn't hide Health Connect from us. Without it, getSdkStatus() reports SDK_UNAVAILABLE on
    // Android 13 and below even when Health Connect is installed — the connect flow then fails
    // silently. Also not covered by the library's bundled plugin.
    './plugins/withHealthConnectQueries',
    // Adds the Android 14+ VIEW_PERMISSION_USAGE / HEALTH_PERMISSIONS intent-filter to MainActivity.
    // Without it, requestPermission() returns an EMPTY grant on Android 14 (HC is OS-level there),
    // so connecting reports "that source isn't available right now" even though HC is present. The
    // library's bundled plugin only adds the older ACTION_SHOW_PERMISSIONS_RATIONALE filter.
    './plugins/withHealthConnectPermissionUsage',
    [
      'expo-notifications',
      {
        // MONOCHROME, not the app icon (punchlist 16 §7). Android masks small notification icons
        // down to their alpha channel and tints the result, so a full-colour logo renders as a
        // solid square — which is exactly what the app icon was doing here. This asset is a white
        // flame silhouette on transparent; regenerate with `node scripts/gen-flame-assets.js`.
        //
        // The plugin emits it as the `notification_icon` drawable, which is the name the Live
        // Activity module's smallIcon() looks up before falling back to applicationInfo.icon.
        icon: './assets/images/notification-icon.png',
        color: '#E0612C',
      },
    ],
    // Generates the iOS Widget Extension target that HOSTS the Live Activity (#87). Expo
    // prebuild has no notion of app extensions, so without this there is nowhere for the Lock
    // Screen card / Dynamic Island UI to live. The target's own config (frameworks, bundle id,
    // Swift sources) is targets/lockin/expo-target.config.js.
    //
    // Not expo-widgets: it's first-party and does Live Activities, but as of SDK 57 it's alpha,
    // @expo/ui can't render images (we need the flame), and it has no self-counting timer
    // component — the entire design rests on Text(timerInterval:) so the OS ticks the clock and
    // we never push. Revisit when it exits alpha and exposes a timer.
    // ...AND, with no change to the line above, the three Focus Nudge Screen Time extensions
    // (APP_BLOCKER_SPEC / FOCUS_NUDGE_SETUP.md): targets/device-activity-monitor,
    // targets/shield-configuration, targets/shield-action. This plugin generates every directory
    // under targets/, so adding those three needed nothing here — which is exactly why
    // react-native-device-activity was NOT adopted: it scaffolds its own targets through
    // @kingstinct/expo-apple-targets, a 0.1.x fork of this same plugin, and the two would each
    // generate all five targets. See targets/device-activity-monitor/expo-target.config.js.
    '@bacons/apple-targets',
    // The MAIN app's Family Controls + App Group entitlements. The three extensions declare their
    // own inside their expo-target.config.js files; nothing does the same for com.philoi.app, and
    // the App Group half fails silently — the shield draws its built-in fallback copy forever
    // because Cindy's line never reaches the shared container.
    './plugins/withFocusNudgeEntitlements',
    // The ANDROID half — the AccessibilityService <service>, its minimal-scope config XML,
    // SYSTEM_ALERT_WINDOW, and the <queries> allow-list for the curated guardable apps. Gated,
    // because this is the entry that turns Philoi into a sensitive-permission app in Play's eyes;
    // see the FOCUS_NUDGE_ANDROID note at the top of this file.
    ...(FOCUS_NUDGE_ANDROID ? ['./plugins/withFocusNudgeAndroid'] : []),
    // Native Google Sign-In (punchlist 2, §0) — replaces the Supabase-hosted OAuth redirect
    // page with the native account picker; supabase.auth.signInWithIdToken() still does the
    // actual auth exchange server-side, this just changes how the user gets the idToken.
    [
      '@react-native-google-signin/google-signin',
      {
        // iOS only: Google's SDK returns to the app through a custom URL scheme, and the scheme
        // it expects is the iOS client ID with its dot-separated segments REVERSED — so
        // `<id>.apps.googleusercontent.com` becomes `com.googleusercontent.apps.<id>`. The plugin
        // writes this into CFBundleURLTypes; without it the account picker opens and then has no
        // way back, so sign-in hangs on the Google page. Hardcoded rather than read from
        // process.env because config plugins run at prebuild time on EAS, where the local .env
        // isn't present — and unlike a secret this is public (it ships inside every install and
        // is derivable from the iOS client ID anyone can read out of the binary).
        iosUrlScheme: 'com.googleusercontent.apps.921536564136-s18vdec893u1dlgvhs5aaep59fdetmi3',
      },
    ],
    // Gym tracker phase-2 video clips (PHILOI_UI_SPEC.md §23) — behind GYM_VIDEO_CLIPS_ENABLED
    // until this ships in a real build (native modules, no OTA). expo-camera's own permission
    // strings are separate from expo-image-picker's above (that one's for a still-photo camera
    // launch; this is video-with-audio capture, so it needs its own mic string too).
    [
      'expo-camera',
      {
        cameraPermission: 'Philoi needs your camera to film a set clip to share with your campfire.',
        // Same combined string as the expo-speech-recognition entry above — see the note there.
        microphonePermission:
          'Philoi needs your microphone so you can talk to Cindy, and to record sound when you film a set clip.',
      },
    ],
    'expo-video',
    'react-native-compressor',
  ],
  runtimeVersion: {
    // 'sdkVersion' for now — 'fingerprint' hashes differently on Windows (local) vs EAS's
    // Linux build servers, which breaks the dev-client build from Windows. Fingerprint only
    // protects OTA-to-standalone anyway (the earlier crash), and dev-client + Metro doesn't
    // use OTA, so it buys nothing during iteration. WHILE ON sdkVersion: do NOT publish OTA
    // updates to preview/production channels (that's what caused the native-mismatch crash) —
    // dev iteration stays on Metro. Revisit 'fingerprint' when productionizing the OTA
    // pipeline, computed/published from a consistent env (EAS/CI), not local Windows.
    policy: 'sdkVersion',
  },
  // OTA JS updates via EAS Update — matched to the eas.json build profiles' own `channel` field
  // (development/preview/production), so a build only ever pulls updates published to its own
  // channel. Runtime-version-gated by the policy above: an update only applies to a build whose
  // native runtime it's actually compatible with, never silently skipping a required native
  // rebuild (e.g. this session's Health Connect/HealthKit/Strava native additions).
  updates: {
    url: 'https://u.expo.dev/f1031c6d-fd56-4d27-880a-0e87a7953f05',
  },
  experiments: {
    typedRoutes: true,
    reactCompiler: true,
  },
  extra: {
    // The JS half of the build-time flag above. Read through Constants rather than hardcoded in
    // feature-flags.ts precisely so it cannot drift from the manifest: one env var, one source.
    focusNudgeAndroid: FOCUS_NUDGE_ANDROID,
    supabaseUrl: process.env.SUPABASE_URL,
    supabaseAnonKey: process.env.SUPABASE_ANON_KEY,
    // TODO: RevenueCat — public SDK keys go here once billing is wired up.
    revenueCatIosKey: process.env.REVENUECAT_IOS_KEY ?? null,
    revenueCatAndroidKey: process.env.REVENUECAT_ANDROID_KEY ?? null,
    posthogApiKey: process.env.POSTHOG_API_KEY ?? null,
    posthogHost: process.env.POSTHOG_HOST ?? 'https://us.i.posthog.com',
    sentryDsn: process.env.SENTRY_DSN ?? null,
    // Public half of the Strava OAuth app only (§17) — safe client-side, it's the value in
    // every Strava authorize URL. The client secret lives ONLY in Supabase's Edge Function
    // secrets (supabase/functions/strava-*), never here.
    stravaClientId: process.env.STRAVA_CLIENT_ID ?? null,
    // Same deal for Whoop (§17) — public client id only. WHOOP_CLIENT_SECRET lives ONLY in
    // Supabase's Edge Function secrets (supabase/functions/whoop-*), never here.
    whoopClientId: process.env.WHOOP_CLIENT_ID ?? null,
    // Native Google Sign-In (punchlist 2, §0) — both are PUBLIC client IDs (safe client-side,
    // same trust level as an OAuth redirect URI). googleWebClientId MUST be the exact Client ID
    // already configured in Supabase's Google provider (Auth > Providers > Google) — that's what
    // makes the idToken this SDK returns acceptable to signInWithIdToken(). googleIosClientId is
    // a separate "iOS" type OAuth client (bundle id com.philoi.app) — Android needs no client id
    // in code, just its OAuth client's SHA-1 registered in Google Cloud Console.
    googleWebClientId: process.env.GOOGLE_WEB_CLIENT_ID ?? null,
    googleIosClientId: process.env.GOOGLE_IOS_CLIENT_ID ?? null,
    eas: {
      projectId: 'f1031c6d-fd56-4d27-880a-0e87a7953f05',
    },
  },
};

export default config;
