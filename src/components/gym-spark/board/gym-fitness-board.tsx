import { useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';

import { ExerciseLibrarySheet } from '@/components/fitness/exercise-library-sheet';
import { GYM_BOARD_ROW_HEIGHT, GymBoardRowView } from '@/components/gym-spark/board/gym-board-row';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { useMetricCatalog, useMetricLeaderboard } from '@/hooks/use-metric-leaderboard';
import { aggsForUnit, exerciseMetricKey } from '@/lib/api/stats';
import type { GymBoardRow } from '@/lib/api/gym-spark';
import { useAuth } from '@/lib/auth/auth-context';
import { aggLabel, exerciseValueUnit, formatMetricValue } from '@/lib/stats/format';
import type { ExerciseAgg, ExerciseUnit, MetricCatalogRow, MetricLeaderboardRow, MetricScope } from '@/types/house';

// THE BOARD's Fitness pill (GYM_SPARK): per-exercise sub-leaderboards, gated by exercise. You pick a
// lift and the board ranks people by it. No new SQL — it reads the existing exercise boards
// (get_metric_leaderboard with an `ex:<slug>:<agg>` metric, 0265; the same thing the Standings
// Fitness board and /fitness/exercise read).
//
// · The chips are the catalog's exercise metrics (metric_catalog rows whose metric starts `ex:` —
//   Bench / Squat / Deadlift today), in catalog order, plus "More…" for the exercise library. A lift
//   picked from the library joins the chips for the session. Until you pick, the first chip is on.
// · Scope is 'my_uni' — "the gym" is your school's gym — falling back to 'global' when your profile
//   has no university (scope_user_ids('my_uni') matches nothing then, not even you). The server also
//   gates every row on university_email_verified + can_see_rank, so an unverified viewer is never on
//   a lift board themselves; we say so above the list.
// · Exercise metrics are all-time only in the catalog, and the server's 'week' window is an ISO
//   (Monday) week, not the Board's Sunday reset — so the This week / All-time toggle is hidden here
//   and the caption says "· ALL-TIME".

export type BoardLift = { slug: string; name: string; unit: ExerciseUnit };

/** Used only when the catalog hasn't answered (or failed), so the pill never shows an empty gate. */
const FALLBACK_LIFTS: BoardLift[] = [
  { slug: 'bench_press', name: 'Bench', unit: 'weight' },
  { slug: 'squat', name: 'Squat', unit: 'weight' },
  { slug: 'deadlift', name: 'Deadlift', unit: 'weight' },
];

/** "ex:bench_press:e1rm" + "Bench PR" → { slug: bench_press, name: Bench }. */
export function popularLifts(catalog: MetricCatalogRow[]): BoardLift[] {
  const lifts = catalog
    .filter((r) => r.metric.startsWith('ex:'))
    .sort((a, b) => a.sort - b.sort)
    .map((r) => ({
      slug: r.metric.split(':')[1] ?? '',
      name: r.label.replace(/\s*PR$/i, '').trim() || r.label,
      unit: 'weight' as const,
    }))
    .filter((l) => l.slug.length > 0);
  return lifts.length > 0 ? lifts : FALLBACK_LIFTS;
}

/** The board's aggregation for a lift: est 1RM for anything weighed, else the unit's only one. */
function liftAgg(lift: BoardLift): ExerciseAgg {
  return aggsForUnit(lift.unit)[0];
}

/** "BENCH · EST 1RM · ALL-TIME" */
export function liftCaption(lift: BoardLift): string {
  const agg = liftAgg(lift);
  const what = agg === 'e1rm' ? 'EST 1RM' : aggLabel(agg, lift.unit).toUpperCase();
  return `${lift.name.toUpperCase()} · ${what} · ALL-TIME`;
}

/** The exercise chips + "More…", in the slot the window toggle holds on the XP boards. */
export function LiftChips({
  lifts,
  selected,
  onPick,
}: {
  lifts: BoardLift[];
  selected: BoardLift;
  onPick: (lift: BoardLift) => void;
}) {
  const [libraryOpen, setLibraryOpen] = useState(false);
  // A lift picked from the library that isn't a catalog chip still gets a chip, at the end.
  const chips = lifts.some((l) => l.slug === selected.slug) ? lifts : [...lifts, selected];

  return (
    <>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.chipScroller}
        contentContainerStyle={styles.chips}
        accessibilityRole="tablist">
        {chips.map((l) => {
          const on = l.slug === selected.slug;
          return (
            <Pressable
              key={l.slug}
              onPress={() => onPick(l)}
              style={[styles.chip, on && styles.chipOn]}
              accessibilityRole="tab"
              accessibilityState={{ selected: on }}>
              <Text style={[styles.chipText, on && styles.chipTextOn]} numberOfLines={1}>
                {l.name}
              </Text>
            </Pressable>
          );
        })}
        <Pressable
          onPress={() => setLibraryOpen(true)}
          style={styles.chip}
          accessibilityRole="button"
          accessibilityLabel="More exercises">
          <Text style={styles.chipText}>More…</Text>
        </Pressable>
      </ScrollView>
      <ExerciseLibrarySheet
        visible={libraryOpen}
        onClose={() => setLibraryOpen(false)}
        onPick={(ex) => {
          setLibraryOpen(false);
          onPick({ slug: ex.slug, name: ex.name, unit: ex.unit });
        }}
      />
    </>
  );
}

/** The catalog's lifts, for the screen (which owns the picked lift so it survives pill flips). */
export function useBoardLifts(): BoardLift[] {
  const { catalog } = useMetricCatalog();
  return popularLifts(catalog);
}

