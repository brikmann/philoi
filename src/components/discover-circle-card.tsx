import { StyleProp, StyleSheet, Text, View, ViewStyle } from 'react-native';

import { CampfireBadge, heatFromMemberCount } from '@/components/campfire-badge';
import { Card } from '@/components/ui/card';
import { PrimaryButton } from '@/components/ui/primary-button';
import { Colors, Fonts, Spacing } from '@/constants/theme';
import type { DiscoverableGroup } from '@/types/database';

type DiscoverCircleCardProps = {
  group: DiscoverableGroup;
  onJoin: () => void;
  joining: boolean;
  /** Overrides the default fixed width (240) — pass { width: '100%' } for use in a vertical list. */
  style?: StyleProp<ViewStyle>;
};

export function DiscoverCircleCard({ group, onJoin, joining, style }: DiscoverCircleCardProps) {
  return (
    <Card style={[styles.card, style]}>
      <View style={styles.headerRow}>
        {/* Was a loose 24px emoji sitting on the card with nothing around it — mock 168's
            exact complaint. The badge gives it the warm frame and the activity aura, so a
            discover row draws a campfire the same way the valley and the header do. */}
        <CampfireBadge emoji={group.emoji} heat={heatFromMemberCount(group.member_count)} size={40} />
        <View style={styles.headerText}>
          <Text style={styles.name}>{group.name}</Text>
          <Text style={styles.meta}>
            {group.cadence} · {group.member_count} {group.member_count === 1 ? 'member' : 'members'}
            {group.owner_university ? ` · ${group.owner_university}` : ''}
          </Text>
        </View>
      </View>
      <PrimaryButton label="Join Campfire" onPress={onJoin} loading={joining} />
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
