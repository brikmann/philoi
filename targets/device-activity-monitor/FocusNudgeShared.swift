// ══════════════════════════════════════════════════════════════════════════════════════════════
// FOCUS NUDGE — THE APP-GROUP CONTRACT (APP_BLOCKER_SPEC.md §C, FOCUS_NUDGE_SETUP.md Part B)
//
// 🔴 MIRRORED FILE. Four byte-identical copies exist, one per Xcode target:
//
//   modules/philoi-focus-nudge/ios/FocusNudgeShared.swift   (the app-side bridge / CocoaPod)
//   targets/device-activity-monitor/FocusNudgeShared.swift  (DeviceActivityMonitor extension)
//   targets/shield-configuration/FocusNudgeShared.swift     (ShieldConfiguration extension)
//   targets/shield-action/FocusNudgeShared.swift            (ShieldAction extension)
//
// `npm run check:focus-nudge` fails if they drift. They cannot share a module — each extension is
// its own Xcode target and the bridge builds as its own pod, so none can import another. Same
// arrangement, and the same silent-failure risk, as Attributes.swift for the Live Activity: a
// renamed key produces no build error and no visible runtime error, just a shield that renders
// blank over someone's Instagram.
//
// WHY THE APP GROUP IS THE ONLY CHANNEL: a ShieldConfiguration extension is asked for its UI
// synchronously, in a system process, with a budget measured in milliseconds. It cannot await a
// network call — so it cannot ask the coach anything. The app writes Cindy's line here while it
// still has the network, and the shield only ever READS. Nothing below opens a socket.
// ══════════════════════════════════════════════════════════════════════════════════════════════

import DeviceActivity
import FamilyControls
import Foundation
import ManagedSettings

/// The one App Group shared by the main app and all three extensions. Must match the group enabled
/// on all four App IDs in the developer portal — a mismatch here is invisible at build time and
/// shows up as UserDefaults(suiteName:) returning nil, i.e. a blank shield.
public let FOCUS_NUDGE_APP_GROUP = "group.com.philoi.app"

/// The store the shield is applied to. NAMED rather than the default store, so Philoi's shield is
/// its own settings store and clearing ours can never clear anything else on the device.
extension ManagedSettingsStore.Name {
  public static let focusNudge = Self("philoi.focusNudge")
}

/// The DeviceActivity schedule that exists purely as the failsafe (§D): if the app is killed
/// mid-session and never disarms, intervalDidEnd clears the shield for us.
extension DeviceActivityName {
  public static let focusNudgeSession = Self("philoi.focusNudge.session")
}

/// The usage-threshold event that re-arms the shield after a "continue anyway" (§C frequency
/// guard). See FocusNudgeState.deferredUntilMs.
extension DeviceActivityEvent.Name {
  public static let focusNudgeDeferLapsed = Self("philoi.focusNudge.deferLapsed")
}

// MARK: - Keys

public enum FocusNudgeKey {
  /// The nudge payload the app pre-fetches and caches. JSON, written as a String.
  public static let payload = "focusNudge.payload"
  /// The user's FamilyActivitySelection, JSON-encoded. Opaque tokens — never resolvable to app
  /// identities, by Apple's design, and we never try.
  public static let selection = "focusNudge.selection"
  /// Epoch-ms timestamps of recent shield presentations. Drives the §C-safety escalation.
  public static let retreats = "focusNudge.retreats"
  /// Epoch ms until which the shield stays off after a "continue anyway". 0 = not deferred.
  public static let deferredUntilMs = "focusNudge.deferredUntilMs"
  /// Epoch ms the current lock-in armed at. 0 = nothing armed.
  public static let armedAtMs = "focusNudge.armedAtMs"
}

public var focusNudgeDefaults: UserDefaults? {
  UserDefaults(suiteName: FOCUS_NUDGE_APP_GROUP)
}

public func focusNudgeNowMs() -> Double {
  Date().timeIntervalSince1970 * 1000
}

// MARK: - The payload

/// One shield's worth of copy. Every string is authored in JS (src/lib/focus-nudge.ts) so the
/// wording ships over OTA rather than needing a native build — the Swift below only ever picks
/// between cards and renders them.
public struct FocusNudgeCard {
  /// reinforce | wellbeing | support — the coach's own intent (see _shared/coach/prompt.ts).
  public let intent: String
  public let title: String
  public let body: String
  public let primaryLabel: String
  /// Deep link the primary button opens — philoi://lock-in or philoi://support.
  public let primaryURL: String
  public let secondaryLabel: String

