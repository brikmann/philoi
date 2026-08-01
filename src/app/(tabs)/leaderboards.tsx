import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';

import { BurntOutCampfire } from '@/components/empty-states/burnt-out-campfire';
import { LeaderboardGap, LeaderboardPersonRow } from '@/components/leaderboard-person-row';
import { ParthenonPodium, type PodiumItem } from '@/components/parthenon-podium';
import { EmptyState } from '@/components/ui/empty-state';
import { Screen } from '@/components/ui/screen';
import { TabHeader } from '@/components/ui/tab-header';
import { TextInput } from '@/components/ui/text-input';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { HexagonBadge } from '@/components/hexagon-badge';
import { useCrossCirclePeople } from '@/hooks/use-cross-circle-people';
import { useGlobalLeaderboard } from '@/hooks/use-global-leaderboard';
import { useUniversityLeaderboard } from '@/hooks/use-university-leaderboard';
import { useUniversityTotals } from '@/hooks/use-university-totals';
import { track } from '@/lib/analytics';
import { useAuth } from '@/lib/auth/auth-context';
import { fetchUniversityShortNames } from '@/lib/api/groups';
import { searchLeaderboard } from '@/lib/api/leaderboard-social';
import { getUniversityCrest } from '@/lib/university-crests';
import type {
  CrossCirclePerson,
  GlobalLeaderboardRow,
  LeaderboardSearchResult,
  RankTierName,
  UniversityLeaderboardRow,
} from '@/types/database';

type Scope = 'camp' | 'uni' | 'vs' | 'global';
type Metric = 'xp' | 'streak';
type VsMetric = 'total' | 'avg';

const SCOPE_LABEL: Record<Scope, string> = { camp: 'Campfires', uni: 'My uni', vs: 'Vs. unis', global: 'Global' };
const SCOPES: Scope[] = ['camp', 'uni', 'vs', 'global'];

// The visible list caps at rank 10 below the podium (ranks 1-3) — your own row/pillar pins at
// the bottom with your true rank whenever it falls outside that window (PHILOI_UI_SPEC.md §15).
const VISIBLE_RANKS = 10;

type ListRow<T> = { row: T; rank: number };
type Board<T> = { top3: PodiumItem[]; listRows: ListRow<T>[]; pinned: ListRow<T> | null };

// The three individual-scope row shapes all carry user_id/display_name/avatar_url/tier/division/
// score; only their "second metric" field differs (current_streak for the Campfires pool vs.
// check_ins_this_week for My-uni/Global, which don't track a per-user streak directly).
type PersonRow = CrossCirclePerson | UniversityLeaderboardRow | GlobalLeaderboardRow;

function personValue(row: PersonRow, metric: Metric): string {
  if (metric === 'xp') return `${Math.round(row.score).toLocaleString()} XP`;
  if ('current_streak' in row) return `🔥 ${row.current_streak}d`;
  return `${row.check_ins_this_week}× wk`;
}

function personPodiumItem(row: PersonRow, metric: Metric, isMe: boolean): PodiumItem {
  return {
    kind: 'person',
    key: row.user_id,
    displayName: row.display_name,
    avatarUrl: row.avatar_url,
    tier: row.tier as RankTierName,
    division: row.division,
    value: personValue(row, metric),
    isMe,
  };
}

// Campfires pool — fully loaded client-side (no server-truth rank), so "true rank" is just the
// position in the fully-sorted array.
function buildCampBoard(people: CrossCirclePerson[], metric: Metric, myId?: string): Board<CrossCirclePerson> {
  const ordered = [...people].sort((a, b) => (metric === 'xp' ? b.score - a.score : b.current_streak - a.current_streak));
  const top3 = ordered.slice(0, 3).map((p) => personPodiumItem(p, metric, p.user_id === myId));
  const listRows = ordered.slice(3, VISIBLE_RANKS).map((row, i) => ({ row, rank: i + 4 }));
  const myIndex = ordered.findIndex((p) => p.user_id === myId);
  const pinned = myIndex >= VISIBLE_RANKS ? { row: ordered[myIndex], rank: myIndex + 1 } : null;
  return { top3, listRows, pinned };
}

