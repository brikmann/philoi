// The app-side half of the lock-in Live Activity (#87): requests, updates, and ends the activity
// whose UI lives in targets/lockin/.
//
// The clock is never sent from here. `startedAt` goes over once, in the immutable attributes, and
// the widget's `Text(timerInterval:)` counts up from it in the OS. `update()` exists only for the
// rank bar — the one thing on that card iOS cannot derive by itself.

import ActivityKit
import ExpoModulesCore

/// Mirrors `LiveActivityState` in src/lib/live-activity.ts. Field names must match the JS object
/// keys exactly — Expo's Record decoding is by name, and a typo surfaces as a silently default
/// value (an empty label, a 0% bar) rather than as an error.
struct LiveActivityStateRecord: Record {
  @Field var sessionName: String = ""
  /// Epoch milliseconds, because that's what `Date.getTime()` gives JS. Converted to seconds for
  /// Foundation on the way in — passing ms to `timeIntervalSince1970` would put the session start
  /// roughly fifty thousand years in the future and the timer would render as a frozen 00:00.
  @Field var startedAtMs: Double = 0
  @Field var rankRatio: Double = 0
  @Field var rankLabel: String = ""
  @Field var projection: String?
  @Field var tierOuterHex: String = ""
  @Field var tierInnerHex: String = ""

  var startedAt: Date {
    Date(timeIntervalSince1970: startedAtMs / 1000)
  }

  var contentState: LockInActivityAttributes.ContentState {
    LockInActivityAttributes.ContentState(
      rankLabel: rankLabel,
      rankRatio: rankRatio,
      projection: projection,
      tierOuterHex: tierOuterHex,
      tierInnerHex: tierInnerHex
    )
  }

  /// If we die without ending the activity, this is when iOS starts presenting the card as stale
  /// instead of as live. Matched to the widget's 24h timer cap so the two can't disagree about
  /// when a session has stopped being believable.
  var staleDate: Date {
    startedAt.addingTimeInterval(24 * 60 * 60)
  }
}

public class PhiloiLiveActivityModule: Module {
  public func definition() -> ModuleDefinition {
    Name("PhiloiLiveActivity")

    /// False when the user has switched Live Activities off for Philoi in Settings, which is a
    /// per-app toggle and can change while the app is running — so this is checked at every start,
    /// never cached.
    Function("isAvailable") { () -> Bool in
      ActivityAuthorizationInfo().areActivitiesEnabled
    }

    AsyncFunction("start") { (state: LiveActivityStateRecord) -> String? in
      guard ActivityAuthorizationInfo().areActivitiesEnabled else { return nil }

      // Only ever one lock-in at a time (PHILOI_UI_SPEC.md §5), so a start with something already
      // running means the previous session leaked — end it rather than stacking a second card.
      await Self.endAll()

      let activity = try Activity.request(
        attributes: LockInActivityAttributes(sessionName: state.sessionName, startedAt: state.startedAt),
        content: ActivityContent(state: state.contentState, staleDate: state.staleDate),
        // .token would ask APNs for a push token we have no use for — the timer self-counts and
        // rank updates come from the app process. Requesting one would also drag in the
        // aps-environment entitlement (NATIVE_BUILD_CONFIG.md: "Skip push").
        pushType: nil
      )
      return activity.id
    }

    AsyncFunction("update") { (state: LiveActivityStateRecord) in
      // Looked up fresh rather than held in a property: the system owns activity lifetime, and a
      // stored reference goes stale across a background/foreground cycle or a process restart.
      for activity in Activity<LockInActivityAttributes>.activities {
        await activity.update(ActivityContent(state: state.contentState, staleDate: state.staleDate))
      }
    }

    AsyncFunction("end") {
      await Self.endAll()
    }
  }

  /// Ends every lock-in activity, not just one.
  ///
  /// The worst failure this feature has is an activity outliving its session — a Lock Screen
  /// insisting you're locked in, with a timer climbing through hours you didn't do. So this is
  /// deliberately a sweep over whatever the system currently holds, and the JS side calls it on
  /// cold start whenever the session resolves to null, not only on an explicit Stop.
  private static func endAll() async {
    for activity in Activity<LockInActivityAttributes>.activities {
      await activity.end(nil, dismissalPolicy: .immediate)
    }
  }
}
