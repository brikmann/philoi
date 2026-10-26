import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { ExerciseLibrarySheet, muscleLabel } from '@/components/fitness/exercise-library-sheet';
import { FitnessBoard } from '@/components/fitness/fitness-board';
import { FITNESS_SCOPES, FitnessScopePills } from '@/components/fitness/fitness-scope-pills';
import { PrDisputeSheet } from '@/components/fitness/pr-dispute-sheet';
import { Screen } from '@/components/ui/screen';
import { SpaceButton, SpaceChip, SpaceEmpty, SpaceHeader, SPACE_GUTTER } from '@/components/ui/space-kit';
import { Toggle } from '@/components/ui/toggle';
import { UiGlyph } from '@/components/ui/ui-glyph';
import { Colors, Fonts, Spacing } from '@/constants/theme';
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
// Clips are NEVER PUBLIC. A row says "✓ clip on file" or "no clip · unverified" and nothing more:
// there is no watch button on the board, because without an age gate a public clip feed would
// broadcast minors' workout video (friends and circle-mates can still play one — pr-consent-sheet). Tapping someone's PR explains that and offers the one lever the community
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
        <View style={styles.change}>
          <Text style={styles.changeText}>Change</Text>
          <UiGlyph name="down" size={12} color={Colors.navEmber2} />
        </View>
      </Pressable>

      {aggs.length > 1 ? (
        <View style={styles.aggRow}>
          {aggs.map((a) => (
            <SpaceChip key={a} label={aggLabel(a, unit)} selected={agg === a} onPress={() => setAgg(a)} />
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
      <SpaceEmpty
        title="Your rank is private"
        body="Private climbers aren't on any board. Change it in Settings whenever you want in."
        action={<SpaceButton label="Open Settings" onPress={() => router.push('/settings')} style={styles.emptyAction} />}
      />
    );
  } else if (gate === 'no_school') {
    body = <SpaceEmpty title="Add your school" body="Set your school in Profile to see how you stack up at your university." />;
  } else if (gate === 'unverified') {
    body = (
      <SpaceEmpty
        title="Verify to unlock"
        body="Only students with a verified school email count on My uni — that's what keeps the campus rankings real."
        action={<SpaceButton label="Verify my campus" onPress={() => router.push('/campus')} style={styles.emptyAction} />}
      />
    );
  } else if (gate === 'no_program') {
    body = (
      <SpaceEmpty
        title="Pick your program"
        body="Your program names your house. Pick it and this board ranks you against every Heir of it, at both schools."
        action={<SpaceButton label="Pick my program" onPress={() => router.push('/house/change-program?ceremony=1')} style={styles.emptyAction} />}
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
      <SpaceHeader title="Exercise board" />
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
    paddingHorizontal: SPACE_GUTTER,
    paddingBottom: Spacing.twelve,
  },
  exercise: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    backgroundColor: Colors.spacePanel,
    borderWidth: 1,
    borderColor: Colors.spaceLine,
    borderRadius: 14,
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
    color: Colors.spaceDim,
  },
  change: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  changeText: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 12,
    color: Colors.navEmber2,
  },
  aggRow: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  emptyAction: {
    marginTop: Spacing.two,
    alignSelf: 'stretch',
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
    color: Colors.spaceFaint,
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