// My-uni / Global — server-truth `rank`/`is_me` when sorted by XP (the RPC's own order, which
// always includes the caller's row even far outside p_limit); Streaks re-sorts the fetched slice
// client-side, so its "rank" is just a local position within that slice (the RPC only fetched the
// top p_limit by XP, so this doesn't reflect a true global streak rank — same limitation the
// pre-existing My-uni board already had).
function buildRankedBoard<T extends UniversityLeaderboardRow | GlobalLeaderboardRow>(rows: T[], metric: Metric): Board<T> {
  if (metric === 'xp') {
    const ordered = [...rows].sort((a, b) => a.rank - b.rank);
    const top3 = ordered.slice(0, 3).map((r) => personPodiumItem(r, metric, r.is_me));
    const listRows = ordered.filter((r) => r.rank >= 4 && r.rank <= VISIBLE_RANKS).map((row) => ({ row, rank: row.rank }));
    const mine = ordered.find((r) => r.is_me);
    const pinned = mine && mine.rank > VISIBLE_RANKS ? { row: mine, rank: mine.rank } : null;
    return { top3, listRows, pinned };
  }
  const ordered = [...rows].sort((a, b) => b.check_ins_this_week - a.check_ins_this_week);
  const top3 = ordered.slice(0, 3).map((r) => personPodiumItem(r, metric, r.is_me));
  const listRows = ordered.slice(3, VISIBLE_RANKS).map((row, i) => ({ row, rank: i + 4 }));
  const myIndex = ordered.findIndex((r) => r.is_me);
  const pinned = myIndex >= VISIBLE_RANKS ? { row: ordered[myIndex], rank: myIndex + 1 } : null;
  return { top3, listRows, pinned };
}