function toBoardRow(r: MetricLeaderboardRow): GymBoardRow {
  return {
    rank: r.rank ?? 0,
    user_id: r.user_id,
    display_name: r.display_name,
    handle: r.handle,
    avatar_url: r.avatar_url,
    // The lift rides in `xp` so GymBoardRowView's medal rule (non-zero value only) applies as-is.
    xp: r.value,
    week_streak: 0,
    is_me: r.is_me,
  };
}

/** One lift's ranked list. */
export function GymFitnessList({ lift, onPressRow }: { lift: BoardLift; onPressRow: (row: GymBoardRow) => void }) {
  const { profile } = useAuth();
  const scope: MetricScope = profile?.university?.trim() ? 'my_uni' : 'global';
  const agg = liftAgg(lift);
  const valueUnit = exerciseValueUnit(lift.unit, agg);

  const { rows, loading, error, refetch } = useMetricLeaderboard({
    metric: exerciseMetricKey(lift.slug, agg),
    scope,
    window: 'all',
    limit: null,
  });

  // The hook reads on mount/change; this re-reads on later focuses (a set logged elsewhere), skipping
  // the first so a pill flip doesn't fetch twice.
  // Those background reads (and pull-to-refresh) keep the current rows up; the first read shows a
  // spinner. The screen keys this component by lift, so a lift change starts over.
  const [quiet, setQuiet] = useState(false);
  const focusedOnce = useRef(false);
  useFocusEffect(
    useCallback(() => {
      if (focusedOnce.current) {
        setQuiet(true);
        void refetch().finally(() => setQuiet(false));
      }
      focusedOnce.current = true;
    }, [refetch])
  );

  const [refreshing, setRefreshing] = useState(false);
  const refresh = async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  };
  const shown = loading && !refreshing && !quiet ? [] : rows.filter((r) => r.rank !== null);

  const formatValue = (v: number): { text: string; unit: string; a11y: string } => {
    if (valueUnit === 'lb') {
      const n = Math.round(v).toLocaleString('en-US');
      return { text: n, unit: ' lb', a11y: `${n} pounds` };
    }
    if (valueUnit === 'count') {
      const n = Math.round(v).toLocaleString('en-US');
      return { text: n, unit: ' reps', a11y: `${n} reps` };
    }
    const t = formatMetricValue(valueUnit, v);
    return { text: t, unit: '', a11y: t };
  };
  const subline = agg === 'e1rm' ? 'est 1RM' : aggLabel(agg, lift.unit);

  const unverified = profile ? !profile.university_email_verified : false;

  return (
    <FlatList
      data={shown}
      keyExtractor={(r) => r.user_id}
      renderItem={({ item }) => (
        <GymBoardRowView
          row={toBoardRow(item)}
          onPress={onPressRow}
          value={formatValue(item.value)}
          subline={item.verified ? `${subline} · ✓ clip on file` : subline}
        />
      )}
      getItemLayout={(_, index) => ({ length: GYM_BOARD_ROW_HEIGHT, offset: GYM_BOARD_ROW_HEIGHT * index, index })}
      contentContainerStyle={styles.listContent}
      showsVerticalScrollIndicator={false}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} tintColor={Colors.navEmber} />
      }
      ListHeaderComponent={
        unverified ? (
          <Text style={styles.note}>Verify your school email in Edit profile to show up on lift boards.</Text>
        ) : null
      }
      ListEmptyComponent={
        loading ? (
          <View style={styles.state}>
            <ActivityIndicator color={Colors.navEmber} />
          </View>
        ) : error ? (
          <View style={styles.state}>
            <Text style={styles.stateBody}>Couldn&apos;t load this board.</Text>
            <Pressable onPress={() => void refetch()} hitSlop={8} accessibilityRole="button">
              <Text style={styles.retry}>Try again</Text>
            </Pressable>
          </View>
        ) : (
          <View style={styles.state}>
            <Text style={styles.stateTitle}>Nobody on the {lift.name} board yet</Text>
            <Text style={styles.stateBody}>Log a set and you open it.</Text>
          </View>
        )
      }
    />
  );
}

const styles = StyleSheet.create({
  // A horizontal ScrollView in a column would otherwise take a share of the leftover height.
  chipScroller: {
    flexGrow: 0,
  },
  chips: {
    gap: 8,
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.one,
  },
  chip: {
    paddingHorizontal: 18,
    paddingVertical: 9,
    borderRadius: Radius.pill,
    backgroundColor: Colors.spacePanel,
    borderWidth: 1,
    borderColor: Colors.spaceLine,
  },
  chipOn: {
    backgroundColor: Colors.navEmber2,
    borderColor: Colors.navEmber2,
  },
  chipText: {
    fontFamily: Fonts.bodyBold,
    fontSize: 14,
    color: Colors.ink,
  },
  chipTextOn: {
    color: Colors.onEmber,
  },
  listContent: {
    paddingHorizontal: Spacing.three,
    paddingBottom: Spacing.three,
    flexGrow: 1,
  },
  note: {
    fontFamily: Fonts.body,
    fontSize: 13,
    color: Colors.spaceDim,
    paddingBottom: Spacing.two,
  },
  state: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: Spacing.six,
    gap: Spacing.two,
  },
  stateTitle: {
    fontFamily: Fonts.bodyBold,
    fontSize: 17,
    color: Colors.ink,
    textAlign: 'center',
  },
  stateBody: {
    fontFamily: Fonts.body,
    fontSize: 14,
    color: Colors.spaceDim,
    textAlign: 'center',
  },
  retry: {
    fontFamily: Fonts.bodyBold,
    fontSize: 14,
    color: Colors.navEmber2,
  },
});
