/** @type {import('@bacons/apple-targets/app.plugin').ConfigFunction} */
// The Shield Action extension — the two buttons on the nudge (APP_BLOCKER_SPEC §C). See
// ../device-activity-monitor for why all three of these are hand-rolled on @bacons/apple-targets
// rather than pulled in from react-native-device-activity.
module.exports = () => ({
  type: 'shield-action',

  // PRODUCT_MODULE_NAME comes from this, and the generated Info.plist names
  // $(PRODUCT_MODULE_NAME).ShieldActionExtension as the principal class — keep this and the Swift
  // class in step.
  name: 'ShieldAction',
  displayName: 'Philoi Focus Actions',

  bundleIdentifier: '.ShieldAction',

  // ManagedSettings comes with the type. UIKit is ours, for the NSExtensionContext open() that
  // deep-links back into Philoi on the primary button. FamilyControls and DeviceActivity are here
  // because the mirrored FocusNudgeShared.swift is compiled into this target too and reaches for
  // both; see the note in ../device-activity-monitor/expo-target.config.js.
  frameworks: ['UIKit', 'FamilyControls', 'DeviceActivity'],

  deploymentTarget: '16.4',

  entitlements: {
    'com.apple.developer.family-controls': true,
    // The pipe — see the note in ../device-activity-monitor/expo-target.config.js.
    'com.apple.security.application-groups': ['group.com.philoi.app'],
  },
});
