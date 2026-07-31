// Declares Health Connect's package so this app is allowed to SEE it.
//
// Android 11+ package visibility hides other installed packages unless you declare them in
// <queries>. On Android 13 and below, Health Connect is a separate Play Store app
// (com.google.android.apps.healthdata) rather than part of the platform — so without this entry
// getSdkStatus() reports SDK_UNAVAILABLE even when Health Connect IS installed and set up. The
// app then silently decides the device has no Health Connect: isHealthConnectAvailable() returns
// false, requestStepsAuthorization() returns false, and the user just gets "Could not connect"
// with no permission sheet ever appearing. Nothing crashes, which is what makes it hard to spot.
//
// react-native-health-connect's own bundled plugin does NOT add this — it only wires the
// rationale intent-filter (see node_modules/react-native-health-connect/app.plugin.js) — the
// same gap that made plugins/withHealthConnectPermissionDelegate.js necessary.
//
// Required by Google's own Health Connect setup docs for Android 13 and lower. Harmless on
// Android 14+, where Health Connect is part of the platform.
//
// Must be a config plugin, not a hand-edit to android/app/src/main/AndroidManifest.xml: android/
// is gitignored and regenerated on every prebuild and every EAS build.

const { withAndroidManifest } = require('@expo/config-plugins');

const HEALTH_CONNECT_PACKAGE = 'com.google.android.apps.healthdata';

module.exports = function withHealthConnectQueries(config) {
  return withAndroidManifest(config, (cfg) => {
    const manifest = cfg.modResults.manifest;

    // Merge into the existing <queries> block if there is one (expo-web-browser already adds one
    // for the browser VIEW intent) — a second sibling <queries> element is legal but pointlessly
    // messy, and merging keeps the diff to exactly the one <package> line.
    manifest.queries = manifest.queries || [];
    if (manifest.queries.length === 0) manifest.queries.push({});
    const queries = manifest.queries[0];

    queries.package = queries.package || [];
    const alreadyDeclared = queries.package.some((p) => p?.$?.['android:name'] === HEALTH_CONNECT_PACKAGE);
    if (!alreadyDeclared) {
      queries.package.push({ $: { 'android:name': HEALTH_CONNECT_PACKAGE } });
    }

    return cfg;
  });
};
