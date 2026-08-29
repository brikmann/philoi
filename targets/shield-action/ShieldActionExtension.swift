// The two buttons on the shield (APP_BLOCKER_SPEC §C).
//
//   PRIMARY   → opens Philoi. Which screen depends on the tone the shield was showing: back to the
//               live lock-in on a reinforce card, straight to the support surface on a wellbeing
//               or support one (§C-safety: "offer to help find someone to talk to"). The URL is
//               carried in the payload the app cached, so the routing is decided in JS.
//   SECONDARY → "I really need a sec." Takes the shield DOWN for a cooldown and gets out of the
//               way. No penalty, no streak loss, nothing recorded against them.
//
// 🔴 THE SECONDARY BUTTON IS THE FEATURE. Everything else here is decoration; the promise this
// whole spec rests on is that continuing always works ("Continue anyway is always available and
// silent — this is a nudge, not a gate"). So it disarms the store WHOLESALE rather than trying to
// subtract one token from it: an app shielded by a CATEGORY the user picked cannot be unshielded
// individually, and the failure mode of getting that subtlety wrong is the shield reappearing on
// every retap — a trap, which is the one thing this must never be. Coarse and certain beats
// precise and occasionally inescapable.
//
// iOS constraint worth knowing before you test it: there is no ShieldActionResponse that means
// "let them straight through". `.close` dismisses the shield and returns to the Home Screen, so
// after disarming, the app opens on the next tap. That extra tap is the whole cost of the
// pass-through, and it costs the user nothing else.

import Foundation
import ManagedSettings
import UIKit

/// Open a philoi:// URL from inside an app extension.
///
/// A bare NSExtensionContext, because there is no UIApplication in an extension process and a
/// ShieldActionDelegate is not given a context of its own. This is the standard route out of a
/// Screen Time extension and the one the community package uses too.
private func openPhiloi(_ urlString: String) {
  guard let url = URL(string: urlString) else { return }
  NSExtensionContext().open(url, completionHandler: nil)
}

private func respond(
  to action: ShieldAction, completionHandler: @escaping (ShieldActionResponse) -> Void
) {
  let payload = FocusNudgePayload.load()
  // Read, don't record: the retreat was already counted when the shield was drawn next door in
  // ShieldConfiguration. Counting again here would double every drift that got a tap and leave
  // every drift that got ignored counted once — escalating people unevenly for no reason.
  let retreats = FocusNudgeState.retreats(window: payload.escalateWindowMs).count
  let card = payload.card(retreats: retreats)

  switch action {
  case .primaryButtonPressed:
    openPhiloi(card.primaryURL)
    completionHandler(.close)

  case .secondaryButtonPressed:
    // Order matters: write the deferral BEFORE taking the shield down. FocusNudgeShield.arm() is a
    // no-op while deferred, so if the app happens to reconcile in the same instant, it finds the
    // deferral already set and leaves them alone.
    FocusNudgeState.deferredUntilMs = focusNudgeNowMs() + payload.deferMs
    FocusNudgeShield.disarm()
    completionHandler(.close)

  @unknown default:
    // A future button we do not know about must not strand anyone behind a shield.
    completionHandler(.close)
  }
}

// The class name must stay in step with NSExtensionPrincipalClass, which @bacons/apple-targets
// writes as $(PRODUCT_MODULE_NAME).ShieldActionExtension for a `shield-action` target.
class ShieldActionExtension: ShieldActionDelegate {
  override func handle(
    action: ShieldAction, for application: ApplicationToken,
    completionHandler: @escaping (ShieldActionResponse) -> Void
  ) {
    respond(to: action, completionHandler: completionHandler)
  }

  override func handle(
    action: ShieldAction, for webDomain: WebDomainToken,
    completionHandler: @escaping (ShieldActionResponse) -> Void
  ) {
    respond(to: action, completionHandler: completionHandler)
  }

  override func handle(
    action: ShieldAction, for category: ActivityCategoryToken,
    completionHandler: @escaping (ShieldActionResponse) -> Void
  ) {
    respond(to: action, completionHandler: completionHandler)
  }
}
