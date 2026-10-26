import { useRouter } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { FitnessBoard } from '@/components/fitness/fitness-board';
import { MetricPickerSheet } from '@/components/fitness/metric-picker-sheet';
import { PrDisputeSheet } from '@/components/fitness/pr-dispute-sheet';
import { UiGlyph } from '@/components/ui/ui-glyph';
import { Colors, Fonts, Spacing } from '@/constants/theme';
import { useMetricCatalog, useMetricLeaderboard } from '@/hooks/use-metric-leaderboard';
import { useAuth } from '@/lib/auth/auth-context';
import { formatMetricValue } from '@/lib/stats/format';
import type { MetricCatalogRow, MetricLeaderboardRow, MetricScope, MyProgramRow } from '@/types/house';

// THE FITNESS BOARD (mock 289), as the Leaderboard tab's second board rather than its own screen —
// the tab's XP | Fitness toggle swaps this in under the SAME scope row, so switching boards keeps
// your scope. Ranked purely on real fitness: run km from Strava, logged gym time, a lift PR (set +
// clip), volume, streak, sessions. Pick a metric; it re-ranks live.
//
// The tab owns the scope, the program fetch, the privacy dial and the scope gates (they're the same
// for both boards); this owns only what's fitness-specific: the fitness-only metric, its picker with
// the exercise drill-down, the PR dispute sheet and Versus from a row.

/** The mock's opening board. Falls back to the first fitness stat if the key is ever renamed. */
const DEFAULT_METRIC_KEY = 'run_distance_30d';

function windowCaption(row: MetricCatalogRow): string | undefined {
  if (row.metric.startsWith('ex:')) return 'est 1RM';
  if (row.metric_window === '30d') return 'last 30 days';
  if (row.metric_window === 'week') return 'this week';
  return undefined;
}

export function FitnessBoardPanel({
  scope,
  held,
  notice,
  program,
  actions,
}: {
  scope: MetricScope;
  /** The tab's gate is up (or the program is still loading) — hold the fetch. */
  held: boolean;
  /** Shown in the board's place while held — the tab's scope-gate explainer. */
  notice?: ReactNode;
  program: MyProgramRow | null;
  /** Trailing buttons for the tools row (the tab's Challenges link). */
  actions?: ReactNode;
}) {
  const router = useRouter();
  const { session } = useAuth();

  const { catalog, error: catalogError, refetch: refetchCatalog } = useMetricCatalog();
  const [pickedKey, setPickedKey] = useState<string | null>(null);
  const fitnessStats = catalog.filter((r) => r.fitness);
  const stat =
    fitnessStats.find((r) => r.key === pickedKey) ??
    fitnessStats.find((r) => r.key === DEFAULT_METRIC_KEY) ??
    fitnessStats[0] ??
    null;

  const { rows, loading, error, refetch } = useMetricLeaderboard({
    metric: held ? null : (stat?.metric ?? null),
    scope,
    window: stat?.metric_window ?? 'all',
    limit: null,
  });

  const [pickerOpen, setPickerOpen] = useState(false);
  const [disputeRow, setDisputeRow] = useState<MetricLeaderboardRow | null>(null);

  function goToProfile(userId: string) {
    if (userId === session?.user.id) router.push('/profile');
    else router.push({ pathname: '/friend-profile', params: { userId } });
  }

  const formatValue = (v: number) => (stat ? formatMetricValue(stat.unit, v) : String(v));

  return (
    <View style={styles.panel}>
      <View style={styles.tools}>
        <Pressable style={styles.metricChip} onPress={() => setPickerOpen(true)} accessibilityRole="button" accessibilityLabel="Change metric">
          <Text style={styles.metricLabel} numberOfLines={1}>
            {stat ? `${stat.emoji} ${stat.label}` : catalogError ? 'Stats unavailable' : 'Loading stats…'}
          </Text>
          <UiGlyph name="down" size={14} color={Colors.spaceDim} />
        </Pressable>
        {actions}
      </View>
      {scope === 'my_program' && program ? (
        <Text style={styles.house}>
          {program.name} · Heirs of {program.patron_name}
        </Text>
      ) : null}

      {held ? (notice ?? null) : (
        <FitnessBoard
          rows={rows}
          loading={loading}
          error={error ?? (stat ? null : catalogError)}
          onRefresh={() => {
            if (!stat) refetchCatalog();
            refetch();
          }}
          formatValue={formatValue}
          valueCaption={stat ? windowCaption(stat) : undefined}
          onPressRow={(r) => goToProfile(r.user_id)}
          onPressVerification={stat?.metric.startsWith('ex:') ? setDisputeRow : undefined}
          onVersus={(r) => router.push({ pathname: '/versus', params: { with: r.user_id } })}
          footer={<Text style={styles.footer}>A separate board from XP — ranked purely on real fitness.</Text>}
          emptyTitle="Nobody on this board yet"
          emptyBody={
            scope === 'friends'
              ? 'None of your friends have logged this yet. Be the first.'
              : scope === 'my_program'
                ? 'Houses are brand new — this board fills up as more Heirs pick their program. Log it and you open it.'
                : 'Log it — a run from Strava, a gym session, a set — and you open the board.'
          }
        />
      )}

      <MetricPickerSheet
        visible={pickerOpen}
        catalog={catalog}
        selectedKey={stat?.key ?? null}
        onPick={(r) => setPickedKey(r.key)}
        onPickExercise={(ex) => {
          setPickerOpen(false);
          router.push({
            pathname: '/fitness/exercise',
            params: { slug: ex.slug, name: ex.name, unit: ex.unit, muscle: ex.muscleGroup ?? '' },
          });
        }}
        onClose={() => setPickerOpen(false)}
      />
      <PrDisputeSheet
        row={disputeRow}
        value={disputeRow ? formatValue(disputeRow.value) : ''}
        onClose={() => setDisputeRow(null)}
        onPulled={refetch}
        onViewProfile={goToProfile}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    flex: 1,
  },
  // Same row as the XP board's tools, so flipping the toggle doesn't move anything above the list.
  tools: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    marginHorizontal: Spacing.three,
    marginTop: Spacing.two,
    marginBottom: Spacing.two,
  },
  metricChip: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
    paddingVertical: 9,
    paddingHorizontal: 12,
    borderRadius: 11,
    backgroundColor: Colors.spacePanel,
    borderWidth: 1,
    borderColor: Colors.spaceLine,
  },
  metricLabel: {
    flexShrink: 1,
    fontFamily: Fonts.bodyBold,
    fontSize: 13,
    color: Colors.ink,
  },
  house: {
    fontFamily: Fonts.bodyBold,
    fontSize: 12,
    color: Colors.gold,
    letterSpacing: 0.4,
    marginHorizontal: Spacing.three,
    marginBottom: Spacing.two,
  },
  footer: {
    fontFamily: Fonts.body,
    fontSize: 11,
    color: Colors.spaceFaint,
    textAlign: 'center',
    marginTop: Spacing.three,
  },
});
