import { forwardRef } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Defs, RadialGradient, Rect, Stop } from 'react-native-svg';

import { FLAME_ASPECT_RATIO, FlameSvg } from '@/components/flame-icon';
import { Colors, Fonts } from '@/constants/theme';
import { formatDurationClock } from '@/lib/format';
import { GOAL_TYPE_META } from '@/lib/goal-types';
import type { GoalType } from '@/types/database';

const CARD_WIDTH = 360;
const CARD_HEIGHT = 640;

type LockInShareCardProps = {
  displayName: string;
  goalType: GoalType;
  goalDetail: string | null;
  durationSeconds: number;
  xpEarned: number;
  prCount: number;
  streakDays: number;
};

// The per-lock-in share card (design-mocks/54b) — same pre-composed "story" language as
// fire-share-card.tsx/rank-up-share-card.tsx (radial twilight bg, flame mark, philoi.app
// footer), but for a single lock-in's own stats rather than a daily-fire or rank-up moment.
// Rendered off-screen and captured via react-native-view-shot (lib/share-card.ts).
export const LockInShareCard = forwardRef<View, LockInShareCardProps>(function LockInShareCard(
  { displayName, goalType, goalDetail, durationSeconds, xpEarned, prCount, streakDays },
  ref
) {
  const title = goalDetail || GOAL_TYPE_META[goalType].label;
  return (
    <View ref={ref} collapsable={false} style={styles.card}>
      <Svg width={CARD_WIDTH} height={CARD_HEIGHT} style={StyleSheet.absoluteFill}>
        <Defs>
          <RadialGradient id="lockInCardBg" cx="50%" cy="30%" r="75%">
            <Stop offset="0%" stopColor="#3a1f2e" />
            <Stop offset="34%" stopColor="#241528" />
            <Stop offset="66%" stopColor={Colors.cream} />
          </RadialGradient>
        </Defs>
        <Rect x={0} y={0} width={CARD_WIDTH} height={CARD_HEIGHT} fill="url(#lockInCardBg)" />
      </Svg>

      <View style={styles.brandtop}>
        <FlameSvg width={14 * FLAME_ASPECT_RATIO} height={14} />
        <Text style={styles.brandtopText}>PHILOI</Text>
      </View>

      <View style={styles.fire}>
        <FlameSvg width={100 * FLAME_ASPECT_RATIO} height={100} />
      </View>

      <Text style={styles.headline}>
        {title} · {formatDurationClock(durationSeconds)}
      </Text>
      <Text style={styles.sub}>{displayName} locked in</Text>

      <View style={styles.statRow}>
        <View style={styles.stat}>
          <Text style={styles.statValue}>+{xpEarned}</Text>
          <Text style={styles.statLabel}>XP</Text>
        </View>
        <View style={styles.stat}>
          <Text style={styles.statValue}>{prCount}</Text>
          <Text style={styles.statLabel}>PRs</Text>
        </View>
        <View style={styles.stat}>
          <Text style={styles.statValue}>🔥{streakDays}</Text>
          <Text style={styles.statLabel}>STREAK</Text>
        </View>
      </View>

      <View style={styles.footer}>
        <Text style={styles.wordmark}>philoi</Text>
        <Text style={styles.url}>philoi.app</Text>
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  card: {
    width: CARD_WIDTH,
    height: CARD_HEIGHT,
    alignItems: 'center',
    paddingTop: 64,
    paddingHorizontal: 24,
    paddingBottom: 32,
    overflow: 'hidden',
  },
  brandtop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  brandtopText: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 14,
    letterSpacing: 1.5,
    color: Colors.ember,
    opacity: 0.85,
  },
  fire: {
    marginTop: 30,
  },
  headline: {
    fontFamily: Fonts.displayHeavy,
    fontSize: 26,
    lineHeight: 30,
    textAlign: 'center',
    color: Colors.ember,
    marginTop: 22,
  },
  sub: {
    fontFamily: Fonts.body,
    fontSize: 14,
    color: '#e7c9b8',
    textAlign: 'center',
    marginTop: 8,
  },
  statRow: {
    flexDirection: 'row',
    gap: 28,
    marginTop: 28,
  },
  stat: {
    alignItems: 'center',
  },
  statValue: {
    fontFamily: Fonts.displayHeavy,
    fontSize: 22,
    color: Colors.ink,
  },
  statLabel: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 9,
    letterSpacing: 0.8,
    color: Colors.textTertiary,
    marginTop: 2,
  },
  footer: {
    marginTop: 'auto',
    alignItems: 'center',
    gap: 3,
    opacity: 0.9,
  },
  wordmark: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 17,
    letterSpacing: 0.5,
    color: Colors.ink,
  },
  url: {
    fontFamily: Fonts.body,
    fontSize: 11.5,
    color: Colors.textTertiary,
  },
});
