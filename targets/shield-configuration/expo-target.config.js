/** @type {import('@bacons/apple-targets/app.plugin').ConfigFunction} */
// The Shield Configuration extension — the surface Cindy's nudge is actually drawn on
// (APP_BLOCKER_SPEC §C, mocks 109 + 116). See ../device-activity-monitor for why all three of
// these are hand-rolled on @bacons/apple-targets rather than pulled in from
// react-native-device-activity.
module.exports = () => ({
  type: 'shield-config',

  // PRODUCT_MODULE_NAME comes from this, and the generated Info.plist names
  // $(PRODUCT_MODULE_NAME).ShieldConfigurationExtension as the principal class — keep this and the
  // Swift class in step.
  name: 'ShieldConfiguration',
  displayName: 'Philoi Focus Nudge',

  bundleIdentifier: '.ShieldConfiguration',

  // ManagedSettings + ManagedSettingsUI come with the type. UIKit is ours: a ShieldConfiguration is
  // built from UIColor and UIImage, not SwiftUI — the system draws it, we only describe it.
  // FamilyControls and DeviceActivity are here because the mirrored FocusNudgeShared.swift is
  // compiled into this target too and reaches for both; see the note in
  // ../device-activity-monitor/expo-target.config.js.
  frameworks: ['UIKit', 'FamilyControls', 'DeviceActivity'],

  deploymentTarget: '16.4',

  // The flame on the shield. Bundled into THIS target's own asset catalogue rather than read out
  // of the App Group container: an icon that ships in the bundle can never be missing, and a
  // half-drawn shield over someone's Instagram is a worse failure than a plain one.
  //
  // Generated, not hand-placed — `node scripts/gen-flame-assets.js` writes it here from the one
  // glyph in flame-logo.tsx, alongside the launcher and notification icons, so the shield can't
  // drift into showing a different flame from the rest of the app. White silhouette on transparent;
  // the Swift tints it per tone.
  images: {
    flame: './flame.png',
  },

  entitlements: {
    'com.apple.developer.family-controls': true,
    // The pipe — see the note in ../device-activity-monitor/expo-target.config.js. This target is
    // the one that fails most visibly without it: no group, no cached copy, blank shield.
    'com.apple.security.application-groups': ['group.com.philoi.app'],
  },
});
