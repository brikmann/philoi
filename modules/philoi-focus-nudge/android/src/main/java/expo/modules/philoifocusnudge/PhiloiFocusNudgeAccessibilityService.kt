package expo.modules.philoifocusnudge

import android.accessibilityservice.AccessibilityService
import android.view.accessibility.AccessibilityEvent

// ══════════════════════════════════════════════════════════════════════════════════════════════
// 🔴 THIS FILE IS THE PLAY DECLARATION.
//
// PLAY_ACCESSIBILITY_DECLARATION.md tells Google, in writing, that Focus Nudge uses the
// AccessibilityService API "solely to detect, in real time, when a user-selected app is brought to
// the foreground (the TYPE_WINDOW_STATE_CHANGED event's package name)", that it "does not read
// screen content, text, form fields, or any on-screen information", "performs no automation or
// input on the user's behalf", and "collects, stores, and transmits no data".
//
// Every one of those sentences is a claim about the ~40 lines below. Read them against the
// declaration before changing anything here. A mismatch between the declaration and the behaviour
// is the single biggest cause of rejection, and unlike a normal bug it costs weeks — the extended
// review clock restarts on resubmission.
//
// Concretely, what this service must never grow:
//   · getSource() / rootInActiveWindow / findAccessibilityNodeInfosByText — reading the screen.
//     (canRetrieveWindowContent="false" in res/xml/accessibility_service_config.xml already makes
//     these return null, so the config and the code say the same thing from both directions.)
//   · event.text / event.contentDescription — still content, even though the event carries it.
//   · performGlobalAction() / AccessibilityNodeInfo.performAction() — automation on the user's behalf.
//   · any network call, log upload, or analytics event carrying a package name.
//
// It also subscribes to exactly ONE event type. Not because more would be useful and we are being
// polite, but because typeWindowStateChanged is genuinely the whole mechanism: it is the moment an
// app comes forward, which is the only moment this feature cares about.
//
// WHY ACCESSIBILITY AT ALL (the question the reviewer will actually ask): UsageStatsManager is the
// non-accessibility alternative, and it only answers "which app was in front" when polled, after
// the fact. A poll leaves roughly a second of the feed on screen before the nudge lands — and that
// second IS the habit loop the feature exists to interrupt. A nudge that arrives after the dopamine
// is not a nudge. Android offers no other real-time foreground signal.
// ══════════════════════════════════════════════════════════════════════════════════════════════

class PhiloiFocusNudgeAccessibilityService : AccessibilityService() {

  /**
   * The only thing this service does.
   *
   * Runs on the main thread, which is what makes the nudge instant: the overlay view is attached
   * synchronously, inside the same event dispatch that told us the app came forward, with no post()
   * and no Activity launch in between. Starting an Activity here instead would cost a window
   * transition and its animation — and that animation is precisely the glimpse of the feed we are
   * paying an extended Play review to avoid.
   *
   * Everything it consults lives in SharedPreferences rather than in memory, because the system can
   * bind this service into a process where Philoi's JS has never run. See FocusNudgeShared.kt.
   */
  override fun onAccessibilityEvent(event: AccessibilityEvent?) {
    if (event == null || event.eventType != AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED) return

    // 🔴 THE ONLY FIELD READ FROM THE EVENT, ANYWHERE IN THIS APP.
    val packageName = event.packageName?.toString() ?: return

    // Our own windows — including the nudge overlay itself, whose attach can fire this very event.
    // Ignored rather than treated as "they left the guarded app": handling it as a departure would
    // tear the overlay down in the same breath as putting it up. Every route OFF the overlay is an
    // explicit button, so nothing is lost by staying silent here.
    if (packageName == this.packageName) return

    if (packageName in FocusNudgeState.guardedPackages(this)) {
      // Armed = a lock-in is running. Outside a session the guard does not exist at all: Focus
      // Nudge is a thing that happens to a session, never a permanent blocker on your phone.
      if (!FocusNudgeState.isArmed(this)) return
      // A "continue anyway" is still holding. Exactly ten minutes, then the guard resumes on its
      // own — no re-arming call, no service round trip, just a timestamp comparison.
      //
      // ONE DELIBERATE DIVERGENCE FROM iOS, and it is worth knowing rather than discovering. iOS
      // registers a DeviceActivity usage-threshold event that puts the shield BACK mid-scroll once
      // ten minutes of guarded-app usage have actually been spent. Here the deferral only lifts at
      // the next window change — so someone who taps "continue anyway" and then scrolls for forty
      // unbroken minutes is not interrupted again, where on iOS they would be.
      //
      // That gap is left open on purpose. Closing it means a delayed callback living in an
      // accessibility service that the OS may unbind at any moment, cancelled correctly on disarm,
      // on unbind, and on every departure — new state whose failure mode is an overlay stranded
      // over the wrong app. The spec asks for "set defer-until, dismiss" and nothing more, and the
      // iOS re-arm exists only because a shield there is APPLIED state that had to be restored;
      // nothing is applied here. If real use shows the continuous-scroll case matters, it is a
      // small follow-up — but it should be a decision, not a leftover.
      if (FocusNudgeState.isDeferred(this)) return
      FocusNudgeOverlay.show(this)
      return
    }

    // Some other app came forward — the launcher, recents, a notification tap. The overlay is a
    // TYPE_APPLICATION_OVERLAY window, so it floats above whatever is underneath and would sit on
    // top of the home screen forever if we did not take it down here. This is the reason the
    // service is not narrowed with android:packageNames to the guarded list alone: knowing they
    // LEFT is as necessary as knowing they arrived, and the package name is all it takes to know it.
    FocusNudgeOverlay.hide(this)
  }

  /** Required override. There is nothing to interrupt — this service performs no actions. */
  override fun onInterrupt() = Unit

  /**
   * Turning the service off in Settings must not strand a nudge on someone's screen. The overlay is
   * a system window and it outlives its creator quite happily, so it has to be taken down by hand.
   */
  override fun onUnbind(intent: android.content.Intent?): Boolean {
    FocusNudgeOverlay.hide(this)
    return super.onUnbind(intent)
  }

  override fun onDestroy() {
    FocusNudgeOverlay.hide(this)
    super.onDestroy()
  }
}
