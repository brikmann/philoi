import { Alert, StyleSheet, Text, View } from 'react-native';

import { Card } from '@/components/ui/card';
import { PrimaryButton } from '@/components/ui/primary-button';
import { SecondaryButton } from '@/components/ui/secondary-button';
import { Colors, Fonts, Spacing } from '@/constants/theme';
import { GOAL_TYPE_META } from '@/lib/goal-types';
import type { MyGoal } from '@/hooks/use-my-goals';

type GoalCardProps = {
  goal: MyGoal;
  onLockIn: () => void;
  onArchive: () => void;
};

export function GoalCard({ goal, onLockIn, onArchive }: GoalCardProps) {
  const meta = GOAL_TYPE_META[goal.type];

  function confirmArchive() {
    Alert.alert('Archive this goal?', 'Your streak history is kept, but it stops showing up here.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Archive', style: 'destructive', onPress: onArchive },
    ]);
  }

  return (
    <Card style={styles.card}>
      <View style={styles.headerRow}>
        <Text style={styles.emoji}>{meta.emoji}</Text>
        <View style={styles.headerText}>
          <Text style={styles.name}>{goal.label || meta.label}</Text>
          <Text style={styles.cadence}>{goal.cadence}</Text>
        </View>
        <Text style={styles.streak}>🔥 {goal.current_streak}</Text>
      </View>

      {goal.checked_in_today ? (
        <SecondaryButton label="Locked in today ✅" onPress={() => {}} disabled />
      ) : (
        <PrimaryButton label="Lock in" onPress={onLockIn} />
      )}

      <Text style={styles.archiveLink} onPress={confirmArchive}>
        Archive goal
      </Text>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: Spacing.three,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  emoji: {
    fontSize: 28,
  },
  headerText: {
    flex: 1,
  },
  name: {
    fontFamily: Fonts.display,
    fontSize: 18,
    color: Colors.ink,
  },
  cadence: {
    fontFamily: Fonts.body,
    fontSize: 13,
    color: Colors.muted,
  },
  streak: {
    fontFamily: Fonts.bodyExtraBold,
    fontSize: 16,
    color: Colors.coral,
  },
  archiveLink: {
    fontFamily: Fonts.body,
    fontSize: 12,
    color: Colors.muted,
    textAlign: 'center',
    textDecorationLine: 'underline',
  },
});
