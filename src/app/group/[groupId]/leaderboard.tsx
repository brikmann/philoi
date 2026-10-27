import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, View } from 'react-native';

import { ActiveChallengeMarkerChip } from '@/components/active-challenge-marker-chip';
import { LeaderboardGap, LeaderboardPersonRow } from '@/components/leaderboard-person-row';
import { ParthenonPodium, type PodiumItem } from '@/components/parthenon-podium';
import { Screen } from '@/components/ui/screen';
import { SPACE_GUTTER, SpaceChip, SpaceEmpty, SpaceHeader } from '@/components/ui/space-kit';
import { Colors, Spacing } from '@/constants/theme';
import { useGroup } from '@/hooks/use-group';
import { useLeaderboard } from '@/hooks/use-leaderboard';
import { usePresence } from '@/hooks/use-presence';
import { usePublicLoadouts } from '@/hooks/use-public-loadouts';
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
  const value = (row: LeaderboardRow) => (metric === 'xp' ? `${Math.round(row.score).toLocaleString()} XP` : `${row.check_ins_this_week} check-ins/wk`);
  // The weekly count wears the flame it carried as a 🔥 before the icon sweep; XP stays bare.
  const valueIcon = metric === 'xp' ? undefined : ('streak' as const);
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
        valueIcon,
        isMe: row.user_id === session?.user.id,
      }))
    : [];
  const listRows = usePodium ? sorted.slice(3, VISIBLE_RANKS) : sorted;
  const listRowRankOffset = usePodium ? 4 : 1;
  const myIndex = sorted.findIndex((r) => r.user_id === session?.user.id);
  const pinned = usePodium && myIndex >= VISIBLE_RANKS ? sorted[myIndex] : null;

  // One call for the whole board — see the batching note in economy/public-identity.tsx.
  const loadouts = usePublicLoadouts(sorted.map((r) => r.user_id));
  // Live status (0245), one batched call for the whole roster.
  const presence = usePresence(sorted.map((r) => r.user_id));
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
      {/* The native header gives way to the kit's, like every other pushed screen; the campfire's
          name stays the title it always was. */}
      <Stack.Screen options={{ headerShown: false }} />
      <SpaceHeader title={group?.name ?? 'Leaderboard'} subtitle="Leaderboard" onBack={() => router.back()} />
      <View style={styles.header}>
        <View style={styles.metricRow}>
          <SpaceChip label="XP" selected={metric === 'xp'} onPress={() => setMetric('xp')} />
          <SpaceChip label="Streaks" selected={metric === 'streak'} onPress={() => setMetric('streak')} />
        </View>
      </View>

      <FlatList
        data={listRows}
        keyExtractor={(item) => item.user_id}
        contentContainerStyle={styles.listContent}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={refetch} tintColor={Colors.navEmber} />}
        ListHeaderComponent={
          top3.length > 0 ? (
            <View style={styles.podiumWrap}>
              <ParthenonPodium
                top={top3.map((t) => (t.kind === 'person' ? { ...t, presence: presence[t.key] } : t))}
                onPressItem={(item) => goToProfile(item.key)} />
            </View>
          ) : null
        }
        renderItem={({ item, index }) => (
          <View style={styles.rowWrap}>
            <Pressable onPress={() => goToProfile(item.user_id)}>
              <LeaderboardPersonRow
                rank={index + listRowRankOffset}
                userId={item.user_id}
                loadout={loadouts[item.user_id]}
                presence={presence[item.user_id]}
                displayName={item.display_name}
                avatarUrl={item.avatar_url}
                tier={item.tier}
                division={item.division}
                value={value(item)}
                valueIcon={valueIcon}
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
                  userId={pinned.user_id}
                  loadout={loadouts[pinned.user_id]}
                  presence={presence[pinned.user_id]}
                  displayName={pinned.display_name}
                  avatarUrl={pinned.avatar_url}
                  tier={pinned.tier}
                  division={pinned.division}
                  value={value(pinned)}
                  valueIcon={valueIcon}
                  isMe
                />
              </Pressable>
            </>
          ) : null
        }
        ListEmptyComponent={
          !loading && isEmpty ? <SpaceEmpty title="Nobody here yet" body={error ?? 'Members show up once they start earning XP.'} /> : null
        }
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: {
    paddingHorizontal: SPACE_GUTTER,
    paddingBottom: Spacing.two,
  },
  metricRow: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  listContent: {
    paddingHorizontal: SPACE_GUTTER,
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
