import { forwardRef } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Defs, RadialGradient, Rect, Stop } from 'react-native-svg';

import { HexagonBadge } from '@/components/hexagon-badge';
import { Colors, Fonts } from '@/constants/theme';
import { formatRankTier } from '@/lib/rank-tiers';
import type { RankTierName } from '@/types/database';

const CARD_WIDTH = 360;
const CARD_HEIGHT = 640;

type RankUpShareCardProps = {
  displayName: string;
  tier: RankTierName;
  division: number;
  streakDays: number;
  /** The campfire this rank-up's most recent lock-in was scoped to, if any (§11's share card
   * spec: "hexagon + tier, your streak, the campfire name") — omitted for a solo session. */
  circleName?: string | null;
};

// The rank-up "growth hook" share card (PHILOI_UI_SPEC.md §11 — "polished, pre-composed... not
// a raw screenshot: hexagon + tier, your streak, the campfire name, and the Philoi mark, sized
// for IG/story"). Rendered off-screen and captured via react-native-view-shot, same technique
// as fire-share-card.tsx's daily-fire card.
export const RankUpShareCard = forwardRef<View, RankUpShareCardProps>(function RankUpShareCard(
  { displayName, tier, division, streakDays, circleName },
  ref
) {
  return (
    <View ref={ref} collapsable={false} style={styles.card}>
      <Svg width={CARD_WIDTH} height={CARD_HEIGHT} style={StyleSheet.absoluteFill}>
        <Defs>
          <RadialGradient id="rankCardBg" cx="50%" cy="32%" r="75%">
            <Stop offset="0%" stopColor="#2d2740" />
            <Stop offset="40%" stopColor="#241528" />
            <Stop offset="70%" stopColor={Colors.cream} />
          </RadialGradient>
        </Defs>
        <Rect x={0} y={0} width={CARD_WIDTH} height={CARD_HEIGHT} fill="url(#rankCardBg)" />
      </Svg>

      <Text style={styles.brandtop}>PHILOI</Text>

      <View style={styles.hexZone}>
        <HexagonBadge tier={tier} division={division} size={140} />
      </View>

      <Text style={styles.headline}>
        {displayName.toUpperCase()}{'\n'}REACHED {formatRankTier(tier, division).toUpperCase()}
      </Text>
      <Text style={styles.sub}>
        {streakDays}-day streak{circleName ? ` · ${circleName}` : ''}
      </Text>

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
    paddingTop: 56,
    paddingHorizontal: 24,
    paddingBottom: 32,
    overflow: 'hidden',
  },
  brandtop: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 14,
    letterSpacing: 1.5,
    color: Colors.ember,
    opacity: 0.85,
  },
  hexZone: {
    marginTop: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headline: {
    fontFamily: Fonts.displayHeavy,
    fontSize: 30,
    lineHeight: 34,
    textAlign: 'center',
    color: Colors.ember,
    marginTop: 30,
  },
  sub: {
    fontFamily: Fonts.body,
    fontSize: 14,
    color: '#e7c9b8',
    textAlign: 'center',
    marginTop: 14,
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
