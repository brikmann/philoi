/** @type {import('@bacons/apple-targets/app.plugin').ConfigFunction} */
// The Widget Extension target that hosts the lock-in Live Activity (#87).
//
// A Live Activity's UI cannot live in the app target — ActivityKit renders it out of process, on
// the Lock Screen and in the Dynamic Island, so it has to be an extension. Expo prebuild doesn't
// scaffold extensions, which is what @bacons/apple-targets is for: everything in this directory
// becomes a separate Xcode target on the next prebuild.
//
// There is NO widget in here beyond the activity — no home-screen widget, no timeline provider.
// The one entry point is LockInLiveActivityBundle in LockInLiveActivity.swift.
module.exports = () => ({
  type: 'widget',
  displayName: 'Philoi Lock-in',

  // ActivityKit is what makes this an activity rather than a home-screen widget; WidgetKit is
  // required regardless because a Live Activity is declared inside a WidgetBundle. SwiftUI is the
  // only way to draw either.
  frameworks: ['SwiftUI', 'WidgetKit', 'ActivityKit'],

  // Matched to SDK 57's own iOS floor rather than ActivityKit's 16.1. The target does NOT inherit
  // the app's deployment target — apple-targets defaults it lower — and if this target were built
  // below 16.1 the ActivityConfiguration APIs below wouldn't compile without availability
  // annotations wrapping every view. Pinning the same floor as the app keeps the Swift clean.
  deploymentTarget: '16.4',

  // Only the two the OS itself consumes: $accent tints system chrome, $widgetBackground is the
  // card ground. The brand palette (PHILOI purple, ember) is declared in Swift instead — see
  // `Palette` in LockInLiveActivity.swift for why: the asset names apple-targets derives from
  // these keys are a plugin implementation detail, and a mismatch shows up as a black card at
  // runtime rather than as a build error.
  colors: {
    $accent: '#E0612C',
    $widgetBackground: '#1B1430',
  },

  // No App Group. The activity is driven entirely by ActivityKit's own attributes/content-state
  // payload pushed from the app process (PhiloiLiveActivityModule), so there is no shared
  // UserDefaults surface to read and nothing to keep in sync. Adding a group here would mean
  // another provisioning-profile entitlement to manage for no gain.
});
