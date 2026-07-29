import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';

import { LeaderboardGap, LeaderboardPersonRow } from '@/components/leaderboard-person-row';
import { EmptyState } from '@/components/ui/empty-state';
import { Screen } from '@/components/ui/screen';
import { TabHeader } from '@/components/ui/tab-header';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { useCrossCirclePeople } from '@/hooks/use-cross-circle-people';
import { useUniversityLeaderboard } from '@/hooks/use-university-leaderboard';
import { useUniversityTotals } from '@/hooks/use-university-totals';
import { track } from '@/lib/analytics';
import { useAuth } from '@/lib/auth/auth-context';
import type { UniversityLeaderboardRow } from '@/types/database';

type Scope = 'camp' | 'uni' | 'vs';
type Metric = 'xp' | 'streak';

const SCOPE_LABEL: Record<Scope, string> = { camp: 'Campfires', uni: 'My uni', vs: 'Vs. unis' };
const SCOPES: Scope[] = ['camp', 'uni', 'vs'];

// My-university list is capped at the top 10; your own row is pinned below a "···" gap
// (PHILOI_UI_SPEC.md §417) so you stay findable even at #142.
const UNI_VISIBLE = 10;

type UniItem = { kind: 'row'; row: UniversityLeaderboardRow; rank: number } | { kind: 'gap' };

