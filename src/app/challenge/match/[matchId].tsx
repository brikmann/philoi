import { Ionicons } from '@expo/vector-icons';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Avatar } from '@/components/ui/avatar';
import { PrimaryButton } from '@/components/ui/primary-button';
import { Screen } from '@/components/ui/screen';
import { SecondaryButton } from '@/components/ui/secondary-button';
import { TextInput } from '@/components/ui/text-input';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { useGatedInterval } from '@/hooks/use-motion-active';
import { useTeamMatch } from '@/hooks/use-team-match';
import {
  confirmTeamMatchScore,
  joinTeamMatch,
  refEndMatch,
  refSetClock,
  refSetScore,
  reportTeamMatchScore,
  resolveTeamMatch,
} from '@/lib/api/team-match';
import { getErrorMessage } from '@/lib/errors';
import type { TeamMatch, TeamSide } from '@/types/database';

// ══════════════════════════════════════════════════════════════════════════════════════════════
// THE MATCH SCREEN — mocks 177 §C (scorekeeper) and §D (full time), plus the watch view §B links
// to. CODE_PROMPT_team_mode.md §2/§4, migration 0173.
//
// ONE SCREEN FOR FOUR STATES, and deliberately not four screens. The score, the roster, the two
// tiers and who is reffing are the same facts in all of them; what changes is which controls the
// viewer is offered:
//
//   final                → the result (§D). Nobody edits anything, ever again.
//   ref + live mode      → the scorekeeper (§C): big +/- per side, the clock, Undo, End match.
//   confirm mode, played → report the final score, or confirm the one the other side reported.
//   anyone else          → watch. Read-only score, and Join Red / Join Blue if not yet on a side.
//
// 🔒 EVERY ONE OF THOSE IS A PRESENTATION CHOICE, NOT A PERMISSION. `am_i_ref` comes back from the
// server and every write below is refused server-side for the wrong caller — a non-ref who somehow
// reached refSetScore gets "Only the scorekeeper can change the score" from the database. Hiding
// the button is the courtesy; the RPC is the rule.
//
// THERE IS NO PER-PLAYER NUMBER ON THIS SCREEN, because there is none in the feature. The roster
// renders names and sides. That absence is the design (see 0173's header) and not something to
// fill in later.
// ══════════════════════════════════════════════════════════════════════════════════════════════

function sideColor(m: TeamMatch, side: TeamSide) {
  return (side === 'a' ? m.team_a_color : m.team_b_color) ?? Colors.amber;
}
function sideName(m: TeamMatch, side: TeamSide) {
  return side === 'a' ? m.team_a_name : m.team_b_name;
}

/** mm:ss from the two clock fields. Banked seconds plus the current running stretch, so a client
 *  that was asleep through half the match still renders the right number. */
