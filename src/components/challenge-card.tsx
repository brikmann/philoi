import { useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import { Card } from '@/components/ui/card';
import { TextInput } from '@/components/ui/text-input';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { logChallengeProgress } from '@/lib/api/challenges';
import { getErrorMessage } from '@/lib/errors';
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

type ChallengeCardProps = {
  challenge: Challenge;
  circleName: string | null;
  onLogged: (justCompleted: boolean) => void;
  onDeleted: () => void;
  onViewLeaderboard?: () => void;
};

export function ChallengeCard({ challenge, circleName, onLogged, onDeleted, onViewLeaderboard }: ChallengeCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [amount, setAmount] = useState('');
  const [logging, setLogging] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const meta = TYPE_META[challenge.type];
  const isComplete = challenge.completed_at !== null;
  const pct = Math.min(100, Math.round((challenge.progress / challenge.target) * 100));

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
    Alert.alert('Delete challenge?', "You'll lose your logged progress.", [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: onDeleted },
    ]);
  }

  return (
    <Card style={styles.card}>
      <Pressable onLongPress={handleDelete} style={styles.header}>
        <Text style={styles.icon}>{meta.icon}</Text>
        <View style={styles.titleColumn}>
          <Text style={styles.title}>{challengeTitle(challenge)}</Text>
          <Text style={styles.subtitle}>
            {circleName ? `🔗 ${circleName}` : '🔒 Private'} · {challenge.period === 'day' ? 'Daily' : 'Weekly'}
          </Text>
        </View>
        {isComplete && <Text style={styles.doneBadge}>✅</Text>}
        {circleName && onViewLeaderboard && (
          <Pressable
            onPress={onViewLeaderboard}
            hitSlop={8}
            style={styles.leaderboardButton}
            accessibilityLabel="View challenge leaderboard">
            <Text style={styles.leaderboardIcon}>🏆</Text>
          </Pressable>
        )}
      </Pressable>

      <View style={styles.progressTrack}>
        <View style={[styles.progressFill, { width: `${pct}%` }, isComplete && styles.progressFillDone]} />
      </View>
      <Text style={styles.progressLabel}>
        {challenge.progress.toLocaleString()} / {challenge.target.toLocaleString()} {challenge.unit}
      </Text>

      {!isComplete && (
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
  icon: {
    fontSize: 24,
  },
  titleColumn: {
    flex: 1,
  },
  title: {
    fontFamily: Fonts.bodyBold,
    fontSize: 16,
    color: Colors.ink,
  },
  subtitle: {
    fontFamily: Fonts.body,
    fontSize: 12,
    color: Colors.muted,
  },
  doneBadge: {
    fontSize: 20,
  },
  leaderboardButton: {
    minWidth: 44,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  leaderboardIcon: {
    fontSize: 18,
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
  progressLabel: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 12,
    color: Colors.muted,
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
