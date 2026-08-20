import { forwardRef } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { HeatFlame } from '@/components/heat-flame';
import { ShareCardFrame } from '@/components/share-card-frame';
import { Colors, Fonts } from '@/constants/theme';
import type { RankTierName } from '@/types/database';

type FireShareCardProps = {
  streakDays: number;
  handle: string | null;
  tier?: RankTierName;
  division?: number;
};

// B1 — the streak flex (design-mocks/96, card 1). Fires from the share icon next to the streak on
// Home, and from the daily-fire completion.
//
// The hero is the COAL-BED FIRE, not the brand flame: this card is about a fire that has been kept
// burning, and the gauge (mock 93) is the thing that draws a real fire with a bed under it. Pinned
// at full heat — you don't share a streak card on a day you let it go cold.
export const FireShareCard = forwardRef<View, FireShareCardProps>(function FireShareCard(
  { streakDays, handle, tier, division },
  ref
) {
  return (
    <ShareCardFrame ref={ref} kick="STILL ON FIRE" handle={handle} tier={tier} division={division}>
      <HeatFlame heat={1} size={150} />
      <Text style={styles.stat}>{streakDays}</Text>
      <Text style={styles.label}>DAY STREAK</Text>
      <Text style={styles.sub}>kept the fire alive</Text>
    </ShareCardFrame>
  );
});

const styles = StyleSheet.create({
  stat: {
    fontFamily: Fonts.bodyBold,
    fontSize: 88,
    lineHeight: 92,
    letterSpacing: -2.5,
    color: Colors.ember,
    marginTop: 14,
  },
  label: {
    fontFamily: Fonts.bodyBold,
    fontSize: 18,
    letterSpacing: 1,
    color: '#C8BCDD',
    marginTop: 6,
  },
  sub: {
    fontFamily: Fonts.body,
    fontSize: 14,
    color: Colors.textTertiary,
    marginTop: 5,
  },
});
