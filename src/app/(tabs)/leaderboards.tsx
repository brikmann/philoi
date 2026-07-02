import { useRouter } from 'expo-router';
import { useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';

import { LeaderboardRow } from '@/components/leaderboard-row';
import { EmptyState } from '@/components/ui/empty-state';
import { Screen } from '@/components/ui/screen';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { useMyCircleRanks } from '@/hooks/use-my-circle-ranks';
import { useUniversityLeaderboard } from '@/hooks/use-university-leaderboard';
import { useAuth } from '@/lib/auth/auth-context';

type Scope = 'circles' | 'school';

function MyCirclesList() {
  const router = useRouter();
  const { ranks, loading, error, refetch } = useMyCircleRanks();

  return (
    <FlatList
      data={ranks}
      keyExtractor={(item) => item.group_id}
      contentContainerStyle={styles.listContent}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={refetch} tintColor={Colors.coral} />}
      renderItem={({ item }) => (
        <Pressable
          style={styles.circleRow}
          onPress={() => router.push(`/group/${item.group_id}?tab=leaderboard`)}
          accessibilityLabel={`Open ${item.group_name} leaderboard`}>
          <Text style={styles.circleEmoji}>{item.group_emoji}</Text>
          <View style={styles.circleColumn}>
            <Text style={styles.circleName}>{item.group_name}</Text>
            <Text style={styles.circleMeta}>
              #{item.my_rank} of {item.member_count} · {item.check_ins_this_week} check-ins this week
            </Text>
          </View>
          <Text style={styles.circleStreak}>🔥 {item.current_streak}</Text>
        </Pressable>
      )}
      ItemSeparatorComponent={() => <View style={{ height: Spacing.two }} />}
      ListEmptyComponent={
        !loading ? (
          <EmptyState title="No circles yet" body={error ?? "Join or start a circle to see your rank."} />
        ) : null
      }
    />
  );
}

function MySchoolList() {
  const { profile, session } = useAuth();
  const university = profile?.university ?? '';
  const { rows, loading, error, refetch } = useUniversityLeaderboard(university);

  if (!university) {
    return (
      <EmptyState
        title="Add your school"
        body="Set your school in Profile to see how you stack up at your university."
      />
    );
  }

  return (
    <FlatList
      data={rows}
      keyExtractor={(item) => item.user_id}
      contentContainerStyle={styles.listContent}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={refetch} tintColor={Colors.coral} />}
      ListHeaderComponent={
        <View style={styles.schoolHeader}>
          <Text style={styles.schoolTitle}>🏆 {university}</Text>
          <Text style={styles.schoolSubtitle}>Ranked by best active streak across every circle.</Text>
          {error && <Text style={styles.error}>{error}</Text>}
        </View>
      }
      renderItem={({ item, index }) => (
        <LeaderboardRow
          rank={index + 1}
          row={{
            user_id: item.user_id,
            handle: item.handle,
            display_name: item.display_name,
            avatar_url: item.avatar_url,
            is_pro: item.is_pro,
            current_streak: item.best_streak,
            goal_target: null,
            check_ins_this_week: item.check_ins_this_week,
          }}
          isMe={item.user_id === session?.user.id}
        />
      )}
      ListEmptyComponent={
        !loading ? <EmptyState title="Nobody here yet" body="Be the first from your school to start a streak." /> : null
      }
    />
  );
}

export default function LeaderboardsScreen() {
  const [scope, setScope] = useState<Scope>('circles');

  return (
    <Screen padded={false}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Leaderboards</Text>
        <View style={styles.toggleRow}>
          <Pressable
            style={[styles.toggle, scope === 'circles' && styles.toggleActive]}
            onPress={() => setScope('circles')}>
            <Text style={[styles.toggleLabel, scope === 'circles' && styles.toggleLabelActive]}>My Circles</Text>
          </Pressable>
          <Pressable
            style={[styles.toggle, scope === 'school' && styles.toggleActive]}
            onPress={() => setScope('school')}>
            <Text style={[styles.toggleLabel, scope === 'school' && styles.toggleLabelActive]}>My School</Text>
          </Pressable>
        </View>
      </View>

      {scope === 'circles' ? <MyCirclesList /> : <MySchoolList />}
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: {
    gap: Spacing.two,
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.three,
    paddingBottom: Spacing.two,
  },
  headerTitle: {
    fontFamily: Fonts.display,
    fontSize: 32,
    color: Colors.ink,
  },
  toggleRow: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  toggle: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: Spacing.two,
    borderRadius: Radius.pill,
    borderWidth: 2,
    borderColor: Colors.line,
  },
  toggleActive: {
    backgroundColor: Colors.coral,
    borderColor: Colors.coral,
  },
  toggleLabel: {
    fontFamily: Fonts.bodyBold,
    fontSize: 14,
    color: Colors.muted,
  },
  toggleLabelActive: {
    color: '#FFFFFF',
  },
  listContent: {
    padding: Spacing.four,
  },
  circleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    backgroundColor: Colors.card,
    borderRadius: Radius.card,
    borderWidth: 1,
    borderColor: Colors.line,
    padding: Spacing.three,
  },
  circleEmoji: {
    fontSize: 28,
  },
  circleColumn: {
    flex: 1,
  },
  circleName: {
    fontFamily: Fonts.bodyBold,
    fontSize: 16,
    color: Colors.ink,
  },
  circleMeta: {
    fontFamily: Fonts.body,
    fontSize: 12,
    color: Colors.muted,
  },
  circleStreak: {
    fontFamily: Fonts.bodyExtraBold,
    color: Colors.coral,
  },
  schoolHeader: {
    gap: Spacing.one,
    marginBottom: Spacing.three,
  },
  schoolTitle: {
    fontFamily: Fonts.display,
    fontSize: 24,
    color: Colors.ink,
  },
  schoolSubtitle: {
    fontFamily: Fonts.body,
    fontSize: 13,
    color: Colors.muted,
  },
  error: {
    fontFamily: Fonts.body,
    color: Colors.coral,
  },
});