  public init?(dict: [String: Any]?) {
    guard let dict = dict,
      let title = dict["title"] as? String,
      let body = dict["body"] as? String,
      let primaryLabel = dict["primaryLabel"] as? String,
      let primaryURL = dict["primaryURL"] as? String,
      let secondaryLabel = dict["secondaryLabel"] as? String
    else { return nil }
    self.intent = dict["intent"] as? String ?? "reinforce"
    self.title = title
    self.body = body
    self.primaryLabel = primaryLabel
    self.primaryURL = primaryURL
    self.secondaryLabel = secondaryLabel
  }

  public init(
    intent: String, title: String, body: String, primaryLabel: String, primaryURL: String,
    secondaryLabel: String
  ) {
    self.intent = intent
    self.title = title
    self.body = body
    self.primaryLabel = primaryLabel
    self.primaryURL = primaryURL
    self.secondaryLabel = secondaryLabel
  }
}

public struct FocusNudgePayload {
  public let base: FocusNudgeCard
  /// The §C-safety escalation: shown once they have retreated escalateAfter times inside
  /// escalateWindowMs. Drops the productivity push entirely. Cached alongside base precisely so
  /// the escalation still happens with no network — care must never depend on connectivity.
  public let escalated: FocusNudgeCard
  public let escalateAfter: Int
  public let escalateWindowMs: Double
  /// How long the shield stays off after a "continue anyway" (§C: a tap on the shoulder, not
  /// nagging).
  public let deferMs: Double

  /// The last-resort copy, used when nothing has ever been cached — a fresh install that shielded
  /// before the first fetch landed, or a payload we could not parse.
  ///
  /// 🔴 It biases to CARE, not to productivity (§C-safety: "whenever it's uncertain, care and
  /// connection over productivity"). We do not know why they are here, so we do not push hard.
  public static let fallback = FocusNudgePayload(
    base: FocusNudgeCard(
      intent: "reinforce",
      title: "You're still locked in.",
      body:
        "Whatever pulled you here will keep. Come back to it — or take a real break, properly.",
      primaryLabel: "Back to my session",
      primaryURL: "philoi://lock-in?from=shield",
      secondaryLabel: "Continue anyway"
    ),
    escalated: FocusNudgeCard(
      intent: "wellbeing",
      title: "Hey — just checking on you.",
      body:
        "No judgment. But the feed won't fix whatever's sitting heavy. Step outside for a sec, or text someone who gets it.",
      primaryLabel: "Talk to someone",
      primaryURL: "philoi://support?from=shield",
      secondaryLabel: "I'm okay — continue"
    ),
    escalateAfter: 3,
    escalateWindowMs: 60 * 60 * 1000,
    deferMs: 10 * 60 * 1000
  )

  public init(
    base: FocusNudgeCard, escalated: FocusNudgeCard, escalateAfter: Int, escalateWindowMs: Double,
    deferMs: Double
  ) {
    self.base = base
    self.escalated = escalated
    self.escalateAfter = escalateAfter
    self.escalateWindowMs = escalateWindowMs
    self.deferMs = deferMs
  }

  public static func load() -> FocusNudgePayload {
    // The shield runs in another process; without this it can read a stale snapshot of the group's
    // preferences and show the line from two sessions ago.
    CFPreferencesAppSynchronize(kCFPreferencesCurrentApplication)

    guard let raw = focusNudgeDefaults?.string(forKey: FocusNudgeKey.payload),
      let data = raw.data(using: .utf8),
      let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
      let base = FocusNudgeCard(dict: json["base"] as? [String: Any])
    else { return .fallback }

    return FocusNudgePayload(
      base: base,
      // A payload missing its escalation still escalates — to the built-in wellbeing card rather
      // than to nothing. Falling back to `base` here would answer repeated retreat with another
      // productivity push, which is the one outcome §C-safety rules out.
      escalated: FocusNudgeCard(dict: json["escalated"] as? [String: Any]) ?? Self.fallback.escalated,
      escalateAfter: json["escalateAfter"] as? Int ?? Self.fallback.escalateAfter,
      escalateWindowMs: json["escalateWindowMs"] as? Double ?? Self.fallback.escalateWindowMs,
      deferMs: json["deferMs"] as? Double ?? Self.fallback.deferMs
    )
  }

  /// Which card to draw right now.
  ///
  /// Escalation is ONE-WAY. A payload the coach already marked wellbeing or support is never
  /// downgraded back to a push by a low retreat count — once the data says care, it stays care.
  public func card(retreats: Int) -> FocusNudgeCard {
    if base.intent == "wellbeing" || base.intent == "support" { return base }
    return retreats >= escalateAfter ? escalated : base
  }
}

// MARK: - Retreat history (§C-safety graduated response)

public enum FocusNudgeState {
  /// Timestamps inside the escalation window, oldest first.
  public static func retreats(window: Double) -> [Double] {
    let now = focusNudgeNowMs()
    let all = focusNudgeDefaults?.array(forKey: FocusNudgeKey.retreats) as? [Double] ?? []
    return all.filter { now - $0 <= window }
  }

