import { Ionicons } from '@expo/vector-icons';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { EmptyState } from '@/components/ui/empty-state';
import { PrimaryButton } from '@/components/ui/primary-button';
import { SecondaryButton } from '@/components/ui/secondary-button';
import { CompareStatRow } from '@/components/versus/compare-stat-row';
import { PersonLookup } from '@/components/versus/person-lookup';
import {
  DEFAULT_STAT_KEYS,
  DUEL_WINDOW_HOURS,
  MAX_COMPARE_STATS,
  duelPublicName,
  joinLabels,
  planSend,
  statFromCatalog,
  statFromExerciseKey,
  type CompareStat,
} from '@/components/versus/send-plan';
import { StatLibrarySheet } from '@/components/versus/stat-library-sheet';
import { VersusBar } from '@/components/versus/versus-bar';
import { VersusPerson } from '@/components/versus/versus-person';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { useAuth } from '@/lib/auth/auth-context';
import { fetchProfileById } from '@/lib/api/profile';
import { createH2HChallenge, setChallengeScope } from '@/lib/api/social-challenges';
import { fetchMetricCatalog, fetchVersus, isRankPrivateError } from '@/lib/api/stats';
import { getErrorMessage } from '@/lib/errors';
import type { MetricCatalogRow, VersusRow } from '@/types/house';

// ══════════════════════════════════════════════════════════════════════════════════════════════
// HEAD TO HEAD — compare anyone, any stats (mocks 292/293, CODE_PROMPT_fitness_boards §4).
//
// Three steps on one screen: find a person (skipped when the link says `?with=`), build the compare
// zone from the stat library and flag ⚔ the ones worth a challenge, then the result — split bars,
// your side always on the left, each person's identity on top.
//
// THE FLAGS ARE PROMISES, SO THE SCREEN SAYS WHICH ONES IT CAN KEEP. A flagged stat with a server
// race (`duel_metric`) becomes a real duel on send; one without — streak, sessions, a PR — goes to
// Cindy's Q&A pre-filled with the opponent. Both lists are on screen before the tap (send-plan.ts).
//
// The server does the privacy: versus() refuses anyone whose rank is private (hint 'rank_private'),
// and that is a sentence here, not an error.
// ══════════════════════════════════════════════════════════════════════════════════════════════

type Step = 'lookup' | 'compose' | 'result';

type Target = { id: string; name: string; avatarUrl: string | null; university: string | null };

/**
 * The tier each duel is scoped at. A stat-library duel has no Cindy verdict behind it, so this
 * proposes the same default the verdict screen falls back to when none is given. It is a proposal:
 * the server validates the name and derives verifiability from the race metric itself.
 */
const DUEL_TIER = 'uncommon' as const;

function parseKeys(raw: string | undefined): string[] {
  if (!raw) return [];
  const keys = raw
    .split(',')
    .map((k) => k.trim())
    .filter(Boolean);
  return Array.from(new Set(keys)).slice(0, MAX_COMPARE_STATS);
}

function firstName(name: string): string {
  return name.split(' ')[0] || name;
}

