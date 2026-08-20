import { Ionicons } from '@expo/vector-icons';
import { useEffect, useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import Svg, { Circle, Defs, G, Line, RadialGradient, Stop } from 'react-native-svg';

import { RewardRow, type RewardRowSpec } from '@/components/economy/reward-rows';
import { FlameSvg } from '@/components/flame-icon';
import { PrimaryButton } from '@/components/ui/primary-button';
import { Colors, Fonts, Spacing } from '@/constants/theme';
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
  /** For the sub-line: "You beat Dee", "Most lock-in time", "Semester". */
  opponentName?: string | null;
  metricLabel: string;
  durationLabel: string;
  xp: number;
  embers: number;
  box: { key: string; name: string; rarity: string } | null;
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
};

export function ChallengeRewardScreen({
  result,
  displayName,
  previousHeadline,
  onOpenBox,
  onShare,
  onClose,
  sharing = false,
}: Props) {
  const reduceMotion = useReduceMotion();
  const intensity = TIER_INTENSITY[result.tier];

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

  return (
    <View style={styles.root}>
      <Pressable style={styles.close} onPress={onClose} hitSlop={12} accessibilityLabel="Close">
        <Ionicons name="close" size={22} color={Colors.textTertiary} />
      </Pressable>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.burst}>
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
        <Text style={styles.subline}>{subline(result)}</Text>

        <View style={styles.rewards}>
          {rows.map((row) => (
            <RewardRow key={`${row.kind}-${row.title}`} spec={row} />
          ))}
        </View>
      </ScrollView>

      <View style={styles.foot}>
        {result.box && onOpenBox ? (
          <PrimaryButton label={`Open your ${result.box.name}`} onPress={onOpenBox} />
        ) : (
          <PrimaryButton label="Collect" onPress={onClose} />
        )}
        {onShare ? (
          <Pressable style={styles.shareBtn} onPress={onShare} disabled={sharing} accessibilityRole="button">
            <Text style={styles.shareText}>{sharing ? 'Preparing…' : 'Share to your story'}</Text>
          </Pressable>
        ) : null}
      </View>
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

/** "🥇 1st · You beat Dee · Most lock-in time · Semester" */
function subline(r: ChallengeRewardResult): string {
  return [TIER_MEDAL[r.tier], r.opponentName ? `You beat ${r.opponentName}` : null, r.metricLabel, r.durationLabel]
    .filter(Boolean)
    .join(' · ');
}

function buildRows(r: ChallengeRewardResult, onOpenBox?: () => void): RewardRowSpec[] {
  const rows: RewardRowSpec[] = [];

  if (r.xp > 0) {
    rows.push({
      kind: 'xp',
      title: 'XP earned',
      detail: 'The bigger the goal, the bigger the pot',
      value: `+${r.xp.toLocaleString('en-US')}`,
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
  if (r.box) {
    rows.push({
      kind: 'box',
      title: r.box.name,
      detail: 'Cosmetic loot box',
      chip: { label: r.box.rarity.toUpperCase(), color: Colors.amber },
      onOpen: onOpenBox,
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
  close: {
    position: 'absolute',
    top: Spacing.two,
    right: Spacing.three,
    zIndex: 2,
  },
  scroll: {
    flexGrow: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.five,
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
