import { Ionicons } from '@expo/vector-icons';
import { useEffect, useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Circle, Defs, G, Line, RadialGradient, Stop } from 'react-native-svg';

import { ClaimBalancePill, asBoxKey, useRewardClaim } from '@/components/economy/reward-claim';
import { RewardRow, type RewardRowSpec } from '@/components/economy/reward-rows';
import { FullscreenRays, useRevealCue, type RewardRevealKind } from '@/components/economy/reward-reveal';
import { FlameSvg } from '@/components/flame-icon';
import { PrimaryButton } from '@/components/ui/primary-button';
import { Colors, Fonts, Spacing } from '@/constants/theme';
import { useInventory } from '@/hooks/use-inventory';
import { useReduceMotion } from '@/hooks/use-reduce-motion';
import {
  TIER_INTENSITY,
  TIER_MEDAL,
  challengeHeadline,
  type PlacementTier,
  type RewardContext,
} from '@/lib/challenge-reward-copy';

// The challenge / campfire result screen — design-mocks/47.
//
// Fires when a challenge closes. Until now grant_reward paid out silently: embers landed in the
// wallet, a box appeared in the inventory and a badge was minted with nothing on screen to say so,
// which made the most rewarding moment in the app its quietest.
//
// The rewards shown are the ones the SERVER reports paying, never re-derived here. grant_reward
// returns {embers, box, badge, band}; this screen renders that. A screen that computed its own
// numbers from the same inputs would eventually disagree with the ledger, and the ledger is what
// actually moved.

export type ChallengeRewardResult = {
  /** Where they finished — drives copy pool AND the screen's intensity. */
  tier: PlacementTier;
  /** Duel vs board, so a 1v1 loss can never draw the "Fraud Watch" pool. */
  context: RewardContext;
  /** Absolute finishing position, 1-based. Null on a result settled without standings. */
  placement: number | null;
  /** How many raced. On a whole-campfire placement race this is the campfire. */
  fieldSize: number;
  /** 0 = top of the board, 1 = bottom — placementTier's orientation, already flipped for us. */
  percentile: number | null;
  /** For the sub-line: "You beat Dee", "Most lock-in time", "Semester". */
  opponentName?: string | null;
  metricLabel: string;
  durationLabel: string;
  xp: number;
  embers: number;
  /** `id` is the loot_boxes row (0125) — null on a payload written before that deployed, which is
   *  what leaves the Open CTA off rather than pointing it at a box that cannot be found. */
  box: { id: string | null; key: string; name: string; rarity: string } | null;
  badge: { key: string; name: string } | null;
};

type Props = {
  result: ChallengeRewardResult;
  displayName: string;
  /** The last headline this user saw, so the pool avoids an immediate repeat. */
  previousHeadline?: string | null;
  onOpenBox?: () => void;
  onShare?: () => void;
  onClose: () => void;
  sharing?: boolean;
  /**
   * Which of the three challenge reveals this is, for the ray tint and count in REVEAL_TUNING.
   *
   * Passed in rather than derived here because both presenters — the settlement watcher and the
   * challenge-info screen — already compute it with `challengeRevealKind` to queue at the right
   * priority, and a second derivation off `result.context` would disagree with theirs on a
   * collective challenge (which is a 'board' here but a team reveal there). The fallback is only
   * for a caller that has not been updated.
   */
  revealKind?: RewardRevealKind;
};

