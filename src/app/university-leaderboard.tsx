import { Stack } from 'expo-router';
import { FlatList, RefreshControl, StyleSheet, Text, View } from 'react-native';

import { LeaderboardRow } from '@/components/leaderboard-row';
import { EmptyState } from '@/components/ui/empty-state';
import { Screen } from '@/components/ui/screen';
import { Colors, Fonts, Spacing } from '@/constants/theme';
import { useUniversityLeaderboard } from '@/hooks/use-university-leaderboard';
import { useAuth } from '@/lib/auth/auth-context';

export default function UniversityLeaderboardScreen() {
  const { profile, session } = useAuth();
  const university = profile?.university ?? '';
  const { rows, loading, error, refetch } = useUniversityLeaderboard(university);

  return (
    <Screen padded={false}>
      <Stack.Screen options={{ title: university || 'School Leaderboard' }} />
      <FlatList
        data={rows}
        keyExtractor={(item) => item.user_id}
        contentContainerStyle={styles.listContent}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={refetch} tintColor={Colors.coral} />}
        ListHeaderComponent={
          <View style={styles.header}>
            <Text style={styles.title}>🏆 {university}</Text>
            <Text style={styles.subtitle}>Ranked by consistency across every goal.</Text>
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
              score: item.score,
              tier: item.tier,
              division: item.division,
              check_ins_this_week: item.check_ins_this_week,
            }}
            isMe={item.user_id === session?.user.id}
          />
        )}
        ListEmptyComponent={
          !loading ? (
            <EmptyState
              title="Nobody here yet"
              body="Be the first from your school to start a streak."
            />
          ) : null
        }
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  listContent: {
    padding: Spacing.four,
  },
  header: {
    gap: Spacing.one,
    marginBottom: Spacing.three,
  },
  title: {
    fontFamily: Fonts.display,
    fontSize: 24,
    color: Colors.ink,
  },
  subtitle: {
    fontFamily: Fonts.body,
    fontSize: 13,
    color: Colors.muted,
  },
  error: {
    fontFamily: Fonts.body,
    color: Colors.coral,
  },
});
