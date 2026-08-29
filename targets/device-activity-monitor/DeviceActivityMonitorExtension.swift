// The DeviceActivity Monitor extension (FOCUS_NUDGE_SETUP.md Part B, APP_BLOCKER_SPEC §B/§D).
//
// WHAT THIS IS FOR, precisely: the app arms the shield itself the moment a lock-in starts, because
// that is instant and needs no scheduling. This extension exists for the two moments the app is
// not running to handle —
//
//   · intervalDidEnd — THE FAILSAFE. If Philoi is force-quit or crashes mid-session, nothing in
//     the app process is left to take the shield down. §D is explicit that the nudge must never
//     outlive its session: an app still shielded hours after the lock-in ended is the only
//     genuinely harmful failure this feature has, and it is the one this callback prevents.
//   · eventDidReachThreshold — the re-arm after a "continue anyway". The shield comes down for a
//     cooldown when someone says "I really need a sec" (§C, pass-through, no penalty); this fires
//     once they have actually spent that long in the app and puts it back.
//
// intervalDidStart re-applies the shield as well, so a session that began while the app was in the
// background still arms. FocusNudgeShield.arm() is idempotent — being called twice is the normal
// case here, not a bug.
//
// NO NETWORKING. Nothing in this process fetches anything; the copy the shield draws was written
// to the App Group by the app while it still had a connection. See FocusNudgeShared.swift.

import DeviceActivity
import Foundation

class DeviceActivityMonitorExtension: DeviceActivityMonitor {
  override func intervalDidStart(for activity: DeviceActivityName) {
    super.intervalDidStart(for: activity)
    guard activity == .focusNudgeSession else { return }
    FocusNudgeShield.arm()
  }

  override func intervalDidEnd(for activity: DeviceActivityName) {
    super.intervalDidEnd(for: activity)
    guard activity == .focusNudgeSession else { return }

    // Unconditional, and deliberately not guarded on anything we believe about the session. This
    // is the sweep: whatever state the app left behind, the shield comes down and the session's
    // counters reset. Same reasoning as the Live Activity's !sessionId branch.
    FocusNudgeShield.disarm()
    FocusNudgeState.deferredUntilMs = 0
    FocusNudgeState.armedAtMs = 0
    // Retreat history is per-session by design (§C-safety reads "repeated retreat in a short
    // window"), so it does not carry into tomorrow's lock-in.
    FocusNudgeState.clearRetreats()
  }

  override func eventDidReachThreshold(
    _ event: DeviceActivityEvent.Name, activity: DeviceActivityName
  ) {
    super.eventDidReachThreshold(event, activity: activity)
    guard activity == .focusNudgeSession, event == .focusNudgeDeferLapsed else { return }

    // Only while a lock-in is actually armed. Without this check a threshold that fires after the
    // session ended would put a shield back up over a session that no longer exists.
    guard FocusNudgeState.armedAtMs > 0 else { return }
    FocusNudgeShield.arm()
  }
}