export function ChallengeRewardScreen({
  result,
  displayName,
  previousHeadline,
  onOpenBox,
  onShare,
  onClose,
  sharing = false,
  revealKind,
}: Props) {
  const reduceMotion = useReduceMotion();
  const intensity = TIER_INTENSITY[result.tier];
  const kind: RewardRevealKind = revealKind ?? (result.context === 'duel' ? 'challenge_solo' : 'challenge_placement');
  // A settlement's embers landed server-side, so this read already includes them — the pill counts
  // up TO it, from `wallet - paid`. Costs one get_inventory on a screen that only ever mounts on a
  // real payout, which is the same trade the goal reveal's own note argues for.
  const { embers: walletEmbers, loading: walletLoading } = useInventory();

  // 🔇 THIS SCREEN MADE NO SOUND AT ALL. The three challenge rows of REVEAL_TUNING have pointed at
  // the victory fanfare since #185, and nothing read them: the cue only ever fired from the shared
  // card, and a settled challenge is presented by this bespoke screen through either door. So the
  // app's loudest payout — the one Noah calls the challenge victory — settled in silence.
  useRevealCue(kind);

  // §A · THE SAME BUILD THE GOAL REVEAL AND THE SHARED CARD USE. A settled challenge arrived as a
  // finished screen too — the tier glow was already breathing when the frame appeared, which reads
  // as a screenshot rather than as a result landing. Back-eased overshoot and settle, delayed
  // behind the modal's own fade, so all three reveals enter the same way.
  const enter = useSharedValue(0);
  useEffect(() => {
    enter.value = withDelay(
      60,
      withSequence(
        withTiming(1.04, { duration: reduceMotion ? 0 : 300, easing: Easing.out(Easing.back(1.6)) }),
        withTiming(1, { duration: reduceMotion ? 0 : 160 })
      )
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one build per mount
  }, []);
  const buildStyle = useAnimatedStyle(() => ({
    opacity: Math.min(1, enter.value * 1.4),
    transform: [{ scale: 0.9 + enter.value * 0.1 }],
  }));

  // Picked ONCE per mount. Regenerating on every render would reroll the headline mid-animation
  // and on every parent state change — the line has to hold still while it is being read.
  const headline = useMemo(
    () => challengeHeadline(result.tier, result.context, displayName, previousHeadline),
    [result.tier, result.context, displayName, previousHeadline]
  );

  // The spec's intensity ladder, as one number the burst scales off: ray length, glow and flame
  // all climb together rather than each being tuned per tier by hand.
  const energy = intensity.level / 7;

  const pulse = useSharedValue(0);
  useEffect(() => {
    if (reduceMotion) {
      pulse.value = 0;
      return;
    }
    // Faster at the top of the ladder — "animation speed scales up together" with the rest.
    const duration = 1600 - energy * 500;
    pulse.value = withRepeat(withTiming(1, { duration, easing: Easing.inOut(Easing.quad) }), -1, true);
  }, [reduceMotion, energy, pulse]);

  const glowStyle = useAnimatedStyle(() => ({
    opacity: 0.45 + pulse.value * (0.2 + energy * 0.3),
    transform: [{ scale: 1 + pulse.value * (0.02 + energy * 0.05) }],
  }));

  const rows = useMemo(() => buildRows(result, onOpenBox), [result, onOpenBox]);

  // Box into the bag, then embers into the balance, then the reveal closes itself. The row's own
  // Open button is untouched and still routes to the box-crack screen — claiming puts the box away,
  // opening it is a different thing you can still do from here or from the inventory.
  const {
    rootRef,
    originRef,
    pillRef,
    heroAnchor,
    rootOffset,
    busy,
    ctaLabel,
    onCta,
    dismiss,
    displayBalance,
    pillStyle,
    layer,
  } = useRewardClaim({
    boxKey: asBoxKey(result.box?.key),
    boxName: result.box?.name,
    embers: result.embers,
    walletEmbers: walletLoading ? null : walletEmbers,
    onDone: onClose,
  });

  return (
    <View style={styles.root} ref={rootRef} collapsable={false}>
      {/* THE FULL-SCREEN FAN, from the shared reveal language, anchored on the measured hero.
          Mock 47's own `Rays` below stay exactly as they were — they are a 120pt crest detail whose
          spoke count climbs with the ladder, and this is the light behind the whole frame. Gated on
          the SAME `level >= 3` for the same reason the crest spokes are: the spec is explicit that
          a weak result gets embers, not blaze, and a full-screen ray blast behind "NEEDS IGNITION"
          would be the app cheering a loss. One comparison to move if Noah wants it lower. */}
      {intensity.level >= 3 ? (
        <FullscreenRays kind={kind} anchor={heroAnchor} rootOffset={rootOffset} />
      ) : null}

      {/* Close moved off the top-right corner to make room for the balance: the corner the embers
          fly to has to hold the thing they land in. */}
      <View style={styles.topbar}>
        <Pressable style={styles.close} onPress={dismiss} hitSlop={12} accessibilityLabel="Close">
          <Ionicons name="close" size={22} color={Colors.textTertiary} />
        </Pressable>
        <Animated.View style={pillStyle}>
          <ClaimBalancePill embers={displayBalance} innerRef={pillRef} lit={busy} />
        </Animated.View>
      </View>

      {/* The build wraps the CONTENT, never the rays — the fan is what it builds into. */}
      <Animated.View style={[styles.buildLayer, buildStyle]}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* Also the origin of both flights and the anchor for the rays, hence the ref. */}
        <View style={styles.burst} ref={originRef} collapsable={false}>
          <Animated.View style={[styles.glowLayer, glowStyle]} pointerEvents="none">
            <Svg width={200} height={200}>
              <Defs>
                <RadialGradient id="rewardGlow" cx="50%" cy="50%" r="50%">
                  <Stop offset="0" stopColor={intensity.accent} stopOpacity={0.16 + energy * 0.3} />
                  <Stop offset="0.65" stopColor={intensity.accent} stopOpacity={0} />
                </RadialGradient>
              </Defs>
              <Circle cx={100} cy={100} r={100} fill="url(#rewardGlow)" />
            </Svg>
          </Animated.View>

          {/* Mock 47's radiating rays. Count climbs with the ladder, so a mid-pack finish gets a
              calm frame and a champion gets the full starburst — "embers, not blaze" at the
              bottom, per the spec's explicit instruction not to over-celebrate a weak result. */}
          {intensity.level >= 3 ? <Rays accent={intensity.accent} energy={energy} /> : null}

          <View style={styles.flameHolder}>
            <FlameSvg width={54} height={54} />
          </View>
        </View>

        <Text style={[styles.eyebrow, { color: intensity.accent }]}>{intensity.label}</Text>
        <Text style={styles.headline}>{headline}</Text>
        {/* THE FIELD, STATED (#186). A placement race's result is "where you came out of how many",
            and until now that number appeared nowhere on the screen that celebrates it — the
            subline said "🥇 1st" whether you had beaten two people or two hundred. Given its own
            line, in the tier's accent, because on a big campfire race it IS the result. */}
        {fieldLine(result) ? (
          <View style={[styles.fieldPill, { borderColor: intensity.accent }]}>
            <Text style={[styles.fieldPillText, { color: intensity.accent }]}>{fieldLine(result)}</Text>
          </View>
        ) : null}
        <Text style={styles.subline}>{subline(result)}</Text>

        <View style={styles.rewards}>
          {rows.map((row) => (
            <RewardRow key={`${row.kind}-${row.title}`} spec={row} />
          ))}
        </View>
      </ScrollView>
      </Animated.View>

      <View style={styles.foot}>
        {/* Was one CTA that took the whole settlement at once — "Open your Hestia Vessel" or a bare
            "Collect". Now it is the current claim, box first: the box drifts to the inventory
            corner, then the embers fly into the pill above with their smoke. Disabled while
            something is in the air, so a second tap cannot skip a flight. */}
        <PrimaryButton label={ctaLabel} onPress={onCta} disabled={busy} />
        {onShare ? (
          <Pressable
            style={styles.shareBtn}
            onPress={onShare}
            disabled={sharing || busy}
            accessibilityRole="button">
            <Text style={styles.shareText}>{sharing ? 'Preparing…' : 'Share to your story'}</Text>
          </Pressable>
        ) : null}
      </View>

      {layer}
    </View>
  );
}

