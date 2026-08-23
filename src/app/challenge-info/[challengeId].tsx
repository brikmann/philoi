import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Avatar } from '@/components/ui/avatar';
import { PrimaryButton } from '@/components/ui/primary-button';
import { Screen } from '@/components/ui/screen';
import { Colors, Fonts, Spacing } from '@/constants/theme';
import { useMyChallenges } from '@/hooks/use-my-challenges';
import { useSocialChallenges } from '@/hooks/use-social-challenges';
import { useAuth } from '@/lib/auth/auth-context';
import { challengeTitle, isDuel, metricLabel, metricNoun } from '@/lib/challenge-metric';
import { fetchChallengeResults } from '@/lib/api/social-challenges';
import { getErrorMessage } from '@/lib/errors';
import { CHALLENGE_TYPE_ICON } from '@/lib/goal-types';
import { formatTimeLeft } from '@/lib/format';
import type { ChallengeResultRow } from '@/types/database';

// Challenge / Goal info — design-mocks/102 v2, the screen that makes the minimal card possible.
//
// THE POINT: the browse cards used to carry "Winner +200 XP", "+50 embers on complete" and the
// tiebreak rules inline, which is what made a list of three challenges read as a wall. Moving all
// of it one tap away lets the card be avatars + bar + lead + clock, and gives the rules somewhere
// to be COMPLETE rather than abbreviated to whatever fits under a progress bar.
//
// Two variants behind one route, because they answer the same question ("what are the rules of the
// thing I'm looking at?") and splitting them into two screens would duplicate the row chrome.

type Row = { k: string; v: string; highlight?: boolean };

export default function ChallengeInfoScreen() {
  const router = useRouter();
  const { challengeId, kind } = useLocalSearchParams<{ challengeId: string; kind?: string }>();
  const isGoal = kind === 'goal';

  return (
    <Screen>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12} accessibilityLabel="Back">
          <Ionicons name="chevron-back" size={24} color={Colors.muted} />
        </Pressable>
        <Text style={styles.headerTitle}>{isGoal ? 'Goal info' : 'Challenge info'}</Text>
      </View>

      {isGoal ? <GoalInfo challengeId={challengeId} /> : <SocialInfo challengeId={challengeId} />}
    </Screen>
  );
}

/**
 * THE RESULT (0111's get_challenge_results, wired here by 0112).
 *
 * This screen is where challenge_won / challenge_lost / campfire_settled deep-link (0089), and
 * until now the tap landed on a rules table with the "Watch live" button gone and nothing in its
 * place — the reward arc's last step was a page that said what the race WOULD have been. The
 * standings were being written at settlement and read by nobody.
 *
 * Figures come from the server as they were decided. Recomputing them here from live data would
 * eventually disagree with the ledger, and the ledger is what actually moved.
 */
function Results({ challengeId, myUserId }: { challengeId: string; myUserId: string | undefined }) {
  const [rows, setRows] = useState<ChallengeResultRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    fetchChallengeResults(challengeId)
      .then((r) => live && setRows(r))
      .catch((e) => live && setError(getErrorMessage(e, 'Could not load the result.')));
    return () => {
      live = false;
    };
  }, [challengeId]);

  if (error) return <Text style={styles.resultsError}>{error}</Text>;
  if (!rows) return <ActivityIndicator color={Colors.amber} style={styles.resultsLoading} />;
  // A challenge that settled before 0111/0112 has no roster, so there are no standings to show.
  // Says so rather than drawing an empty podium.
  if (rows.length === 0) {
    return <Text style={styles.resultsError}>No standings were recorded for this one.</Text>;
  }

  return (
    <View style={styles.results}>
      <Text style={styles.sectionLabel}>Final standings</Text>
      {rows.map((r) => (
        <View key={r.member_id} style={[styles.resultRow, r.member_id === myUserId && styles.resultRowMe]}>
          <Text style={[styles.resultPlace, r.is_winner && styles.resultPlaceWin]}>
            {r.place != null ? `#${r.place}` : '—'}
          </Text>
          <Avatar label={r.member_name} size={28} lit={r.member_id === myUserId} />
          <View style={styles.resultWho}>
            <Text style={styles.resultName} numberOfLines={1}>
              {r.member_id === myUserId ? 'You' : r.member_name}
              {r.is_winner ? ' 👑' : ''}
            </Text>
            {r.percentile != null && rows.length > 2 ? (
              <Text style={styles.resultBand}>Top {Math.max(1, Math.round((1 - r.percentile) * 100))}%</Text>
            ) : null}
          </View>
          {/* What the ledger paid, not what the screen thinks it should have. 0 is shown as a
              dash: a group race nobody completed pays nobody, and "+0 XP" reads like a bug. */}
          <Text style={[styles.resultXp, r.awarded_xp > 0 && styles.resultXpPaid]}>
            {r.awarded_xp > 0 ? `+${r.awarded_xp.toLocaleString('en-US')} XP` : '—'}
          </Text>
        </View>
      ))}
    </View>
  );
}

