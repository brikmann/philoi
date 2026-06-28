import { StyleSheet, Text, View } from 'react-native';

import { Card } from '@/components/ui/card';
import { PrimaryButton } from '@/components/ui/primary-button';
import { SecondaryButton } from '@/components/ui/secondary-button';
import { Colors, Fonts, Spacing } from '@/constants/theme';
import type { MyGroup } from '@/lib/api/groups';

type GroupCardProps = {
  group: MyGroup;
  onLockIn: () => void;
  onOpen: () => void;
};

export function GroupCard({ group, onLockIn, onOpen }: GroupCardProps) {
  return (
    <Card style={styles.card}>
      <View style={styles.headerRow}>
        <Text style={styles.emoji}>{group.emoji}</Text>
        <View style={styles.headerText}>
          <Text style={styles.name}>{group.name}</Text>
          <Text style={styles.cadence}>{group.cadence}</Text>
        </View>
        <Text style={styles.streak}>🔥 {group.current_streak}</Text>
      </View>

      {group.checked_in_today ? (
        <SecondaryButton label="Locked in today ✅ — view your circle" onPress={onOpen} />
      ) : (
        <PrimaryButton label="Lock in" onPress={onLockIn} />
      )}
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
});
