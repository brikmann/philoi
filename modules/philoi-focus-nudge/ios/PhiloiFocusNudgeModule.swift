// The app-side half of Focus Nudge (APP_BLOCKER_SPEC §A/§B/§D, FOCUS_NUDGE_SETUP.md Part B).
//
// Four jobs, and only four:
//   1. ask for Screen Time authorization,
//   2. put Apple's FamilyActivityPicker up so the user chooses what to guard,
//   3. hand Cindy's pre-fetched line to the App Group so the shield can draw it offline,
//   4. arm on lock-in start and disarm on lock-in end.
//
// The shield itself lives in three extensions (targets/shield-configuration, targets/shield-action,
// targets/device-activity-monitor) because iOS renders it out of process — the same reason the
// Live Activity's UI is its own target. Everything those three read comes from here, through the
// App Group, because they cannot network. FocusNudgeShared.swift is the contract.
//
// 🔒 THE TOKENS ARE OPAQUE AND STAY THAT WAY. A FamilyActivitySelection is a set of tokens Apple
// deliberately makes unresolvable to app identities, and nothing below tries. The only thing this
// file ever reports upward is how MANY were picked.

import DeviceActivity
import ExpoModulesCore
import FamilyControls
import ManagedSettings
import SwiftUI

/// Mirrors ArmOptions in modules/philoi-focus-nudge/index.ts. Field names must match the JS keys
/// exactly — Expo decodes Records by name, and a typo reads as a silent default.
struct FocusNudgeArmOptions: Record {
  /// The failsafe ceiling (§D). The DeviceActivity schedule ends here no matter what, so a
  /// force-quit mid-session cannot leave someone shielded indefinitely.
  @Field var maxMinutes: Double = 720
  /// How long a "continue anyway" holds the shield down before the monitor's usage-threshold event
  /// puts it back. Kept in step with the payload's own `deferMs`.
  @Field var deferMinutes: Double = 10
}

