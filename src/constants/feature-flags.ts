import Constants from 'expo-constants';

// Circle chat is built (schema, RLS, moderation audit log, report/block/remove) and the
// chat-safety build (philoi_chat_safety_build.md) acceptance checklist — server-enforced
// blocking, rate limiting, disabled-account enforcement, circle/profile reportability, and
// real RLS proof tests (supabase/rls_isolation_test.sql) — has been walked through and passes.
export const CHAT_ENABLED = true;

// Device-verified fitness sync — Apple HealthKit (iOS) and Google Health Connect (Android),
// PHILOI_UI_SPEC.md §17. Neither native module (@kingstinct/react-native-healthkit,
// react-native-health-connect) is compiled into any build yet: both need a fresh EAS dev-client
// rebuild (Expo Go can't run either), plus the HealthKit capability enabled for com.philoi.app in
// the Apple Developer portal for iOS. One shared flag for both platforms, per the build spec's
// "behind the fitness feature flag" — flip it true only once that rebuild has actually shipped;
// until then it stays false so nobody hits a "native module not found" crash on an old binary.
// src/lib/healthkit.ts and src/lib/health-connect.ts each also independently guard on their own
// Platform.OS check, so this is a belt-and-suspenders gate, not the only one.
//
// This is also the "behind the fitness flag" gate for the two OAuth sources, Strava (§17/19c) and
// Whoop (§17/19d). Neither needs a native module — both ride expo-auth-session, already in the
// binary — so each ALSO guards on its own client id being configured (isStravaSupported /
// isWhoopSupported), which is what actually stays false until the vendor dashboard app exists and
// its secrets are set on the Supabase project:
//   supabase secrets set WHOOP_CLIENT_ID=... WHOOP_CLIENT_SECRET=...
// Whoop additionally needs Whoop's own app review before it works beyond the dev account.
export const FITNESS_SYNC_ENABLED = true;

// Gym tracker phase-2 — per-set video clips (PHILOI_UI_SPEC.md §23). expo-camera, expo-video,
// expo-video-thumbnails, and react-native-compressor are all native modules, so this only holds
// on a build that compiled them in — same reasoning as FITNESS_SYNC_ENABLED above. Both gates
// are now satisfied:
//   • the R2 credentials are set on the Supabase project (R2_ACCOUNT_ID / R2_ACCESS_KEY_ID /
//     R2_SECRET_ACCESS_KEY / R2_BUCKET_NAME=philoi-gym-clips) and gym-clip-upload-url +
//     gym-clip-playback-url are redeployed against them;
//   • the four native modules ship in the build cut alongside this commit — which is exactly
//     why this flip must NOT be sent as an OTA update to any older binary.
// Every native import stays behind a lazy require() at the call site (gym-clip-recorder.tsx,
// gym-clip-player.tsx) rather than a module-scope import, so an older binary that somehow sees
// this flag true still degrades to a failed capture rather than a bundle-load crash.
export const GYM_VIDEO_CLIPS_ENABLED = true;

// Read-only Google Calendar (GCAL_INTEGRATION_SPEC.md) — the AI coach's deadline/free-busy
// source. No native module is involved (the Google Sign-In SDK is already in the binary and is
// what runs the consent sheet), so this is NOT a "needs an EAS rebuild" gate like the fitness
// flags above. It's a GOOGLE-SIDE gate, and it stays false until all three of these are true:
//
//   1. https://www.googleapis.com/auth/calendar.readonly is added to the OAuth consent screen
//      for Google Cloud project 921536564136 (GOOGLE_SIGNIN_SETUP.md). Until it is, the consent
//      sheet errors out instead of asking — a worse experience than the row simply not being live.
//   2. That scope is VERIFIED by Google. calendar.readonly is a "sensitive" scope: unverified,
//      only test users on the consent screen can grant it, and everyone else hits the unverified-
//      app screen. Verification takes days, not minutes — start it early.
//   3. The Supabase project has the secrets the server half needs:
//        supabase secrets set GOOGLE_WEB_CLIENT_ID=... GOOGLE_WEB_CLIENT_SECRET=... \
//                             GCAL_TOKEN_ENC_KEY="$(openssl rand -base64 32)"
//
// src/lib/google-calendar.ts ALSO independently guards on googleWebClientId being configured, so
// this is a belt-and-suspenders gate, not the only one. Flipping it true is a one-line change and
// needs no rebuild. See CODE_HANDOFF_gcal.md for the full setup runbook.
// ON as of 2026-08-23, with precondition 2 knowingly outstanding: calendar.readonly is submitted
// for verification but not yet granted, so ONLY accounts listed under OAuth consent screen ->
// Audience -> Test users can complete the grant. Everyone else meets the unverified-app screen.
// That is the intended state for this build — the connect flow has to work on a real device to
// record the demo video that verification itself requires.
export const GOOGLE_CALENDAR_ENABLED = true;

// Focus Nudge on ANDROID (CODE_PROMPT_focus_nudge_android.md, PLAY_ACCESSIBILITY_DECLARATION.md).
//
// The odd one out in this file: it is not a constant, it is read from the build.
//
// Every other flag here decides what the app does, so a JS constant is the right shape and
// flipping one is a one-line change. This one decides what the app's MANIFEST contains — an
// AccessibilityService <service> element, which is what makes Play treat Philoi as a
// sensitive-permission app owing a declaration and a multi-week extended review. A constant in
// this file could not express that: it would hide the setup screen and change nothing about the
// review, and worse, a `true` here in a binary built without FOCUS_NUDGE_ANDROID=1 would walk
// people to an Accessibility settings list with no Philoi row in it.
//
// So the single source of truth is the FOCUS_NUDGE_ANDROID env var at build time, which
// app.config.ts uses for BOTH the config plugin and this value. Off by default, which is what lets
// the closed-test build ship without Focus Nudge. See the note at the top of app.config.ts.
//
// iOS is unaffected — Family Controls is gated by the entitlement and the picker, not by this.
export const FOCUS_NUDGE_ANDROID_ENABLED: boolean =
  Constants.expoConfig?.extra?.focusNudgeAndroid === true;
