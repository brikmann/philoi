import { forwardRef } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Defs, RadialGradient, Rect, Stop } from 'react-native-svg';

import { FLAME_ASPECT_RATIO, FlameSvg } from '@/components/flame-icon';
import { HexagonBadge } from '@/components/hexagon-badge';
import { Colors, Fonts } from '@/constants/theme';
import { formatRankTier } from '@/lib/rank-tiers';
import type { RankTierName } from '@/types/database';

const CARD_WIDTH = 360;
const CARD_HEIGHT = 640;

type FireShareCardProps = {
  displayName: string;
  streakDays: number;
  tier: RankTierName;
  division: number;
};

// The pre-composed 9:16 "story" share image (design-mocks/28-story-share-ios.html,
// 29-story-share-android.html — same card art both platforms). Rendered off-screen (see
// lock-in/index.tsx) and captured via react-native-view-shot; never a literal screenshot of the
// app UI. The philoi.app footer is deliberate — it's the install ad, keep it.
export const FireShareCard = forwardRef<View, FireShareCardProps>(function FireShareCard(
  { displayName, streakDays, tier, division },
  ref
) {
  return (
    <View ref={ref} collapsable={false} style={styles.card}>
      <Svg width={CARD_WIDTH} height={CARD_HEIGHT} style={StyleSheet.absoluteFill}>
        <Defs>
          <RadialGradient id="cardBg" cx="50%" cy="30%" r="75%">
            <Stop offset="0%" stopColor="#3a1f2e" />
            <Stop offset="34%" stopColor="#241528" />
            <Stop offset="66%" stopColor={Colors.cream} />
          </RadialGradient>
        </Defs>
        <Rect x={0} y={0} width={CARD_WIDTH} height={CARD_HEIGHT} fill="url(#cardBg)" />
      </Svg>

      <View style={styles.brandtop}>
        <FlameSvg width={14 * FLAME_ASPECT_RATIO} height={14} />
        <Text style={styles.brandtopText}>PHILOI</Text>
      </View>

      <View style={styles.fire}>
        <FlameSvg width={118 * FLAME_ASPECT_RATIO} height={118} />
      </View>

      <Text style={styles.headline}>
        {displayName.toUpperCase()} IS{'\n'}ON FIRE 🔥
      </Text>
      <Text style={styles.sub}>Daily fire complete · {streakDays}-day streak</Text>

      <View style={styles.rankPill}>
        <HexagonBadge tier={tier} division={division} size={16} />
        <Text style={styles.rankPillText}>{formatRankTier(tier, division)}</Text>
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
    fontSize: 36,
    lineHeight: 39,
    textAlign: 'center',
    color: Colors.ember,
    marginTop: 22,
  },
  sub: {
    fontFamily: Fonts.body,
    fontSize: 14,
    color: '#e7c9b8',
    textAlign: 'center',
    marginTop: 14,
  },
  rankPill: {
    marginTop: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    backgroundColor: 'rgba(224,97,44,0.22)',
    borderWidth: 1,
    borderColor: Colors.coral,
    borderRadius: 999,
    paddingVertical: 6,
    paddingHorizontal: 16,
  },
  rankPillText: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 13,
    color: Colors.ember,
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
