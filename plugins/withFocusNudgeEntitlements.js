// The MAIN APP's half of the Focus Nudge entitlements (FOCUS_NUDGE_SETUP.md Part A, §A3/§A4).
//
// The three extensions declare their own entitlements in their expo-target.config.js files, which
// @bacons/apple-targets turns into per-target generated.entitlements. Nothing does the same for
// com.philoi.app itself — so without this plugin the app target ships with neither capability, and
// the failure is split and confusing:
//
//   · no Family Controls on the app  → AuthorizationCenter.requestAuthorization() fails, so the
//     user can never grant Screen Time access and the feature can never be turned on at all;
//   · no App Group on the app        → UserDefaults(suiteName:) returns nil on the WRITE side, so
//     authorization and the picker both work, the shield goes up, and it renders the built-in
//     fallback copy forever because Cindy's line never actually reached the container.
//
// The second one is the nasty one: everything looks wired, and the only symptom is that the nudge
// never says anything specific.
//
// Must be a config plugin, not a hand-edit to ios/Philoi/Philoi.entitlements: ios/ is gitignored
// and regenerated on every prebuild and every EAS build. Additive — it merges into whatever
// expo-notifications, associated domains and the rest have already put there.

const { withEntitlementsPlist } = require('expo/config-plugins');

const APP_GROUP = 'group.com.philoi.app';

module.exports = function withFocusNudgeEntitlements(config) {
  return withEntitlementsPlist(config, (cfg) => {
    const entitlements = cfg.modResults;

    // The distribution entitlement is granted at the TEAM level and applied per bundle id in the
    // portal; this is the binary-side declaration of it. Both halves are required — a profile
    // carrying the capability signs a binary that never asked for it just fine, and then
    // authorization fails at runtime with no build-time warning.
    entitlements['com.apple.developer.family-controls'] = true;

    const groups = entitlements['com.apple.security.application-groups'] ?? [];
    if (!groups.includes(APP_GROUP)) {
      entitlements['com.apple.security.application-groups'] = [...groups, APP_GROUP];
    }

    return cfg;
  });
};