public class PhiloiFocusNudgeModule: Module {
  public func definition() -> ModuleDefinition {
    Name("PhiloiFocusNudge")

    // ─────────────────────────── authorization ───────────────────────────

    /// "notDetermined" | "denied" | "approved". Read fresh every time: the user can revoke Screen
    /// Time access in Settings while the app is running, and §"Edge cases" requires us to notice
    /// rather than crash.
    Function("authorizationStatus") { () -> String in
      switch AuthorizationCenter.shared.authorizationStatus {
      case .approved: return "approved"
      case .denied: return "denied"
      case .notDetermined: return "notDetermined"
      @unknown default: return "notDetermined"
      }
    }

    /// Resolves with the status AFTER the prompt. Denial is not an error — it is a normal answer
    /// that turns the feature off, and it must never block anyone from locking in.
    AsyncFunction("requestAuthorization") { () -> String in
      do {
        try await AuthorizationCenter.shared.requestAuthorization(for: .individual)
        return "approved"
      } catch {
        // Thrown on refusal as well as on genuine failure, and the two are indistinguishable here.
        // Report the status the system actually holds rather than guessing from the error.
        return AuthorizationCenter.shared.authorizationStatus == .approved ? "approved" : "denied"
      }
    }

    // ─────────────────────────── the picker ───────────────────────────

    /// Apple's own FamilyActivityPicker, presented as a sheet.
    ///
    /// A sheet rather than an embedded RN view component: FamilyActivityPicker is SwiftUI, its
    /// contents are privileged, and hosting it inside the RN view tree buys nothing — the user
    /// picks apps once, in a modal, from the Focus Nudge settings screen.
    ///
    /// Resolves with the counts (never identities). Cancelling resolves with the counts UNCHANGED
    /// rather than rejecting, because "I looked and changed nothing" is not an error.
    AsyncFunction("presentPicker") { (promise: Promise) in
      DispatchQueue.main.async {
        guard let presenter = self.appContext?.utilities?.currentViewController() else {
          promise.reject("no_view_controller", "No view controller to present the picker from.")
          return
        }

        let host = FocusNudgePickerHost(
          initial: FocusNudgeSelection.load() ?? FamilyActivitySelection()
        ) { result in
          presenter.presentedViewController?.dismiss(animated: true)
          if let saved = result {
            FocusNudgeSelection.save(saved)
            // Re-apply immediately when a session is already running, so changing the picked apps
            // mid-lock-in takes effect now rather than at the next session.
            if FocusNudgeState.armedAtMs > 0 { FocusNudgeShield.arm() }
          }
          promise.resolve(Self.counts())
        }

        let controller = UIHostingController(rootView: host)
        controller.modalPresentationStyle = .formSheet
        presenter.present(controller, animated: true)
      }
    }

    /// { applications, categories, webDomains } — counts only. This is the whole of what the app
    /// is ever allowed to know about the selection.
    Function("selectionCounts") { () -> [String: Int] in
      Self.counts()
    }

    Function("clearSelection") {
      FocusNudgeSelection.clear()
      FocusNudgeShield.disarm()
    }

    // ─────────────────────────── the handoff ───────────────────────────

    /// Cache the nudge copy for the shield to read.
    ///
    /// Takes a JSON string rather than a Record, on purpose: this payload is authored end-to-end in
    /// JS (src/lib/focus-nudge.ts) so the wording ships over OTA, and the Swift on both sides of
    /// the App Group treats it as opaque text. Nothing here validates it — FocusNudgePayload.load()
    /// in the shield falls back to its own built-in card if it cannot be parsed, which is the
    /// behaviour we want anyway for a partially-written or future-shaped payload.
    Function("writePayload") { (json: String) in
      focusNudgeDefaults?.set(json, forKey: FocusNudgeKey.payload)
    }

    /// How many times the shield has been presented inside the window — written by the
    /// ShieldConfiguration extension, read back here so the next coach call knows it is dealing
    /// with repeated retreat (§C-safety graduated response).
    Function("retreatCount") { (windowMs: Double) -> Int in
      FocusNudgeState.retreats(window: windowMs).count
    }

    // ─────────────────────────── arm / disarm ───────────────────────────

    Function("isArmed") { () -> Bool in
      FocusNudgeState.armedAtMs > 0
    }

    /// Arm for the current lock-in.
    ///
    /// The shield goes up HERE, immediately, rather than waiting for the monitor extension —
    /// intervalDidStart is delivered on the system's schedule and an app opened three seconds after
    /// starting a session must already be covered. The DeviceActivity schedule registered alongside
    /// it exists for the two things this process cannot do: disarm after a force-quit (§D's
    /// failsafe) and re-arm once a "continue anyway" cooldown has been used up.
    AsyncFunction("arm") { (options: FocusNudgeArmOptions) -> Bool in
      guard AuthorizationCenter.shared.authorizationStatus == .approved else { return false }
      guard let selection = FocusNudgeSelection.load(),
        !(selection.applicationTokens.isEmpty && selection.categoryTokens.isEmpty
          && selection.webDomainTokens.isEmpty)
      else { return false }

      // A new session starts clean: a previous session's deferral must not silently swallow the
      // first nudge of this one, and its retreat history must not escalate this one early.
      FocusNudgeState.deferredUntilMs = 0
      FocusNudgeState.clearRetreats()
      FocusNudgeState.armedAtMs = focusNudgeNowMs()
      FocusNudgeShield.arm(force: true)

      let center = DeviceActivityCenter()
      center.stopMonitoring([.focusNudgeSession])

      let calendar = Calendar.current
      let now = Date()
      // A MINUTE IN THE PAST, deliberately. A DeviceActivitySchedule is expressed as times of day,
      // so a start set to exactly "now" is ambiguous about whether this instant is inside the
      // window or a hair before it — and if the system resolves it as "starts later", the failsafe
      // interval (and its intervalDidEnd) slides a whole day out. Backdating the start removes the
      // question: we are unambiguously inside the window the moment monitoring begins.
      let start = now.addingTimeInterval(-60)
      let schedule = DeviceActivitySchedule(
        intervalStart: calendar.dateComponents([.hour, .minute, .second], from: start),
        intervalEnd: calendar.dateComponents(
          [.hour, .minute, .second], from: start.addingTimeInterval(options.maxMinutes * 60)),
        // Never repeats. This window belongs to ONE lock-in; a repeating schedule would shield the
        // same hours tomorrow whether or not anyone was working.
        repeats: false
      )

      // Usage threshold, not wall clock: this fires once the user has actually spent deferMinutes
      // inside the guarded apps, which is the moment a "I really need a sec" has plainly turned
      // into a scroll. The monitor re-arms then.
      let deferLapsed = DeviceActivityEvent(
        applications: selection.applicationTokens,
        categories: selection.categoryTokens,
        webDomains: selection.webDomainTokens,
        threshold: DateComponents(minute: Int(options.deferMinutes))
      )

      do {
        try center.startMonitoring(
          .focusNudgeSession, during: schedule, events: [.focusNudgeDeferLapsed: deferLapsed])
      } catch {
        // The shield is already up — monitoring is the failsafe, not the mechanism. Losing it
        // costs us the force-quit sweep and the re-arm, not the feature, so this is reported and
        // swallowed rather than failing the arm and leaving the user unguarded.
        NSLog("[PhiloiFocusNudge] startMonitoring failed: \(error.localizedDescription)")
      }
      return true
    }

    /// End of session. Unconditional and idempotent — see the sweep note in the monitor extension.
    AsyncFunction("disarm") { () -> Void in
      FocusNudgeShield.disarm()
      FocusNudgeState.armedAtMs = 0
      FocusNudgeState.deferredUntilMs = 0
      FocusNudgeState.clearRetreats()
      DeviceActivityCenter().stopMonitoring([.focusNudgeSession])
    }

    /// Put the shield back if a cooldown has lapsed while the app was away. Cheap enough to call on
    /// every foreground; a no-op unless something has actually changed.
    AsyncFunction("reconcile") { () -> Bool in
      guard FocusNudgeState.armedAtMs > 0 else { return false }
      guard AuthorizationCenter.shared.authorizationStatus == .approved else {
        // Permission revoked mid-session (§"Edge cases"). Leave nothing behind and let JS surface
        // the "Focus Nudge is off" state.
        FocusNudgeShield.disarm()
        FocusNudgeState.armedAtMs = 0
        return false
      }
      if FocusNudgeState.isDeferred { return false }
      FocusNudgeShield.arm()
      return true
    }
  }

