// The lock-in Live Activity: Lock Screen card + Dynamic Island (#87, design-mocks/91-lockin-pill.html).
//
// THE ONE RULE IN THIS FILE: nothing here is ever driven by a pushed tick. The clock is
// `Text(timerInterval:)`, which iOS animates itself from a fixed start date at zero cost to us and
// zero network traffic. The app pushes an update only when the rank bar moves or the session ends.
//
// The second rule, inherited from the OS rather than chosen: there is no animation here. No pulse
// on the projection cue, no flicker on the flame — Live Activities get no free-running animation
// loop, so the in-app bar (src/components/rank-projection-bar.tsx) pulses and this one doesn't.
// That's the same reason that component takes an `animated` prop instead of always pulsing.

import ActivityKit
import SwiftUI
import WidgetKit

// MARK: - Palette

// Hardcoded rather than read from the generated asset catalog because the asset names
// apple-targets derives from expo-target.config.js `colors` keys are an implementation detail of
// the plugin — a rename there would fail at RUNTIME as a blank/black card, not at build time.
// These mirror src/constants/theme.ts and DESIGN_LANGUAGE_EMBER.md §7.
private enum Palette {
  /// The PHILOI wordmark gradient, top to bottom.
  static let purpleLight = Color(hex: 0xC99BFF)
  static let purpleDark = Color(hex: 0x8A4FFF)
  /// "What you're chasing" — the projection segment and its label. Never the fill.
  static let emberLight = Color(hex: 0xF2A33C)
  static let emberDark = Color(hex: 0xE0612C)
  static let track = Color.white.opacity(0.12)
}

private extension Color {
  init(hex: UInt32) {
    self.init(
      .sRGB,
      red: Double((hex >> 16) & 0xFF) / 255,
      green: Double((hex >> 8) & 0xFF) / 255,
      blue: Double(hex & 0xFF) / 255,
      opacity: 1
    )
  }

  /// Tier metal arrives from JS as "#B87333" (RANK_TIER_METAL). Falls back to the ember pair
  /// rather than to a default that could render invisible against the card.
  init(philoiHex: String, fallback: Color) {
    let cleaned = philoiHex.hasPrefix("#") ? String(philoiHex.dropFirst()) : philoiHex
    guard cleaned.count == 6, let value = UInt32(cleaned, radix: 16) else {
      self = fallback
      return
    }
    self.init(hex: value)
  }
}

// MARK: - Shared pieces

/// The self-counting clock. `countsDown: false` makes it climb from `start`.
///
/// The range needs an end, and a lock-in has no scheduled one — so it's capped a day out. Beyond
/// 24h the text would stop advancing, which is fine: a lock-in that long is already a bug or a
/// forgotten session, and the app's own stale-session handling ends the activity well before then.
private struct SessionTimer: View {
  let start: Date
  var font: Font = .system(size: 34, weight: .semibold, design: .rounded)

  var body: some View {
    Text(timerInterval: start ... start.addingTimeInterval(24 * 60 * 60), countsDown: false)
      .font(font)
      .monospacedDigit()
      .foregroundStyle(.white)
  }
}

/// "PHILOI" in the purple gradient, with the session label beside it when there is one.
private struct Wordmark: View {
  let sessionName: String
  var size: CGFloat = 13

  private var text: String {
    sessionName.isEmpty ? "PHILOI" : "PHILOI · \(sessionName.uppercased())"
  }

  var body: some View {
    Text(text)
      .font(.system(size: size, weight: .bold))
      .kerning(1.6)
      .lineLimit(1)
      .foregroundStyle(
        LinearGradient(colors: [Palette.purpleLight, Palette.purpleDark], startPoint: .top, endPoint: .bottom)
      )
  }
}

/// Progress through the current division, with the projection segment filling the gap.
///
/// Three layers back to front, matching rank-projection-bar.tsx exactly: track, ember projection
/// spanning what's left, then the tier-metal fill for what's earned. Tier colour = where you are,
/// ember = what you're chasing (DESIGN_LANGUAGE_EMBER.md §7).
private struct RankBar: View {
  let state: LockInActivityAttributes.ContentState

