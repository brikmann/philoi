import type { ReactElement, ReactNode } from 'react';
import { ActivityIndicator, FlatList, RefreshControl, StyleSheet, Text, View } from 'react-native';

import { SpaceEmpty, SPACE_GUTTER } from '@/components/ui/space-kit';
import { Colors, Fonts, Spacing } from '@/constants/theme';
import { shortName } from '@/lib/format';
import type { MetricLeaderboardRow } from '@/types/house';

// THE ONE BOARD LAYOUT. The Leaderboard tab's XP board, its Fitness board and an exercise board all
// draw through this, so flipping XP | Fitness changes the numbers and nothing else: same gutter, same
// row gap, same empty and loading states, and the same pinned "you" bar under the list — your row,
// wherever you sit on the board, and the gap to the top. Each board renders its own row (BoardRow
// or the fitness row) and may supply what the pinned bar shows when you aren't on the board.

/** "14 km behind Aisha." / "You're #1 — 9 km ahead of Jordan." — null when you aren't ranked. */
export function standingLine(rows: MetricLeaderboardRow[], formatValue: (v: number) => string): string | null {
  const me = rows.find((r) => r.is_me);
  if (!me || me.rank == null) return null;
  const top = rows[0];
  if (me.rank === 1) {
    const second = rows.find((r) => r.rank === 2);
    if (!second) return "You're #1.";
    const lead = me.value - second.value;
    return lead > 0
      ? `You're #1 — ${formatValue(lead)} ahead of ${shortName(second.display_name)}.`
      : `You're #1, level with ${shortName(second.display_name)}.`;
  }
  const gap = top.value - me.value;
  return gap > 0
    ? `You're #${me.rank} · ${formatValue(gap)} behind ${shortName(top.display_name)}.`
    : `You're #${me.rank} · level with ${shortName(top.display_name)} for #1.`;
}

export function LeaderboardList({
  rows,
  data,
  loading,
  error,
  onRefresh,
  formatValue,
  renderRow,
  header,
  footer,
  emptyTitle,
  emptyBody,
  pinnedFallback,
}: {
  /** The whole board — where "you" is looked up, even when `data` is filtered (Live only). */
  rows: MetricLeaderboardRow[];
  /** What the list shows; defaults to `rows`. */
  data?: MetricLeaderboardRow[];
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
  /** Formats a value AND a gap ("14 km behind") — so it must take any number, not just a row's. */
  formatValue: (value: number) => string;
  renderRow: (row: MetricLeaderboardRow) => ReactElement;
  header?: ReactElement | null;
  footer?: ReactElement | null;
  emptyTitle: string;
  emptyBody: string;
  /** The pinned bar when you aren't on the board. Omitted = "You're not on this board yet." */
  pinnedFallback?: ReactNode;
}) {
  const me = rows.find((r) => r.is_me);
  const standing = standingLine(rows, formatValue);
  const shown = data ?? rows;

  return (
    <View style={styles.wrap}>
      <FlatList
        data={shown}
        keyExtractor={(r) => r.user_id}
        contentContainerStyle={styles.listContent}
        refreshControl={<RefreshControl refreshing={loading && rows.length > 0} onRefresh={onRefresh} tintColor={Colors.navEmber} />}
        ListHeaderComponent={header}
        renderItem={({ item }) => renderRow(item)}
        ItemSeparatorComponent={Separator}
        ListFooterComponent={shown.length > 0 ? footer : null}
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
      {/* Pinned: you, wherever you are on the board, and the gap to the top. */}
      {me ? (
        <View style={styles.pinned}>
          {renderRow(me)}
          {standing ? <Text style={styles.standing}>{standing}</Text> : null}
        </View>
      ) : loading ? null : pinnedFallback !== undefined ? (
        pinnedFallback ? <View style={styles.pinned}>{pinnedFallback}</View> : null
      ) : rows.length > 0 ? (
        <View style={styles.pinned}>
          <Text style={styles.standing}>You&apos;re not on this board yet.</Text>
        </View>
      ) : null}
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
  pinned: {
    paddingHorizontal: SPACE_GUTTER,
    paddingTop: Spacing.two,
    paddingBottom: Spacing.three,
    borderTopWidth: 1,
    borderTopColor: Colors.spaceLine,
    backgroundColor: Colors.spaceBg,
    gap: Spacing.one,
  },
  standing: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 12,
    color: Colors.navEmber2,
    textAlign: 'center',
  },
});
