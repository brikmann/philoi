import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';

import { ActiveChallengeMarkerChip } from '@/components/active-challenge-marker-chip';
import { LeaderboardGap, LeaderboardPersonRow } from '@/components/leaderboard-person-row';
import { ParthenonPodium, type PodiumItem } from '@/components/parthenon-podium';
import { EmptyState } from '@/components/ui/empty-state';
import { Screen } from '@/components/ui/screen';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { useGroup } from '@/hooks/use-group';
import { useLeaderboard } from '@/hooks/use-leaderboard';
import { useAuth } from '@/lib/auth/auth-context';
import { fetchActiveChallengeMarker } from '@/lib/api/leaderboard-social';
import type { ActiveChallengeMarker, LeaderboardRow } from '@/types/database';

type Metric = 'xp' | 'streak';
const VISIBLE_RANKS = 10;

// The intra-campfire leaderboard (PHILOI_UI_SPEC.md §420-421) — just this campfire's members,
// same Parthenon format + XP/Streaks toggle as the Leaderboard tab (§15's "same format" rule),
// small-board fallback for free since ParthenonPodium already handles 1-2 members gracefully. No
// server-truth rank here (a campfire's member list is small and fully loaded), so "rank" is just
// the position in the sorted array, same as the Leaderboard tab's Campfires scope.
export default function GroupLeaderboardScreen() {
  const { groupId } = useLocalSearchParams<{ groupId: string }>();
  const router = useRouter();
  const { session } = useAuth();
  const { group } = useGroup(groupId);
  const { rows, loading, error, refetch } = useLeaderboard(groupId);
  const [metric, setMetric] = useState<Metric>('xp');
  const [markers, setMarkers] = useState<Record<string, ActiveChallengeMarker>>({});

  useEffect(() => {
    let cancelled = false;
    Promise.all(rows.map((r) => fetchActiveChallengeMarker(r.user_id).then((m) => [r.user_id, m] as const))).then((entries) => {
      if (cancelled) return;
      const next: Record<string, ActiveChallengeMarker> = {};
      for (const [userId, marker] of entries) if (marker) next[userId] = marker;
      setMarkers(next);
    });
    return () => {
      cancelled = true;
    };
  }, [rows]);

  // Always sort by the raw metric value; the tier hexagon is a badge only (§412).
  const sorted = [...rows].sort((a, b) => (metric === 'xp' ? b.score - a.score : b.check_ins_this_week - a.check_ins_this_week));
  const value = (row: LeaderboardRow) => (metric === 'xp' ? `${Math.round(row.score).toLocaleString()} XP` : `🔥 ${row.check_ins_this_week}× wk`);
  // Punchlist 2, §3: a campfire under 3 members falls back to the old plain-list format — never
  // a podium with empty slots. This ALSO fixes a real bug the podium path had on its own: with
  // exactly 3-9 members, `sorted.slice(3, VISIBLE_RANKS)` is an empty array (nothing past rank 3
  // yet), which was driving the FlatList's ListEmptyComponent — "Nobody here yet" rendering
  // alongside a podium full of real people. isEmpty below is keyed off the full member count,
  // never off this rank-4+ slice.
  const usePodium = sorted.length >= 3;
  const top3: PodiumItem[] = usePodium
    ? sorted.slice(0, 3).map((row) => ({
        kind: 'person',
        key: row.user_id,
        displayName: row.display_name,
        avatarUrl: row.avatar_url,
        tier: row.tier,
        division: row.division,
        value: value(row),
        isMe: row.user_id === session?.user.id,
      }))
    : [];
  const listRows = usePodium ? sorted.slice(3, VISIBLE_RANKS) : sorted;
  const listRowRankOffset = usePodium ? 4 : 1;
  const myIndex = sorted.findIndex((r) => r.user_id === session?.user.id);
  const pinned = usePodium && myIndex >= VISIBLE_RANKS ? sorted[myIndex] : null;
  const isEmpty = sorted.length === 0;

  function goToProfile(userId: string) {
    if (userId === session?.user.id) router.push('/profile');
    else router.push({ pathname: '/friend-profile', params: { userId } });
  }

  function goWatch(marker: ActiveChallengeMarker) {
    router.push({ pathname: '/watch/[challengeId]', params: { challengeId: marker.challenge_id, mode: marker.mode } });
  }

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
        data={listRows}
        keyExtractor={(item) => item.user_id}
        contentContainerStyle={styles.listContent}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={refetch} tintColor={Colors.coral} />}
        ListHeaderComponent={
          top3.length > 0 ? (
            <View style={styles.podiumWrap}>
              <ParthenonPodium top={top3} onPressItem={(item) => goToProfile(item.key)} />
            </View>
          ) : null
        }
        renderItem={({ item, index }) => (
          <View style={styles.rowWrap}>
            <Pressable onPress={() => goToProfile(item.user_id)}>
              <LeaderboardPersonRow
                rank={index + listRowRankOffset}
                displayName={item.display_name}
                avatarUrl={item.avatar_url}
                tier={item.tier}
                division={item.division}
                value={value(item)}
                isMe={item.user_id === session?.user.id}
              />
            </Pressable>
            {markers[item.user_id] && (
              <View style={styles.markerRow}>
                <ActiveChallengeMarkerChip marker={markers[item.user_id]} onWatch={() => goWatch(markers[item.user_id])} compact />
              </View>
            )}
          </View>
        )}
        ItemSeparatorComponent={() => <View style={{ height: 2 }} />}
        ListFooterComponent={
          pinned ? (
            <>
              <LeaderboardGap />
              <Pressable onPress={() => goToProfile(pinned.user_id)}>
                <LeaderboardPersonRow
                  rank={myIndex + 1}
                  displayName={pinned.display_name}
                  avatarUrl={pinned.avatar_url}
                  tier={pinned.tier}
                  division={pinned.division}
                  value={value(pinned)}
                  isMe
                />
              </Pressable>
            </>
          ) : null
        }
        ListEmptyComponent={
          !loading && isEmpty ? <EmptyState title="Nobody here yet" body={error ?? 'Members show up once they start earning XP.'} /> : null
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
  podiumWrap: {
    alignItems: 'center',
    marginBottom: Spacing.four,
  },
  rowWrap: {
    gap: 4,
  },
  markerRow: {
    paddingLeft: 40,
    paddingBottom: 4,
  },
});