  private var ratio: Double { min(max(state.rankRatio, 0), 1) }
  /// The activity starts the instant the session does, but the rank comes from a network read that
  /// resolves a moment later — so the first content state has an empty label. Rendering it anyway
  /// would flash "0% to " on the Lock Screen, so the bar simply isn't there until there's a rank to
  /// show. The card still has the wordmark and the clock, which is the part that matters.
  private var hasRank: Bool { !state.rankLabel.isEmpty }
  /// At the apex the bar is full and there is nothing to chase, so the ghost would be zero-width
  /// anyway — but a missing projection also hides it, which is the new-user case.
  private var showsProjection: Bool { state.projection != nil && ratio < 1 }

  var body: some View {
    if hasRank { bar } else { EmptyView() }
  }

  private var bar: some View {
    VStack(alignment: .leading, spacing: 4) {
      HStack(alignment: .firstTextBaseline) {
        Text(ratio >= 1 ? "Max rank" : "\(Int(ratio * 100))% to \(state.rankLabel)")
          .font(.system(size: 11, weight: .semibold))
          .foregroundStyle(.white.opacity(0.85))
        Spacer(minLength: 6)
        // Small on purpose (mock 91): the eye should land on the ember segment and read "close",
        // with the number there if you look for it.
        if let projection = state.projection, showsProjection {
          Text(projection)
            .font(.system(size: 10, weight: .semibold))
            .monospacedDigit()
            .foregroundStyle(Palette.emberDark)
        }
      }

      GeometryReader { geo in
        ZStack(alignment: .leading) {
          Capsule().fill(Palette.track)

          if showsProjection {
            Capsule()
              .fill(LinearGradient(colors: [Palette.emberLight, Palette.emberDark], startPoint: .leading, endPoint: .trailing))
              .opacity(0.5)
              .frame(width: geo.size.width * (1 - ratio))
              .offset(x: geo.size.width * ratio)
          }

          // Keep a sliver visible at 0% so a fresh division doesn't look like a broken bar.
          Capsule()
            .fill(
              LinearGradient(
                colors: [
                  Color(philoiHex: state.tierOuterHex, fallback: Palette.emberDark),
                  Color(philoiHex: state.tierInnerHex, fallback: Palette.emberLight),
                ],
                startPoint: .leading,
                endPoint: .trailing
              )
            )
            .frame(width: max(geo.size.width * ratio, ratio > 0 ? 3 : 0))
        }
      }
      .frame(height: 7)
    }
  }
}

// MARK: - Lock Screen

private struct LockScreenView: View {
  let context: ActivityViewContext<LockInActivityAttributes>

  var body: some View {
    VStack(spacing: 8) {
      Wordmark(sessionName: context.attributes.sessionName)
      SessionTimer(start: context.attributes.startedAt)
      RankBar(state: context.state)
    }
    .padding(.horizontal, 18)
    .padding(.vertical, 14)
    .frame(maxWidth: .infinity)
  }
}

// MARK: - Activity

struct LockInLiveActivity: Widget {
  var body: some WidgetConfiguration {
    ActivityConfiguration(for: LockInActivityAttributes.self) { context in
      LockScreenView(context: context)
        .activityBackgroundTint(Color(hex: 0x1B1430))
        .activitySystemActionForegroundColor(.white)
    } dynamicIsland: { context in
      DynamicIsland {
        // Expanded drops the rank bar on purpose — the region is short and wide, and a 7pt bar
        // under a 34pt clock reads as noise there. The Lock Screen card is where the ladder lives.
        DynamicIslandExpandedRegion(.center) {
          VStack(spacing: 4) {
            Wordmark(sessionName: context.attributes.sessionName, size: 12)
            SessionTimer(start: context.attributes.startedAt, font: .system(size: 30, weight: .semibold, design: .rounded))
          }
        }
      } compactLeading: {
        Circle()
          .fill(LinearGradient(colors: [Palette.purpleLight, Palette.purpleDark], startPoint: .top, endPoint: .bottom))
          .frame(width: 8, height: 8)
      } compactTrailing: {
        SessionTimer(start: context.attributes.startedAt, font: .system(size: 13, weight: .semibold, design: .rounded))
      } minimal: {
        SessionTimer(start: context.attributes.startedAt, font: .system(size: 12, weight: .semibold, design: .rounded))
      }
      // Tapping any presentation opens the app; the root layout routes an active session to the
      // lock-in screen, so no per-activity deep link is needed.
      .widgetURL(URL(string: "philoi://lock-in"))
    }
  }
}

// MARK: - Entry point

@main
struct LockInLiveActivityBundle: WidgetBundle {
  // Only the activity — there is no home-screen widget in this target, so no timeline provider
  // and no supportedFamilies to declare.
  var body: some Widget {
    LockInLiveActivity()
  }
}
