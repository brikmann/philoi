import { forwardRef } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { ShareCardFrame } from '@/components/share-card-frame';
import { FlameLogo } from '@/components/ui/flame-logo';
import { Colors, Fonts } from '@/constants/theme';
import { GOAL_TYPE_META } from '@/lib/goal-types';
import type { GoalType, RankTierName } from '@/types/database';

type LockInShareCardProps = {
  goalType: GoalType;
  goalDetail: string | null;
  durationSeconds: number;
  /** The campfire it was locked in with, or null for a solo session. */
  circleName?: string | null;
  /** When the session happened. Defaults to now — a card shared straight off the done screen. */
  at?: Date;
  handle: string | null;
  tier?: RankTierName;
  division?: number;
};

/** "2h 14m" — the mock's exact shape, with the units set smaller than the numbers. */
function splitDuration(seconds: number): { h: number; m: number } {
  const total = Math.max(0, Math.round(seconds / 60));
  return { h: Math.floor(total / 60), m: total % 60 };
}

// B2 — proof of work (design-mocks/96, card 2). Fires from Share on the done / daily-fire screen.
//
// Brand flame here, not the coal-bed gauge: a single session is a clean, finished thing, and the
// mock draws it with the logo silhouette. The card deliberately carries no XP/PR/streak stat row
// any more — one number, one line of context. The flex is the time.
export const LockInShareCard = forwardRef<View, LockInShareCardProps>(function LockInShareCard(
  { goalType, goalDetail, durationSeconds, circleName, at, handle, tier, division },
  ref
) {
  const { h, m } = splitDuration(durationSeconds);
  const title = goalDetail || GOAL_TYPE_META[goalType].label;
  const when = (at ?? new Date()).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

  return (
    <ShareCardFrame ref={ref} kick="LOCKED IN" handle={handle} tier={tier} division={division}>
      <View style={styles.flame}>
        <FlameLogo size={132} />
      </View>
      <Text style={styles.duration}>
        {h > 0 ? (
          <>
            {h}
            <Text style={styles.unit}>h </Text>
          </>
        ) : null}
        {m}
        <Text style={styles.unit}>m</Text>
      </Text>
      <Text style={styles.label}>LOCKED IN</Text>
      <Text style={styles.sub}>
        {title} · {circleName ?? 'solo'} · {when}
      </Text>
    </ShareCardFrame>
  );
});

const styles = StyleSheet.create({
  flame: {
    marginBottom: 22,
  },
  duration: {
    fontFamily: Fonts.bodyBold,
    fontSize: 46,
    lineHeight: 50,
    color: Colors.ink,
  },
  unit: {
    fontFamily: Fonts.bodyBold,
    fontSize: 28,
    color: Colors.ink,
  },
  label: {
    fontFamily: Fonts.bodyBold,
    fontSize: 16,
    letterSpacing: 1,
    color: '#C8BCDD',
    marginTop: 8,
  },
  sub: {
    fontFamily: Fonts.body,
    fontSize: 13,
    color: Colors.textTertiary,
    marginTop: 5,
    textAlign: 'center',
  },
});
