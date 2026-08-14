import { forwardRef } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Defs, RadialGradient, Rect, Stop } from 'react-native-svg';

import { FLAME_ASPECT_RATIO, FlameSvg } from '@/components/flame-icon';
import { HexagonBadge } from '@/components/hexagon-badge';
import { Colors, Fonts, Radius } from '@/constants/theme';
import { divisionUpCopy, RANK_UP_COPY, rankUpCardTag } from '@/lib/rank-up-copy';
import { formatRankTier, RANK_TIER_METAL } from '@/lib/rank-tiers';
import type { RankTierName } from '@/types/database';

// 9:16 for stories (design-mocks/84 draws it at 270×480; same ratio, captured at 2× the size).
const CARD_WIDTH = 360;
const CARD_HEIGHT = 640;
const BADGE_SIZE = 150;

type RankUpShareCardProps = {
  handle: string | null;
  tier: RankTierName;
  division: number;
  streakDays: number;
  /** Whether this was a within-tier bump — swaps the tag to DIVISION UP and the copy to the light
   * two-liner, matching what the celebration settled into on screen. */
  isDivisionBump?: boolean;
  /** The campfire this rank-up's most recent lock-in was scoped to, if any — omitted for a solo
   * session. Rendered on the streak line under the handle pill. */
  circleName?: string | null;
};

// The rank-up story card (design-mocks/84) — the shareable output the on-screen moment settles
// into, so what lands in someone's story is the same frame they just watched compose, not a
// separate design. Rendered off-screen and captured via react-native-view-shot, same technique
// as fire-share-card.tsx's daily-fire card.
export const RankUpShareCard = forwardRef<View, RankUpShareCardProps>(function RankUpShareCard(
  { handle, tier, division, streakDays, isDivisionBump = false, circleName },
  ref
) {
  const metal = RANK_TIER_METAL[tier];
  const copy = isDivisionBump ? divisionUpCopy(tier) : RANK_UP_COPY[tier];
  const rank = formatRankTier(tier, division);

  return (
    <View ref={ref} collapsable={false} style={styles.card}>
      <Svg width={CARD_WIDTH} height={CARD_HEIGHT} style={StyleSheet.absoluteFill}>
        <Defs>
          {/* The celebration's own stage gradient, so the capture reads as a still of the moment. */}
          <RadialGradient id="rankCardBg" cx="50%" cy="26%" rx="130%" ry="60%">
            <Stop offset="0" stopColor="#2a1f3a" />
            <Stop offset="0.58" stopColor="#1a1326" />
            <Stop offset="1" stopColor="#120d1a" />
          </RadialGradient>
        </Defs>
        <Rect x={0} y={0} width={CARD_WIDTH} height={CARD_HEIGHT} fill="url(#rankCardBg)" />
      </Svg>

      <View style={styles.brand}>
        <FlameSvg width={18 * FLAME_ASPECT_RATIO} height={18} />
        <Text style={styles.brandLabel}>Philoi</Text>
      </View>

      <Text style={[styles.tag, { color: metal.inner }]}>{rankUpCardTag(tier, isDivisionBump)}</Text>

      <View style={styles.hexZone}>
        {/* The tier aura the badge sits in — the still version of the glow the moment settles on. */}
        <View pointerEvents="none" style={styles.aura}>
          <Svg width="100%" height="100%" viewBox="0 0 100 100">
            <Defs>
              <RadialGradient id="rankCardAura" cx="50%" cy="50%" r="50%">
                <Stop offset="0" stopColor={metal.inner} stopOpacity={0.5} />
                <Stop offset="0.55" stopColor={metal.inner} stopOpacity={0.2} />
                <Stop offset="1" stopColor={metal.inner} stopOpacity={0} />
              </RadialGradient>
            </Defs>
            <Circle cx="50" cy="50" r="50" fill="url(#rankCardAura)" />
          </Svg>
        </View>
        <HexagonBadge tier={tier} division={division} size={BADGE_SIZE} />
      </View>

      <Text style={[styles.tierName, { color: metal.inner }]}>{rank}</Text>
      <Text style={[styles.head, { color: metal.inner }, isDivisionBump && styles.headBump]}>{copy.head}</Text>
      <Text style={styles.sub}>{copy.sub}</Text>

      <View style={styles.footer}>
        <View style={styles.who}>
          <Text style={styles.whoHandle}>{handle ? `@${handle}` : 'philoi.app'}</Text>
          <Text style={styles.whoDot}>·</Text>
          <View style={[styles.whoHex, { backgroundColor: metal.inner }]} />
          <Text style={[styles.whoRank, { color: metal.inner }]}>{rank}</Text>
        </View>
        <Text style={styles.streakLine}>
          {streakDays}-day streak{circleName ? ` · ${circleName}` : ''}
        </Text>
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  card: {
    width: CARD_WIDTH,
    height: CARD_HEIGHT,
    alignItems: 'center',
    paddingTop: 24,
    paddingHorizontal: 26,
    paddingBottom: 26,
    overflow: 'hidden',
  },
  brand: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  brandLabel: {
    fontFamily: Fonts.displayHeavy,
    fontSize: 18,
    color: Colors.ink,
  },
  tag: {
    fontFamily: Fonts.bodyBold,
    fontSize: 12,
    letterSpacing: 5,
    marginTop: 18,
  },
  hexZone: {
    marginTop: 34,
    alignItems: 'center',
    justifyContent: 'center',
  },
  aura: {
    position: 'absolute',
    width: 270,
    height: 270,
  },
  tierName: {
    fontFamily: Fonts.displayHeavy,
    fontSize: 34,
    marginTop: 24,
  },
  head: {
    fontFamily: Fonts.displayHeavy,
    fontSize: 20,
    lineHeight: 24,
    letterSpacing: 0.4,
    textAlign: 'center',
    marginTop: 18,
  },
  headBump: {
    fontSize: 15,
    lineHeight: 19,
  },
  sub: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 12,
    lineHeight: 17,
    letterSpacing: 0.5,
    color: Colors.muted,
    textAlign: 'center',
    marginTop: 8,
  },
  footer: {
    marginTop: 'auto',
    alignItems: 'center',
    gap: 8,
  },
  who: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(0,0,0,0.3)',
    paddingVertical: 7,
    paddingHorizontal: 14,
    borderRadius: Radius.pill,
  },
  whoHandle: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 13,
    color: Colors.ink,
  },
  whoDot: {
    fontFamily: Fonts.body,
    fontSize: 13,
    color: Colors.textTertiary,
  },
  whoHex: {
    width: 13,
    height: 14,
    borderRadius: 2,
  },
  whoRank: {
    fontFamily: Fonts.bodyBold,
    fontSize: 13,
  },
  streakLine: {
    fontFamily: Fonts.body,
    fontSize: 12,
    color: Colors.textTertiary,
  },
});
