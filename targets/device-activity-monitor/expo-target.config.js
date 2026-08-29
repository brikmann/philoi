/** @type {import('@bacons/apple-targets/app.plugin').ConfigFunction} */
// The Device Activity Monitor extension for Focus Nudge (FOCUS_NUDGE_SETUP.md, APP_BLOCKER_SPEC).
//
// Expo prebuild has no notion of app extensions, so — exactly as with the Live Activity in
// ../lockin and the notification service in ../notification-service — this directory becomes its
// own Xcode target on the next prebuild. Three of these make up Focus Nudge:
//
//   ../device-activity-monitor  arms and (crucially) disarms on the session window   ← this one
//   ../shield-configuration     draws Cindy's nudge over the app they opened
//   ../shield-action            handles the two buttons on it
//
// WHY NOT react-native-device-activity: it wraps all three and would have removed most of this
// plumbing, but it scaffolds its targets through @kingstinct/expo-apple-targets — a 0.1.x fork of
// the very plugin this repo already runs at 5.0.0 — and both scan this same `targets/` directory.
// Running the two together would generate the Live Activity and notification-service targets
// twice, and the only way out is to port those two off @bacons/apple-targets onto a fork four
// major versions behind. @bacons/apple-targets already understands all three Screen Time target
// types natively (`device-activity-monitor`, `shield-config`, `shield-action`) — it writes the
// Info.plist, the NSExtensionPointIdentifier and the principal class for each — so hand-rolling
// the Swift on top of it is both less code and one Xcode-project mutator instead of two.
module.exports = () => ({
  type: 'device-activity-monitor',

  // PRODUCT_MODULE_NAME is derived from this, and NSExtensionPrincipalClass is written as
  // $(PRODUCT_MODULE_NAME).DeviceActivityMonitorExtension — so `name` and the Swift class name
  // have to agree or the extension loads into nothing at runtime with no build error.
  name: 'DeviceActivityMonitor',
  displayName: 'Philoi Focus Monitor',

  // The App ID that already exists in the portal. The leading dot appends to the main app's
  // bundle identifier, which is what makes this exactly com.philoi.app.DeviceActivityMonitor
  // rather than whatever the plugin would derive from the target type.
  bundleIdentifier: '.DeviceActivityMonitor',

  // All three named explicitly rather than left to Swift's auto-linking. FocusNudgeShared.swift is
  // compiled into every one of these targets and touches all three frameworks — FamilyControls for
  // the selection, ManagedSettings for the store, DeviceActivity for the schedule and event names —
  // so listing them here is the difference between a clear link line and an "undefined symbol"
  // deep in an EAS build log.
  frameworks: ['FamilyControls', 'ManagedSettings', 'DeviceActivity'],

  // Matched to the app's floor, like every other target here. apple-targets defaults extensions
  // LOWER than the app, and a mismatch surfaces as an availability or signing error deep inside a
  // cloud build rather than locally.
  deploymentTarget: '16.4',

  entitlements: {
    // The distribution entitlement is granted to the team; this is the target-side declaration of
    // it. Without it the extension is not permitted to touch a ManagedSettingsStore at all.
    'com.apple.developer.family-controls': true,
    // 🔴 THE PIPE. This group is the only channel between the app and these three extensions —
    // they cannot network, so everything they draw or decide was written here by the app. If the
    // group is not enabled on this App ID in the portal, UserDefaults(suiteName:) returns nil and
    // the feature fails silently: a blank shield, or no shield at all.
    'com.apple.security.application-groups': ['group.com.philoi.app'],
  },
});