  /// Record that the shield was presented. Debounced: iOS asks the ShieldConfiguration extension
  /// for its UI more than once per presentation (per app, per category), and each of those is the
  /// same single act of drift — counting them all would escalate someone to the wellbeing card on
  /// their very first retreat.
  @discardableResult
  public static func recordRetreat(window: Double, debounceMs: Double = 30_000) -> Int {
    let now = focusNudgeNowMs()
    var kept = retreats(window: window)
    if let last = kept.last, now - last < debounceMs { return kept.count }
    kept.append(now)
    // Bounded so a pathological day cannot grow this without limit inside a shared container.
    focusNudgeDefaults?.set(Array(kept.suffix(50)), forKey: FocusNudgeKey.retreats)
    return kept.count
  }

  public static func clearRetreats() {
    focusNudgeDefaults?.removeObject(forKey: FocusNudgeKey.retreats)
  }

  public static var deferredUntilMs: Double {
    get { focusNudgeDefaults?.double(forKey: FocusNudgeKey.deferredUntilMs) ?? 0 }
    set { focusNudgeDefaults?.set(newValue, forKey: FocusNudgeKey.deferredUntilMs) }
  }

  public static var isDeferred: Bool {
    deferredUntilMs > focusNudgeNowMs()
  }

  public static var armedAtMs: Double {
    get { focusNudgeDefaults?.double(forKey: FocusNudgeKey.armedAtMs) ?? 0 }
    set { focusNudgeDefaults?.set(newValue, forKey: FocusNudgeKey.armedAtMs) }
  }
}

// MARK: - The selection

public enum FocusNudgeSelection {
  /// The user's picked apps. Opaque tokens throughout — we store and compare them, and never try
  /// to resolve an identity out of one (APP_BLOCKER_SPEC "Privacy: iOS selection is opaque").
  public static func load() -> FamilyActivitySelection? {
    CFPreferencesAppSynchronize(kCFPreferencesCurrentApplication)
    guard let raw = focusNudgeDefaults?.string(forKey: FocusNudgeKey.selection),
      let data = raw.data(using: .utf8),
      let selection = try? JSONDecoder().decode(FamilyActivitySelection.self, from: data)
    else { return nil }
    return selection
  }

  public static func save(_ selection: FamilyActivitySelection) {
    guard let data = try? JSONEncoder().encode(selection),
      let raw = String(data: data, encoding: .utf8)
    else { return }
    focusNudgeDefaults?.set(raw, forKey: FocusNudgeKey.selection)
  }

  public static func clear() {
    focusNudgeDefaults?.removeObject(forKey: FocusNudgeKey.selection)
  }

  public static var isEmpty: Bool {
    guard let s = load() else { return true }
    return s.applicationTokens.isEmpty && s.categoryTokens.isEmpty && s.webDomainTokens.isEmpty
  }
}

// MARK: - Arming

public enum FocusNudgeShield {
  /// Apply the user's selection to the shield. Idempotent — the monitor extension and the app both
  /// call it, and calling it twice is the normal case rather than a bug.
  ///
  /// A no-op while deferred, so a "continue anyway" is not undone a second later by whichever
  /// process happens to reconcile next. That would turn a pass-through into a gate, which is the
  /// one thing this feature must never become.
  public static func arm(force: Bool = false) {
    guard force || !FocusNudgeState.isDeferred else { return }
    guard let selection = FocusNudgeSelection.load() else { return }

    let store = ManagedSettingsStore(named: .focusNudge)
    store.shield.applications =
      selection.applicationTokens.isEmpty ? nil : selection.applicationTokens
    store.shield.webDomains = selection.webDomainTokens.isEmpty ? nil : selection.webDomainTokens

    // `except: []` is not a formality — ActivityCategoryPolicy.specific carries a required
    // exclusion set, and it is the mechanism a "block everything except X" product would use. We
    // have nothing to exclude: the user named the categories they wanted guarded, and quietly
    // carving holes in that is not ours to do.
    if selection.categoryTokens.isEmpty {
      store.shield.applicationCategories = nil
      store.shield.webDomainCategories = nil
    } else {
      store.shield.applicationCategories = .specific(selection.categoryTokens, except: [])
      store.shield.webDomainCategories = .specific(selection.categoryTokens, except: [])
    }
  }

  /// Take the shield down completely.
  ///
  /// clearAllSettings() rather than nilling the four fields: this store is ours alone (see the
  /// named store above), and a session that ends must leave NOTHING behind. An app still shielded
  /// after its lock-in ended is the only genuinely harmful failure this feature has.
  public static func disarm() {
    ManagedSettingsStore(named: .focusNudge).clearAllSettings()
  }
}