export default function LeaderboardsScreen() {
  const { session, profile } = useAuth();
  const [scope, setScope] = useState<Scope>('camp');
  const [metric, setMetric] = useState<Metric>('xp');

  const { people, loading: peopleLoading, error: peopleError, refetch: refetchPeople } = useCrossCirclePeople();
  const university = profile?.university ?? '';
  const { rows: uniRows, loading: uniLoading, error: uniError, refetch: refetchUni } = useUniversityLeaderboard(university);
  const { totals, loading: totalsLoading, refetch: refetchTotals } = useUniversityTotals();

  useEffect(() => {
    track('leaderboard_viewed', { scope });
  }, [scope]);

  const loading = scope === 'camp' ? peopleLoading : scope === 'uni' ? uniLoading : totalsLoading;
  const refetch = scope === 'camp' ? refetchPeople : scope === 'uni' ? refetchUni : refetchTotals;

  // Always sort people by their raw metric value — never by tier; the hexagon is a badge only
  // (PHILOI_UI_SPEC.md §412). The Streaks toggle swaps the whole list to a streak sort.
  const sortedPeople = [...people].sort((a, b) =>
    metric === 'xp' ? b.score - a.score : b.current_streak - a.current_streak
  );

  // My uni: sort the full pool, keep the top 10, then pin my own row (with my true rank) below
  // a gap if I'm outside it.
  const sortedUni = [...uniRows].sort((a, b) =>
    metric === 'xp' ? b.score - a.score : b.check_ins_this_week - a.check_ins_this_week
  );
  const myUniIndex = sortedUni.findIndex((r) => r.user_id === session?.user.id);
  const uniItems: UniItem[] = sortedUni.slice(0, UNI_VISIBLE).map((row, i) => ({ kind: 'row', row, rank: i + 1 }));
  if (myUniIndex >= UNI_VISIBLE) {
    uniItems.push({ kind: 'gap' }, { kind: 'row', row: sortedUni[myUniIndex], rank: myUniIndex + 1 });
  }

  // Vs. universities: rank by per-capita XP (avg per active student) so a small campus can
  // beat a big one on merit, not headcount (PHILOI_UI_SPEC.md §418).
  const sortedTotals = totals
    .map((t) => ({ ...t, perCapita: t.member_count > 0 ? t.total_xp / t.member_count : 0 }))
    .sort((a, b) => b.perCapita - a.perCapita);

  return (
    <Screen padded={false}>
      <TabHeader title="Leaderboard" />
      <View style={styles.header}>
        <View style={styles.pillRow}>
          {SCOPES.map((s) => (
            <Pressable key={s} style={[styles.pill, scope === s && styles.pillOn]} onPress={() => setScope(s)}>
              <Text style={[styles.pillLabel, scope === s && styles.pillLabelOn]}>{SCOPE_LABEL[s]}</Text>
            </Pressable>
          ))}
        </View>
        {scope !== 'vs' && (
          <View style={styles.metricRow}>
            <Pressable style={[styles.metricPill, metric === 'xp' && styles.pillOn]} onPress={() => setMetric('xp')}>
              <Text style={[styles.pillLabel, metric === 'xp' && styles.pillLabelOn]}>XP</Text>
            </Pressable>
            <Pressable style={[styles.metricPill, metric === 'streak' && styles.pillOn]} onPress={() => setMetric('streak')}>
              <Text style={[styles.pillLabel, metric === 'streak' && styles.pillLabelOn]}>Streaks</Text>
            </Pressable>
          </View>
        )}
      </View>

      {scope === 'camp' && (
        <FlatList
          data={sortedPeople}
          keyExtractor={(item) => item.user_id}
          contentContainerStyle={styles.listContent}
          refreshControl={<RefreshControl refreshing={loading} onRefresh={refetch} tintColor={Colors.coral} />}
          renderItem={({ item, index }) => (
            <LeaderboardPersonRow
              rank={index + 1}
              displayName={item.display_name}
              tier={item.tier}
              division={item.division}
              value={metric === 'xp' ? `${Math.round(item.score).toLocaleString()} XP` : `🔥 ${item.current_streak}d`}
              isMe={item.user_id === session?.user.id}
            />
          )}
          ItemSeparatorComponent={() => <View style={{ height: 2 }} />}
          ListEmptyComponent={
            !loading ? (
              peopleError ? (
                <EmptyState title="Couldn't load leaderboard" body={peopleError} />
              ) : (
                <EmptyState title="No Campfires yet" body="Join or start a Campfire to see how you stack up." />
              )
            ) : null
          }
        />
      )}

      {scope === 'uni' &&
        (!university ? (
          <EmptyState title="Add your school" body="Set your school in Profile to see how you stack up at your university." />
        ) : (
          <FlatList
            data={uniItems}
            keyExtractor={(item) => (item.kind === 'gap' ? 'gap' : item.row.user_id)}
            contentContainerStyle={styles.listContent}
            refreshControl={<RefreshControl refreshing={loading} onRefresh={refetch} tintColor={Colors.coral} />}
            renderItem={({ item }) =>
              item.kind === 'gap' ? (
                <LeaderboardGap />
              ) : (
                <LeaderboardPersonRow
                  rank={item.rank}
                  displayName={item.row.display_name}
                  tier={item.row.tier}
                  division={item.row.division}
                  value={
                    metric === 'xp'
                      ? `${Math.round(item.row.score).toLocaleString()} XP`
                      : `🔥 ${item.row.check_ins_this_week}x wk`
                  }
                  isMe={item.row.user_id === session?.user.id}
                />
              )
            }
            ItemSeparatorComponent={() => <View style={{ height: 2 }} />}
            ListEmptyComponent={
              !loading ? <EmptyState title="Nobody here yet" body={uniError ?? 'Be the first from your school to start a streak.'} /> : null
            }
          />
        ))}

      {scope === 'vs' && (
        <FlatList
          data={sortedTotals}
          keyExtractor={(item) => item.university}
          contentContainerStyle={styles.listContent}
          refreshControl={<RefreshControl refreshing={loading} onRefresh={refetch} tintColor={Colors.coral} />}
          renderItem={({ item, index }) => (
            <View style={[styles.row, item.university === university && styles.rowMe]}>
              <Text style={styles.pos}>{index + 1}</Text>
              <View style={styles.avatar}>
                <Ionicons name="business" size={14} color={Colors.achieverText} />
              </View>
              <View style={styles.who}>
                <Text style={styles.name} numberOfLines={1}>
                  {item.university}
                  {item.university === university ? ' · you' : ''}
                </Text>
                <Text style={styles.sub}>avg / active student</Text>
              </View>
              <Text style={styles.val}>{Math.round(item.perCapita).toLocaleString()} XP</Text>
            </View>
          )}
          ItemSeparatorComponent={() => <View style={{ height: 2 }} />}
          ListEmptyComponent={!loading ? <EmptyState title="No campuses yet" body="Check back once more schools join." /> : null}
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: {
    gap: Spacing.two,
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.two,
    paddingBottom: Spacing.two,
  },
  pillRow: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  pill: {
    flex: 1,
    alignItems: 'center',
    backgroundColor: Colors.card,
    borderRadius: Radius.pill,
    borderWidth: 1,
    borderColor: 'transparent',
    paddingVertical: Spacing.two,
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
    padding: Spacing.four,
    gap: 2,
  },
  // Vs.-unis school rows keep their own inline layout (crest instead of avatar/hex).
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    padding: Spacing.two,
    borderRadius: Radius.card,
  },
  rowMe: {
    backgroundColor: Colors.selectedBg,
    borderWidth: 1,
    borderColor: Colors.coral,
  },
  pos: {
    width: 18,
    textAlign: 'center',
    fontFamily: Fonts.bodySemiBold,
    fontSize: 12,
    color: Colors.textTertiary,
  },
  avatar: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: Colors.achieverBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  who: {
    flex: 1,
    minWidth: 0,
  },
  name: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 13,
    color: Colors.ink,
  },
  sub: {
    fontFamily: Fonts.body,
    fontSize: 10.5,
    color: Colors.muted,
  },
  val: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 13,
    color: Colors.ink,
  },
});