export default function VersusScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ with?: string; stats?: string }>();
  const { session, profile: me } = useAuth();
  const myId = session?.user.id ?? null;
  const linkedKeys = useMemo(() => parseKeys(params.stats), [params.stats]);
  const autoCompare = Boolean(params.with) && linkedKeys.length > 0;

  const [step, setStep] = useState<Step>(params.with ? (autoCompare ? 'result' : 'compose') : 'lookup');
  const [target, setTarget] = useState<Target | null>(null);
  const [targetError, setTargetError] = useState<string | null>(null);

  const [catalog, setCatalog] = useState<MetricCatalogRow[] | null>(null);
  const [catalogFailed, setCatalogFailed] = useState(false);
  /** Null until the person edits it — until then the zone is derived from the link or defaults. */
  const [edited, setEdited] = useState<CompareStat[] | null>(null);
  const [flagged, setFlagged] = useState<Set<string>>(() => new Set());
  const [libraryOpen, setLibraryOpen] = useState(false);

  const [rows, setRows] = useState<VersusRow[] | null>(null);
  const [comparing, setComparing] = useState(autoCompare);
  const [isPrivate, setIsPrivate] = useState(false);
  const [compareError, setCompareError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    // Fail soft: before 0265 there is no metric_catalog. The screen says so instead of erroring.
    fetchMetricCatalog()
      .then((rows) => setCatalog(rows))
      .catch(() => setCatalogFailed(true));
  }, []);

  // `?with=` — resolve the name and face once; the lookup step never ran.
  useEffect(() => {
    const id = params.with;
    if (!id) return;
    fetchProfileById(id)
      .then((p) => setTarget({ id: p.id, name: p.display_name, avatarUrl: p.avatar_url, university: p.university }))
      .catch((e) => setTargetError(getErrorMessage(e, 'Could not find that person.')));
  }, [params.with]);

  // `?with=…&stats=…` is a finished question (a board row's "Versus", a shared link) — answer it
  // straight away rather than making the person press Compare on a zone they didn't build.
  useEffect(() => {
    if (!autoCompare || !params.with || !myId) return;
    fetchVersus(myId, params.with, linkedKeys)
      .then((r) => setRows(r))
      .catch((e) => {
        if (isRankPrivateError(e)) setIsPrivate(true);
        else setCompareError(getErrorMessage(e, 'Could not compare right now.'));
      })
      .finally(() => setComparing(false));
  }, [autoCompare, params.with, myId, linkedKeys]);

  const byKey = useMemo(() => new Map((catalog ?? []).map((r) => [r.key, r])), [catalog]);

  const stats: CompareStat[] = useMemo(() => {
    if (edited) return edited;
    const keys = linkedKeys.length > 0 ? linkedKeys : [...DEFAULT_STAT_KEYS];
    const out: CompareStat[] = [];
    for (const key of keys) {
      const row = byKey.get(key);
      const stat = row ? statFromCatalog(row) : statFromExerciseKey(key);
      if (stat) out.push(stat);
    }
    return out;
  }, [edited, linkedKeys, byKey]);

  /** In the result, the server's own rows are the truth about what each stat can be raced on. */
  const resultStats: CompareStat[] = useMemo(
    () =>
      (rows ?? []).map((r) => ({
        key: r.metric_key,
        label: r.label,
        emoji: r.emoji,
        challengeable: r.challengeable,
        duel_metric: r.duel_metric,
        duel_goal_type: r.duel_goal_type,
      })),
    [rows]
  );
  const plan = useMemo(() => planSend(step === 'result' ? resultStats : stats, flagged), [step, resultStats, stats, flagged]);
  const flaggedCount = plan.duels.length + plan.cindy.length;

  function editStats(next: CompareStat[]) {
    setEdited(next);
    // A flag on a stat that left the zone must not ride along into the send.
    setFlagged((prev) => new Set([...prev].filter((k) => next.some((s) => s.key === k))));
  }

  function toggleLibrary(row: MetricCatalogRow) {
    if (stats.some((s) => s.key === row.key)) editStats(stats.filter((s) => s.key !== row.key));
    else if (stats.length < MAX_COMPARE_STATS) editStats([...stats, statFromCatalog(row)]);
  }

  function moveStat(index: number, direction: -1 | 1) {
    const to = index + direction;
    if (to < 0 || to >= stats.length) return;
    const next = [...stats];
    [next[index], next[to]] = [next[to], next[index]];
    editStats(next);
  }

  function toggleFlag(key: string) {
    setFlagged((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function pickPerson(person: { user_id: string; display_name: string; avatar_url: string | null; university: string | null }) {
    setTarget({ id: person.user_id, name: person.display_name, avatarUrl: person.avatar_url, university: person.university });
    setTargetError(null);
    setIsPrivate(false);
    setRows(null);
    setStep('compose');
  }

  async function handleCompare() {
    if (!myId || !target || stats.length === 0 || comparing) return;
    setComparing(true);
    setCompareError(null);
    setIsPrivate(false);
    setStep('result');
    try {
      setRows(await fetchVersus(myId, target.id, stats.map((s) => s.key)));
    } catch (e) {
      if (isRankPrivateError(e)) setIsPrivate(true);
      else setCompareError(getErrorMessage(e, 'Could not compare right now.'));
    } finally {
      setComparing(false);
    }
  }

  function openCindy(stat: CompareStat) {
    if (!target) return;
    router.push({
      pathname: '/challenge/create',
      params: { opponentId: target.id, opponentName: target.name, mode: 'h2h', label: stat.label, publicName: stat.label },
    });
  }

  // The duel create, mirrored from the verdict screen: create, then scope (swallowed — an unscoped
  // duel pays less, never wrong), then land on the new challenge with `fresh`. One duel per
  // duel-able flag, created in order; the first one is where you land.
  async function handleSend() {
    if (!target || sending) return;
    if (plan.duels.length === 0) {
      if (plan.cindy[0]) openCindy(plan.cindy[0]);
      return;
    }
    setSending(true);
    const created: string[] = [];
    const failed: { stat: CompareStat; message: string }[] = [];
    for (const stat of plan.duels) {
      try {
        const duel = await createH2HChallenge({
          opponentId: target.id,
          raceMetric: stat.duel_metric!,
          windowHours: DUEL_WINDOW_HOURS,
          publicName: duelPublicName(stat),
          lockinGoalType: stat.duel_metric === 'lockin_time' ? stat.duel_goal_type : null,
        });
        if (duel?.id) {
          await setChallengeScope(duel.id, DUEL_TIER).catch(() => {});
          created.push(duel.id);
        }
      } catch (e) {
        failed.push({ stat, message: getErrorMessage(e, 'Could not send that one.') });
      }
    }
    setSending(false);

    if (created.length === 0) {
      Alert.alert('Challenge not sent', failed[0]?.message ?? 'Try again.');
      return;
    }
    if (failed.length > 0) {
      Alert.alert(
        `${created.length} of ${plan.duels.length} sent`,
        failed.map((f) => `${duelPublicName(f.stat)}: ${f.message}`).join('\n')
      );
    }
    router.replace({ pathname: '/challenge-info/[challengeId]', params: { challengeId: created[0], fresh: '1' } });
  }

  const title = step === 'lookup' ? 'Head to head' : target ? `You vs ${firstName(target.name)}` : 'Head to head';

  return (
    <SafeAreaView edges={['top']} style={styles.safe}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={8} accessibilityLabel="Back">
          <Ionicons name="chevron-back" size={22} color={Colors.muted} />
        </Pressable>
        <Text style={styles.title} numberOfLines={1}>
          {title}
        </Text>
        {step === 'result' && !comparing ? (
          <Pressable onPress={() => setStep('compose')} hitSlop={8} accessibilityRole="button">
            <Text style={styles.headerAction}>↺ edit</Text>
          </Pressable>
        ) : null}
      </View>

      {catalogFailed ? (
        <EmptyState
          emoji="⚔️"
          title="Head to head is almost here"
          body="Comparing any stat against anyone lands with the next update."
        />
      ) : step === 'lookup' ? (
        <View style={styles.lookup}>
          <PersonLookup myId={myId} onPick={pickPerson} />
        </View>
      ) : targetError ? (
        <EmptyState
          emoji="🔍"
          title="Couldn't find them"
          body={targetError}
          action={<SecondaryButton label="Search someone else" onDark onPress={() => setStep('lookup')} />}
        />
      ) : (
        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          <View style={styles.people}>
            {myId ? (
              <VersusPerson
                userId={myId}
                name={me?.display_name ?? 'You'}
                avatarUrl={me?.avatar_url}
                university={me?.university}
                side="you"
              />
            ) : null}
            <Text style={styles.vs}>VS</Text>
            {target ? (
              <VersusPerson userId={target.id} name={target.name} avatarUrl={target.avatarUrl} university={target.university} side="them" />
            ) : (
              <View style={styles.personPending}>
                <ActivityIndicator color={Colors.textTertiary} />
              </View>
            )}
          </View>

          {step === 'compose' ? (
            <>
              <View style={styles.zone}>
                <View style={styles.zoneHead}>
                  <Text style={styles.zoneLabel}>
                    Comparing ({stats.length}/{MAX_COMPARE_STATS})
                  </Text>
                  <Text style={styles.zoneLabel}>⚔ = challenge</Text>
                </View>
                {stats.map((stat, i) => (
                  <CompareStatRow
                    key={stat.key}
                    stat={stat}
                    flagged={flagged.has(stat.key)}
                    isFirst={i === 0}
                    isLast={i === stats.length - 1}
                    onToggleFlag={() => toggleFlag(stat.key)}
                    onMove={(d) => moveStat(i, d)}
                    onRemove={() => editStats(stats.filter((s) => s.key !== stat.key))}
                  />
                ))}
                {stats.length === 0 ? <Text style={styles.zoneHint}>Add a stat to line up against each other.</Text> : null}
                <Pressable
                  onPress={() => setLibraryOpen(true)}
                  disabled={!catalog}
                  style={styles.addStat}
                  accessibilityRole="button">
                  <Ionicons name="add" size={14} color={Colors.amber} />
                  <Text style={styles.addStatLabel}>{catalog ? 'Add stats' : 'Loading the stat library…'}</Text>
                </Pressable>
              </View>

              <SendPlanNote duels={plan.duels} cindy={plan.cindy} />

              <View style={styles.cta}>
                <PrimaryButton
                  label={flaggedCount > 0 ? `Compare · challenge on ${flaggedCount} ⚔` : 'Compare'}
                  onPress={handleCompare}
                  disabled={!target || stats.length === 0}
                  loading={comparing}
                />
              </View>
            </>
          ) : comparing ? (
            <ActivityIndicator style={styles.loading} color={Colors.amber} />
          ) : isPrivate ? (
            <EmptyState
              emoji="🔒"
              title="They keep their stats private."
              body="Their rank is hidden, so there is nothing to line up against."
              action={<SecondaryButton label="Compare someone else" onDark onPress={() => setStep('lookup')} />}
            />
          ) : compareError ? (
            <EmptyState
              emoji="⚠️"
              title="Couldn't compare"
              body={compareError}
              action={<SecondaryButton label="Try again" onDark onPress={handleCompare} />}
            />
          ) : rows && target ? (
            <>
              {rows.map((row) => (
                <VersusBar key={row.metric_key} row={row} flagged={row.challengeable && flagged.has(row.metric_key)} />
              ))}
              <ResultSummary rows={rows} name={target.name} duels={plan.duels} />
              <SendPlanNote duels={plan.duels} cindy={plan.cindy} />

              <View style={styles.cta}>
                {plan.duels.length > 0 ? (
                  <PrimaryButton
                    label={`Send the challenge ⚔ · ${plan.duels.length}`}
                    onPress={handleSend}
                    loading={sending}
                    pulse
                  />
                ) : null}
                {plan.cindy.map((stat) => (
                  <SecondaryButton key={stat.key} label={`Set up ${stat.label} with Cindy`} onDark solid onPress={() => openCindy(stat)} />
                ))}
                {flaggedCount === 0 ? (
                  <Pressable onPress={() => setStep('compose')} style={styles.flagHint} accessibilityRole="button">
                    <Text style={styles.flagHintText}>Flag a stat ⚔ to turn this into a challenge</Text>
                  </Pressable>
                ) : null}
              </View>
            </>
          ) : null}
        </ScrollView>
      )}

      {catalog ? (
        <StatLibrarySheet
          visible={libraryOpen}
          catalog={catalog}
          selected={new Set(stats.map((s) => s.key))}
          onToggle={toggleLibrary}
          onClose={() => setLibraryOpen(false)}
        />
      ) : null}
    </SafeAreaView>
  );
}

/** "You lead 2 of 3." plus one line — what they own AND what you do, never only the gap. */
function ResultSummary({ rows, name, duels }: { rows: VersusRow[]; name: string; duels: CompareStat[] }) {
  const mine = rows.filter((r) => r.leader === 'a');
  const theirs = rows.filter((r) => r.leader === 'b');
  const them = firstName(name);

  let line: string;
  if (duels.length > 0) {
    line = `Challenging on ${joinLabels(duels)} — ${them} has 7 days to answer.`;
  } else if (theirs.length === 0 && mine.length === 0) {
    line = 'Dead level on everything.';
  } else if (theirs.length === 0) {
    line = 'You own all of it — for now.';
  } else if (mine.length === 0) {
    line = `${them} owns ${joinLabels(theirs)}. Every one of those is a target.`;
  } else {
    line = `${them} owns ${joinLabels(theirs)}; you own ${joinLabels(mine)}.`;
  }

  return (
    <View style={styles.summary}>
      <Text style={styles.summaryText}>
        <Text style={styles.summaryStrong}>
          You lead {mine.length} of {rows.length}.
        </Text>{' '}
        {line}
      </Text>
    </View>
  );
}

/** Honest about the send BEFORE the tap: which flags become duels, which go to Cindy. */
function SendPlanNote({ duels, cindy }: { duels: CompareStat[]; cindy: CompareStat[] }) {
  if (duels.length === 0 && cindy.length === 0) return null;
  return (
    <View style={styles.planNote}>
      {duels.length > 0 ? (
        <Text style={styles.planText}>
          <Text style={styles.planSword}>⚔ </Text>
          {duels.length === 1 ? 'Becomes a 7-day duel: ' : `Become ${duels.length} separate 7-day duels: `}
          <Text style={styles.planStrong}>{duels.map(duelPublicName).join(', ')}</Text>
        </Text>
      ) : null}
      {cindy.length > 0 ? (
        <Text style={styles.planText}>
          <Text style={styles.planStrong}>{joinLabels(cindy)}</Text>
          {cindy.length === 1 ? " can't be a duel yet" : " can't be duels yet"} — set {cindy.length === 1 ? 'it' : 'them'} up with Cindy instead.
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    // Transparent so the navigator's radial shows through, as on add-friend.
    backgroundColor: 'transparent',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.three,
    marginBottom: Spacing.twelve,
  },
  title: {
    flex: 1,
    fontFamily: Fonts.bodyBold,
    fontSize: 18,
    color: Colors.ink,
  },
  headerAction: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 13,
    color: Colors.amber,
  },
  lookup: {
    flex: 1,
    paddingHorizontal: Spacing.three,
  },
  body: {
    paddingHorizontal: Spacing.three,
    paddingBottom: Spacing.five,
  },
  people: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: Spacing.two,
  },
  vs: {
    alignSelf: 'center',
    fontFamily: Fonts.bodyBold,
    fontSize: 12,
    color: Colors.textTertiary,
  },
  personPending: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.card,
    borderRadius: Radius.card + 2,
    minHeight: 110,
  },
  zone: {
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: 'rgba(242,163,60,0.35)',
    borderRadius: 13,
    padding: 10,
    marginTop: Spacing.twelve,
    backgroundColor: 'rgba(224,97,44,0.05)',
  },
  zoneHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: Spacing.two,
  },
  zoneLabel: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 9.5,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: Colors.amber,
  },
  zoneHint: {
    fontFamily: Fonts.body,
    fontSize: 11.5,
    color: Colors.textTertiary,
    textAlign: 'center',
    paddingVertical: Spacing.two,
  },
  addStat: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    paddingVertical: Spacing.two,
  },
  addStatLabel: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 12,
    color: Colors.amber,
  },
  cta: {
    gap: Spacing.two,
    marginTop: Spacing.three,
  },
  loading: {
    marginTop: Spacing.five,
  },
  summary: {
    marginTop: Spacing.three,
    backgroundColor: Colors.cardDark,
    borderRadius: Radius.card,
    padding: Spacing.twelve,
  },
  summaryText: {
    fontFamily: Fonts.body,
    fontSize: 12.5,
    lineHeight: 18,
    color: Colors.muted,
  },
  summaryStrong: {
    fontFamily: Fonts.bodyBold,
    color: Colors.ink,
  },
  planNote: {
    gap: Spacing.one,
    marginTop: Spacing.twelve,
  },
  planText: {
    fontFamily: Fonts.body,
    fontSize: 11.5,
    lineHeight: 16,
    color: Colors.muted,
  },
  planSword: {
    color: Colors.danger,
  },
  planStrong: {
    fontFamily: Fonts.bodySemiBold,
    color: Colors.ink,
  },
  flagHint: {
    alignItems: 'center',
    paddingVertical: Spacing.two,
  },
  flagHintText: {
    fontFamily: Fonts.body,
    fontSize: 11.5,
    color: Colors.amber,
  },
});