/** Mock 47's seven rays. Static SVG — only the glow behind them breathes, so this costs one draw. */
function Rays({ accent, energy }: { accent: string; energy: number }) {
  const lines = [
    [60, 6],
    [104, 50],
    [16, 50],
    [92, 18],
    [28, 18],
    [92, 82],
    [28, 82],
  ];
  return (
    <View style={styles.rays} pointerEvents="none">
      <Svg width={120} height={100} viewBox="0 0 120 100">
        <G stroke={accent} strokeWidth={2} strokeLinecap="round" opacity={0.25 + energy * 0.35}>
          {lines.map(([x, y]) => (
            <Line key={`${x}-${y}`} x1={60} y1={50} x2={x} y2={y} />
          ))}
        </G>
      </Svg>
    </View>
  );
}

/** 1 -> "1st", 2 -> "2nd", 12 -> "12th", 23 -> "23rd". */
function ordinal(n: number): string {
  // 11/12/13 are the exception the mod-10 rule gets wrong — "11st", "12nd", "13rd".
  const teen = n % 100;
  if (teen >= 11 && teen <= 13) return `${n}th`;
  const suffix = { 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] ?? 'th';
  return `${n}${suffix}`;
}

/**
 * "🥇 1st of 48" / "12th of 48 · TOP 25%" — the headline fact of a board race, or null when there
 * is no field worth naming.
 *
 * NOT SHOWN FOR A DUEL. "1st of 2" is a worse way of saying "you won", and the duel already gets
 * "You beat Dee" in the subline. Nor for a field of one, which is not a race.
 */
