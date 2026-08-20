import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import { Card } from '@/components/ui/card';
import { TextInput } from '@/components/ui/text-input';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { logChallengeProgress, type GoalDayAward } from '@/lib/api/challenges';
import { CHALLENGE_TYPE_ICON } from '@/lib/goal-types';
import { getErrorMessage } from '@/lib/errors';
import { AUTO_SOURCE_NAME, getRealFitnessSourceForChallengeType, sourceNeedsConnection } from '@/lib/fitness-sync';
import type { Challenge, ChallengeType } from '@/types/database';

// Quick-add amounts only. The ICON moved to CHALLENGE_TYPE_ICON in lib/goal-types — these were
// emoji, which draw differently on every OS and font version and cannot take the row's tint (§A3).
const TYPE_QUICK_ADDS: Record<ChallengeType, number[]> = {
  steps: [1000, 2500, 5000],
  run_distance: [1, 5, 10],
  ride_distance: [5, 10, 20],
  gym_visits: [1],
  study_hours: [1, 2],
  custom: [1],
  workout_minutes: [15, 30, 60],
  strain: [1, 2],
  sleep_hours: [1],
};

function challengeTitle(challenge: Challenge): string {
  if (challenge.label) return challenge.label;
  switch (challenge.type) {
    case 'steps':
      return `${challenge.target.toLocaleString()} steps`;
    case 'gym_visits':
      return `${challenge.target}× gym`;
    case 'study_hours':
      return `${challenge.target}h study`;
    case 'run_distance':
      return `${challenge.target}km run`;
    case 'ride_distance':
      return `${challenge.target}km ride`;
    default:
      return `${challenge.target} ${challenge.unit}`;
  }
}

/**
 * The quiet closing line — when this goal's counter goes back to zero.
 *
 * This promise is finally real: until migration 0072 nothing ever reset a challenge, and the card
 * said "Resets Monday" over a counter that ran forever (task #89).
 *
 * DAILY now says plain "midnight" because migration 0084 made it true: roll_over_challenges()
 * reads each user's own timezone off their profile, and the job runs every 15 minutes so it
 * catches each zone's midnight as it passes. Before that it was a single 00:10 UTC sweep, so
 * "midnight UTC" was accurate but wrong behaviour — a user in UTC+13 lost their day at 11am.
 *
 * WEEKLY still says UTC, and still means it. week_start() is the shared boundary leaderboards,
 * streak decay and the pass period all key off; per-user weeks would make "this week" mean
 * different windows in different parts of the app, so it stays global — and a Saturday-evening
 * user in the Americas is genuinely hours from a reset the word "Sunday" alone would put a day
 * away.
 */
function resetLabel(period: Challenge['period']): string {
  return period === 'day' ? 'Resets at midnight' : 'Resets Sunday (UTC)';
}

type ChallengeCardProps = {
  challenge: Challenge;
  /** True when the device source that COULD track this goal is actually connected — the card
   * only claims "Auto" when something is genuinely feeding it. */
  autoConnected?: boolean;
  /** Carries the SERVER's payout up with the completion so the tab can show mock 103's reward
   * screen. Null when nothing was granted (already awarded today, or the RPC failed) — the caller
   * shows the plain burst in that case rather than an empty reward screen. */
  onLogged: (justCompleted: boolean, award: GoalDayAward | null, goalLabel: string) => void;
  onDeleted: () => void;
  /** Opens the Goal info screen (mock 102 v2), where the target, source, reset and reward rules
   * live now that the card itself stays minimal. */
  onInfo?: () => void;
};