function formatClock(elapsedS: number) {
  const s = Math.max(0, Math.floor(elapsedS));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

export default function TeamMatchScreen() {
  const router = useRouter();
  const { matchId } = useLocalSearchParams<{ matchId: string }>();
  const { match, loading, error, refetch, setError } = useTeamMatch(matchId);
  const [busy, setBusy] = useState(false);

  // The clock ticks locally off `clock_started_at`; only start/pause round-trip. A second-by-second
  // refetch would be a request per second per viewer for a number the client can compute.
  const [now, setNow] = useState(() => Date.now());
  const running = Boolean(match?.clock_started_at) && match?.match_state !== 'final';
  useGatedInterval(() => setNow(Date.now()), 1000, running);

  const elapsed = useMemo(() => {
    if (!match) return 0;
    const banked = match.clock_elapsed_s;
    if (!match.clock_started_at || match.match_state === 'final') return banked;
    return banked + Math.max(0, (now - new Date(match.clock_started_at).getTime()) / 1000);
  }, [match, now]);

  const act = useCallback(
    async (fn: () => Promise<unknown>) => {
      setBusy(true);
      setError(null);
      try {
        await fn();
        await refetch();
      } catch (e) {
        setError(getErrorMessage(e, "That didn't go through."));
      } finally {
        setBusy(false);
      }
    },
    [refetch, setError]
  );

  if (loading && !match) {
    return (
      <Screen>
        <Stack.Screen options={{ title: 'Match' }} />
        <ActivityIndicator color={Colors.amber} style={styles.centred} />
      </Screen>
    );
  }

  if (!match) {
    return (
      <Screen>
        <Stack.Screen options={{ title: 'Match' }} />
        <Text style={styles.empty}>
          {error ?? "That match isn't here — it may belong to a campfire you've left."}
        </Text>
      </Screen>
    );
  }

  const isFinal = match.match_state === 'final';
  const scorekeeping = match.am_i_ref && match.score_mode === 'live' && !isFinal;
  const played = match.my_team !== null;

  return (
    <Screen>
      <Stack.Screen
        options={{ title: isFinal ? 'Full time' : match.sport_label, headerBackTitle: 'Back' }}
      />
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        {/* ── the header: sport, clock, who is keeping score ── */}
        <View style={styles.hero}>
          <Text style={styles.eyebrow}>
            {match.sport_emoji} {isFinal ? 'FULL TIME' : match.sport_label.toUpperCase()}
            {scorekeeping ? ' · SCOREKEEPER' : ''}
          </Text>
          {!isFinal && match.score_mode === 'live' && (
            <Text style={styles.clock}>
              ⏱ {formatClock(elapsed)} · {match.clock_started_at ? 'running' : 'paused'}
            </Text>
          )}
          <Text style={styles.subhead}>
            {match.ref_name ? `Scorekeeper: ${match.ref_name}` : 'No scorekeeper set'}
            {match.circle_name ? ` · ${match.circle_name}` : ''}
          </Text>
        </View>

        {/* ── the two sides ── */}
        {(['a', 'b'] as const).map((side) => (
          <TeamPanel
            key={side}
            match={match}
            side={side}
            elapsedControls={scorekeeping}
            busy={busy}
            onStep={(delta) => act(() => refSetScore(match.id, side, delta))}
          />
        ))}

        {/* ── the scorekeeper's controls (§C) ── */}
        {scorekeeping && (
          <>
            <View style={styles.ctlRow}>
              <View style={styles.ctlHalf}>
                <SecondaryButton
                  label={match.clock_started_at ? '⏸ Pause' : '▶ Start clock'}
                  onPress={() => act(() => refSetClock(match.id, !match.clock_started_at))}
                  disabled={busy}
                  onDark
                  solid
                />
              </View>
              <View style={styles.ctlHalf}>
                <PrimaryButton label="⏹ End match" onPress={() => act(() => refEndMatch(match.id))} disabled={busy} />
              </View>
            </View>
            <Text style={styles.note}>
              Only you can edit. The score updates live for the whole campfire.
            </Text>
          </>
        )}

        {/* ── picking a side ── */}
        {!isFinal && (
          <View style={styles.joinRow}>
            {(['a', 'b'] as const).map((side) => {
              const mine = match.my_team === side;
              return (
                <Pressable
                  key={side}
                  disabled={busy || mine}
                  onPress={() => act(() => joinTeamMatch(match.id, side))}
                  accessibilityRole="button"
                  accessibilityState={{ selected: mine, disabled: busy || mine }}
                  style={[
                    styles.joinBtn,
                    { borderColor: sideColor(match, side) },
                    mine && { backgroundColor: Colors.selectedBg },
                  ]}>
                  <Ionicons
                    name={mine ? 'checkmark-circle' : 'add-circle-outline'}
                    size={15}
                    color={sideColor(match, side)}
                  />
                  <Text style={[styles.joinText, { color: sideColor(match, side) }]} numberOfLines={1}>
                    {mine ? `You're on ${sideName(match, side)}` : `Join ${sideName(match, side)}`}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        )}

        {/* ── the default settle route (§1b mode A) ── */}
        {!isFinal && match.score_mode === 'confirm' && (
          <ConfirmPanel match={match} played={played} busy={busy} act={act} />
        )}

        {/* ── the result (§D) ── */}
        {isFinal && <ResultPanel match={match} />}

        {/* ── the roster: names and sides, and nothing else ── */}
        <Text style={styles.label}>Who played</Text>
        {match.roster.length === 0 ? (
          <Text style={styles.hint}>Nobody has picked a side yet.</Text>
        ) : (
          <View style={styles.rosterWrap}>
            {match.roster.map((p) => (
              <View key={p.user_id} style={styles.rosterRow}>
                <Avatar label={p.display_name} size={26} />
                <Text style={styles.rosterName} numberOfLines={1}>
                  {p.display_name}
                </Text>
                <View style={[styles.rosterDot, { backgroundColor: sideColor(match, p.team) }]} />
                <Text style={[styles.rosterTeam, { color: sideColor(match, p.team) }]} numberOfLines={1}>
                  {sideName(match, p.team)}
                </Text>
              </View>
            ))}
          </View>
        )}

        {error && <Text style={styles.error}>{error}</Text>}

        {isFinal && (
          <View style={styles.doneBtn}>
            <PrimaryButton label="Back to the campfire" onPress={() => router.back()} />
          </View>
        )}
      </ScrollView>
    </Screen>
  );
}

/** One side's panel. Doubles as the read-only score for a watcher and as the scorekeeper's control
 *  — same numbers, and the buttons are the only difference, which is why it is one component. */
function TeamPanel({
  match,
  side,
  elapsedControls,
  busy,
  onStep,
}: {
  match: TeamMatch;
  side: TeamSide;
  /** Whether to render the +/- controls at all. */
  elapsedControls: boolean;
  busy: boolean;
  onStep: (delta: number) => void;
}) {
  const color = sideColor(match, side);
  const score = side === 'a' ? match.score_a : match.score_b;
  // The catalog's own steps, so basketball offers +1/+2/+3 and soccer one big "+1 goal". A build
  // that has never heard of a sport added since it shipped still labels its buttons right.
  const steps = match.step_values.length > 0 ? match.step_values : [1];

  return (
    <View style={[styles.teamPanel, { borderColor: color }]}>
      <Text style={[styles.teamName, { color }]} numberOfLines={1}>
        {sideName(match, side).toUpperCase()}
      </Text>
      <Text style={[styles.teamScore, { color }]}>{score}</Text>
      {elapsedControls && (
        <View style={styles.stepRow}>
          <Pressable
            disabled={busy || score === 0}
            onPress={() => onStep(-1)}
            accessibilityRole="button"
            accessibilityLabel={`Undo a point for ${sideName(match, side)}`}
            style={[styles.stepBtn, { borderColor: color }, (busy || score === 0) && styles.stepBtnOff]}>
            <Text style={[styles.stepGlyph, { color }]}>−</Text>
          </Pressable>
          {steps.map((step) => (
            <Pressable
              key={step}
              disabled={busy}
              onPress={() => onStep(step)}
              accessibilityRole="button"
              accessibilityLabel={`Add ${step} for ${sideName(match, side)}`}
              style={[styles.stepBtn, styles.stepBtnWide, { borderColor: color }, busy && styles.stepBtnOff]}>
              <Text style={[styles.stepLabel, { color }]}>
                {steps.length === 1 ? match.score_step_label : `+${step}`}
              </Text>
            </Pressable>
          ))}
        </View>
      )}
    </View>
  );
}

/**
 * Mode A, on screen. Three states and they are genuinely different asks:
 *
 *   nothing reported  → whoever played types the final score.
 *   reported, my side → waiting on them. Nothing to do, and offering a confirm here would be the
 *                       thing dual confirmation exists to stop (the server refuses it anyway).
 *   reported, other   → confirm it, or say it's wrong.
 */
function ConfirmPanel({
  match,
  played,
  busy,
  act,
}: {
  match: TeamMatch;
  played: boolean;
  busy: boolean;
  act: (fn: () => Promise<unknown>) => Promise<void>;
}) {
  const [a, setA] = useState('');
  const [b, setB] = useState('');
  const reported = match.reported_by !== null;
  const mineReported = reported && match.reported_team === match.my_team;
  const numbersOk = /^\d{1,3}$/.test(a.trim()) && /^\d{1,3}$/.test(b.trim());

  // The host's tiebreak lives here too, because a disputed match with no path forward is the one
  // state this flow can get stuck in.
  const canResolve = match.am_i_admin && (match.score_disputed || reported);

  if (!played && !canResolve) {
    return (
      <View style={styles.panel}>
        <Text style={styles.panelTitle}>Final score, both sides confirm</Text>
        <Text style={styles.hint}>
          Pick a side above to report or confirm the score. Philoi doesn&apos;t keep score for this
          one — the game&apos;s own scoreboard does.
        </Text>
      </View>
    );
  }

  if (reported && !mineReported) {
    return (
      <View style={styles.panel}>
        <Text style={styles.panelTitle}>
          {match.reported_by_name ?? 'They'} reported {match.team_a_name} {match.reported_score_a} –{' '}
          {match.reported_score_b} {match.team_b_name}
        </Text>
        <Text style={styles.hint}>
          You&apos;re on the other side, so it&apos;s yours to confirm. Confirming settles the match
          and pays both teams.
        </Text>
        <View style={styles.ctlRow}>
          <View style={styles.ctlHalf}>
            <SecondaryButton
              label="That's wrong"
              onPress={() => act(() => confirmTeamMatchScore(match.id, false))}
              disabled={busy}
              onDark
              solid
            />
          </View>
          <View style={styles.ctlHalf}>
            <PrimaryButton
              label="Confirm"
              onPress={() => act(() => confirmTeamMatchScore(match.id, true))}
              disabled={busy}
            />
          </View>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.panel}>
      <Text style={styles.panelTitle}>
        {mineReported ? 'Waiting on the other team' : 'What was the final score?'}
      </Text>
      {mineReported ? (
        <Text style={styles.hint}>
          You reported {match.team_a_name} {match.reported_score_a} – {match.reported_score_b}{' '}
          {match.team_b_name}. Someone on {match.reported_team === 'a' ? match.team_b_name : match.team_a_name}{' '}
          has to confirm it before anyone is paid. You can re-enter it below if it was wrong.
        </Text>
      ) : (
        <Text style={styles.hint}>
          Enter it once and someone on the other team confirms — that&apos;s what keeps a score from
          being set by one side alone.
        </Text>
      )}
      {match.score_disputed && (
        <Text style={styles.warn}>
          The last score was disputed. Both sides need to agree on this one
          {match.am_i_admin ? ', or you can settle it as the host.' : '.'}
        </Text>
      )}
      <View style={styles.scoreEntry}>
        <View style={styles.scoreField}>
          <Text style={[styles.scoreFieldLabel, { color: sideColor(match, 'a') }]} numberOfLines={1}>
            {match.team_a_name}
          </Text>
          <TextInput value={a} onChangeText={setA} keyboardType="number-pad" placeholder="0" maxLength={3} />
        </View>
        <Text style={styles.scoreDash}>–</Text>
        <View style={styles.scoreField}>
          <Text style={[styles.scoreFieldLabel, { color: sideColor(match, 'b') }]} numberOfLines={1}>
            {match.team_b_name}
          </Text>
          <TextInput value={b} onChangeText={setB} keyboardType="number-pad" placeholder="0" maxLength={3} />
        </View>
      </View>
      {played && (
        <PrimaryButton
          label="Report this score"
          disabled={busy || !numbersOk}
          onPress={() => act(() => reportTeamMatchScore(match.id, Number(a), Number(b)))}
        />
      )}
      {canResolve && (
        <View style={styles.resolveWrap}>
          <SecondaryButton
            label="Settle it as host"
            disabled={busy || !numbersOk}
            onPress={() => act(() => resolveTeamMatch(match.id, Number(a), Number(b)))}
            onDark
            solid
          />
          <Text style={styles.hint}>
            Settles at the score above without the other side confirming. For a match that stalled.
          </Text>
        </View>
      )}
    </View>
  );
}

/** Mock 177 §D — who won, and what each side gets. The reveal itself is the app's ordinary
 *  challenge reward reveal, fired by ChallengeSettlementWatcher off the payload settlement wrote;
 *  this is the standings behind it. */
function ResultPanel({ match }: { match: TeamMatch }) {
  const draw = match.score_a === match.score_b;
  const winner: TeamSide | null = draw ? null : match.score_a > match.score_b ? 'a' : 'b';

  return (
    <View style={styles.resultWrap}>
      <Text style={styles.resultScore}>
        <Text style={{ color: sideColor(match, 'a') }}>
          {match.team_a_name} {match.score_a}
        </Text>
        <Text style={styles.resultDash}> – </Text>
        <Text style={{ color: sideColor(match, 'b') }}>
          {match.score_b} {match.team_b_name}
        </Text>
      </Text>
      <Text style={styles.hint}>
        {draw
          ? 'A draw — both sides are paid the winners’ tier.'
          : `${sideName(match, winner!)} take it.`}
      </Text>

      {(['a', 'b'] as const).map((side) => {
        const won = draw || side === winner;
        return (
          <View key={side} style={[styles.resultRow, { borderColor: sideColor(match, side) }]}>
            <Text style={styles.resultIcon}>{won ? '🏆' : '🤝'}</Text>
            <View style={styles.resultText}>
              <Text style={[styles.resultTeam, { color: sideColor(match, side) }]} numberOfLines={1}>
                {sideName(match, side)}
              </Text>
              <Text style={styles.resultSub}>
                {won ? 'Winners · everyone on this side' : 'Good game · everyone on this side'}
              </Text>
            </View>
            <View style={[styles.resultTag, won ? styles.tagWin : styles.tagLose]}>
              <Text style={won ? styles.tagWinText : styles.tagLoseText}>
                {(won ? match.winner_reward_tier : match.loser_reward_tier).toUpperCase()}
              </Text>
            </View>
          </View>
        );
      })}
      <Text style={styles.everyone}>Every player on both teams earns a reward — win or lose.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { paddingBottom: Spacing.five, gap: Spacing.two },
  centred: { marginTop: Spacing.five },
  empty: {
    fontFamily: Fonts.body,
    fontSize: 13,
    color: Colors.muted,
    textAlign: 'center',
    marginTop: Spacing.five,
  },
  hero: { alignItems: 'center', gap: 3, marginTop: Spacing.twelve, marginBottom: Spacing.two },
  eyebrow: {
    fontFamily: Fonts.bodyBold,
    fontSize: 10.5,
    letterSpacing: 2,
    color: Colors.coral,
  },
  clock: { fontFamily: Fonts.displayHeavy, fontSize: 14, color: Colors.ember },
  subhead: { fontFamily: Fonts.body, fontSize: 11.5, color: Colors.muted },
  teamPanel: {
    borderWidth: 2,
    borderRadius: Radius.card + 4,
    backgroundColor: Colors.cardDark,
    padding: Spacing.twelve,
    alignItems: 'center',
    gap: Spacing.one,
  },
  teamName: { fontFamily: Fonts.bodyBold, fontSize: 13, letterSpacing: 0.5 },
  teamScore: { fontFamily: Fonts.displayHeavy, fontSize: 52, lineHeight: 56 },
  stepRow: { flexDirection: 'row', gap: Spacing.two, alignSelf: 'stretch' },
  stepBtn: {
    minWidth: 54,
    height: 44,
    borderRadius: Radius.button,
    borderWidth: 1,
    backgroundColor: Colors.twilight900,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepBtnWide: { flex: 1 },
  stepBtnOff: { opacity: 0.4 },
  stepGlyph: { fontFamily: Fonts.displayHeavy, fontSize: 20 },
  stepLabel: { fontFamily: Fonts.bodyBold, fontSize: 14 },
  ctlRow: { flexDirection: 'row', gap: Spacing.two, marginTop: Spacing.two },
  ctlHalf: { flex: 1 },
  note: { fontFamily: Fonts.body, fontSize: 11, color: Colors.textTertiary, textAlign: 'center' },
  joinRow: { flexDirection: 'row', gap: Spacing.two, marginTop: Spacing.two },
  joinBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    height: 44,
    paddingHorizontal: Spacing.two,
    borderRadius: Radius.button,
    borderWidth: 1,
  },
  joinText: { fontFamily: Fonts.bodyBold, fontSize: 12.5, flexShrink: 1 },
  panel: {
    backgroundColor: Colors.card,
    borderRadius: Radius.card,
    borderWidth: 1,
    borderColor: Colors.line,
    padding: Spacing.twelve,
    gap: Spacing.two,
    marginTop: Spacing.two,
  },
  panelTitle: { fontFamily: Fonts.bodyBold, fontSize: 13.5, color: Colors.ink },
  scoreEntry: { flexDirection: 'row', alignItems: 'flex-end', gap: Spacing.two },
  scoreField: { flex: 1, gap: 4 },
  scoreFieldLabel: { fontFamily: Fonts.bodyBold, fontSize: 11.5 },
  scoreDash: { fontFamily: Fonts.displayHeavy, fontSize: 18, color: Colors.muted, paddingBottom: Spacing.twelve },
  resolveWrap: { gap: Spacing.two, marginTop: Spacing.two },
  resultWrap: { gap: Spacing.two, marginTop: Spacing.twelve },
  resultScore: { fontFamily: Fonts.displayHeavy, fontSize: 24, textAlign: 'center' },
  resultDash: { color: Colors.muted },
  resultRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    borderWidth: 1,
    borderRadius: Radius.card,
    backgroundColor: Colors.cardDark,
    padding: Spacing.twelve,
  },
  resultIcon: { fontSize: 20 },
  resultText: { flex: 1, gap: 2 },
  resultTeam: { fontFamily: Fonts.bodyBold, fontSize: 13.5 },
  resultSub: { fontFamily: Fonts.body, fontSize: 11, color: Colors.muted },
  resultTag: { paddingHorizontal: Spacing.two, paddingVertical: 4, borderRadius: Radius.pill },
  tagWin: { backgroundColor: Colors.green },
  tagLose: { backgroundColor: Colors.disabled },
  tagWinText: { fontFamily: Fonts.bodyBold, fontSize: 9.5, letterSpacing: 0.5, color: Colors.twilight900 },
  tagLoseText: { fontFamily: Fonts.bodyBold, fontSize: 9.5, letterSpacing: 0.5, color: Colors.ink },
  everyone: {
    fontFamily: Fonts.body,
    fontSize: 11.5,
    color: Colors.coldChipText,
    textAlign: 'center',
    marginTop: Spacing.one,
  },
  label: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 10.5,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    color: Colors.textTertiary,
    marginTop: Spacing.twelve,
  },
  hint: { fontFamily: Fonts.body, fontSize: 11.5, color: Colors.muted, lineHeight: 16 },
  warn: { fontFamily: Fonts.body, fontSize: 11.5, color: Colors.danger, lineHeight: 16 },
  error: { fontFamily: Fonts.body, fontSize: 12, color: Colors.danger, marginTop: Spacing.two },
  rosterWrap: { gap: Spacing.one },
  rosterRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, paddingVertical: 4 },
  rosterName: { flex: 1, fontFamily: Fonts.bodySemiBold, fontSize: 13, color: Colors.ink },
  rosterDot: { width: 8, height: 8, borderRadius: 4 },
  rosterTeam: { fontFamily: Fonts.bodySemiBold, fontSize: 11.5, maxWidth: 110 },
  doneBtn: { marginTop: Spacing.four },
});
