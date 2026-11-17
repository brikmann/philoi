import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { GymPostCard } from '@/components/gym-spark/gym-post-card';
import { GymTopBar } from '@/components/gym-spark/gym-top-bar';
import { PrStoryButton } from '@/components/gym-spark/share/pr-story-button';
import { useGymPostModeration } from '@/components/gym-spark/use-gym-post-moderation';
import { Colors, Fonts, Spacing } from '@/constants/theme';
import { fetchGymFeed, type GymFeedFilter, type GymFeedItem } from '@/lib/api/gym-spark';

// THE GYM SPARK · the Feed, which is home (mock 400). The global GymTopBar (✈ 🔔 ☰, v2 §6), two chips
// (Feed · Following — v2 §4 dropped PRs) over get_gym_feed, newest first, posting is the ＋ in the global top bar (GymTopBar).
// Comment-only — no cheer anywhere. The chips are two equal full-width pills; a running session lives in
// the docked live lock-in bar, not here.
//
// Refreshes on focus, so a post you just made (compose → detail → back) and a comment you just left
// (its 💬 count and the top-comment line) are both there when you land back here. The refetch asks
// for as many rows as are already on screen (capped), so a focus refresh doesn't chop a long scroll.

const PAGE = 20;
const FOCUS_CAP = 60;

// 'prs' stays a valid GymFeedFilter (the server still serves it) but has no chip since v2 §4.
const FILTERS: { key: GymFeedFilter; label: string }[] = [
  { key: 'gym', label: 'Feed' },
  { key: 'following', label: 'Following' },
];

const EMPTY: Record<GymFeedFilter, string> = {
  gym: 'Nothing posted yet. Be the first — tap + and post something.',
  following: 'Nobody you follow has posted yet.',
  prs: 'No PRs yet.',
};

export function GymFeedScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ lockin?: string }>();
  const [filter, setFilter] = useState<GymFeedFilter>('gym');
  const [items, setItems] = useState<GymFeedItem[] | null>(null);
  const [error, setError] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  // Plain refs, read only inside callbacks: whether the last page came back short, how many rows are
  // on screen (for the focus refetch size), and a token so a slow response for an old chip is dropped.
  const done = useRef(false);
  const shown = useRef(0);
  const token = useRef(0);

  // A friend's "lock in?" nudge deep-links /?lockin=1 (installed builds and 0207 write that route).
  // The legacy home forwards it to the Lock In tab; so does this one.
  useEffect(() => {
    if (params.lockin === '1') {
      router.setParams({ lockin: undefined });
      router.navigate('/lockin');
    }
  }, [params.lockin, router]);

  const load = useCallback(async () => {
    const mine = ++token.current;
    const limit = Math.min(Math.max(shown.current, PAGE), FOCUS_CAP);
    try {
      const rows = await fetchGymFeed(filter, null, limit);
      if (mine !== token.current) return;
      done.current = rows.length < limit;
      shown.current = rows.length;
      setError(false);
      setItems(rows);
    } catch {
      if (mine !== token.current) return;
      setError(true);
      setItems((prev) => prev ?? []);
    }
  }, [filter]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  function pickFilter(next: GymFeedFilter) {
    if (next === filter) return;
    shown.current = 0;
    done.current = false;
    setItems(null);
    setError(false);
    setFilter(next);
  }

  async function refresh() {
    setRefreshing(true);
    shown.current = 0;
    await load();
    setRefreshing(false);
  }

  async function loadMore() {
    if (!items?.length || done.current || loadingMore || error) return;
    const mine = token.current;
    setLoadingMore(true);
    try {
      const last = items[items.length - 1];
      const more = await fetchGymFeed(filter, { created_at: last.created_at, id: last.id }, PAGE);
      if (mine !== token.current) return;
      if (more.length < PAGE) done.current = true;
      setItems((prev) => {
        const list = prev ?? [];
        const seen = new Set(list.map((p) => `${p.item_type}:${p.id}`));
        const next = [...list, ...more.filter((m) => !seen.has(`${m.item_type}:${m.id}`))];
        shown.current = next.length;
        return next;
      });
    } catch {
      // A failed page is retried by the next scroll-to-bottom.
    } finally {
      setLoadingMore(false);
    }
  }

  const moderation = useGymPostModeration((gone, reason) => {
    setItems((prev) =>
      (prev ?? []).filter((i) =>
        reason === 'blocked' ? i.user_id !== gone.user_id : !(i.id === gone.id && i.item_type === gone.item_type)
      )
    );
  });
  const openMore = moderation.open;

  return (
    <SafeAreaView edges={['top']} style={styles.safe}>
      <GymTopBar />

      <View style={styles.chipRow}>
      <View style={styles.chips} accessibilityRole="tablist">
        {FILTERS.map((f) => {
          const on = f.key === filter;
          return (
            <Pressable
              key={f.key}
              onPress={() => pickFilter(f.key)}
              style={[styles.chip, on && styles.chipOn]}
              accessibilityRole="tab"
              accessibilityState={{ selected: on }}>
              <Text style={[styles.chipText, on && styles.chipTextOn]}>{f.label}</Text>
            </Pressable>
          );
        })}
      </View>
      </View>

      {items === null ? (
        <ActivityIndicator color={Colors.navEmber} style={styles.loader} />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(i) => `${i.item_type}:${i.id}`}
          renderItem={({ item }) => (
            // The card draws prAccessory only on PR posts; the button itself only shows on your own.
            <GymPostCard
              item={item}
              variant="feed"
              onMore={openMore}
              prAccessory={item.is_pr ? <PrStoryButton item={item} /> : null}
            />
          )}
          contentContainerStyle={styles.list}
          ItemSeparatorComponent={Separator}
          onEndReached={() => void loadMore()}
          onEndReachedThreshold={0.6}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} tintColor={Colors.navEmber} />
          }
          ListEmptyComponent={
            <Text style={styles.empty}>
              {error ? 'Couldn’t load the feed. Pull down to try again.' : EMPTY[filter]}
            </Text>
          }
          ListFooterComponent={loadingMore ? <ActivityIndicator color={Colors.navEmber} style={styles.more} /> : null}
        />
      )}

      {moderation.sheets}
    </SafeAreaView>
  );
}

function Separator() {
  return <View style={styles.sep} />;
}


const styles = StyleSheet.create({
  safe: {
    flex: 1,
  },
  chipRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingBottom: Spacing.twelve,
  },
  chips: {
    flex: 1,
    flexDirection: 'row',
    gap: Spacing.two,
  },
  chip: {
    flex: 1,
    alignItems: 'center',
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: Colors.spacePanel,
    borderWidth: 1,
    borderColor: Colors.spaceLine,
  },
  chipOn: {
    backgroundColor: Colors.navEmber2,
    borderColor: Colors.navEmber,
  },
  chipText: {
    fontFamily: Fonts.bodyBold,
    fontSize: 14.5,
    color: Colors.ink,
  },
  chipTextOn: {
    color: '#1A1030',
  },
  loader: {
    marginTop: Spacing.six,
  },
  list: {
    paddingHorizontal: Spacing.three,
    paddingBottom: Spacing.six,
    flexGrow: 1,
  },
  sep: {
    height: Spacing.three,
  },
  empty: {
    marginTop: Spacing.six,
    paddingHorizontal: Spacing.five,
    textAlign: 'center',
    fontFamily: Fonts.body,
    fontSize: 13.5,
    lineHeight: 20,
    color: Colors.spaceDim,
  },
  more: {
    marginVertical: Spacing.four,
  },
});
