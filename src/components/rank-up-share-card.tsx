import { forwardRef } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Defs, RadialGradient, Stop } from 'react-native-svg';

import { HexagonBadge } from '@/components/hexagon-badge';
import { ShareCardFrame } from '@/components/share-card-frame';
import { Fonts } from '@/constants/theme';
import { formatRankTier, RANK_TIER_METAL } from '@/lib/rank-tiers';
import type { RankTierName } from '@/types/database';

const BADGE_SIZE = 150;

type RankUpShareCardProps = {
  handle: string | null;
  tier: RankTierName;
  division: number;
  /** Whether this was a within-tier bump — swaps the kicker and the line under the tier name. */
  isDivisionBump?: boolean;
};

// B3 — the tier climb (design-mocks/96, card 3). Fires from the rank-up celebration, so what lands
// in someone's story is the same frame they just watched compose.
//
// Stripped back from the earlier version: no tier-path line, no streak line, no rank-up prose. The
// badge, the tier name, and three words. The metal carries the rest.
export const RankUpShareCard = forwardRef<View, RankUpShareCardProps>(function RankUpShareCard(
  { handle, tier, division, isDivisionBump = false },
  ref
) {
  const metal = RANK_TIER_METAL[tier];

  return (
    <ShareCardFrame
      ref={ref}
      kick={isDivisionBump ? 'DIVISION UP' : 'RANKED UP'}
      kickColor={metal.inner}
      handle={handle}
      tier={tier}
      division={division}>
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

      <Text style={[styles.tierName, { color: metal.inner }]}>{formatRankTier(tier, division).toUpperCase()}</Text>
      <Text style={styles.label}>{isDivisionBump ? 'moved up a division' : 'climbed a tier'}</Text>
    </ShareCardFrame>
  );
});

const styles = StyleSheet.create({
  hexZone: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  aura: {
    position: 'absolute',
    width: 270,
    height: 270,
  },
  tierName: {
    fontFamily: Fonts.bodyBold,
    fontSize: 40,
    letterSpacing: -0.5,
    marginTop: 26,
  },
  label: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 15,
    color: '#C8BCDD',
    marginTop: 8,
  },
});
