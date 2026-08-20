import { Ionicons } from '@expo/vector-icons';
import { forwardRef } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { ShareCardFrame } from '@/components/share-card-frame';
import { Colors, Fonts } from '@/constants/theme';
import { GOAL_TYPE_ICON, GOAL_TYPE_META } from '@/lib/goal-types';
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
  /** Stat-row values (§9). Each pill is omitted when its value is missing, so a caller that does
   * not have a number shows fewer pills rather than a zero. */
  streakDays?: number;
  xpEarned?: number;
  /** Gym only — see showsPRs. */
  prCount?: number;
};

/** "2h 14m" — the mock's exact shape, with the units set smaller than the numbers. */
function splitDuration(seconds: number): { h: number; m: number } {
  const total = Math.max(0, Math.round(seconds / 60));
  return { h: Math.floor(total / 60), m: total % 60 };
}

// B2 — proof of work (design-mocks/96 card 2, refreshed by mock 107 Frame 3). Fires from Share on
// the done / daily-fire screen.
//
// The hero is the SESSION TYPE’s vector, not the brand flame: every share card in the set already
// carries the flame in its footer, so spending the largest element on it again said nothing about
// which session this was. The stat row likewise came back — this file used to say it carried none
// because "the flex is the time", and mock 107 reverses that: a duration alone does not say
// whether the session was any good.
export const LockInShareCard = forwardRef<View, LockInShareCardProps>(function LockInShareCard(
  { goalType, goalDetail, durationSeconds, circleName, at, handle, tier, division, streakDays, xpEarned, prCount },
  ref
) {
  const { h, m } = splitDuration(durationSeconds);
  const title = goalDetail || GOAL_TYPE_META[goalType].label;
  const when = (at ?? new Date()).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

  // PRs belong to lifting and nowhere else (§9). Gated on the TYPE first and the count second, so
  // a study session can never render "0 PRs" — the mock calls that out explicitly as the bug. A
  // gym session with no PR that day also stays silent rather than announcing a zero.
  const showsPRs = goalType === 'gym' && (prCount ?? 0) > 0;

  return (
    <ShareCardFrame ref={ref} kick="LOCKED IN" handle={handle} tier={tier} division={division}>
      {/* The session TYPE's own vector, not the brand flame and not an emoji (§9). Same
          GOAL_TYPE_ICON set the lock-in list rows use, so the card and the row a person taps to
          reach it show the same glyph. */}
      <View style={styles.typeTile}>
        <Ionicons name={GOAL_TYPE_ICON[goalType]} size={34} color={Colors.amber} />
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
      <Text style={styles.label}>{title}</Text>
      <Text style={styles.sub}>
        {circleName ?? 'solo'} · {when}
      </Text>

      {/* The stat row, per session type. This is a deliberate REVERSAL of the earlier "one number,
          one line of context — the flex is the time" decision: mock 107 Frame 3 restores it,
          because a duration alone says nothing about whether the session was any good. Each pill
          is omitted when its value is missing, so a caller that does not have a number simply
          shows fewer pills rather than a zero. */}
      <View style={styles.pills}>
        {streakDays != null && streakDays > 0 ? (
          <Pill text={`🔥 ${streakDays}-day streak`} />
        ) : null}
        {showsPRs ? <Pill text={`${prCount} PR${prCount === 1 ? '' : 's'}`} /> : null}
        {xpEarned != null && xpEarned > 0 ? <Pill text={`+${xpEarned} XP`} /> : null}
      </View>
    </ShareCardFrame>
  );
});

function Pill({ text }: { text: string }) {
  return (
    <View style={styles.pill}>
      <Text style={styles.pillText}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  typeTile: {
    width: 60,
    height: 60,
    borderRadius: 16,
    backgroundColor: '#1C1430',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.07)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
  },
  pills: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 6,
    marginTop: 14,
  },
  pill: {
    backgroundColor: '#241A2E',
    borderWidth: 1,
    borderColor: 'rgba(242,163,60,0.35)',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  pillText: {
    fontFamily: Fonts.bodyBold,
    fontSize: 9.5,
    color: Colors.ember,
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
