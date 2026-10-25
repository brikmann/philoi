import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { forestSubline } from '@/components/forests/forest-bits';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { FOREST_SORTS, fetchForests } from '@/lib/api/forests';
import { shortSchoolName } from '@/lib/universities';
import type { ForestSort, ForestSummary } from '@/types/social';

// FORESTS BROWSE (CODE_PROMPT_agora_forests.md §1, mock 283 §02) — the Agora's second tab.
//
// "A forest with no pulse is worse than no forest." So the alive ones lead (Forests with a pulse,
// "N locked in now"), Active is the default sort, and every empty state says what to do next —
// never a bare grid. Suggestions are the server's (university / interests / program match).
//
// FAIL SOFT. Until 0274 is applied the RPCs don't exist; the tab then says forests are coming
// rather than printing a Postgres error, and the Feed tab beside it is untouched.

const SEARCH_DEBOUNCE_MS = 300;

/** What is loaded, tagged with the request it answers — so a fast sort switch can't show stale rows. */
type Loaded = { key: string; rows: ForestSummary[]; failed: boolean };

export function ForestsBrowse() {
  const router = useRouter();
  const [sort, setSort] = useState<ForestSort>('active');
  const [queryText, setQueryText] = useState('');
  const [query, setQuery] = useState('');
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [pulse, setPulse] = useState<ForestSummary[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const runId = useRef(0);

  const key = `${sort}|${query}`;
  const current = loaded && loaded.key === key ? loaded : null;

  // Debounced: a keystroke-per-RPC search on a phone keyboard is a dozen calls per word.
  useEffect(() => {
    const t = setTimeout(() => setQuery(queryText.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [queryText]);

  const load = useCallback(async () => {
    const run = (runId.current += 1);
    const k = `${sort}|${query}`;
    try {
      const rows = await fetchForests(sort, query || undefined);
      if (run === runId.current) setLoaded({ key: k, rows, failed: false });
    } catch {
      if (run === runId.current) setLoaded({ key: k, rows: [], failed: true });
    }
  }, [sort, query]);

  // On focus as well as on change, so a forest you just created or left is reflected on the way back.
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  // The pulse strip is its own read: it should stay "what's alive right now" whatever sort or
  // search the list below is on. Re-read on focus, so coming back from a forest shows it fresh.
  const loadPulse = useCallback(() => {
    fetchForests('active')
      .then((rows) => setPulse(rows.filter((f) => f.pulse)))
      .catch(() => setPulse([]));
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadPulse();
    }, [loadPulse])
  );

  async function refresh() {
    setRefreshing(true);
    loadPulse();
    try {
      await load();
    } finally {
      setRefreshing(false);
    }
  }

  function open(f: ForestSummary) {
    router.push({ pathname: '/forest/[id]', params: { id: f.id } });
  }

  function create() {
    router.push('/forest/create');
  }

  const rows = current?.rows ?? [];
  const showPulse = pulse.length > 0 && !query;

  return (
    <FlatList
      data={rows}
      keyExtractor={(f) => f.id}
      contentContainerStyle={styles.list}
      keyboardShouldPersistTaps="handled"
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={Colors.amber} />}
      ItemSeparatorComponent={() => <View style={styles.sep} />}
      ListHeaderComponent={
        <View>
          <View style={styles.headRow}>
            <Text style={styles.headTitle}>Find your forest</Text>
            <Pressable style={styles.createBtn} onPress={create} accessibilityRole="button" accessibilityLabel="Create a forest">
              <Ionicons name="add" size={14} color={Colors.onEmber} />
              <Text style={styles.createText}>Create</Text>
            </Pressable>
          </View>

          <View style={styles.search}>
            <Ionicons name="search" size={15} color={Colors.textTertiary} />
            <TextInput
              style={styles.searchInput}
              value={queryText}
              onChangeText={setQueryText}
              placeholder="Search by name or tag"
              placeholderTextColor={Colors.textTertiary}
              returnKeyType="search"
              autoCorrect={false}
              accessibilityLabel="Search forests"
            />
            {queryText ? (
              <Pressable onPress={() => setQueryText('')} hitSlop={8} accessibilityLabel="Clear search">
                <Ionicons name="close-circle" size={15} color={Colors.textTertiary} />
              </Pressable>
            ) : null}
          </View>

          {showPulse ? (
            <>
              <View style={styles.pulseLabelRow}>
                <View style={styles.pulseDot} />
                <Text style={styles.sectionLabel}>FORESTS WITH A PULSE</Text>
              </View>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.pulseRow}>
                {pulse.map((f) => (
                  <Pressable key={f.id} style={styles.pulseCard} onPress={() => open(f)} accessibilityRole="button">
                    <Text style={styles.pulseEmoji}>{f.emoji}</Text>
                    <Text style={styles.pulseName} numberOfLines={1}>
                      {f.name}
                    </Text>
                    <Text style={styles.pulseMeta} numberOfLines={1}>
                      {f.university ? shortSchoolName(f.university) : 'Cross-uni'} · {f.member_count.toLocaleString()}
                    </Text>
                    <Text style={styles.pulseLive} numberOfLines={1}>
                      {f.locked_in_now > 0 ? `${f.locked_in_now} locked in now` : 'active today'}
                    </Text>
                  </Pressable>
                ))}
              </ScrollView>
            </>
          ) : null}

          <View style={styles.sorts}>
            {FOREST_SORTS.map((s) => {
              const on = sort === s.key;
              return (
                <Pressable
                  key={s.key}
                  onPress={() => setSort(s.key)}
                  style={[styles.sort, on && styles.sortOn]}
                  accessibilityRole="button"
                  accessibilityState={{ selected: on }}>
                  <Text style={[styles.sortText, on && styles.sortTextOn]}>{s.label}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      }
      ListEmptyComponent={
        !current ? (
          <ActivityIndicator color={Colors.coral} style={styles.loader} />
        ) : (
          <EmptyForests failed={current.failed} sort={sort} query={query} onCreate={create} onRetry={() => void load()} />
        )
      }
      renderItem={({ item }) => <ForestRow forest={item} onPress={() => open(item)} />}
    />
  );
}

function ForestRow({ forest, onPress }: { forest: ForestSummary; onPress: () => void }) {
  const status = forest.my_status === 'active' ? 'Joined' : forest.my_status === 'pending' ? 'Requested' : null;
  return (
    <Pressable style={styles.row} onPress={onPress} accessibilityRole="button" accessibilityLabel={forest.name}>
      <View style={styles.rowEmoji}>
        <Text style={styles.rowEmojiText}>{forest.emoji}</Text>
      </View>
      <View style={styles.rowText}>
        <View style={styles.rowNameLine}>
          <Text style={styles.rowName} numberOfLines={1}>
            {forest.name}
          </Text>
          {forest.visibility === 'request' ? <Ionicons name="lock-closed" size={11} color={Colors.textTertiary} /> : null}
        </View>
        <Text style={styles.rowSub} numberOfLines={1}>
          {forestSubline(forest)}
        </Text>
        {forest.suggested || forest.locked_in_now > 0 ? (
          <View style={styles.rowTags}>
            {forest.suggested ? <Text style={styles.suggested}>Suggested for you</Text> : null}
            {forest.locked_in_now > 0 ? <Text style={styles.liveTag}>{forest.locked_in_now} locked in now</Text> : null}
          </View>
        ) : null}
      </View>
      {status ? <Text style={styles.status}>{status}</Text> : <Ionicons name="chevron-forward" size={16} color={Colors.textTertiary} />}
    </Pressable>
  );
}

/** Every empty state names the next step — an empty grid on a new account reads as a dead feature. */
function EmptyForests({
  failed,
  sort,
  query,
  onCreate,
  onRetry,
}: {
  failed: boolean;
  sort: ForestSort;
  query: string;
  onCreate: () => void;
  onRetry: () => void;
}) {
  if (failed) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyEmoji}>🌱</Text>
        <Text style={styles.emptyTitle}>Forests are still being planted</Text>
        <Text style={styles.emptyBody}>Couldn’t reach them just now. The feed works as normal.</Text>
        <Pressable style={styles.emptyGhost} onPress={onRetry} accessibilityRole="button">
          <Text style={styles.emptyGhostText}>Try again</Text>
        </Pressable>
      </View>
    );
  }
  const copy = query
    ? { title: `No forest matches “${query}”`, body: 'Start it — a forest is cheap to make, and the next person searching finds yours.' }
    : sort === 'mine'
      ? { title: 'You’re not in a forest yet', body: 'Check Active for the ones with a pulse, or start one for your people.' }
      : { title: 'No forests here yet', body: 'Plant the first one — your class, your sport, your 6am crew.' };
  return (
    <View style={styles.empty}>
      <Text style={styles.emptyEmoji}>🌲</Text>
      <Text style={styles.emptyTitle}>{copy.title}</Text>
      <Text style={styles.emptyBody}>{copy.body}</Text>
      <Pressable style={styles.emptyCta} onPress={onCreate} accessibilityRole="button">
        <Text style={styles.emptyCtaText}>Create a forest</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  list: {
    paddingHorizontal: Spacing.three,
    paddingBottom: 96,
  },
  sep: {
    height: Spacing.two,
  },
  headRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: Spacing.twelve,
  },
  headTitle: {
    fontFamily: Fonts.bodyBold,
    fontSize: 15,
    color: Colors.ink,
  },
  createBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    borderRadius: Radius.pill,
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: Colors.amber,
  },
  createText: {
    fontFamily: Fonts.bodyBold,
    fontSize: 12,
    color: Colors.onEmber,
  },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    marginTop: Spacing.twelve,
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: Colors.lineStrong,
    borderRadius: Radius.input,
    paddingHorizontal: Spacing.twelve,
  },
  searchInput: {
    flex: 1,
    paddingVertical: 10,
    fontFamily: Fonts.body,
    fontSize: 13,
    color: Colors.ink,
  },
  pulseLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: Spacing.three,
  },
  pulseDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: Colors.green,
  },
  sectionLabel: {
    fontFamily: Fonts.bodyBold,
    fontSize: 10,
    letterSpacing: 1,
    color: Colors.textTertiary,
  },
  pulseRow: {
    gap: Spacing.two,
    paddingTop: Spacing.two,
    paddingRight: Spacing.three,
  },
  pulseCard: {
    width: 150,
    backgroundColor: Colors.cardDark,
    borderWidth: 1,
    borderColor: `${Colors.amber}44`,
    borderRadius: 14,
    padding: Spacing.twelve,
  },
  pulseEmoji: {
    fontSize: 22,
  },
  pulseName: {
    fontFamily: Fonts.bodyBold,
    fontSize: 13,
    color: Colors.ink,
    marginTop: 6,
  },
  pulseMeta: {
    fontFamily: Fonts.body,
    fontSize: 10.5,
    color: Colors.muted,
    marginTop: 2,
  },
  pulseLive: {
    fontFamily: Fonts.bodyBold,
    fontSize: 11,
    color: Colors.amber,
    marginTop: 6,
  },
  sorts: {
    flexDirection: 'row',
    gap: 6,
    marginTop: Spacing.three,
    marginBottom: Spacing.twelve,
  },
  sort: {
    borderRadius: Radius.pill,
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: Colors.lineStrong,
  },
  sortOn: {
    backgroundColor: Colors.amber,
    borderColor: Colors.amber,
  },
  sortText: {
    fontFamily: Fonts.bodyBold,
    fontSize: 11,
    color: Colors.muted,
  },
  sortTextOn: {
    color: Colors.onEmber,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.twelve,
    backgroundColor: Colors.cardDark,
    borderWidth: 1,
    borderColor: Colors.line,
    borderRadius: 14,
    padding: Spacing.twelve,
  },
  rowEmoji: {
    width: 42,
    height: 42,
    borderRadius: 12,
    backgroundColor: Colors.selectedBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowEmojiText: {
    fontSize: 21,
  },
  rowText: {
    flex: 1,
  },
  rowNameLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  rowName: {
    flexShrink: 1,
    fontFamily: Fonts.bodyBold,
    fontSize: 13.5,
    color: Colors.ink,
  },
  rowSub: {
    fontFamily: Fonts.body,
    fontSize: 11,
    color: Colors.muted,
    marginTop: 2,
  },
  rowTags: {
    flexDirection: 'row',
    gap: Spacing.two,
    marginTop: 4,
  },
  suggested: {
    fontFamily: Fonts.bodyBold,
    fontSize: 10,
    color: Colors.sky,
  },
  liveTag: {
    fontFamily: Fonts.bodyBold,
    fontSize: 10,
    color: Colors.amber,
  },
  status: {
    fontFamily: Fonts.bodyBold,
    fontSize: 10.5,
    color: Colors.textTertiary,
  },
  loader: {
    marginTop: Spacing.five,
  },
  empty: {
    alignItems: 'center',
    paddingHorizontal: Spacing.four,
    marginTop: Spacing.five,
  },
  emptyEmoji: {
    fontSize: 30,
  },
  emptyTitle: {
    fontFamily: Fonts.bodyBold,
    fontSize: 14,
    color: Colors.ink,
    textAlign: 'center',
    marginTop: Spacing.two,
  },
  emptyBody: {
    fontFamily: Fonts.body,
    fontSize: 12.5,
    lineHeight: 18,
    color: Colors.textTertiary,
    textAlign: 'center',
    marginTop: 4,
  },
  emptyCta: {
    marginTop: Spacing.three,
    borderRadius: Radius.pill,
    paddingHorizontal: Spacing.three,
    paddingVertical: 9,
    backgroundColor: Colors.amber,
  },
  emptyCtaText: {
    fontFamily: Fonts.bodyBold,
    fontSize: 12.5,
    color: Colors.onEmber,
  },
  emptyGhost: {
    marginTop: Spacing.three,
    borderRadius: Radius.pill,
    paddingHorizontal: Spacing.three,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: Colors.lineStrong,
  },
  emptyGhostText: {
    fontFamily: Fonts.bodyBold,
    fontSize: 12.5,
    color: Colors.muted,
  },
});