  private static func counts() -> [String: Int] {
    guard let selection = FocusNudgeSelection.load() else {
      return ["applications": 0, "categories": 0, "webDomains": 0]
    }
    return [
      "applications": selection.applicationTokens.count,
      "categories": selection.categoryTokens.count,
      "webDomains": selection.webDomainTokens.count,
    ]
  }
}

/// The SwiftUI wrapper around Apple's picker. Its own type so the selection binding lives
/// somewhere with a lifetime — a FamilyActivityPicker bound to a local var in a closure loses
/// every tap.
private struct FocusNudgePickerHost: View {
  @State private var selection: FamilyActivitySelection
  /// nil = cancelled, and the stored selection is left exactly as it was.
  private let onFinish: (FamilyActivitySelection?) -> Void

  init(initial: FamilyActivitySelection, onFinish: @escaping (FamilyActivitySelection?) -> Void) {
    _selection = State(initialValue: initial)
    self.onFinish = onFinish
  }

  var body: some View {
    NavigationView {
      FamilyActivityPicker(selection: $selection)
        .navigationTitle("Apps to nudge on")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
          ToolbarItem(placement: .cancellationAction) {
            Button("Cancel") { onFinish(nil) }
          }
          ToolbarItem(placement: .confirmationAction) {
            Button("Done") { onFinish(selection) }
          }
        }
    }
  }
}
