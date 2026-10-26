import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { FitnessBoard } from '@/components/fitness/fitness-board';
import { FITNESS_SCOPES, FitnessScopePills } from '@/components/fitness/fitness-scope-pills';
import { MetricPickerSheet } from '@/components/fitness/metric-picker-sheet';
import { PrDisputeSheet } from '@/components/fitness/pr-dispute-sheet';
import { Screen } from '@/components/ui/screen';
import { SpaceButton, SpaceEmpty, SpaceHeader, SPACE_GUTTER } from '@/components/ui/space-kit';
import { UiGlyph } from '@/components/ui/ui-glyph';
import { Colors, Fonts, Spacing } from '@/constants/theme';
import { useMetricCatalog, useMetricLeaderboard } from '@/hooks/use-metric-leaderboard';
import { useAuth } from '@/lib/auth/auth-context';
import { fetchMyProgram } from '@/lib/api/house';
import { rankVisibilityOf } from '@/lib/api/privacy';
import { formatMetricValue } from '@/lib/stats/format';
import type { MetricCatalogRow, MetricLeaderboardRow, MetricScope, MyProgramRow } from '@/types/house';

// THE FITNESS BOARD (mock 289) — a separate board from XP, ranked purely on real fitness: run km
// from Strava, logged gym time, a lift PR (set + clip), volume, streak, sessions. Pick a metric and a
// scope; it re-ranks live. "My program" is the house: every Heir of your program across both schools.
//
// Same privacy dial as the Leaderboard tab (0217): `private` has no board at all, `friends` only
// ever has the Friends board. The server enforces both independently (can_see_rank); this just
// avoids drawing three labels over the same comparison.

/** The mock's opening board. Falls back to the first fitness stat if the key is ever renamed. */
const DEFAULT_METRIC_KEY = 'run_distance_30d';

function windowCaption(row: MetricCatalogRow): string | undefined {
  if (row.metric.startsWith('ex:')) return 'est 1RM';
  if (row.metric_window === '30d') return 'last 30 days';
  if (row.metric_window === 'week') return 'this week';
  return undefined;
}

export default function FitnessBoardScreen() {
  const router = useRouter();
  const { session, profile } = useAuth();
  const { scope: linkedScope } = useLocalSearchParams<{ scope?: string }>();

  const dial = rankVisibilityOf(profile);
  const [pickedScope, setScope] = useState<MetricScope>(
    linkedScope && (FITNESS_SCOPES as string[]).includes(linkedScope) ? (linkedScope as MetricScope) : 'global'
  );
  const scope: MetricScope = dial === 'friends' ? 'friends' : pickedScope;
  const scopes: MetricScope[] = dial === 'friends' ? ['friends'] : FITNESS_SCOPES;

  const { catalog, error: catalogError, refetch: refetchCatalog } = useMetricCatalog();
  const [pickedKey, setPickedKey] = useState<string | null>(null);
  const fitnessStats = catalog.filter((r) => r.fitness);
  const stat =
    fitnessStats.find((r) => r.key === pickedKey) ??
    fitnessStats.find((r) => r.key === DEFAULT_METRIC_KEY) ??
    fitnessStats[0] ??
    null;

  const [program, setProgram] = useState<MyProgramRow | null>(null);
  const [programLoaded, setProgramLoaded] = useState(false);
  useEffect(() => {
    fetchMyProgram()
      .then(setProgram)
      .catch(() => setProgram(null))
      .finally(() => setProgramLoaded(true));
  }, []);

  const university = profile?.university ?? '';
  const campusVerified = profile?.university_email_verified ?? false;
  // A scope that can't have a board for this viewer holds the fetch and explains itself instead.
  const gate: 'none' | 'no_school' | 'unverified' | 'no_program' =
    scope === 'my_uni' && !university
      ? 'no_school'
      : scope === 'my_uni' && !campusVerified
        ? 'unverified'
        : scope === 'my_program' && programLoaded && !program
          ? 'no_program'
          : 'none';
  const held = gate !== 'none' || (scope === 'my_program' && !programLoaded);

  const { rows, loading, error, refetch } = useMetricLeaderboard({
    metric: held || dial === 'private' ? null : (stat?.metric ?? null),
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

  if (dial === 'private') {
    return (
      <Screen padded={false}>
        <SpaceHeader title="Fitness" />
        <SpaceEmpty
          title="Your rank is private"
          body="Private climbers aren't on any board, so there's nothing to rank you against. Change it in Settings whenever you want in."
          action={<SpaceButton label="Open Settings" onPress={() => router.push('/settings')} style={styles.emptyAction} />}
        />
      </Screen>
    );
  }

  return (
    <Screen padded={false}>
      <SpaceHeader title="Fitness" subtitle="Ranked purely on real fitness" />
      <View style={styles.header}>
        <FitnessScopePills scopes={scopes} value={scope} onChange={setScope} />
        <Pressable style={styles.metricChip} onPress={() => setPickerOpen(true)} accessibilityRole="button" accessibilityLabel="Change metric">
          <Text style={styles.metricLabel} numberOfLines={1}>
            {stat ? `${stat.emoji} ${stat.label}` : catalogError ? 'Stats unavailable' : 'Loading stats…'}
          </Text>
          <UiGlyph name="down" size={14} color={Colors.spaceDim} />
        </Pressable>
        {scope === 'my_program' && program ? (
          <Text style={styles.house}>
            {program.name} · Heirs of {program.patron_name}
          </Text>
        ) : null}
      </View>

      {gate === 'no_school' ? (
        <SpaceEmpty title="Add your school" body="Set your school in Profile to see how you stack up at your university." />
      ) : gate === 'unverified' ? (
        <SpaceEmpty
          title="Verify to unlock"
          body="Only students with a verified school email count on My uni — that's what keeps the campus rankings real."
          action={<SpaceButton label="Verify my campus" onPress={() => router.push('/campus')} style={styles.emptyAction} />}
        />
      ) : gate === 'no_program' ? (
        <SpaceEmpty
          title="Pick your program"
          body="Your program names your house. Pick it and this board ranks you against every Heir of it, at both schools."
          action={<SpaceButton label="Pick my program" onPress={() => router.push('/house/change-program?ceremony=1')} style={styles.emptyAction} />}
        />
      ) : (
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
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: {
    gap: Spacing.two,
    paddingHorizontal: SPACE_GUTTER,
    paddingBottom: Spacing.twelve,
  },
  // The Leaderboard tab's metric picker, so the two boards read as one family.
  metricChip: {
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
  emptyAction: {
    marginTop: Spacing.two,
    alignSelf: 'stretch',
  },
  house: {
    fontFamily: Fonts.bodyBold,
    fontSize: 12,
    color: Colors.gold,
    letterSpacing: 0.4,
  },
  footer: {
    fontFamily: Fonts.body,
    fontSize: 11,
    color: Colors.spaceFaint,
    textAlign: 'center',
    marginTop: Spacing.three,
  },
});
