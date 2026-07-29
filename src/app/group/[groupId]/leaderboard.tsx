import { Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';

import { LeaderboardPersonRow } from '@/components/leaderboard-person-row';
import { EmptyState } from '@/components/ui/empty-state';
import { Screen } from '@/components/ui/screen';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { useGroup } from '@/hooks/use-group';
import { useLeaderboard } from '@/hooks/use-leaderboard';
import { useAuth } from '@/lib/auth/auth-context';

type Metric = 'xp' | 'streak';

// The intra-campfire leaderboard (PHILOI_UI_SPEC.md §420-421) — just this campfire's members,
// same compact row style as the Leaderboard tab plus the XP/Streaks toggle. The intimate,
// everyday rivalry that lives inside the campfire itself.
export default function GroupLeaderboardScreen() {
  const { groupId } = useLocalSearchParams<{ groupId: string }>();
  const { session } = useAuth();
  const { group } = useGroup(groupId);
  const { rows, loading, error, refetch } = useLeaderboard(groupId);
  const [metric, setMetric] = useState<Metric>('xp');

  // Always sort by the raw metric value; the tier hexagon is a badge only (§412).
  const sorted = [...rows].sort((a, b) => (metric === 'xp' ? b.score - a.score : b.check_ins_this_week - a.check_ins_this_week));

  return (
    <Screen padded={false}>
      <Stack.Screen options={{ title: group?.name ?? 'Leaderboard' }} />
      <View style={styles.header}>
        <View style={styles.metricRow}>
          <Pressable style={[styles.metricPill, metric === 'xp' && styles.pillOn]} onPress={() => setMetric('xp')}>
            <Text style={[styles.pillLabel, metric === 'xp' && styles.pillLabelOn]}>XP</Text>
          </Pressable>
          <Pressable style={[styles.metricPill, metric === 'streak' && styles.pillOn]} onPress={() => setMetric('streak')}>
            <Text style={[styles.pillLabel, metric === 'streak' && styles.pillLabelOn]}>Streaks</Text>
          </Pressable>
        </View>
      </View>

      <FlatList
        data={sorted}
        keyExtractor={(item) => item.user_id}
        contentContainerStyle={styles.listContent}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={refetch} tintColor={Colors.coral} />}
        renderItem={({ item, index }) => (
          <LeaderboardPersonRow
            rank={index + 1}
            displayName={item.display_name}
            tier={item.tier}
            division={item.division}
            value={metric === 'xp' ? `${Math.round(item.score).toLocaleString()} XP` : `🔥 ${item.check_ins_this_week}x wk`}
            isMe={item.user_id === session?.user.id}
          />
        )}
        ItemSeparatorComponent={() => <View style={{ height: 2 }} />}
        ListEmptyComponent={
          !loading ? <EmptyState title="Nobody here yet" body={error ?? 'Members show up once they start earning XP.'} /> : null
        }
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: {
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.three,
    paddingBottom: Spacing.two,
  },
  metricRow: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  metricPill: {
    backgroundColor: Colors.card,
    borderRadius: Radius.pill,
    borderWidth: 1,
    borderColor: 'transparent',
    paddingVertical: Spacing.one,
    paddingHorizontal: Spacing.three,
  },
  pillOn: {
    backgroundColor: Colors.selectedBg,
    borderColor: Colors.coral,
  },
  pillLabel: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 11.5,
    color: Colors.muted,
  },
  pillLabelOn: {
    color: Colors.achieverText,
  },
  listContent: {
    paddingHorizontal: Spacing.four,
    paddingBottom: Spacing.four,
    gap: 2,
  },
});
