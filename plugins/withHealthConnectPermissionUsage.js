// Adds the ANDROID 14+ Health Connect permission-usage declaration to MainActivity.
//
// On Android 14 (API 34)+, Health Connect is part of the OS, and an app that reads health data
// MUST declare an activity that handles the permission-usage intent so the system recognizes it
// as a legitimate Health Connect client:
//
//   <intent-filter>
//     <action   android:name="android.intent.action.VIEW_PERMISSION_USAGE" />
//     <category android:name="android.intent.category.HEALTH_PERMISSIONS" />
//   </intent-filter>
//
// Without it, requestPermission() on Android 14+ returns an EMPTY grant — the permission screen
// never actually grants — so the app reports "that source isn't available right now" even though
// Health Connect is present and working. react-native-health-connect's bundled Expo plugin only
// adds the OLDER `androidx.health.ACTION_SHOW_PERMISSIONS_RATIONALE` filter (for Android 13 / the
// standalone HC app), NOT this one — same gap that made the delegate + queries plugins necessary.
//
// Config plugin (not a hand-edit) because android/ is gitignored and regenerated on every prebuild
// / EAS build. Requires a NEW native build to take effect (manifest change — not OTA-shippable).
const { withAndroidManifest } = require('@expo/config-plugins');

const ACTION = 'android.intent.action.VIEW_PERMISSION_USAGE';
const CATEGORY = 'android.intent.category.HEALTH_PERMISSIONS';

module.exports = function withHealthConnectPermissionUsage(config) {
  return withAndroidManifest(config, (cfg) => {
    const application = cfg.modResults.manifest.application?.[0];
    if (!application) throw new Error('withHealthConnectPermissionUsage: no <application> in manifest.');

    const mainActivity = (application.activity ?? []).find((a) =>
      String(a?.$?.['android:name'] ?? '').endsWith('MainActivity')
    );
    if (!mainActivity) throw new Error('withHealthConnectPermissionUsage: MainActivity not found.');

    mainActivity['intent-filter'] = mainActivity['intent-filter'] ?? [];

    const alreadyDeclared = mainActivity['intent-filter'].some((f) =>
      (f.action ?? []).some((a) => a?.$?.['android:name'] === ACTION)
    );
    if (!alreadyDeclared) {
      mainActivity['intent-filter'].push({
        action: [{ $: { 'android:name': ACTION } }],
        category: [{ $: { 'android:name': CATEGORY } }],
      });
    }

    return cfg;
  });
};
