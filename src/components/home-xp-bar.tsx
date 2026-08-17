import { useEffect, useId, useState } from 'react';
import { StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withRepeat, withSequence, withTiming } from 'react-native-reanimated';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';

import { Colors, EMBER_GRADIENT, Fonts, Radius } from '@/constants/theme';
import { useReduceMotion } from '@/hooks/use-reduce-motion';
import { RANK_TIER_METAL, formatRankTier, xpProgressRatio } from '@/lib/rank-tiers';
import type { RankTierName } from '@/types/database';

// The home rank row's XP bar (DESIGN_LANGUAGE_EMBER §5/§7, mock 92).
//
// ONE bar answering two questions that used to need two widgets:
//   • where you are on the ladder  → the fill, in the CURRENT TIER's metal
//   • what you owe today           → the daily-fire zone, ENCASED in the same bar, ember orange
//
// The fire zone is what makes this worth building. Drawn on the SAME scale as the division — it
// starts exactly where the fill stops and spans the XP still needed for today's fire — so "how much
// more today" is legible as a distance rather than as a second number to hold in your head. It
// pulses, because it is the one thing on the screen you can still act on.
//
// The §7 rule in one place: tier colour = where you are, orange = what you're chasing. Same
// principle as the `~time` projection on the lock-in rank bar.

const BAR_H = 10;

type Props = {
  tier: RankTierName;
  division: number;
  xpIntoTier: number;
  /** The division's FULL WIDTH (get_my_ranks), not the remainder. 0 at Primordial. */
  xpForNextTier: number;
  /** XP still needed for today's fire; 0/undefined once it's done (the zone disappears). */
  fireRemainingXp?: number;
};

export function HomeXpBar({ tier, division, xpIntoTier, xpForNextTier, fireRemainingXp = 0 }: Props) {
  const uid = useId();
  const fillId = `homeXp-${uid}`;
  const fireId = `homeFire-${uid}`;
  const reduceMotion = useReduceMotion();
  const [trackW, setTrackW] = useState(0);
  const pulse = useSharedValue(0.72);

  const metal = RANK_TIER_METAL[tier];
  const atMax = xpForNextTier <= 0;
  const ratio = atMax ? 1 : xpProgressRatio(xpIntoTier, xpForNextTier);
  const pct = Math.round(ratio * 100);

  // The fire zone measured in DIVISION widths, so it shares the bar's scale. Clamped to whatever
  // room is left: a fire needing more XP than the division has would otherwise draw past the end of
  // its own track. At max rank there is no scale to draw on, so the zone is dropped.
  const fireRatio =
    atMax || fireRemainingXp <= 0 ? 0 : Math.min(fireRemainingXp / xpForNextTier, Math.max(0, 1 - ratio));
  const showFire = fireRatio > 0.001;

  useEffect(() => {
    if (!showFire || reduceMotion) {
      pulse.value = 1;
      return;
    }
    pulse.value = withRepeat(
      withSequence(withTiming(1, { duration: 800 }), withTiming(0.72, { duration: 800 })),
      -1,
      true
    );
  }, [showFire, reduceMotion, pulse]);

  const fireStyle = useAnimatedStyle(() => ({ opacity: pulse.value }));

  const onLayout = (e: LayoutChangeEvent) => setTrackW(e.nativeEvent.layout.width);
  const fillW = Math.max(trackW * ratio, ratio > 0 ? 3 : 0);
  const fireW = trackW * fireRatio;

  return (
    <View style={styles.wrap}>
      <View style={styles.top}>
        <Text style={styles.topLabel}>{atMax ? 'Max rank' : `${pct}% to ${formatRankTier(tier, division)}`}</Text>
        <Text style={styles.topXp}>
          {atMax
            ? `${Math.round(xpIntoTier).toLocaleString('en-US')} XP`
            : `${Math.round(xpIntoTier).toLocaleString('en-US')} / ${Math.round(xpForNextTier).toLocaleString('en-US')} XP`}
        </Text>
      </View>

      <View style={styles.track} onLayout={onLayout}>
        {trackW > 0 && fillW > 0 ? (
          <Svg width={fillW} height={BAR_H} style={styles.layer}>
            <Defs>
              {/* The tier's own metal, outer→inner. Gradient ids are global in react-native-svg,
                  hence the per-mount uid. */}
              <LinearGradient id={fillId} x1="0" y1="0" x2="1" y2="0">
                <Stop offset="0" stopColor={metal.outer} />
                <Stop offset="1" stopColor={metal.inner} />
              </LinearGradient>
            </Defs>
            <Rect x="0" y="0" width={fillW} height={BAR_H} rx={BAR_H / 2} fill={`url(#${fillId})`} />
          </Svg>
        ) : null}

        {trackW > 0 && showFire ? (
          <Animated.View style={[styles.layer, { left: fillW, width: fireW }, fireStyle]}>
            <Svg width={fireW} height={BAR_H}>
              <Defs>
                <LinearGradient id={fireId} x1="0" y1="0" x2="1" y2="0">
                  <Stop offset="0" stopColor={EMBER_GRADIENT[1]} />
                  <Stop offset="1" stopColor={EMBER_GRADIENT[0]} />
                </LinearGradient>
              </Defs>
              <Rect x="0" y="0" width={fireW} height={BAR_H} fill={`url(#${fireId})`} />
            </Svg>
          </Animated.View>
        ) : null}
      </View>

      {showFire ? (
        <Text style={styles.fireLabel}>
          {Math.round(fireRemainingXp).toLocaleString('en-US')} XP to today&apos;s fire
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
  },
  top: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 5,
  },
  topLabel: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 9.5,
    color: Colors.muted,
  },
  topXp: {
    fontFamily: Fonts.body,
    fontSize: 9.5,
    color: Colors.muted,
    fontVariant: ['tabular-nums'],
  },
  track: {
    height: BAR_H,
    borderRadius: Radius.pill,
    backgroundColor: Colors.disabled,
    overflow: 'hidden',
  },
  layer: {
    position: 'absolute',
    left: 0,
    top: 0,
    height: BAR_H,
  },
  fireLabel: {
    fontFamily: Fonts.bodyBold,
    fontSize: 9.5,
    color: Colors.amber,
    marginTop: 6,
  },
});
