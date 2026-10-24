import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { ExerciseLibrarySheet, muscleLabel } from '@/components/fitness/exercise-library-sheet';
import { FitnessBoard } from '@/components/fitness/fitness-board';
import { FITNESS_SCOPES, FitnessScopePills } from '@/components/fitness/fitness-scope-pills';
import { PrDisputeSheet } from '@/components/fitness/pr-dispute-sheet';
import { BackHeader } from '@/components/ui/back-header';
import { EmptyState } from '@/components/ui/empty-state';
import { PrimaryButton } from '@/components/ui/primary-button';
import { Screen } from '@/components/ui/screen';
import { Toggle } from '@/components/ui/toggle';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { useMetricLeaderboard } from '@/hooks/use-metric-leaderboard';
import { useAuth } from '@/lib/auth/auth-context';
import { fetchMyProgram } from '@/lib/api/house';
import { rankVisibilityOf } from '@/lib/api/privacy';
import { aggsForUnit, exerciseMetricKey } from '@/lib/api/stats';
import { aggLabel, exerciseValueUnit, formatMetricValue } from '@/lib/stats/format';
import type { ExerciseAgg, ExerciseUnit, MetricLeaderboardRow, MetricScope, MyProgramRow } from '@/types/house';

// ONE EXERCISE'S BOARD (mocks 294/295) — any movement, `?slug=&name=&unit=`. An aggregation toggle
// that fits the exercise's unit, the Fitness board's scopes, and a "Verified only" filter.
//
// Clips are REVIEW-ONLY. A row says "✓ clip on file" or "no clip · unverified" and nothing more:
// there is no watch button anywhere, because without an age gate a public clip feed would broadcast
// minors' workout video. Tapping someone's PR explains that and offers the one lever the community
// has — dispute, which goes to a moderator (0266).

const UNITS: ExerciseUnit[] = ['weight', 'reps', 'time', 'distance'];