export default function LeaderboardsScreen() {
  const router = useRouter();
  const { session, profile } = useAuth();
  const [scope, setScope] = useState<Scope>('camp');
  const [metric, setMetric] = useState<Metric>('xp');
  const [vsMetric, setVsMetric] = useState<VsMetric>('total');
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<LeaderboardSearchResult[]>([]);
  const [searching, setSearching] = useState(false);

  const { people, loading: peopleLoading, error: peopleError, refetch: refetchPeople } = useCrossCirclePeople();
  const university = profile?.university ?? '';
  const { rows: uniRows, loading: uniLoading, error: uniError, refetch: refetchUni } = useUniversityLeaderboard(university);
  const { totals, loading: totalsLoading, refetch: refetchTotals } = useUniversityTotals();
  const { rows: globalRows, loading: globalLoading, error: globalError, refetch: refetchGlobal } = useGlobalLeaderboard();
  const autoFallbackDone = useRef(false);
  const [universityShortNames, setUniversityShortNames] = useState<Record<string, string>>({});

  useEffect(() => {
    track('leaderboard_viewed', { scope });
  }, [scope]);

  useEffect(() => {
    fetchUniversityShortNames()
      .then(setUniversityShortNames)
      .catch(() => {
        // Falls back to full names below — a failed fetch shouldn't block the board.
      });
  }, []);

  // "Board renders empty" (punchlist 2, §1) — get_my_cross_circle_people() now already merges
  // friends + campfire-mates, but a brand new account can still have neither. Rather than land
  // on a lonely single-person podium (or the burnt-out-campfire empty state) by default, fall
  // back the INITIAL scope to My-uni once — only once, and only if the user hasn't already
  // picked a scope themselves, so it never fights a deliberate tap back to Campfires.
  useEffect(() => {
    if (autoFallbackDone.current || peopleLoading || scope !== 'camp') return;
    autoFallbackDone.current = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time fallback once the pool's first load resolves, not a render-loop risk
    if (people.length <= 1 && university) setScope('uni');
  }, [peopleLoading, people.length, university, scope]);

  useEffect(() => {
    if (!searchOpen) return;
    const trimmed = searchQuery.trim();
    if (!trimmed) {
      setSearchResults([]);
      return;
    }
    setSearching(true);
    const timeout = setTimeout(() => {
      searchLeaderboard(trimmed)
        .then(setSearchResults)
        .catch(() => setSearchResults([]))
        .finally(() => setSearching(false));
    }, 300);
    return () => clearTimeout(timeout);
  }, [searchQuery, searchOpen]);

  function handleOpenSearch() {
    setSearchOpen(true);
    track('leaderboard_search_used', { scope });
  }

  function goToProfile(userId: string) {
    if (userId === session?.user.id) {
      router.push('/profile');
    } else {
      router.push({ pathname: '/friend-profile', params: { userId } });
    }
  }

  const loading = scope === 'camp' ? peopleLoading : scope === 'uni' ? uniLoading : scope === 'global' ? globalLoading : totalsLoading;
  const refetch = scope === 'camp' ? refetchPeople : scope === 'uni' ? refetchUni : scope === 'global' ? refetchGlobal : refetchTotals;

  const campBoard = buildCampBoard(people, metric, session?.user.id);
  const uniBoard = buildRankedBoard(uniRows, metric);
  const globalBoard = buildRankedBoard(globalRows, metric);

  const sortedTotals = totals
    .map((t) => ({ ...t, perCapita: t.member_count > 0 ? t.total_xp / t.member_count : 0 }))
    .sort((a, b) => (vsMetric === 'total' ? b.total_xp - a.total_xp : b.perCapita - a.perCapita));
  const vsTop3: PodiumItem[] = sortedTotals.slice(0, 3).map((t) => ({
    kind: 'university',
    key: t.university,
    name: universityShortNames[t.university] ?? t.university,
    value: vsMetric === 'total' ? `${(t.total_xp / 1_000_000 >= 1 ? `${(t.total_xp / 1_000_000).toFixed(2)}M` : Math.round(t.total_xp).toLocaleString())} XP` : `${Math.round(t.perCapita).toLocaleString()} XP`,
    isMe: t.university === university,
  }));
  const vsListRows = sortedTotals.slice(3, VISIBLE_RANKS);

  function renderPersonBoard<T extends PersonRow>(
    board: Board<T>,
    emptyTitle: string,
    emptyBody: string,
    errorMessage: string | null,
    useCampfireEmptyIllustration = false
  ) {
    const isEmpty = board.top3.length === 0 && board.listRows.length === 0 && !board.pinned;
    return (
      <FlatList
        data={board.listRows}
        keyExtractor={(item) => item.row.user_id}
        contentContainerStyle={styles.listContent}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={refetch} tintColor={Colors.coral} />}
        ListHeaderComponent={
          board.top3.length > 0 ? (
            <View style={styles.podiumWrap}>
              <ParthenonPodium top={board.top3} onPressItem={(item) => goToProfile(item.key)} />
            </View>
          ) : null
        }
        renderItem={({ item }) => (
          <Pressable onPress={() => goToProfile(item.row.user_id)}>
            <LeaderboardPersonRow
              rank={item.rank}
              displayName={item.row.display_name}
              avatarUrl={item.row.avatar_url}
              tier={item.row.tier}
              division={item.row.division}
              value={personValue(item.row, metric)}
              isMe={item.row.user_id === session?.user.id}
            />
          </Pressable>
        )}
        ItemSeparatorComponent={() => <View style={{ height: 2 }} />}
        ListFooterComponent={
          board.pinned ? (
            <>
              <LeaderboardGap />
              <Pressable onPress={() => goToProfile(board.pinned!.row.user_id)}>
                <LeaderboardPersonRow
                  rank={board.pinned.rank}
                  displayName={board.pinned.row.display_name}
                  avatarUrl={board.pinned.row.avatar_url}
                  tier={board.pinned.row.tier}
                  division={board.pinned.row.division}
                  value={personValue(board.pinned.row, metric)}
                  isMe
                />
              </Pressable>
            </>
          ) : null
        }
        ListEmptyComponent={
          !loading && isEmpty ? (
            errorMessage ? (
              <EmptyState title="Couldn't load leaderboard" body={errorMessage} />
            ) : useCampfireEmptyIllustration ? (
              <EmptyState icon={<BurntOutCampfire />} title={emptyTitle} body={emptyBody} />
            ) : (
              <EmptyState title={emptyTitle} body={emptyBody} />
            )
          ) : null
        }
      />
    );
  }

  return (
    <Screen padded={false}>
      <TabHeader
        title="Leaderboard"
        right={
          <Pressable onPress={() => (searchOpen ? setSearchOpen(false) : handleOpenSearch())} hitSlop={8} accessibilityLabel={searchOpen ? 'Close search' : 'Search'}>
            <Ionicons name={searchOpen ? 'close' : 'search'} size={20} color={Colors.muted} />
          </Pressable>
        }
      />

      {searchOpen ? (
        <View style={styles.searchScreen}>
          <View style={styles.searchBar}>
            <Ionicons name="search" size={16} color={Colors.muted} />
            <TextInput
              style={styles.searchInput}
              placeholder="Search by name or @username"
              value={searchQuery}
              onChangeText={setSearchQuery}
              autoFocus
              autoCorrect={false}
            />
          </View>
          {searching && <ActivityIndicator color={Colors.coral} style={{ marginTop: Spacing.four }} />}
          <FlatList
            data={searchResults}
            keyExtractor={(item) => item.user_id}
            contentContainerStyle={styles.listContent}
            ListHeaderComponent={searchResults.length > 0 ? <Text style={styles.sectionLabel}>RESULTS</Text> : null}
            renderItem={({ item }) => (
              <Pressable style={styles.searchRow} onPress={() => goToProfile(item.user_id)}>
                <View style={styles.searchAvatar}>
                  <Text style={styles.searchAvatarInitial}>{item.display_name.charAt(0).toUpperCase()}</Text>
                </View>
                <View style={styles.searchInfo}>
                  <View style={styles.searchNameRow}>
                    <Text style={styles.searchName} numberOfLines={1}>
                      {item.display_name}
                    </Text>
                    {item.is_friend && (
                      <View style={styles.friendTag}>
                        <Text style={styles.friendTagText}>Friend</Text>
                      </View>
                    )}
                  </View>
                  <Text style={styles.searchSub} numberOfLines={1}>
                    {item.handle ? `@${item.handle} · ` : ''}
                    {item.board}
                  </Text>
                </View>
                <HexagonBadge tier={item.tier} division={item.division} size={22} />
                <View style={styles.searchRank}>
                  <Text style={styles.searchRankValue}>{item.board_rank ? `#${item.board_rank.toLocaleString()}` : '—'}</Text>
                  <Text style={styles.searchRankSub}>{Math.round(item.score).toLocaleString()} XP</Text>
                </View>
              </Pressable>
            )}
            ListEmptyComponent={
              !searching && searchQuery.trim() ? <EmptyState emoji="🔍" title="No one found" body="Try a different name or @username." /> : null
            }
          />
        </View>
      ) : (
        <>
          <View style={styles.header}>
            <View style={styles.pillRow}>
              {SCOPES.map((s) => (
                <Pressable key={s} style={[styles.pill, scope === s && styles.pillOn]} onPress={() => setScope(s)}>
                  <Text style={[styles.pillLabel, scope === s && styles.pillLabelOn]}>{SCOPE_LABEL[s]}</Text>
                </Pressable>
              ))}
            </View>
            {scope !== 'vs' ? (
              <View style={styles.metricRow}>
                <Pressable style={[styles.metricPill, metric === 'xp' && styles.pillOn]} onPress={() => setMetric('xp')}>
                  <Text style={[styles.pillLabel, metric === 'xp' && styles.pillLabelOn]}>XP</Text>
                </Pressable>
                <Pressable style={[styles.metricPill, metric === 'streak' && styles.pillOn]} onPress={() => setMetric('streak')}>
                  <Text style={[styles.pillLabel, metric === 'streak' && styles.pillLabelOn]}>Streaks</Text>
                </Pressable>
              </View>
            ) : (
              <View style={styles.metricRow}>
                <Pressable style={[styles.metricPill, vsMetric === 'total' && styles.pillOn]} onPress={() => setVsMetric('total')}>
                  <Text style={[styles.pillLabel, vsMetric === 'total' && styles.pillLabelOn]}>Total XP</Text>
                </Pressable>
                <Pressable style={[styles.metricPill, vsMetric === 'avg' && styles.pillOn]} onPress={() => setVsMetric('avg')}>
                  <Text style={[styles.pillLabel, vsMetric === 'avg' && styles.pillLabelOn]}>Avg / member</Text>
                </Pressable>
              </View>
            )}
          </View>

          {scope === 'camp' &&
            renderPersonBoard(campBoard, 'No Campfires yet', 'Join or start a Campfire to see how you stack up.', peopleError, true)}

          {scope === 'uni' &&
            (!university ? (
              <EmptyState title="Add your school" body="Set your school in Profile to see how you stack up at your university." />
            ) : (
              renderPersonBoard(uniBoard, 'Nobody here yet', 'Be the first from your school to start a streak.', uniError)
            ))}

          {scope === 'global' && renderPersonBoard(globalBoard, 'Nobody here yet', 'Check back once more people join.', globalError)}

          {scope === 'vs' && (
            <FlatList
              data={vsListRows}
              keyExtractor={(item) => item.university}
              contentContainerStyle={styles.listContent}
              refreshControl={<RefreshControl refreshing={loading} onRefresh={refetch} tintColor={Colors.coral} />}
              ListHeaderComponent={
                vsTop3.length > 0 ? (
                  <View style={styles.podiumWrap}>
                    <ParthenonPodium top={vsTop3} />
                  </View>
                ) : null
              }
              renderItem={({ item, index }) => {
                const crest = getUniversityCrest(item.university);
                const isMe = item.university === university;
                const value = vsMetric === 'total' ? `${Math.round(item.total_xp).toLocaleString()} XP` : `${Math.round(item.perCapita).toLocaleString()} XP`;
                return (
                  <View style={[styles.row, isMe && styles.rowMe]}>
                    <Text style={styles.pos}>{index + 4}</Text>
                    <View style={[styles.crestSmall, { backgroundColor: crest.bg }]}>
                      <Text style={[styles.crestSmallText, { color: crest.text }]} numberOfLines={1}>
                        {crest.monogram}
                      </Text>
                    </View>
                    <View style={styles.who}>
                      <Text style={styles.name} numberOfLines={1}>
                        {universityShortNames[item.university] ?? item.university}
                        {isMe ? ' · you' : ''}
                      </Text>
                      <Text style={styles.sub}>{vsMetric === 'total' ? 'total XP' : 'avg / active student'}</Text>
                    </View>
                    <Text style={styles.val}>{value}</Text>
                  </View>
                );
              }}
              ItemSeparatorComponent={() => <View style={{ height: 2 }} />}
              ListEmptyComponent={!loading && vsTop3.length === 0 ? <EmptyState title="No campuses yet" body="Check back once more schools join." /> : null}
            />
          )}
        </>
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
    gap: Spacing.one,
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
    fontSize: 11,
    color: Colors.muted,
  },
  pillLabelOn: {
    color: Colors.achieverText,
  },
  listContent: {
    padding: Spacing.four,
    gap: 2,
  },
  podiumWrap: {
    alignItems: 'center',
    marginBottom: Spacing.four,
  },
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
  crestSmall: {
    width: 30,
    height: 30,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  crestSmallText: {
    fontFamily: Fonts.bodyBold,
    fontSize: 9,
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
  searchScreen: {
    flex: 1,
    paddingHorizontal: Spacing.four,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: Colors.coral,
    borderRadius: Radius.input,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
    marginTop: Spacing.two,
  },
  searchInput: {
    flex: 1,
    borderWidth: 0,
    backgroundColor: 'transparent',
    paddingVertical: 0,
    paddingHorizontal: 0,
    fontSize: 14,
  },
  sectionLabel: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 10,
    color: Colors.textTertiary,
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginTop: Spacing.four,
    marginBottom: Spacing.one,
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    paddingVertical: Spacing.two,
    borderTopWidth: 1,
    borderTopColor: Colors.card,
  },
  searchAvatar: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: Colors.achieverBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  searchAvatarInitial: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 14,
    color: Colors.achieverText,
  },
  searchInfo: {
    flex: 1,
    minWidth: 0,
  },
  searchNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  searchName: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 13,
    color: Colors.ink,
    flexShrink: 1,
  },
  friendTag: {
    backgroundColor: 'rgba(61,168,92,0.15)',
    borderRadius: 5,
    paddingVertical: 2,
    paddingHorizontal: 6,
  },
  friendTagText: {
    fontFamily: Fonts.bodyBold,
    fontSize: 8.5,
    color: Colors.green,
  },
  searchSub: {
    fontFamily: Fonts.body,
    fontSize: 11,
    color: Colors.textTertiary,
  },
  searchRank: {
    alignItems: 'flex-end',
  },
  searchRankValue: {
    fontFamily: Fonts.bodyBold,
    fontSize: 13,
    color: Colors.amber,
  },
  searchRankSub: {
    fontFamily: Fonts.body,
    fontSize: 10,
    color: Colors.muted,
  },
});
