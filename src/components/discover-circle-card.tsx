import { StyleSheet, Text, View } from 'react-native';

import { Card } from '@/components/ui/card';
import { PrimaryButton } from '@/components/ui/primary-button';
import { Colors, Fonts, Spacing } from '@/constants/theme';
import type { DiscoverableGroup } from '@/types/database';

type DiscoverCircleCardProps = {
  group: DiscoverableGroup;
  onJoin: () => void;
  joining: boolean;
};

export function DiscoverCircleCard({ group, onJoin, joining }: DiscoverCircleCardProps) {
  return (
    <Card style={styles.card}>
      <View style={styles.headerRow}>
        <Text style={styles.emoji}>{group.emoji}</Text>
        <View style={styles.headerText}>
          <Text style={styles.name}>{group.name}</Text>
          <Text style={styles.meta}>
            {group.cadence} · {group.member_count} {group.member_count === 1 ? 'member' : 'members'}
            {group.owner_university ? ` · ${group.owner_university}` : ''}
          </Text>
        </View>
      </View>
      <PrimaryButton label="Join circle" onPress={onJoin} loading={joining} />
    </Card>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: Spacing.three,
    width: 240,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  emoji: {
    fontSize: 24,
  },
  headerText: {
    flex: 1,
  },
  name: {
    fontFamily: Fonts.bodyBold,
    fontSize: 15,
    color: Colors.ink,
  },
  meta: {
    fontFamily: Fonts.body,
    fontSize: 12,
    color: Colors.muted,
  },
});