export default function ExerciseBoardScreen() {
  const router = useRouter();
  const { session, profile } = useAuth();
  const params = useLocalSearchParams<{ slug?: string; name?: string; unit?: string; muscle?: string }>();
  const slug = params.slug ?? '';
  const name = params.name || 'Exercise';
  const unit: ExerciseUnit = (UNITS as string[]).includes(params.unit ?? '') ? (params.unit as ExerciseUnit) : 'weight';
  const muscle = muscleLabel(params.muscle);

  const dial = rankVisibilityOf(profile);
  const [pickedScope, setScope] = useState<MetricScope>('global');
  const scope: MetricScope = dial === 'friends' ? 'friends' : pickedScope;
  const scopes: MetricScope[] = dial === 'friends' ? ['friends'] : FITNESS_SCOPES;

  const aggs = aggsForUnit(unit);
  const [pickedAgg, setAgg] = useState<ExerciseAgg>(aggs[0]);
  // A "change exercise" can land on a unit without the agg you had picked.
  const agg = aggs.includes(pickedAgg) ? pickedAgg : aggs[0];
  const [verifiedOnly, setVerifiedOnly] = useState(false);

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
  const gate: 'none' | 'no_school' | 'unverified' | 'no_program' =
    scope === 'my_uni' && !university
      ? 'no_school'
      : scope === 'my_uni' && !campusVerified
        ? 'unverified'
        : scope === 'my_program' && programLoaded && !program
          ? 'no_program'
          : 'none';
  const held = !slug || dial === 'private' || gate !== 'none' || (scope === 'my_program' && !programLoaded);

  const { rows, loading, error, refetch } = useMetricLeaderboard({
    metric: held ? null : exerciseMetricKey(slug, agg),
    scope,
    window: 'all',
    limit: null,
    verifiedOnly,
  });

  const [disputeRow, setDisputeRow] = useState<MetricLeaderboardRow | null>(null);
  const [libraryOpen, setLibraryOpen] = useState(false);

  const valueUnit = exerciseValueUnit(unit, agg);
  const formatValue = (v: number) => formatMetricValue(valueUnit, v);

  function goToProfile(userId: string) {
    if (userId === session?.user.id) router.push('/profile');
    else router.push({ pathname: '/friend-profile', params: { userId } });
  }

  const header = (
    <View style={styles.header}>
      <Pressable style={styles.exercise} onPress={() => setLibraryOpen(true)} accessibilityRole="button" accessibilityLabel="Change exercise">
        <View style={styles.exerciseWho}>
          <Text style={styles.exerciseName} numberOfLines={1}>
            {name}
          </Text>
          {muscle ? <Text style={styles.exerciseSub}>{muscle}</Text> : null}
        </View>
        <Text style={styles.change}>▾ change</Text>
      </Pressable>

      {aggs.length > 1 ? (
        <View style={styles.aggRow}>
          {aggs.map((a) => (
            <Pressable
              key={a}
              style={[styles.aggPill, agg === a && styles.aggPillOn]}
              onPress={() => setAgg(a)}
              accessibilityRole="button"
              accessibilityState={{ selected: agg === a }}>
              <Text style={[styles.aggLabel, agg === a && styles.aggLabelOn]}>{aggLabel(a, unit)}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}

      <FitnessScopePills scopes={scopes} value={scope} onChange={setScope} />

      <View style={styles.filterRow}>
        <View style={styles.filterWho}>
          <Text style={styles.filterLabel}>Verified only</Text>
          <Text style={styles.filterSub}>Hide PRs with no clip on file</Text>
        </View>
        <Toggle value={verifiedOnly} onValueChange={setVerifiedOnly} accessibilityLabel="Verified only" />
      </View>
      {scope === 'my_program' && program ? (
        <Text style={styles.house}>
          {program.name} · Heirs of {program.patron_name}
        </Text>
      ) : null}
    </View>
  );

  const footer = (
    <Text style={styles.footer}>Every entry needs a logged set + video to count as verified — no self-typed numbers.</Text>
  );

  let body: React.ReactNode;
  if (dial === 'private') {
    body = (
      <EmptyState
        emoji="🔒"
        title="Your rank is private"
        body="Private climbers aren't on any board. Change it in Settings whenever you want in."
        action={<PrimaryButton label="Open Settings" onPress={() => router.push('/settings')} />}
      />
    );
  } else if (gate === 'no_school') {
    body = <EmptyState emoji="🏫" title="Add your school" body="Set your school in Profile to see how you stack up at your university." />;
  } else if (gate === 'unverified') {
    body = (
      <EmptyState
        emoji="🔒"
        title="Verify to unlock"
        body="Only students with a verified school email count on My uni — that's what keeps the campus rankings real."
        action={<PrimaryButton label="Verify my campus" onPress={() => router.push('/campus')} />}
      />
    );
  } else if (gate === 'no_program') {
    body = (
      <EmptyState
        emoji="🏛️"
        title="Pick your program"
        body="Your program names your house. Pick it and this board ranks you against every Heir of it, at both schools."
        action={<PrimaryButton label="Pick my program" onPress={() => router.push('/house/change-program?ceremony=1')} />}
      />
    );
  } else {
    body = (
      <FitnessBoard
        rows={rows}
        loading={loading}
        error={error}
        onRefresh={refetch}
        formatValue={formatValue}
        valueCaption={agg === 'e1rm' ? 'est 1RM' : undefined}
        // Your own row goes to your profile; anyone else's PR opens what the ✓ means + dispute.
        onPressRow={(r) => (r.is_me ? goToProfile(r.user_id) : setDisputeRow(r))}
        onPressVerification={setDisputeRow}
        onVersus={(r) => router.push({ pathname: '/versus', params: { with: r.user_id } })}
        footer={footer}
        emptyTitle={verifiedOnly ? 'No verified PRs yet' : 'Nobody on this board yet'}
        emptyBody={
          verifiedOnly
            ? 'A PR counts as verified once it has a logged set and a clip on file. Turn the filter off to see every entry.'
            : scope === 'my_program'
              ? `Houses are brand new — this fills up as more Heirs pick their program. Log a ${name} set and you open it.`
              : `Log a ${name} set in the gym logger and you open this board.`
        }
      />
    );
  }

  return (
    <Screen padded={false}>
      <BackHeader title="Exercise board" />
      {/* The header rides outside the list so the gated states keep the toggles above them. */}
      {header}
      {body}
      <PrDisputeSheet
        row={disputeRow}
        value={disputeRow ? formatValue(disputeRow.value) : ''}
        onClose={() => setDisputeRow(null)}
        onPulled={refetch}
        onViewProfile={goToProfile}
      />
      <ExerciseLibrarySheet
        visible={libraryOpen}
        onClose={() => setLibraryOpen(false)}
        onPick={(ex) => {
          setLibraryOpen(false);
          router.setParams({ slug: ex.slug, name: ex.name, unit: ex.unit, muscle: ex.muscleGroup ?? '' });
        }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: {
    gap: Spacing.two,
    paddingHorizontal: Spacing.four,
    paddingBottom: Spacing.twelve,
  },
  exercise: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    backgroundColor: Colors.card,
    borderRadius: Radius.card,
    padding: Spacing.twelve,
  },
  exerciseWho: {
    flex: 1,
    minWidth: 0,
  },
  exerciseName: {
    fontFamily: Fonts.bodyBold,
    fontSize: 17,
    color: Colors.ink,
  },
  exerciseSub: {
    fontFamily: Fonts.body,
    fontSize: 12,
    color: Colors.muted,
  },
  change: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 11,
    color: Colors.amber,
  },
  aggRow: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  aggPill: {
    backgroundColor: Colors.card,
    borderRadius: Radius.pill,
    borderWidth: 1,
    borderColor: 'transparent',
    paddingVertical: Spacing.one,
    paddingHorizontal: Spacing.three,
  },
  aggPillOn: {
    backgroundColor: Colors.selectedBg,
    borderColor: Colors.coral,
  },
  aggLabel: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 11,
    color: Colors.muted,
  },
  aggLabelOn: {
    color: Colors.achieverText,
  },
  filterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  filterWho: {
    flex: 1,
  },
  filterLabel: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 13,
    color: Colors.ink,
  },
  filterSub: {
    fontFamily: Fonts.body,
    fontSize: 11,
    color: Colors.textTertiary,
  },
  house: {
    fontFamily: Fonts.bodyBold,
    fontSize: 12,
    color: Colors.ember,
    letterSpacing: 0.4,
  },
  footer: {
    fontFamily: Fonts.body,
    fontSize: 11,
    color: Colors.textTertiary,
    textAlign: 'center',
    marginTop: Spacing.three,
  },
});
