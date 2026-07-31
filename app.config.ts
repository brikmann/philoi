import type { ExpoConfig } from 'expo/config';

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
    icon: './assets/images/icon.png',
    associatedDomains: ['applinks:getphiloi.com'],
    infoPlist: {
    ITSAppUsesNonExemptEncryption: false,
    NSHealthShareUsageDescription:
      'Philoi reads only the activity your challenge needs — like steps or distance — to verify it automatically. Your health data stays on your device.',
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
    'expo-audio',
    'expo-sharing',
    'expo-updates',
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
    [
      'expo-notifications',
      {
        icon: './assets/images/icon.png',
        color: '#E0612C',
      },
    ],
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
        microphonePermission: 'Philoi needs your microphone to record sound with your set clip.',
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
