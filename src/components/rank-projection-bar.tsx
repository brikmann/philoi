import { useEffect, useState } from 'react';
import { StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withRepeat, withSequence, withTiming } from 'react-native-reanimated';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';

import { Colors, Fonts, Radius } from '@/constants/theme';
import { formatProjection } from '@/lib/api/xp-rate';
import { formatRankTier, xpProgressRatio } from '@/lib/rank-tiers';
import type { RankTierName } from '@/types/database';

// "75% to Gold III" with a pulsing ghost showing the gap and roughly how long it'll take (#87,
// mock 91). This replaces the raw "1,480 / 2,000 XP" on the lock-in screen: mid-session, a pair of
// numerals is arithmetic homework, and a time is an answer.
//
// Three layers, back to front:
//   1. track  — the empty division
//   2. ghost  — darker gold, PULSING, spanning what's left to the next division
//   3. fill   — the gold gradient, what you've actually earned
//
// The pulse is in-app ONLY. On a Live Activity the same numbers render and update on ActivityKit
// refreshes but do not animate — the OS doesn't allow a free-running loop there, which is why
// `animated` is a prop rather than always-on.

/** Bar fill ramp, per the #87 tokens. */
const GOLD_FROM = '#C9922A';
const GOLD_TO = '#F5D06A';
/** The projection ghost — dark enough to read as "not yours yet" beside the solid fill. */
const GHOST = '#7A5A18';
/** The "~2h" caption. The ghost colour itself is too dark to read as text on the dark theme. */
const GHOST_LABEL = '#C9922A';

const BAR_H = 7;

type Props = {
  tier: RankTierName;
  division: number;
  xpIntoTier: number;
  /** The division's FULL WIDTH (get_my_ranks), not the remainder. 0 at Primordial. */
  xpForNextTier: number;
  /** Hours of locked-in time to the next division, or null to hide the projection entirely. */
  hoursToNext: number | null;
  /** In-app surfaces pulse; Live Activity mirrors pass false. */
  animated?: boolean;
  /** Show the "75% to Gold III" caption above the bar. */
  showLabel?: boolean;
};

export function RankProjectionBar({
  tier,
  division,
  xpIntoTier,
  xpForNextTier,
  hoursToNext,
  animated = true,
  showLabel = true,
}: Props) {
  const pulse = useSharedValue(0.35);
  // The gradient needs real pixels — SVG can't take a percentage width the way a View can.
  const [trackW, setTrackW] = useState(0);

  // Primordial is the apex and has no next division — xpForNextTier comes back 0 there. A bar with
  // nothing to fill toward would render as permanently empty, which reads as a bug rather than as
  // "you've finished the ladder".
  const atMax = xpForNextTier <= 0;
  const ratio = atMax ? 1 : xpProgressRatio(xpIntoTier, xpForNextTier);
  const pct = Math.round(ratio * 100);
  const projection = atMax || hoursToNext === null ? null : formatProjection(hoursToNext);
  const showGhost = !atMax && projection !== null;

  useEffect(() => {
    if (!animated || !showGhost) return;
    pulse.value = withRepeat(
      withSequence(withTiming(0.75, { duration: 1100 }), withTiming(0.3, { duration: 1100 })),
      -1,
      true
    );
  }, [animated, showGhost, pulse]);

  const ghostStyle = useAnimatedStyle(() => ({ opacity: animated ? pulse.value : 0.5 }));

  const onTrackLayout = (e: LayoutChangeEvent) => setTrackW(e.nativeEvent.layout.width);

  // `formatRankTier` already returns "Primordial" with no numeral for the apex and "Gold III" for
  // everything else, so the label needs no special-casing of its own.
  const nextLabel = atMax ? 'Primordial' : formatRankTier(tier, division);
  // Keep a sliver visible at 0% so the bar never looks broken on a fresh division.
  const fillW = Math.max(trackW * ratio, ratio > 0 ? 3 : 0);

  return (
    <View style={styles.wrap}>
      {showLabel ? (
        <View style={styles.captionRow}>
          <Text style={styles.caption}>{atMax ? 'Max rank' : `${pct}% to ${nextLabel}`}</Text>
          {/* Small on purpose (mock 91): the eye should land on the pulse and read "close",
              with the number available if you look for it. */}
          {projection ? <Text style={styles.projection}>{projection}</Text> : null}
        </View>
      ) : null}

      <View style={styles.track} onLayout={onTrackLayout}>
        {showGhost ? (
          <Animated.View style={[styles.ghost, { left: `${pct}%` }, ghostStyle]} />
        ) : null}
        {trackW > 0 && fillW > 0 ? (
          <Svg width={fillW} height={BAR_H} style={styles.fill}>
            <Defs>
              <LinearGradient id="rankFill" x1="0" y1="0" x2="1" y2="0">
                <Stop offset="0" stopColor={GOLD_FROM} />
                <Stop offset="1" stopColor={GOLD_TO} />
              </LinearGradient>
            </Defs>
            <Rect x="0" y="0" width={fillW} height={BAR_H} rx={BAR_H / 2} fill="url(#rankFill)" />
          </Svg>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    width: '100%',
    gap: 6,
  },
  captionRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
  },
  caption: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 11.5,
    color: Colors.ink,
    letterSpacing: 0.2,
  },
  projection: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 10,
    color: GHOST_LABEL,
    fontVariant: ['tabular-nums'],
  },
  track: {
    height: BAR_H,
    borderRadius: Radius.pill,
    backgroundColor: 'rgba(255,255,255,0.08)',
    overflow: 'hidden',
    justifyContent: 'center',
  },
  ghost: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    right: 0,
    backgroundColor: GHOST,
  },
  fill: {
    position: 'absolute',
    left: 0,
    top: 0,
  },
});
