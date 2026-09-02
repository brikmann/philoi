import { StyleSheet, Text, View } from 'react-native';

import { EmberIcon } from '@/components/economy/ember-icon';
import { FlameSvg } from '@/components/flame-icon';
import { ProgressBar } from '@/components/ui/progress-bar';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';

// The reason people come back, finally on the screen that pays them.
//
// WHAT THIS REPLACES, and why it is not that. The reveal used to carry a small "1" in a bubble on
// the flame. It was removed in the strip because it said nothing — a bare number with no scale
// beside it is not a streak, it is a digit. But the streak IS why a daily goal is worth clearing
// twice, and a screen that celebrates the clearing while hiding the run is celebrating the smaller
// half.
//
// So: the count, the next bonus, and the distance between them. "3 to the +60 bonus" is the part
// that does the work — it turns "I did a thing" into "I am four days from something", which is the
// only sentence on this screen that points at tomorrow.
//
// 🔒 PRESENTATION ONLY. The thresholds mirror economy_config's goal_rewards.milestones so the bar
// promises what the server will actually pay (the same contract the old breakdown line carried).
// Nothing here grants; `streak` is the figure economy_award_goal_day already returned.

/** Mirrors economy_config's goal_rewards.milestones — days → bonus embers. */
export const DEFAULT_MILESTONES: Record<number, number> = { 3: 30, 7: 60, 14: 150, 30: 400 };

type Props = {
  /** The run this payout is part of, exactly as the server reported it. */
  streak: number;
  milestones?: Record<number, number>;
};

export function StreakMeter({ streak, milestones = DEFAULT_MILESTONES }: Props) {
  const rungs = Object.keys(milestones)
    .map(Number)
    .sort((a, b) => a - b);

  const next = rungs.find((d) => d > streak) ?? null;
  // The rung just cleared is where the bar starts, so the fill measures THIS leg rather than the
  // whole ladder — four days into a 7-day rung should read as most of the way there, not as 4/30.
  const floor = [...rungs].reverse().find((d) => d <= streak) ?? 0;
  const ratio = next ? (streak - floor) / (next - floor) : 1;
  const toGo = next ? next - streak : 0;

  return (
    <View style={styles.root}>
      <View style={styles.headRow}>
        <FlameSvg width={13} height={16} />
        <Text style={styles.count}>
          {streak}-day streak
        </Text>
        {next ? (
          <View style={styles.bonusPill}>
            <EmberIcon size={11} />
            <Text style={styles.bonusText}>+{milestones[next]}</Text>
          </View>
        ) : null}
      </View>

      <ProgressBar ratio={ratio} height={5} trackColor={Colors.trackAlt} fillColor={Colors.amber} />

      <Text style={styles.caption}>
        {next
          ? `${toGo} ${toGo === 1 ? 'day' : 'days'} to the ${next}-day bonus`
          : // Past the top rung there is no next number to chase, so the line stops promising one.
            'Every rung cleared — keep it burning.'}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    alignSelf: 'stretch',
    backgroundColor: Colors.scrim,
    borderRadius: Radius.card,
    paddingVertical: Spacing.twelve,
    paddingHorizontal: Spacing.three,
    gap: Spacing.two,
  },
  headRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  count: {
    flex: 1,
    fontFamily: Fonts.bodyBold,
    fontSize: 14.5,
    color: Colors.ink,
  },
  bonusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(255,210,122,0.12)',
    borderRadius: Radius.pill,
    paddingVertical: 3,
    paddingHorizontal: 8,
  },
  bonusText: {
    fontFamily: Fonts.bodyBold,
    fontSize: 12,
    color: Colors.ember,
    fontVariant: ['tabular-nums'],
  },
  caption: {
    fontFamily: Fonts.body,
    fontSize: 11.5,
    color: Colors.muted,
  },
});
