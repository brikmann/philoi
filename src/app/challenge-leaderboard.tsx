import { Stack, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { FlatList, Image, RefreshControl, StyleSheet, Text, View } from 'react-native';

import { EmptyState } from '@/components/ui/empty-state';
import { Screen } from '@/components/ui/screen';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { fetchChallengeLeaderboard } from '@/lib/api/challenges';
import { useAuth } from '@/lib/auth/auth-context';
import { getErrorMessage } from '@/lib/errors';
import type { ChallengeLeaderboardRow, ChallengeType } from '@/types/database';

export default function ChallengeLeaderboardScreen() {
  const { circleId, type, title } = useLocalSearchParams<{ circleId: string; type: ChallengeType; title?: string }>();
  const { session } = useAuth();
  const [rows, setRows] = useState<ChallengeLeaderboardRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    try {
      setError(null);
      setRows(await fetchChallengeLeaderboard(circleId, type));
    } catch (e) {
      setError(getErrorMessage(e, 'Could not load the challenge leaderboard.'));
    } finally {
      setLoading(false);
    }
  }, [circleId, type]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-mount, no caching layer to defer to
    refetch();
  }, [refetch]);

  return (
    <Screen padded={false}>
      <Stack.Screen options={{ title: title ? decodeURIComponent(title) : 'Challenge leaderboard' }} />
      <FlatList
        data={rows}
        keyExtractor={(item) => item.user_id}
        contentContainerStyle={styles.listContent}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={refetch} tintColor={Colors.coral} />}
        renderItem={({ item, index }) => {
          const pct = Math.min(100, Math.round((item.progress / item.target) * 100));
          return (
            <View style={[styles.row, item.user_id === session?.user.id && styles.rowMe]}>
              <Text style={styles.rank}>{index + 1}</Text>
              {item.avatar_url ? (
                <Image source={{ uri: item.avatar_url }} style={styles.avatar} />
              ) : (
                <View style={[styles.avatar, styles.avatarFallback]}>
                  <Text style={styles.avatarInitial}>{item.display_name.charAt(0).toUpperCase()}</Text>
                </View>
              )}
              <View style={styles.nameColumn}>
                <Text style={styles.name}>
                  {item.display_name}
                  {item.user_id === session?.user.id ? ' (you)' : ''}
                </Text>
                <View style={styles.progressTrack}>
                  <View
                    style={[
                      styles.progressFill,
                      { width: `${pct}%` },
                      item.completed_at && styles.progressFillDone,
                    ]}
                  />
                </View>
              </View>
              <Text style={styles.progress}>
                {item.completed_at ? '✅' : `${item.progress.toLocaleString()}/${item.target.toLocaleString()}`}
              </Text>
            </View>
          );
        }}
        ListEmptyComponent={
          !loading ? (
            <EmptyState title="Nobody's logged yet" body={error ?? 'Be the first in this circle to start this challenge.'} />
          ) : null
        }
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  listContent: {
    padding: Spacing.four,
    gap: Spacing.two,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.two,
    borderRadius: Radius.input,
  },
  rowMe: {
    backgroundColor: Colors.achieverBg,
  },
  rank: {
    width: 20,
    fontFamily: Fonts.bodyBold,
    color: Colors.muted,
    textAlign: 'center',
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
  },
  avatarFallback: {
    backgroundColor: Colors.plum,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitial: {
    color: Colors.cream,
    fontFamily: Fonts.bodyBold,
  },
  nameColumn: {
    flex: 1,
    gap: Spacing.half,
  },
  name: {
    fontFamily: Fonts.bodyBold,
    color: Colors.ink,
  },
  progressTrack: {
    height: 6,
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
  progress: {
    fontFamily: Fonts.bodyExtraBold,
    color: Colors.coral,
    fontSize: 12,
  },
});
