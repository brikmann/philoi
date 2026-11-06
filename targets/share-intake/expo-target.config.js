/** @type {import('@bacons/apple-targets/app.plugin').ConfigFunction} */
// The iOS Share Extension behind "Share → Philoi" (mock 324, cross-post with Instagram).
//
// WHY A SHARE EXTENSION: Instagram offers no way in. Meta retired the Basic Display API, nothing
// lets a third party read someone's posts, and nobody can put a button inside Instagram's composer.
// What every app CAN do is appear in the OS share sheet — so after posting to IG, the person shares
// the same photo / clip to Philoi from there. That's the whole on-ramp.
//
// THIS TARGET DRAWS NOTHING WORTH DRAWING. It copies the one shared file into the App Group the app
// already has (group.<bundle id>, the Focus Nudge pipe — withFocusNudgeEntitlements gives the app
// target the same group), writes a one-line manifest beside it, and opens the app at
// `philoi://share-intake` (a link or text share writes the manifest alone). The real composer is
// the app's own (src/app/agora/import.tsx, which hands a link on to agora/compose), so the
// extension never runs React Native — `exportJs` stays off, and the extension stays far under iOS's
// ~120 MB share-extension memory ceiling even for a long clip (the file is copied, never loaded).
//
// SIGNING (the ITMS-90035 gap, #271): this is a separate App ID, com.philoi.app.ShareIntake, with its
// own distribution profile. apple-targets lists it under extra.eas.build.experimental.ios.appExtensions,
// so EAS creates the App ID and profile — but only on an INTERACTIVE credentials run the first time
// (`eas build -p ios` without --non-interactive, or `eas credentials`). A headless first build fails
// signing for this target.
//
// The Info.plist beside this file is committed, not generated: apple-targets only writes one when
// it is missing, and its default activation rule is TRUEPREDICATE, which App Review rejects. Ours
// declares exactly one image, one movie, or one web URL / text (0294: Instagram shares a Reel as its
// URL, so without the URL key Philoi never appears in Instagram's share sheet at all).
module.exports = (config) => ({
  type: 'share',

  // NSExtensionPrincipalClass is $(PRODUCT_MODULE_NAME).ShareViewController — the class in
  // ShareViewController.swift. The name and the plist have to agree or the extension loads nothing.
  name: 'ShareIntake',
  // What the share sheet shows under the icon.
  displayName: 'Philoi',
  bundleIdentifier: '.ShareIntake',

  // UniformTypeIdentifiers for UTType.movie / .image when picking the attachment.
  frameworks: ['UniformTypeIdentifiers'],

  // Matched to the app's floor, like every other target here.
  deploymentTarget: '16.4',

  entitlements: {
    // 🔴 THE PIPE. The app reads the file this extension leaves here. If the group isn't enabled on
    // this App ID, containerURL(forSecurityApplicationGroupIdentifier:) returns nil and the
    // extension shows "Couldn't hand this to Philoi" instead of opening the app.
    'com.apple.security.application-groups': [`group.${config.ios.bundleIdentifier}`],
  },
});