// An individual goal (design-mocks/73B). The old card stacked 🔗 / ✅ / 🏆 into the corner and
// made you decode three glyphs; this reads straight left→right — icon, name, cadence — then one
// sub-line saying only how it's tracked, one bar, and ONE status. No campfire binding anywhere:
// a goal is the user's own (migration 0059), and sharing the work is a per-lock-in choice.
export function ChallengeCard({ challenge, autoConnected = false, onLogged, onDeleted, onInfo }: ChallengeCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [amount, setAmount] = useState('');
  const [logging, setLogging] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const quickAdds = TYPE_QUICK_ADDS[challenge.type];
  const isComplete = challenge.completed_at !== null;
  const pct = Math.min(100, Math.round((challenge.progress / challenge.target) * 100));

  // "Auto" is a claim about what's actually happening, not about what's theoretically possible —
  // a steps goal on a phone that never granted Health Connect is logged by hand, and saying
  // otherwise would leave someone waiting for numbers that never arrive.
  const realSource = getRealFitnessSourceForChallengeType(challenge.type);
  // Lock-in-sourced metrics (study, gym) need no connection at all — the app already has the
  // check-ins — so they're auto from creation, unlike a steps goal that's waiting on a permission.
  const isAuto = realSource !== null && (!sourceNeedsConnection(realSource) || autoConnected);
  const sourceLine = isAuto ? `⚡ Auto · ${AUTO_SOURCE_NAME[realSource]}` : '✏️ Logged by hand';

  async function handleLog(value: number) {
    if (value <= 0) return;
    setLogging(true);
    setError(null);
    try {
      const result = await logChallengeProgress(challenge.id, value);
      setAmount('');
      setExpanded(false);
      onLogged(result.justCompleted, result.award, challengeTitle(challenge));
    } catch (e) {
      setError(getErrorMessage(e, 'Could not log progress.'));
    } finally {
      setLogging(false);
    }
  }

  function handleDelete() {
    Alert.alert('Delete goal?', "You'll lose your logged progress.", [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: onDeleted },
    ]);
  }

  return (
    <Card style={styles.card}>
      <Pressable onPress={onInfo} onLongPress={handleDelete} style={styles.header}>
        <View style={styles.iconTile}>
          <Ionicons name={CHALLENGE_TYPE_ICON[challenge.type]} size={18} color={Colors.ember} />
        </View>
        <View style={styles.titleColumn}>
          <Text style={styles.title} numberOfLines={1}>
            {challengeTitle(challenge)}
          </Text>
          <Text style={styles.source} numberOfLines={1}>
            {sourceLine}
          </Text>
        </View>
        <View style={styles.cadenceChip}>
          <Text style={styles.cadenceChipText}>{challenge.period === 'day' ? 'Daily' : 'Weekly'}</Text>
        </View>
      </Pressable>

      <View style={styles.progressTrack}>
        <View style={[styles.progressFill, { width: `${pct}%` }, isComplete && styles.progressFillDone]} />
      </View>

      {/* Numbers on the left, ONE status on the right — a percentage while it's live, the green
          "Smashed" once the target's beaten. Never both, and never a third badge elsewhere. */}
      <View style={styles.statusRow}>
        <Text style={styles.progressLabel}>
          {challenge.progress.toLocaleString()} / {challenge.target.toLocaleString()} {challenge.unit}
        </Text>
        {isComplete ? (
          <View style={styles.smashed}>
            <Text style={styles.smashedText}>Smashed</Text>
            <Ionicons name="checkmark" size={12} color={Colors.green} />
          </View>
        ) : (
          <Text style={styles.pct}>{pct}%</Text>
        )}
      </View>

      <Text style={styles.reset}>
        {resetLabel(challenge.period)}
        {isComplete ? ' · +XP banked' : ''}
      </Text>

      {/* Only a hand-logged goal in progress needs controls — an auto-tracked one fills itself,
          and offering quick-adds beside it invites double-counting the same steps. */}
      {!isComplete && !isAuto && (
        <>
          {expanded ? (
            <View style={styles.logRow}>
              <TextInput
                style={styles.logInput}
                placeholder="Amount"
                keyboardType="numeric"
                value={amount}
                onChangeText={setAmount}
              />
              <Pressable
                style={styles.logButton}
                disabled={logging || !amount.trim()}
                onPress={() => handleLog(Number(amount))}>
                <Text style={styles.logButtonLabel}>{logging ? '…' : 'Log'}</Text>
              </Pressable>
            </View>
          ) : (
            <View style={styles.quickRow}>
              {quickAdds.map((qa) => (
                <Pressable
                  key={qa}
                  style={styles.quickPill}
                  disabled={logging}
                  onPress={() => handleLog(qa)}
                  accessibilityLabel={`Log +${qa} ${challenge.unit}`}>
                  <Text style={styles.quickPillLabel}>+{qa.toLocaleString()}</Text>
                </Pressable>
              ))}
              <Pressable style={styles.quickPillGhost} onPress={() => setExpanded(true)}>
                <Text style={styles.quickPillGhostLabel}>Log amount…</Text>
              </Pressable>
            </View>
          )}
          {error && <Text style={styles.error}>{error}</Text>}
        </>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: Spacing.two,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  iconTile: {
    width: 38,
    height: 38,
    borderRadius: 11,
    backgroundColor: Colors.achieverBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  titleColumn: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    fontFamily: Fonts.bodyBold,
    fontSize: 15,
    color: Colors.ink,
  },
  source: {
    fontFamily: Fonts.body,
    fontSize: 11,
    color: Colors.muted,
    marginTop: 2,
  },
  cadenceChip: {
    borderRadius: Radius.pill,
    backgroundColor: Colors.disabled,
    paddingVertical: 3,
    paddingHorizontal: 9,
  },
  cadenceChipText: {
    fontFamily: Fonts.bodyBold,
    fontSize: 9.5,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    color: Colors.muted,
  },
  progressTrack: {
    height: 10,
    borderRadius: Radius.pill,
    backgroundColor: Colors.line,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: Radius.pill,
    backgroundColor: Colors.coral,
  },
  progressFillDone: {
    backgroundColor: Colors.green,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
  },
  progressLabel: {
    flex: 1,
    fontFamily: Fonts.bodySemiBold,
    fontSize: 12.5,
    color: Colors.ink,
  },
  pct: {
    fontFamily: Fonts.bodyBold,
    fontSize: 12.5,
    color: Colors.muted,
  },
  smashed: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  smashedText: {
    fontFamily: Fonts.bodyBold,
    fontSize: 12.5,
    color: Colors.green,
  },
  reset: {
    fontFamily: Fonts.body,
    fontSize: 10.5,
    color: Colors.textTertiary,
  },
  quickRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
  },
  quickPill: {
    borderRadius: Radius.pill,
    paddingVertical: Spacing.one,
    paddingHorizontal: Spacing.three,
    backgroundColor: Colors.achieverBg,
  },
  quickPillLabel: {
    fontFamily: Fonts.bodyBold,
    fontSize: 13,
    color: Colors.achieverText,
  },
  quickPillGhost: {
    borderRadius: Radius.pill,
    paddingVertical: Spacing.one,
    paddingHorizontal: Spacing.three,
    borderWidth: 2,
    borderColor: Colors.line,
  },
  quickPillGhostLabel: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 13,
    color: Colors.muted,
  },
  logRow: {
    flexDirection: 'row',
    gap: Spacing.two,
    alignItems: 'center',
  },
  logInput: {
    flex: 1,
  },
  logButton: {
    backgroundColor: Colors.coral,
    borderRadius: Radius.input,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
  },
  logButtonLabel: {
    fontFamily: Fonts.bodyBold,
    color: Colors.ink,
  },
  error: {
    fontFamily: Fonts.body,
    fontSize: 12,
    color: Colors.coral,
  },
});