function fieldLine(r: ChallengeRewardResult): string | null {
  if (r.context !== 'board' || r.placement == null || r.fieldSize < 2) return null;
  const medal = TIER_MEDAL[r.tier];
  // The podium medals already carry the ordinal ("🥇 1st"), so they take the field count directly
  // rather than repeating it — "🥇 1st of 48", not "🥇 1st · 1st of 48".
  if (r.tier === 'rank1' || r.tier === 'rank2' || r.tier === 'rank3') return `${medal} of ${r.fieldSize}`;
  return `${ordinal(r.placement)} of ${r.fieldSize} · ${medal}`;
}

/** "🥇 1st · You beat Dee · Most lock-in time · Semester" */
function subline(r: ChallengeRewardResult): string {
  // The medal moves up into the field pill when there is one, so it is stated once per screen.
  const lead = fieldLine(r) ? null : TIER_MEDAL[r.tier];
  return [lead, r.opponentName ? `You beat ${r.opponentName}` : null, r.metricLabel, r.durationLabel]
    .filter(Boolean)
    .join(' · ');
}

function buildRows(r: ChallengeRewardResult, onOpenBox?: () => void): RewardRowSpec[] {
  const rows: RewardRowSpec[] = [];

  // BOX FIRST, THEN EMBERS, then the two rows nothing is claimed from. The manifest reads in the
  // order the claims run — see useRewardClaim — so the row you are about to claim is the top one,
  // and the box is no longer buried under two lines of numbers on the screen that grants it.
  if (r.box) {
    rows.push({
      kind: 'box',
      title: r.box.name,
      detail: 'Cosmetic loot box',
      chip: { label: r.box.rarity.toUpperCase(), color: Colors.amber },
      onOpen: onOpenBox,
    });
  }
  if (r.embers > 0) {
    rows.push({
      kind: 'embers',
      title: 'Embers',
      detail: 'Spend in the shop',
      value: `+${r.embers.toLocaleString('en-US')}`,
      destination: '→ wallet',
    });
  }
  if (r.xp > 0) {
    rows.push({
      kind: 'xp',
      title: 'XP earned',
      detail: 'The bigger the goal, the bigger the pot',
      value: `+${r.xp.toLocaleString('en-US')}`,
    });
  }
  if (r.badge) {
    rows.push({
      kind: 'badge',
      title: `"${r.badge.name}" badge`,
      detail: "Exclusive — can't be bought",
      chip: { label: 'EARNED', color: Colors.green },
      destination: '→ earned',
    });
  }
  return rows;
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  // Takes the ScrollView's place in the column, so the build is a transform on the same box rather
  // than a new layout step that would shift the footer.
  buildLayer: {
    flex: 1,
  },
  topbar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.three,
    // No top padding of its own: the safe-area inset above already clears the status bar, and the
    // extra 8 on top of it left the X and the balance floating in the middle of nothing. This row
    // sits directly under the system bar, which is where a close button belongs.
    paddingTop: 0,
    zIndex: 2,
  },
  close: {
    width: 34,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scroll: {
    flexGrow: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.two,
    gap: 2,
  },
  burst: {
    width: 200,
    height: 200,
    alignItems: 'center',
    justifyContent: 'center',
  },
  glowLayer: {
    position: 'absolute',
  },
  rays: {
    position: 'absolute',
  },
  flameHolder: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  eyebrow: {
    fontFamily: Fonts.bodyBold,
    fontSize: 10.5,
    letterSpacing: 1.4,
    marginTop: Spacing.two,
  },
  headline: {
    fontFamily: Fonts.bodyBold,
    fontSize: 23,
    color: Colors.ink,
    textAlign: 'center',
    marginTop: 6,
    lineHeight: 29,
  },
  fieldPill: {
    borderWidth: 1,
    borderRadius: 999,
    paddingVertical: 5,
    paddingHorizontal: Spacing.twelve,
    backgroundColor: Colors.scrim,
    marginTop: Spacing.twelve,
  },
  fieldPillText: {
    fontFamily: Fonts.bodyBold,
    fontSize: 14,
    letterSpacing: 0.4,
  },
  subline: {
    fontFamily: Fonts.body,
    fontSize: 12.5,
    color: Colors.muted,
    textAlign: 'center',
    marginTop: 6,
  },
  rewards: {
    alignSelf: 'stretch',
    gap: Spacing.two,
    marginTop: Spacing.four,
  },
  foot: {
    paddingHorizontal: 18,
    paddingBottom: 18,
    paddingTop: Spacing.two,
    gap: Spacing.two,
  },
  shareBtn: {
    alignItems: 'center',
    paddingVertical: Spacing.twelve,
  },
  shareText: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 13.5,
    color: Colors.muted,
  },
});