function SocialInfo({ challengeId }: { challengeId: string }) {
  const router = useRouter();
  const { session } = useAuth();
  const { challenges } = useSocialChallenges();
  const c = challenges.find((x) => x.id === challengeId);

  if (!c) return <Missing what="challenge" />;

  const isCreator = session?.user.id === c.created_by;
  // `shape` (0096), not `opponent_id != null`. A collective goal used to draw the duel arena
  // below — CAMPFIRE_REDESIGN_SPEC's 🔴 "a group goal renders as a 1v1 VS card" — and since a
  // group challenge has no opponent_id, the empty half of that arena rendered the literal string
  // "Opponent", which is the spec's other 🔴 on the same line.
  const duel = isDuel(c);
  const settled = c.status === 'completed' || c.status === 'expired';
  const otherName = (isCreator ? c.opponent_name : c.created_by_name) ?? 'them';

  const rows: Row[] = duel
    ? [
        { k: 'Type', v: 'Head-to-head' },
        { k: 'The race', v: metricLabel(c.race_metric) },
        {
          k: 'Duration',
          v: c.ends_at ? `${c.window_hours}h · ${formatTimeLeft(c.ends_at)}` : `${c.window_hours}h`,
        },
        { k: 'Winner takes', v: `+${c.payout_xp} XP`, highlight: true },
        // The tiebreak is the spec's resolution rule, stated here because it is precisely the
        // sort of thing nobody thinks about until it decides their challenge.
        { k: "If it's a tie", v: 'First to reach it' },
        { k: 'Campfire watching', v: c.circle_id ? 'On' : 'Off' },
      ]
    : [
        { k: 'Type', v: c.shape === 'placement' ? 'Placement race' : 'Collective goal' },
        { k: 'The goal', v: `Everyone locks in ${c.target_count ?? 1}×` },
        {
          k: 'Duration',
          v: c.ends_at ? `${c.window_hours}h · ${formatTimeLeft(c.ends_at)}` : `${c.window_hours}h`,
        },
        { k: 'Everyone takes', v: `up to +${c.payout_xp} XP`, highlight: true },
        // The racers, not the campfire — since 0096 this is an invited subset, and the count on
        // the card is the one settlement uses (0112).
        { k: 'Racing', v: `${c.accepted_count} in${c.invited_count > 0 ? ` · ${c.invited_count} yet to answer` : ''}` },
        { k: 'Campfire', v: c.circle_name ?? '—' },
      ];

  return (
    <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
      <Text style={styles.publicName} numberOfLines={2}>
        {challengeTitle(c)}
      </Text>

      {duel ? (
        <View style={styles.arena}>
          <View style={styles.competitor}>
            <Avatar label="You" size={44} lit />
            <Text style={styles.competitorName}>You</Text>
          </View>
          <Text style={styles.vs}>VS</Text>
          <View style={styles.competitor}>
            <Avatar label={otherName} size={44} />
            <Text style={styles.competitorName} numberOfLines={1}>
              {otherName}
            </Text>
          </View>
        </View>
      ) : (
        // A collective goal is a house passing together, so the hero is the house — a count and
        // the campfire's name, not two faces with a VS between them.
        <View style={styles.houseHero}>
          <View style={styles.houseIcon}>
            <Ionicons name="people" size={26} color={Colors.amber} />
          </View>
          <Text style={styles.houseCount}>
            <Text style={styles.houseCountBig}>{c.completed_count ?? 0}</Text>
            <Text style={styles.houseCountMuted}> / {c.member_count ?? c.accepted_count} done</Text>
          </Text>
          <Text style={styles.competitorName} numberOfLines={1}>
            {c.circle_name ?? 'the campfire'}
          </Text>
        </View>
      )}

      <Rules rows={rows} />

      <View style={styles.note}>
        {duel ? (
          <Text style={styles.noteText}>
            <Text style={styles.noteStrong}>Winner +{c.payout_xp} XP</Text> — scales with effort, capped to keep
            it fair. The loser gets a rematch, not a penalty. Whoever has the most{' '}
            {metricNoun(c.race_metric)} when the clock hits zero takes it.
          </Text>
        ) : (
          <Text style={styles.noteText}>
            <Text style={styles.noteStrong}>All or nothing.</Text> Nobody is paid unless every racer hits{' '}
            {c.target_count ?? 1} qualifying lock-ins before the clock runs out — and once they do, each
            share scales with where you placed. Only the people who accepted are in it.
          </Text>
        )}
      </View>

      {settled ? <Results challengeId={c.id} myUserId={session?.user.id} /> : null}

      {/* Watchable while it runs AND once it is over: 0112 opened the settled band on the group
          watch RPC, which is what made a finished campfire race a dead end where a finished duel
          was not. */}
      {c.status === 'active' || settled ? (
        <View style={styles.actions}>
          <PrimaryButton
            label={settled ? 'See the race' : 'Watch live'}
            onPress={() =>
              router.push({ pathname: '/watch/[challengeId]', params: { challengeId: c.id, mode: c.mode } })
            }
          />
        </View>
      ) : null}
    </ScrollView>
  );
}

