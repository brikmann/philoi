import { forwardRef } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { PersonalFlame } from '@/components/personal-flame';
import { ShareCardFrame } from '@/components/share-card-frame';
import { Colors, Fonts } from '@/constants/theme';
import type { RankTierName } from '@/types/database';

// §E — the goal-streak story card (design-mocks/104), fired from mock 103's "Share to your story".
//
// The number IS the card. A streak's whole appeal is that it is a single legible integer that can
// only be earned one day at a time, so it gets the same treatment the lock-in card gives duration:
// enormous, with everything else demoted to a caption.
//
// PersonalFlame rather than the brand FlameSvg, unlike the challenge card next to it. A streak is
// personal — it is the user's own equipped flame that has been kept alight — whereas a challenge
// win is a competitive result and wears the brand mark. Same distinction PersonalFlame's own
// comment draws between "home is you" and the shared surfaces.

type Props = {
  streakDays: number;
  /** "10,000 steps" — the goal in its own words. */
  goalLabel: string;
  handle: string | null;
  tier?: RankTierName;
  division?: number;
};

export const GoalStreakShareCard = forwardRef<View, Props>(function GoalStreakShareCard(
  { streakDays, goalLabel, handle, tier, division },
  ref
) {
  return (
    <ShareCardFrame ref={ref} kick="GOAL STREAK" ground="season" handle={handle} tier={tier} division={division}>
      <View style={styles.flame}>
        <PersonalFlame size={104} />
      </View>
      <View style={styles.numberRow}>
        <Text style={styles.number}>{streakDays}</Text>
        <Text style={styles.unit}>{streakDays === 1 ? 'day' : 'days'}</Text>
      </View>
      <Text style={styles.goal} numberOfLines={2}>
        {goalLabel}
      </Text>
      <Text style={styles.caption}>every single day</Text>
    </ShareCardFrame>
  );
});

const styles = StyleSheet.create({
  flame: {
    alignItems: 'center',
  },
  numberRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'center',
    gap: 6,
  },
  number: {
    fontFamily: Fonts.bodyBold,
    fontSize: 76,
    color: Colors.ember,
    lineHeight: 82,
    fontVariant: ['tabular-nums'],
  },
  unit: {
    fontFamily: Fonts.bodyBold,
    fontSize: 22,
    color: Colors.amber,
    marginBottom: 14,
  },
  goal: {
    fontFamily: Fonts.bodyBold,
    fontSize: 18,
    color: Colors.ink,
    textAlign: 'center',
    marginTop: 4,
  },
  caption: {
    fontFamily: Fonts.body,
    fontSize: 13,
    color: Colors.muted,
    textAlign: 'center',
    marginTop: 4,
  },
});
