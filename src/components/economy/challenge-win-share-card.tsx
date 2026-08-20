import { forwardRef } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { FlameSvg } from '@/components/flame-icon';
import { ShareCardFrame } from '@/components/share-card-frame';
import { Colors, Fonts } from '@/constants/theme';
import { TIER_INTENSITY, TIER_MEDAL, type PlacementTier } from '@/lib/challenge-reward-copy';
import type { RankTierName } from '@/types/database';

// §E — the challenge/placement story card (design-mocks/104), fired from mock 47's
// "Share to your story".
//
// Same mock-96 frame as every other card (rank-in-hex, philoi.app footer) so the share set reads
// as one family. What's specific here is the PLACEMENT: the medal and the tier label come from the
// same TIER_INTENSITY/TIER_MEDAL tables the reward screen uses, so the card and the screen it was
// shared from can never disagree about how big the win was.
//
// Deliberately does NOT show the ember payout. A share card is a flex, and "I won 50 embers" is a
// worse flex than "I beat Dee" — it also advertises a currency number that means nothing to
// someone who doesn't play, which is exactly who these are aimed at.

type Props = {
  tier: PlacementTier;
  /** "You beat Dee" / "Emberfall · 214 in the campfire". */
  contextLine: string;
  metricLabel: string;
  handle: string | null;
  rankTier?: RankTierName;
  division?: number;
};

export const ChallengeWinShareCard = forwardRef<View, Props>(function ChallengeWinShareCard(
  { tier, contextLine, metricLabel, handle, rankTier, division },
  ref
) {
  const intensity = TIER_INTENSITY[tier];

  return (
    <ShareCardFrame
      ref={ref}
      kick={intensity.label}
      kickColor={intensity.accent}
      ground="season"
      handle={handle}
      tier={rankTier}
      division={division}>
      <View style={styles.flame}>
        <FlameSvg width={112} height={112} />
      </View>
      <Text style={[styles.placement, { color: intensity.accent }]}>{TIER_MEDAL[tier]}</Text>
      <Text style={styles.context} numberOfLines={2}>
        {contextLine}
      </Text>
      <Text style={styles.metric} numberOfLines={1}>
        {metricLabel}
      </Text>
    </ShareCardFrame>
  );
});

const styles = StyleSheet.create({
  flame: {
    alignItems: 'center',
    marginBottom: 6,
  },
  placement: {
    fontFamily: Fonts.bodyBold,
    fontSize: 40,
    textAlign: 'center',
    letterSpacing: -0.5,
  },
  context: {
    fontFamily: Fonts.bodyBold,
    fontSize: 19,
    color: Colors.ink,
    textAlign: 'center',
    marginTop: 8,
  },
  metric: {
    fontFamily: Fonts.body,
    fontSize: 13,
    color: Colors.muted,
    textAlign: 'center',
    marginTop: 4,
  },
});
