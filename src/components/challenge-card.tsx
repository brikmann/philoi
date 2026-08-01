import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import { Card } from '@/components/ui/card';
import { TextInput } from '@/components/ui/text-input';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { logChallengeProgress } from '@/lib/api/challenges';
import { getErrorMessage } from '@/lib/errors';
import { FITNESS_SOURCE_NAME, getRealFitnessSourceForChallengeType } from '@/lib/fitness-sync';
import type { Challenge, ChallengeType } from '@/types/database';

const TYPE_META: Record<ChallengeType, { icon: string; quickAdds: number[] }> = {
  steps: { icon: '👟', quickAdds: [1000, 2500, 5000] },
  run_distance: { icon: '🏃', quickAdds: [1, 5, 10] },
  ride_distance: { icon: '🚴', quickAdds: [5, 10, 20] },
  gym_visits: { icon: '🏋️', quickAdds: [1] },
  study_hours: { icon: '📚', quickAdds: [1, 2] },
  custom: { icon: '🎯', quickAdds: [1] },
  workout_minutes: { icon: '⏱️', quickAdds: [15, 30, 60] },
  strain: { icon: '💪', quickAdds: [1, 2] },
  sleep_hours: { icon: '😴', quickAdds: [1] },
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

/** The quiet closing line — when this goal's counter goes back to zero. */
function resetLabel(period: Challenge['period']): string {
  return period === 'day' ? 'Resets at midnight' : 'Resets Monday';
}

type ChallengeCardProps = {
  challenge: Challenge;
  /** True when the device source that COULD track this goal is actually connected — the card
   * only claims "Auto" when something is genuinely feeding it. */
  autoConnected?: boolean;
  onLogged: (justCompleted: boolean) => void;
  onDeleted: () => void;
};

// An individual goal (design-mocks/73B). The old card stacked 🔗 / ✅ / 🏆 into the corner and
// made you decode three glyphs; this reads straight left→right — icon, name, cadence — then one
// sub-line saying only how it's tracked, one bar, and ONE status. No campfire binding anywhere:
// a goal is the user's own (migration 0059), and sharing the work is a per-lock-in choice.
export function ChallengeCard({ challenge, autoConnected = false, onLogged, onDeleted }: ChallengeCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [amount, setAmount] = useState('');
  const [logging, setLogging] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const meta = TYPE_META[challenge.type];
  const isComplete = challenge.completed_at !== null;
  const pct = Math.min(100, Math.round((challenge.progress / challenge.target) * 100));

  // "Auto" is a claim about what's actually happening, not about what's theoretically possible —
  // a steps goal on a phone that never granted Health Connect is logged by hand, and saying
  // otherwise would leave someone waiting for numbers that never arrive.
  const realSource = getRealFitnessSourceForChallengeType(challenge.type);
  const isAuto = realSource !== null && autoConnected;
  const sourceLine = isAuto ? `⚡ Auto · ${FITNESS_SOURCE_NAME[realSource]}` : '✏️ Logged by hand';

  async function handleLog(value: number) {
    if (value <= 0) return;
    setLogging(true);
    setError(null);
    try {
      const result = await logChallengeProgress(challenge.id, value);
      setAmount('');
      setExpanded(false);
      onLogged(result.justCompleted);
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
      <Pressable onLongPress={handleDelete} style={styles.header}>
        <View style={styles.iconTile}>
          <Text style={styles.icon}>{meta.icon}</Text>
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
              {meta.quickAdds.map((qa) => (
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
  icon: {
    fontSize: 19,
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
