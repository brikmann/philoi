import { forwardRef } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Defs, RadialGradient, Stop } from 'react-native-svg';

import { HexagonBadge } from '@/components/hexagon-badge';
import { ShareCardStamp, boxStamp } from '@/components/economy/share-card-stamp';
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
  /**
   * The box the rank-up granted (0121), for the "what you won" stamp — never an ember count.
   *
   * Optional because the celebration reads its reward through get_my_last_rank_up_reward (0142),
   * which can fail or come back empty on an older client; a card with no stamp is correct then,
   * rather than one asserting a prize it could not confirm.
   */
  boxKey?: string | null;
  /**
   * A cosmetic title this rank unlocked — mock 171 card 4's `Unlocked "Golden"` row.
   *
   * ⚠️ NOTHING FEEDS THIS YET, and that is deliberate rather than unfinished. `rank_up_rewards`
   * (0121) has exactly two payout columns, embers and box_key — there is no title column, and
   * get_my_last_rank_up_reward returns none. Wiring the row to a hardcoded name would make the card
   * claim a reward the ledger never granted, which is the one thing every reward surface in this
   * app is written not to do. The prop is here so that the day a title reward exists server-side,
   * the card needs one argument rather than a redesign.
   */
  titleName?: string | null;
};

// B3 — the tier climb (design-mocks/96, card 3). Fires from the rank-up celebration, so what lands
// in someone's story is the same frame they just watched compose.
//
// Stripped back from the earlier version: no tier-path line, no streak line, no rank-up prose. The
// badge, the tier name, and three words. The metal carries the rest.
export const RankUpShareCard = forwardRef<View, RankUpShareCardProps>(function RankUpShareCard(
  { handle, tier, division, isDivisionBump = false, boxKey, titleName },
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

      {/* THE REWARD ROW (mock 171 card 4). A rank-up pays embers and a box; the box is the half
          worth naming on a card, because an object has a name a non-player understands and a
          balance does not. Title first when one exists — a permanent honour outranks loot. */}
      {titleName ? (
        <ShareCardStamp label={`Unlocked “${titleName}”`} color={metal.inner} />
      ) : (
        boxStamp(boxKey)
      )}
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
