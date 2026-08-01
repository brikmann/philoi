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
