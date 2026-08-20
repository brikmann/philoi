/** @type {import('@bacons/apple-targets/app.plugin').ConfigFunction} */
// The Notification Service Extension that puts the subject's image on a push (§F2).
//
// WHY A WHOLE TARGET FOR ONE IMAGE: Android shows a push image out of the box —
// expo-notifications reads `remoteMessage.notification.imageUrl` and builds the BigPictureStyle
// itself (see RemoteNotificationContent.kt). iOS has no equivalent. An image on iOS must be a
// UNNotificationAttachment, attachments must exist as a local file, and the only place a remote
// file can be downloaded between APNs delivery and display is a Notification Service Extension.
// Expo's own docs say exactly this: "Android will show the image out of the box. On iOS, you need
// to add a Notification Service Extension target to your app."
//
// Extensions cannot live in the app target, and expo prebuild does not scaffold them — same
// reason the Live Activity in ../lockin is its own target. apple-targets turns this directory
// into an Xcode target on the next prebuild, so this needs a NATIVE REBUILD to take effect; it
// will not arrive over Metro or an OTA update.
module.exports = () => ({
  type: 'notification-service',
  displayName: 'Philoi Notification Service',

  // UserNotifications is the whole API surface here — UNNotificationAttachment, the mutable
  // content copy, and the expiry hook. No SwiftUI: an NSE draws nothing, it only rewrites the
  // payload before the system renders it. (A *content* extension would draw, and would be a
  // different target type.)
  frameworks: ['UserNotifications'],

  // Matched to the app's floor, like the widget target. apple-targets defaults extensions lower
  // than the app, and a mismatched floor is the kind of thing that only surfaces as a signing or
  // availability error deep in a cloud build.
  deploymentTarget: '16.4',

  // No App Group and no entitlements. The extension reads the payload it was handed and writes to
  // its own NSTemporaryDirectory; it shares nothing with the app process, so an app group would be
  // one more provisioning-profile entitlement to keep valid for no gain.
});
