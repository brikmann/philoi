import { useCallback, useEffect, useRef, type ReactElement } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';

import { SpaceEmpty, SPACE_GUTTER } from '@/components/ui/space-kit';
import { Colors, Fonts, Spacing } from '@/constants/theme';
import type { MetricLeaderboardRow } from '@/types/house';

// THE ONE BOARD LAYOUT. The Leaderboard tab's XP board, its Fitness board and an exercise board all
// draw through this, so flipping XP | Fitness changes the numbers and nothing else: same gutter, same
// row gap, same empty and loading states. Each board renders its own row (BoardRow or the fitness row).
//
// No pinned "you" bar (mock 329): the list opens on YOUR window instead — your row centred with
// ~4 either side, highlighted inline. Near the top it clamps to #1, near the bottom to the last row,
// so there's never a blank gap. Scroll freely from there; "Jumped to your spot" above the list
// brings you back. The board is fetched whole, so the window is just a scroll position.

/** Rows either side of yours where the window clamps to an end of the board. */
const WINDOW_EDGE = 4;

export function LeaderboardList({
  rows,
  data,
  loading,
  error,
  onRefresh,
  renderRow,
  header,
  footer,
  emptyTitle,
  emptyBody,
  boardKey,
}: {
  /** The whole board — where "you" is looked up, even when `data` is filtered (Live only). */
  rows: MetricLeaderboardRow[];
  /** What the list shows; defaults to `rows`. */
  data?: MetricLeaderboardRow[];
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
  renderRow: (row: MetricLeaderboardRow) => ReactElement;
  header?: ReactElement | null;
  footer?: ReactElement | null;
  emptyTitle: string;
  emptyBody: string;
  /** Changes when the board does (metric, scope, season) — the list re-centres on you each time. */
  boardKey?: string;
}) {
  const shown = data ?? rows;
  const me = rows.find((r) => r.is_me);
  const meIndex = shown.findIndex((r) => r.is_me);
  const total = rows.filter((r) => r.rank != null).length;

  const listRef = useRef<FlatList<MetricLeaderboardRow>>(null);
  const retries = useRef(0);

  const centreOnMe = useCallback(
    (animated: boolean) => {
      const list = listRef.current;
      if (!list || meIndex < 0) return;
      retries.current = 0;
      if (meIndex <= WINDOW_EDGE) list.scrollToOffset({ offset: 0, animated });
      else if (meIndex >= shown.length - 1 - WINDOW_EDGE) list.scrollToEnd({ animated });
      else list.scrollToIndex({ index: meIndex, viewPosition: 0.5, animated });
    },
    [meIndex, shown.length],
  );

  // Once per board: when it lands with you on it, open on your window. A pull-to-refresh keeps the
  // same key, so it never yanks you off wherever you'd scrolled to. The key flips a render BEFORE the
  // hook starts its fetch, so the rows on screen at that moment are the old board's — wait for new ones.
  const key = boardKey ?? '';
  const lastKey = useRef<string | null>(null);
  const staleRows = useRef<MetricLeaderboardRow[] | null>(null);
  useEffect(() => {
    if (lastKey.current !== key) {
      lastKey.current = key;
      staleRows.current = rows;
    }
    if (staleRows.current === null || rows === staleRows.current || loading || meIndex < 0) return;
    // A frame for the new data to lay out before scrolling into it.
    const id = requestAnimationFrame(() => {
      staleRows.current = null;
      centreOnMe(false);
    });
    return () => cancelAnimationFrame(id);
  }, [key, rows, loading, meIndex, centreOnMe]);

  return (
    <View style={styles.wrap}>
      {me && meIndex >= 0 ? (
        <Pressable
          style={styles.jump}
          onPress={() => centreOnMe(true)}
          accessibilityRole="button"
          accessibilityLabel={me.rank == null ? 'Jump to your spot, not ranked yet' : `Jump to your spot, number ${me.rank} of ${total}`}>
          <Text style={styles.jumpText}>
            ↕ Jumped to your spot ·{' '}
            <Text style={styles.jumpRank}>
              {me.rank == null ? 'not ranked yet' : `#${me.rank.toLocaleString()} of ${total.toLocaleString()}`}
            </Text>
          </Text>
        </Pressable>
      ) : null}
      <FlatList
        ref={listRef}
        data={shown}
        keyExtractor={(r) => r.user_id}
        contentContainerStyle={styles.listContent}
        refreshControl={<RefreshControl refreshing={loading && rows.length > 0} onRefresh={onRefresh} tintColor={Colors.navEmber} />}
        ListHeaderComponent={header}
        renderItem={({ item }) => renderRow(item)}
        ItemSeparatorComponent={Separator}
        ListFooterComponent={shown.length > 0 ? footer : null}
        // Rows aren't fixed-height, so a far rank isn't measured yet: jump to its estimated offset
        // (which renders that stretch), then centre on the real row.
        onScrollToIndexFailed={({ index, averageItemLength }) => {
          listRef.current?.scrollToOffset({ offset: averageItemLength * index, animated: false });
          if (retries.current++ >= 3) return;
          setTimeout(() => listRef.current?.scrollToIndex({ index, viewPosition: 0.5, animated: false }), 60);
        }}
        ListEmptyComponent={
          loading ? (
            <ActivityIndicator color={Colors.navEmber} style={styles.loader} />
          ) : error ? (
            <SpaceEmpty title="Couldn't load this board" body={error} />
          ) : (
            <SpaceEmpty title={emptyTitle} body={emptyBody} />
          )
        }
      />
    </View>
  );
}

function Separator() {
  return <View style={styles.separator} />;
}

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
  },
  listContent: {
    paddingHorizontal: SPACE_GUTTER,
    paddingBottom: Spacing.four,
  },
  separator: {
    height: 6,
  },
  loader: {
    marginTop: Spacing.five,
  },
  jump: {
    marginHorizontal: SPACE_GUTTER,
    marginBottom: Spacing.two,
    paddingVertical: 7,
    paddingHorizontal: 10,
    borderRadius: 9,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: 'rgba(255,176,90,0.35)',
    backgroundColor: 'rgba(255,122,47,0.08)',
  },
  jumpText: {
    fontFamily: Fonts.bodyBold,
    fontSize: 11.5,
    color: Colors.navEmber2,
  },
  jumpRank: {
    color: Colors.ink,
  },
});
