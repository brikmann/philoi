// The shield itself — Cindy's nudge, drawn over the app they just opened (APP_BLOCKER_SPEC §C,
// mocks 109 + 116).
//
// 🔴 THIS PROCESS CANNOT NETWORK. iOS asks a ShieldConfigurationDataSource for its UI
// SYNCHRONOUSLY, in a system process, and shows whatever comes back. There is no place to await a
// response, so there is no way to ask the coach anything from here — every string below was
// written into the App Group by the app while it still had a connection. That is the whole reason
// the handoff exists, and it is why the nudge works in airplane mode.
//
// It is also a shield in name only. The buttons are handled next door in the ShieldAction
// extension, where "continue anyway" takes the shield down with no penalty — this is a warm
// interstitial, not a lock (§ "What this model drops").

import ManagedSettings
import ManagedSettingsUI
import UIKit

/// The palette, hand-carried from src/constants/theme.ts. It cannot be imported — this is a
/// separate Xcode target with no access to the JS bundle — so these are the mock-109/116 values
/// written out, the same arrangement as `Palette` in the Live Activity widget.
private enum ShieldPalette {
  /// The warm ground — mock 182/183's #150F24, the same colour Android's overlay puts at the
  /// centre of its ember radial. A shield takes one flat colour where Android takes the gradient;
  /// this is the stop the gradient is built around, so the two platforms sit on the same ground.
  ///
  /// 0.86 alpha, per mock 183, because it is composited OVER the blur below. See the note there.
  static let warmBackground = UIColor(red: 0.082, green: 0.059, blue: 0.141, alpha: 0.86)  // #150F24
  /// The cool ground for the wellbeing/support turn (mock 116 frame 2 — the flame cools).
  static let careBackground = UIColor(red: 0.071, green: 0.086, blue: 0.165, alpha: 0.86)  // #12162A

  static let ink = UIColor(red: 1.0, green: 0.965, blue: 0.925, alpha: 1)  // #FFF6EC
  static let body = UIColor(red: 0.847, green: 0.800, blue: 0.922, alpha: 1)  // #D8CCEB
  static let secondary = UIColor(red: 0.561, green: 0.514, blue: 0.659, alpha: 1)  // #8F83A8

  /// The primary button. Mock 182 draws this fill as a 135° ramp #FF8C42 -> #F5A623, and the
  /// Android overlay does exactly that — but primaryButtonBackgroundColor is ONE UIColor, with no
  /// gradient anywhere in the ShieldConfiguration API. So this is that ramp's midpoint: the
  /// closest a flat fill gets to the button the other platform is drawing.
  static let amber = UIColor(red: 0.980, green: 0.600, blue: 0.196, alpha: 1)  // #FA9932
  static let onEmber = UIColor(red: 0.165, green: 0.078, blue: 0.0, alpha: 1)  // #2A1400
  /// The flame icon's tint, kept SEPARATE from the button fill above even though the two are
  /// close. Android draws the glyph as the real ember ramp (#E0612C -> #FFD27A); a UIImage tint is
  /// one flat colour, so this is that ramp's middle stop — the flame's own colour, not the
  /// button's. Coupling them means a later button tweak silently repaints the mark.
  static let emberIcon = UIColor(red: 0.949, green: 0.639, blue: 0.235, alpha: 1)  // #F2A33C

  static let careBlue = UIColor(red: 0.435, green: 0.608, blue: 1.0, alpha: 1)  // #6F9BFF
  static let onCare = UIColor(red: 0.039, green: 0.075, blue: 0.188, alpha: 1)  // #0A1330

  static func isCare(_ intent: String) -> Bool {
    intent == "wellbeing" || intent == "support"
  }
}

/// The flame, tinted to the tone. Ships inside this target's own asset catalogue (see
/// expo-target.config.js `images`) rather than being read out of the App Group container: an icon
/// that lives in the bundle can never be missing, and the one thing a shield must never do is
/// render half-drawn.
private func shieldIcon(care: Bool) -> UIImage? {
  UIImage(named: "flame")?
    .withTintColor(
      care ? ShieldPalette.careBlue : ShieldPalette.emberIcon, renderingMode: .alwaysOriginal)
}

private func buildShield() -> ShieldConfiguration {
  let payload = FocusNudgePayload.load()

  // Presenting the shield IS the retreat — it is the moment of drift, whether or not they then
  // touch a button. Recording it here (debounced inside recordRetreat) is what lets the escalation
  // in §C-safety happen with no network and no app process: the third time in an hour, the card
  // this returns is the wellbeing one.
  let retreats = FocusNudgeState.recordRetreat(window: payload.escalateWindowMs)
  let card = payload.card(retreats: retreats)
  let care = ShieldPalette.isCare(card.intent)

  return ShieldConfiguration(
    // Blurred, per mock 183 — the one bit of depth Apple's API actually grants, and what stops
    // the shield reading as a flat system alert. The ground colour above is laid OVER this blur at
    // 0.86, which is the mock's own composite.
    //
    // 🔴 THE TRADE, stated plainly because it was a deliberate reversal: a blur means the guarded
    // app is faintly present behind the shield, and the feed is the thing we are asking them to
    // look away from. At 0.86 over an ultra-thin dark material it is unrecognisable shape and
    // motion rather than content — Apple's own shield treatment. If it reads as bleed-through on
    // a real device, the fix is one line: nil here and alpha 1 on the two grounds above, which is
    // what this file did before. Android does NOT face this choice — its overlay is opaque by
    // construction, and mock 182 keeps it that way.
    backgroundBlurStyle: .systemUltraThinMaterialDark,
    backgroundColor: care ? ShieldPalette.careBackground : ShieldPalette.warmBackground,
    icon: shieldIcon(care: care),
    title: .init(text: card.title, color: ShieldPalette.ink),
    subtitle: .init(text: card.body, color: ShieldPalette.body),
    primaryButtonLabel: .init(
      text: card.primaryLabel, color: care ? ShieldPalette.onCare : ShieldPalette.onEmber),
    primaryButtonBackgroundColor: care ? ShieldPalette.careBlue : ShieldPalette.amber,
    // The way out, and it is deliberately the quiet one — present on every single shield, styled
    // as a ghost rather than hidden. "Continue anyway is always available and silent."
    secondaryButtonLabel: .init(text: card.secondaryLabel, color: ShieldPalette.secondary)
  )
}

// The class name must stay in step with NSExtensionPrincipalClass, which @bacons/apple-targets
// writes as $(PRODUCT_MODULE_NAME).ShieldConfigurationExtension for a `shield-config` target.
class ShieldConfigurationExtension: ShieldConfigurationDataSource {
  // All four overrides render the SAME card. The nudge is about the person, not about which app
  // or category tripped it — and we never read the application's identity to vary it. The tokens
  // are opaque by Apple's design and stay that way here.
  override func configuration(shielding application: Application) -> ShieldConfiguration {
    buildShield()
  }

  override func configuration(shielding application: Application, in category: ActivityCategory)
    -> ShieldConfiguration
  {
    buildShield()
  }

  override func configuration(shielding webDomain: WebDomain) -> ShieldConfiguration {
    buildShield()
  }

  override func configuration(shielding webDomain: WebDomain, in category: ActivityCategory)
    -> ShieldConfiguration
  {
    buildShield()
  }
}
