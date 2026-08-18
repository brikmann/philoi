// ⚠️ DUPLICATED FILE — keep byte-identical with its twin:
//   targets/lockin/Attributes.swift                    (widget extension target)
//   modules/philoi-live-activity/ios/Attributes.swift  (app-side ActivityKit bridge)
//
// The duplication is not laziness, it's a limitation. The widget is its own Xcode target and the
// bridge builds as its own CocoaPod, so neither can import the other, and there is no shared
// module to hoist this into. Each compiles its own copy and ActivityKit matches them STRUCTURALLY
// at runtime, across a process boundary, by field name and type.
//
// The failure mode when they drift is the worst kind there is: no build error, no visible runtime
// error. The widget's decoder throws inside a system daemon and the Lock Screen card simply never
// appears. `npm run check:live-activity` diffs the two copies and runs as part of `npm run
// typecheck` — if you edit one, edit both.

import ActivityKit
import Foundation

struct LockInActivityAttributes: ActivityAttributes {
  /// The parts that CHANGE during a session.
  ///
  /// Elapsed time is deliberately NOT in here. Every field in this struct costs an ActivityKit
  /// update to change, and the OS already derives the clock from `startedAt` below via
  /// `Text(timerInterval:)`. Pushing ticks would exhaust the update budget within minutes and
  /// drain the battery to display a number iOS can compute for free.
  struct ContentState: Codable, Hashable {
    /// "Gold III", or "Primordial" at the apex — `formatRankTier` on the JS side owns this string
    /// so the apex correctly renders with no roman numeral.
    var rankLabel: String
    /// 0...1 through the current division. Pinned to 1 at Primordial, which has nothing left to
    /// fill and would otherwise read as a permanently empty bar (i.e. as a bug).
    var rankRatio: Double
    /// "~2h". nil for a new user with no XP rate yet, which hides the projection cue entirely
    /// rather than showing a fabricated estimate.
    var projection: String?
    /// The CURRENT tier's two-tone metal, as hex. Passed in rather than resolved in Swift so the
    /// ladder's colours live in exactly one place — src/lib/rank-tiers.ts (RANK_TIER_METAL).
    var tierOuterHex: String
    var tierInnerHex: String
    /// The equipped flare's colour as "#RRGGBB", or nil for no flare. Tints the card's BORDER and
    /// the Dynamic Island dot only — never the rank bar (which means tier) or the clock. In
    /// ContentState rather than in the attributes because the loadout can hydrate after the
    /// activity has already gone up, and attributes are immutable once requested.
    var flareHex: String?
  }

  /// "Study", "Gym", or the user's own goal detail. Empty string when unset; the UI omits it.
  var sessionName: String
  /// Set ONCE when the session starts and never updated — this is the anchor the OS counts up
  /// from on its own.
  var startedAt: Date
}