function GoalInfo({ challengeId }: { challengeId: string }) {
  const { challenges } = useMyChallenges();
  const g = challenges.find((x) => x.id === challengeId);

  if (!g) return <Missing what="goal" />;

  const pct = Math.min(100, Math.round((g.progress / g.target) * 100));
  const isAuto = g.count_mode !== 'manual';

  const rows: Row[] = [
    { k: 'Type', v: 'Personal goal' },
    { k: 'Target', v: `${g.target.toLocaleString('en-US')} ${g.unit}` },
    { k: 'Source', v: isAuto ? 'Tracked automatically' : 'Logged by hand' },
    // Plain "midnight" is now true — migration 0084 rolls each user at their OWN midnight rather
    // than a single 00:10 UTC sweep. Weekly is still the shared UTC boundary.
    { k: 'Resets', v: g.period === 'day' ? 'Every night at midnight' : 'Every Sunday (UTC)' },
    { k: 'Reward', v: 'Embers on completion', highlight: true },
    { k: 'Goal streak', v: 'Milestones at 3 · 7 · 14 · 30 days' },
  ];

  return (
    <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
      <View style={styles.goalHero}>
        <View style={styles.goalIcon}>
          <Ionicons name={CHALLENGE_TYPE_ICON[g.type]} size={30} color={Colors.amber} />
        </View>
        <Text style={styles.goalTitle}>
          {g.label ?? `${g.target.toLocaleString('en-US')} ${g.unit}`}
        </Text>
        <Text style={styles.goalProgress}>
          {g.progress.toLocaleString('en-US')} / {g.target.toLocaleString('en-US')}{' '}
          {g.period === 'day' ? 'today' : 'this week'} · {pct}%
        </Text>
      </View>

      <Rules rows={rows} />

      <View style={styles.note}>
        <Text style={styles.noteText}>
          Each day you clear this banks a small ember drip that scales with how ambitious the target
          is. An unbroken run pays a bonus on top at{' '}
          <Text style={styles.noteStrong}>3, 7, 14 and 30 days</Text> — the 30-day milestone also
          drops a box.
        </Text>
      </View>
    </ScrollView>
  );
}

function Rules({ rows }: { rows: Row[] }) {
  return (
    <View style={styles.rules}>
      {rows.map((r, i) => (
        <View key={r.k} style={[styles.rule, i > 0 && styles.ruleDivider]}>
          <Text style={styles.ruleKey}>{r.k}</Text>
          <Text style={[styles.ruleValue, r.highlight && styles.ruleValueWin]} numberOfLines={1}>
            {r.v}
          </Text>
        </View>
      ))}
    </View>
  );
}

/** The list this screen reads from is a cache, so a deep link or a stale back-stack entry can land
 * here with nothing to show. Says so plainly rather than rendering an empty rules table. */
function Missing({ what }: { what: string }) {
  return (
    <View style={styles.missing}>
      <Text style={styles.missingText}>That {what} isn&apos;t available any more.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.twelve,
    paddingBottom: Spacing.three,
  },
  headerTitle: {
    fontFamily: Fonts.bodyBold,
    fontSize: 18,
    color: Colors.ink,
  },
  body: {
    paddingBottom: Spacing.four,
  },
  // The public name (0096) — the thing the user actually called this race. It was written at
  // creation and rendered nowhere until 0112 started selecting it.
  publicName: {
    fontFamily: Fonts.bodyBold,
    fontSize: 20,
    lineHeight: 25,
    color: Colors.ink,
    textAlign: 'center',
    marginBottom: Spacing.three,
  },
  houseHero: {
    alignItems: 'center',
    gap: 6,
    marginBottom: Spacing.four,
  },
  houseIcon: {
    width: 54,
    height: 54,
    borderRadius: 16,
    backgroundColor: 'rgba(242,163,60,0.14)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  houseCount: {
    fontFamily: Fonts.body,
  },
  houseCountBig: {
    fontFamily: Fonts.bodyBold,
    fontSize: 22,
    color: Colors.ink,
  },
  houseCountMuted: {
    fontFamily: Fonts.body,
    fontSize: 13,
    color: Colors.muted,
  },
  sectionLabel: {
    fontFamily: Fonts.bodyBold,
    fontSize: 11,
    letterSpacing: 0.6,
    color: Colors.muted,
    marginBottom: Spacing.two,
  },
  results: {
    marginTop: Spacing.four,
  },
  resultsLoading: {
    marginTop: Spacing.four,
  },
  resultsError: {
    fontFamily: Fonts.body,
    fontSize: 12,
    color: Colors.muted,
    textAlign: 'center',
    marginTop: Spacing.four,
  },
  resultRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingVertical: 9,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: Colors.achieverBg,
    marginBottom: 6,
  },
  resultRowMe: {
    borderWidth: 1,
    borderColor: Colors.ember,
  },
  resultPlace: {
    fontFamily: Fonts.bodyBold,
    fontSize: 12.5,
    color: Colors.muted,
    minWidth: 26,
  },
  resultPlaceWin: {
    color: Colors.amber,
  },
  resultWho: {
    flex: 1,
    gap: 1,
  },
  resultName: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 13,
    color: Colors.ink,
  },
  resultBand: {
    fontFamily: Fonts.body,
    fontSize: 10,
    color: Colors.muted,
  },
  resultXp: {
    fontFamily: Fonts.bodyBold,
    fontSize: 12.5,
    color: Colors.textTertiary,
  },
  resultXpPaid: {
    color: Colors.ember,
  },
  arena: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.three,
    marginBottom: Spacing.four,
  },
  competitor: {
    alignItems: 'center',
    gap: 4,
    maxWidth: 110,
  },
  competitorName: {
    fontFamily: Fonts.body,
    fontSize: 11,
    color: Colors.muted,
  },
  vs: {
    fontFamily: Fonts.bodyBold,
    fontSize: 12,
    color: Colors.textTertiary,
  },
  goalHero: {
    alignItems: 'center',
    gap: 8,
    marginBottom: Spacing.four,
  },
  goalIcon: {
    width: 58,
    height: 58,
    borderRadius: 16,
    backgroundColor: 'rgba(242,163,60,0.14)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  goalTitle: {
    fontFamily: Fonts.bodyBold,
    fontSize: 19,
    color: Colors.ink,
    textAlign: 'center',
  },
  goalProgress: {
    fontFamily: Fonts.body,
    fontSize: 11,
    color: Colors.muted,
  },
  rules: {
    backgroundColor: Colors.achieverBg,
    borderWidth: 1,
    borderColor: Colors.line,
    borderRadius: 14,
    overflow: 'hidden',
  },
  rule: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.three,
    paddingVertical: 13,
    paddingHorizontal: 14,
  },
  ruleDivider: {
    borderTopWidth: 1,
    borderTopColor: Colors.line,
  },
  ruleKey: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 13,
    color: Colors.muted,
  },
  ruleValue: {
    fontFamily: Fonts.bodyBold,
    fontSize: 13,
    color: Colors.ink,
    flexShrink: 1,
  },
  ruleValueWin: {
    color: Colors.ember,
  },
  // Mock 102's `.note` — the one place on the screen that explains rather than lists.
  note: {
    backgroundColor: '#231A2E',
    borderLeftWidth: 3,
    borderLeftColor: Colors.coral,
    borderTopRightRadius: 10,
    borderBottomRightRadius: 10,
    paddingVertical: 11,
    paddingHorizontal: 13,
    marginTop: Spacing.three,
  },
  noteText: {
    fontFamily: Fonts.body,
    fontSize: 11.5,
    lineHeight: 17,
    color: Colors.ink,
  },
  noteStrong: {
    fontFamily: Fonts.bodyBold,
    color: Colors.amber,
  },
  actions: {
    marginTop: Spacing.four,
  },
  missing: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  missingText: {
    fontFamily: Fonts.body,
    fontSize: 13.5,
    color: Colors.muted,
  },
});
