import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import { ChallengeManageSheet } from '@/components/challenge-manage-sheet';
import { GradeReportSheet } from '@/components/grade-report-sheet';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { PublicTitle } from '@/components/economy/loadout-bits';
import { Avatar } from '@/components/ui/avatar';
import { usePublicLoadout } from '@/hooks/use-public-loadouts';
import { cancelSocialChallenge, respondToH2HChallenge } from '@/lib/api/social-challenges';
import { getErrorMessage } from '@/lib/errors';
import {
  challengeTitle,
  formatMetricValue,
  gradeChallengeLabel,
  isGrade,
  isPlacement,
  metricLabel,
} from '@/lib/challenge-metric';
import { duelOutcome, isFinished, isSettled, type ChallengeVerdict } from '@/lib/challenge-outcome';
import { formatTimeLeft } from '@/lib/format';
import type { SocialChallenge } from '@/types/database';

type SocialChallengeCardProps = {
  challenge: SocialChallenge;
  myUserId: string;
  onChanged: () => void;
  /** Campfire-admin, when the card is rendered inside a campfire. Widens who is offered Delete
   *  in the manage sheet; the RPC is what actually decides. */
  isAdmin?: boolean;
};

export function SocialChallengeCard({ challenge: c, myUserId, onChanged, isAdmin = false }: SocialChallengeCardProps) {
  const router = useRouter();
  const [manageOpen, setManageOpen] = useState(false);
  const [gradeOpen, setGradeOpen] = useState(false);
  const isInvite = c.mode === 'h2h' && c.status === 'pending' && c.opponent_id === myUserId;
  const isOutgoingPending = c.mode === 'h2h' && c.status === 'pending' && c.created_by === myUserId;
  const isMine = c.created_by === myUserId;
  const otherId = isMine ? c.opponent_id : c.created_by;
  const oppLoadout = usePublicLoadout(otherId);
  const otherName = (isMine ? (c.opponent_name ?? 'them') : c.created_by_name) ?? 'them';

  function handleRematch() {
    if (!otherId) return;
    router.push({
      pathname: '/challenge/create',
      params: { opponentId: otherId, opponentName: otherName, mode: 'h2h' },
    });
  }

  /** A group race cannot be "rematched" against one person — running it again means starting a
   *  fresh one in the same campfire, which is what the create screen does with a groupId. */
  function handleRunAgain() {
    if (!c.circle_id) return;
    router.push({ pathname: '/challenge/create', params: { groupId: c.circle_id } });
  }

  async function handleRespond(accept: boolean) {
    try {
      await respondToH2HChallenge(c.id, accept);
      onChanged();
    } catch (e) {
      Alert.alert('Something went wrong', getErrorMessage(e, 'Could not respond to this challenge.'));
    }
  }

  function handleCancel(confirmLabel: string, confirmMessage: string) {
    Alert.alert(confirmLabel, confirmMessage, [
      { text: 'Never mind', style: 'cancel' },
      {
        text: confirmLabel,
        style: 'destructive',
        onPress: async () => {
          try {
            await cancelSocialChallenge(c.id);
            onChanged();
          } catch (e) {
            Alert.alert('Something went wrong', getErrorMessage(e, 'Could not cancel this challenge.'));
          }
        },
      },
    ]);
  }

  // Was a two-branch ternary written when the metric set was {lockin_time, xp}: since 0096 it can
  // also be volume, distance or ai, and all three fell through to "Most XP" / "12000 XP". One
  // shared spec now (challenge-metric.ts) rather than a copy of this on every screen.
  const fmtScore = (n: number) => formatMetricValue(c.race_metric, n);
  const grade = isGrade(c);
  // A grade race is named by its bar, not by "Grade target" — the label row is where the shape is
  // announced, and "70% in KP451" is the thing worth reading.
  const raceLabel = grade ? gradeChallengeLabel(c) : metricLabel(c.race_metric);
  // public_name is what the spec titles the card with; it was written at creation and read by
  // nothing until 0112 started selecting it.
  const title = challengeTitle(c);
  const finished = isFinished(c.status);
  const manageSheet = manageOpen ? (
    <ChallengeManageSheet
      challenge={c}
      myUserId={myUserId}
      isAdmin={isAdmin}
      onClose={() => setManageOpen(false)}
      onChanged={onChanged}
    />
  ) : null;

  /** The grade sheet, mounted from whichever branch is rendering. Only a racer on the roster can
   *  report, and only while the race is live — the RPC enforces both; this just declines to offer
   *  an action that would be refused. */
  const canReportGrade = grade && !finished && c.my_state === 'accepted';
  const gradeSheet = gradeOpen ? (
    <GradeReportSheet
      challengeId={c.id}
      courseCode={c.course_code}
      target={c.grade_target}
      current={c.my_reported_value}
      onClose={() => setGradeOpen(false)}
      onReported={onChanged}
    />
  ) : null;

  // ── Outgoing invite you sent, still unanswered ──────────────────────────────
  if (isOutgoingPending) {
    return (
      <View style={[styles.card, styles.cardPending]}>
        <PendingStripe />
        <View style={styles.labelRow}>
          <View style={styles.labelLeft}>
            <Ionicons name="flash" size={12} color={Colors.achieverText} />
            <Text style={styles.labelText}>Head-to-head</Text>
          </View>
          <Text style={styles.pendingClock}>waiting for an answer</Text>
        </View>
        <Text style={styles.title}>Challenged {otherName} · {title}</Text>
        <Pressable style={styles.cancelLink} onPress={() => handleCancel('Cancel challenge', `Cancel your challenge to ${otherName}?`)}>
          <Text style={styles.cancelLinkText}>Cancel</Text>
        </Pressable>
      </View>
    );
  }

  // ── Incoming invite (accept / decline) ─────────────────────────────────────
  if (isInvite) {
    return (
      <View style={[styles.card, styles.cardInvite]}>
        <View style={styles.labelRow}>
          <View style={styles.labelLeft}>
            <Ionicons name="flash" size={12} color={Colors.achieverText} />
            <Text style={styles.labelText}>Head-to-head</Text>
          </View>
          <Text style={styles.clock}>{c.created_by_name} challenged you</Text>
        </View>
        <Text style={styles.title}>{title} · who wins in {c.window_hours}h</Text>
        <View style={styles.footRow}>
          <Ionicons name="trophy" size={12} color={Colors.achieverText} />
          <Text style={styles.footText}>winner +{c.payout_xp} XP</Text>
        </View>
        <View style={styles.actsRow}>
          <Pressable style={styles.acceptBtn} onPress={() => handleRespond(true)}>
            <Text style={styles.acceptLabel}>Accept</Text>
          </Pressable>
          <Pressable style={styles.declineBtn} onPress={() => handleRespond(false)}>
            <Text style={styles.declineLabel}>Decline</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  // ── H2H tug-of-war scoreboard (active / completed) — mock 44 ────────────────
  if (c.mode === 'h2h') {
    // 🔴 THE INVERTED WINNER. This block used to derive "who is ahead" three separate ways — a
    // boolean over a three-valued result, a `tied` flag taken from the live scores rather than the
    // settled one, and a lead line that never changed tense — and a finished duel could therefore
    // draw the bar with You ahead while printing "Noah Brikman won" underneath it. One derivation
    // now, in lib/challenge-outcome.ts, which every other finished surface reads too.
    const o = duelOutcome(c, myUserId, otherName);
    // A reported grade of null is "not in yet", which is a different thing from a reported zero
    // and must not render as one. Only the grade branch can see a null score at all: every other
    // metric is observed and always has a number.
    const myMark = c.my_score;
    const oppMark = c.opponent_score;
    const showMark = (v: number | null) => (grade ? (v == null ? '—' : fmtScore(v)) : fmtScore(v ?? 0));

    return (
      <View style={styles.card}>
        <View style={styles.labelRow}>
          <View style={styles.labelLeft}>
            <Ionicons name={grade ? 'school' : 'flash'} size={12} color={Colors.achieverText} />
            <Text style={styles.labelText} numberOfLines={1}>{raceLabel}</Text>
          </View>
          <View style={styles.labelLeft}>
            {c.status === 'active' && <View style={styles.livePulse} />}
            <Text style={styles.clock}>{finished ? 'finished' : formatTimeLeft(c.ends_at)}</Text>
            <ManageKebab visible onPress={() => setManageOpen(true)} />
          </View>
        </View>

        {/* The public name, when there is one, is the headline — the metric has already said what
            the race is in the label row above. */}
        {c.public_name ? (
          <Text style={styles.title} numberOfLines={1}>
            {c.public_name}
          </Text>
        ) : null}

        <View style={styles.matchRow}>
          <View style={styles.matchSide}>
            <View style={[styles.ring, styles.ringYou]}>
              <Avatar label="You" size={40} lit />
            </View>
            <Text style={styles.matchName} numberOfLines={1}>You</Text>
            <Text style={[styles.matchScore, { color: Colors.coral }]}>{showMark(myMark)}</Text>
          </View>
          <Text style={styles.vsText}>VS</Text>
          <View style={styles.matchSide}>
            <View style={[styles.ring, styles.ringOpp]}>
              <Avatar label={otherName} size={40} textColor={Colors.sky} />
            </View>
            <Text style={styles.matchName} numberOfLines={1}>{otherName}</Text>
            {/* Your opponent's equipped title — a 1v1 header is exactly where a "Final Boss" or a
                season placement title is supposed to land (21j / mock 64). */}
            <PublicTitle loadout={oppLoadout} compact />
            <Text style={[styles.matchScore, { color: Colors.sky }]}>{showMark(oppMark)}</Text>
          </View>
        </View>

        {/* THE BAR IS NOT DRAWN FOR A GRADE RACE. A tug-of-war splits a shared total between two
            people, and two marks out of 100 are not a shared total — 70 vs 68 would draw as a
            near-even tug when the real story is that both cleared the bar. A grade race is
            measured against the target, so that is what is shown. */}
        {grade ? (
          <GradeBars target={c.grade_target} mine={myMark} theirs={oppMark} otherName={otherName} />
        ) : (
          <>
            <View style={styles.tugTrack}>
              <View style={[styles.tugYou, { width: `${o.myPercent}%` }]} />
              <View style={styles.tugOpp} />
            </View>
            <Text
              style={[
                styles.leadLabel,
                { color: o.viewerAhead == null ? Colors.muted : o.viewerAhead ? Colors.amber : Colors.sky },
              ]}>
              {o.viewerAhead != null ? '🔥 ' : ''}
              {o.leadText}
            </Text>
          </>
        )}

        {canReportGrade ? (
          <Pressable style={styles.reportBtn} onPress={() => setGradeOpen(true)} accessibilityRole="button">
            <Ionicons name="create-outline" size={13} color={Colors.ink} />
            <Text style={styles.reportLabel}>
              {c.my_reported_value == null ? 'Enter your mark' : 'Update your mark'}
            </Text>
          </Pressable>
        ) : null}

        {/* No "Winner +N XP" row here any more (mock 102 v2): the browse surface stays avatars +
            bar + lead + clock, and every reward/rule moved to the Challenge info screen. The
            RESULT line below stays — once it is over, what you won is the news, not clutter. */}

        {finished && (
          <ResultFooter
            verdict={o.verdict}
            text={o.verdict === 'won' ? `You won +${c.payout_xp} XP` : o.verdictText}
            actionLabel="Rematch"
            onAction={otherId ? handleRematch : undefined}
          />
        )}
        {/* The old unilateral "Leave challenge" link is gone — ending a race the other person is
            still running is now a request they answer (mock 70/71), reached through the trash
            above. The no-consent route survives as "forfeit & leave" inside that sheet. */}
        {/* Mounted only while open, so it re-seeds its editable terms from the live challenge
            every time rather than syncing props into state in an effect. */}
        {manageSheet}
        {gradeSheet}
      </View>
    );
  }

  // ── Placement: a ranked board, not a completion bar (mock 114) ──────────────
  //
  // This branch has to come FIRST, because a placement race is mode = 'group' and would otherwise
  // fall into the block below and claim three things that are not true of it: that it is "all or
  // nothing" (it has no shared target), that everyone must lock in `target_count`× (null by
  // constraint, so the title would read "Everyone locks in null×"), and that 0 of 48 are "done"
  // (nothing is there to be done). The segment strip would draw 48 empty pips that can never fill.
  if (isPlacement(c)) {
    const field = c.member_count ?? c.accepted_count ?? 0;
    return (
      <View style={styles.card}>
        <View style={styles.labelRow}>
          <View style={styles.labelLeft}>
            <Ionicons name="trophy" size={12} color={Colors.achieverText} />
            <Text style={styles.labelText}>Placement · ranked</Text>
          </View>
          <View style={styles.labelLeft}>
            {c.status === 'active' && <View style={styles.livePulse} />}
            <Text style={styles.clock}>{finished ? 'finished' : formatTimeLeft(c.ends_at)}</Text>
            <ManageKebab visible onPress={() => setManageOpen(true)} />
          </View>
        </View>

        <Text style={styles.title}>{title}</Text>

        <View style={styles.groupCountRow}>
          <Text style={styles.groupCount}>
            <Text style={styles.groupCountBig}>{field}</Text>
            <Text style={styles.groupCountMuted}> racing · {raceLabel.toLowerCase()}</Text>
          </Text>
        </View>

        <View style={styles.footRow}>
          <Ionicons name="trophy" size={12} color={Colors.achieverText} />
          <Text style={styles.footText}>Everyone places · rewards scale with your band</Text>
        </View>

        {canReportGrade ? (
          <Pressable style={styles.reportBtn} onPress={() => setGradeOpen(true)} accessibilityRole="button">
            <Ionicons name="create-outline" size={13} color={Colors.ink} />
            <Text style={styles.reportLabel}>
              {c.my_reported_value == null ? 'Enter your mark' : `Your mark · ${fmtScore(c.my_reported_value)}`}
            </Text>
          </Pressable>
        ) : null}

        {/* A finished placement board had NOTHING to say before this — only the duel branch
            rendered a result, which is half of why finished challenges looked inconsistent. The
            viewer's own standing has been written by settlement since 0111; 0145 is the first
            thing to select it. */}
        {finished && (
          <ResultFooter
            verdict={placementVerdict(c.my_final_rank)}
            text={placementText(c.my_final_rank, field, c.status)}
            actionLabel="Run it again"
            onAction={c.circle_id ? handleRunAgain : undefined}
          />
        )}

        {manageSheet}
        {gradeSheet}
      </View>
    );
  }

  // ── Group "all or nothing" completion — mock 45 language ────────────────────
  const memberCount = c.member_count ?? 0;
  const completedCount = c.completed_count ?? 0;
  const segments = Array.from({ length: Math.max(memberCount, 1) }, (_, i) => i < completedCount);
  const everyoneDone = memberCount > 0 && completedCount >= memberCount;
  // A collective goal that is still waiting on invitations is not the same card as one that is
  // running, and stacking them read as one undifferentiated list. 'draft'/'pending' is the band
  // (challenge_is_awaiting server-side) — the same cut the outgoing-invite branch above makes for
  // a duel, which is the shape this is being made consistent with.
  const awaitingAnswers = c.status === 'draft' || c.status === 'pending';

  return (
    <View style={[styles.card, awaitingAnswers && styles.cardPending]}>
      {awaitingAnswers ? <PendingStripe /> : null}
      <View style={styles.labelRow}>
        <View style={styles.labelLeft}>
          <Ionicons name={grade ? 'school' : 'people'} size={12} color={Colors.achieverText} />
          <Text style={styles.labelText}>{grade ? 'Course · all or nothing' : 'Group · all or nothing'}</Text>
        </View>
        <View style={styles.labelLeft}>
          {c.status === 'active' && <View style={styles.livePulse} />}
          <Text style={awaitingAnswers ? styles.pendingClock : styles.clock}>
            {finished
              ? 'finished'
              : awaitingAnswers
                ? c.invited_count > 0
                  ? `waiting on ${c.invited_count}`
                  : 'not started yet'
                : formatTimeLeft(c.ends_at)}
          </Text>
          <ManageKebab visible onPress={() => setManageOpen(true)} />
        </View>
      </View>

      <Text style={styles.title}>{title}</Text>

      <View style={styles.groupCountRow}>
        <Text style={styles.groupCount}>
          <Text style={[styles.groupCountBig, everyoneDone && { color: Colors.green }]}>{completedCount}</Text>
          <Text style={styles.groupCountMuted}> / {memberCount} done</Text>
        </Text>
        {everyoneDone && <Text style={styles.groupDoneTag}>Everyone finished 🎉</Text>}
      </View>

      <View style={styles.segRow}>
        {segments.map((on, i) => (
          <View key={i} style={[styles.seg, on && styles.segOn]} />
        ))}
      </View>

      <View style={styles.footRow}>
        <Ionicons name="trophy" size={12} color={Colors.achieverText} />
        <Text style={styles.footText}>Everyone who finishes scores</Text>
      </View>

      {canReportGrade ? (
        <Pressable style={styles.reportBtn} onPress={() => setGradeOpen(true)} accessibilityRole="button">
          <Ionicons name="create-outline" size={13} color={Colors.ink} />
          <Text style={styles.reportLabel}>
            {c.my_reported_value == null ? 'Enter your mark' : `Your mark · ${fmtScore(c.my_reported_value)}`}
          </Text>
        </Pressable>
      ) : null}

      {/* Same footer, same shape, same place as the duel's and the board's. A collective goal that
          expired because the house did not all finish is a RESULT, and rendering nothing for it
          left the tab with three different ideas of what a finished challenge looks like. */}
      {finished && (
        <ResultFooter
          verdict={isSettled(c.status) ? 'won' : 'lost'}
          text={
            isSettled(c.status)
              ? `Everyone finished · +${c.payout_xp} XP`
              : `${completedCount} of ${memberCount} made it`
          }
          actionLabel="Run it again"
          onAction={c.circle_id ? handleRunAgain : undefined}
        />
      )}

      {manageSheet}
      {gradeSheet}
    </View>
  );
}

/**
 * ONE FINISHED-CHALLENGE FOOTER, for all three shapes.
 *
 * Finished results used to be rendered inconsistently: a duel got a full vs-card with a verdict and
 * a Rematch, a collective goal got nothing at all, and a placement board got nothing at all — so
 * "what a finished challenge looks like" depended on which shape it was. Every shape ends the same
 * way now — a verdict in the colour of the outcome, and one button to run it again.
 */
function ResultFooter({
  verdict,
  text,
  actionLabel,
  onAction,
}: {
  verdict: ChallengeVerdict;
  text: string;
  actionLabel: string;
  onAction?: () => void;
}) {
  return (
    <View style={styles.resultRow}>
      <Text
        style={[
          styles.resultText,
          verdict === 'draw' ? styles.resultTied : verdict === 'won' ? styles.resultWon : styles.resultLost,
        ]}
        numberOfLines={1}>
        {text}
      </Text>
      {onAction ? (
        <Pressable style={styles.rematchBtn} onPress={onAction} accessibilityRole="button">
          <Ionicons name="refresh" size={12} color={Colors.achieverText} />
          <Text style={styles.rematchText}>{actionLabel}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/** Top third of the field reads as a win, bottom third as a loss, the middle as neither. Purely a
 *  colour choice — the reward that was actually paid scales continuously with the percentile. */
function placementVerdict(rank: number | null): ChallengeVerdict {
  if (rank == null) return 'undecided';
  return rank === 1 ? 'won' : 'draw';
}

function placementText(rank: number | null, field: number, status: string): string {
  if (!isSettled(status)) return 'Race ended · nobody placed';
  if (rank == null) return 'Board is final';
  if (rank === 1) return field > 1 ? `You won · 1st of ${field}` : 'You won';
  return `You placed ${ordinal(rank)}${field > 1 ? ` of ${field}` : ''}`;
}

function ordinal(n: number): string {
  const rem100 = n % 100;
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}

/**
 * TWO MARKS AGAINST ONE BAR.
 *
 * The tug-of-war the other metrics use answers "who has more of the shared pile", which is not the
 * question a grade race asks. Both racers agreed to the same target, so what matters is how each
 * one sits relative to it — and both of them clearing it is a good outcome for both, not a
 * near-tie. A meter each, with the target marked, says that; a split bar cannot.
 */
function GradeBars({
  target,
  mine,
  theirs,
  otherName,
}: {
  target: number | null;
  mine: number | null;
  theirs: number | null;
  otherName: string;
}) {
  return (
    <View style={styles.gradeWrap}>
      <GradeBar label="You" value={mine} target={target} tint={Colors.coral} />
      <GradeBar label={otherName} value={theirs} target={target} tint={Colors.sky} />
      {target != null ? (
        <Text style={styles.gradeTargetNote}>Target {Number(target.toFixed(1))}%</Text>
      ) : null}
    </View>
  );
}

function GradeBar({
  label,
  value,
  target,
  tint,
}: {
  label: string;
  value: number | null;
  target: number | null;
  tint: string;
}) {
  const cleared = value != null && target != null && value >= target;
  return (
    <View style={styles.gradeRow}>
      <Text style={styles.gradeName} numberOfLines={1}>
        {label}
      </Text>
      <View style={styles.gradeTrack}>
        <View style={[styles.gradeFill, { width: `${Math.max(0, Math.min(100, value ?? 0))}%`, backgroundColor: tint }]} />
        {/* The bar, drawn on the meter rather than written underneath it — the whole point of the
            meter is being able to see the gap without doing arithmetic. */}
        {target != null ? <View style={[styles.gradeTick, { left: `${Math.min(100, target)}%` }]} /> : null}
      </View>
      <Text style={[styles.gradeValue, cleared && styles.gradeValueOk]}>
        {value == null ? 'not in' : `${Number(value.toFixed(1))}%`}
      </Text>
    </View>
  );
}

/** A hairline down the card's leading edge. Cheaper to read at a glance than the 0.85 opacity that
 *  was the only thing separating a waiting-on-an-answer card from a live one. */
function PendingStripe() {
  return <View style={styles.pendingStripe} />;
}

// THE ⋯ KEBAB — top-right of the card, after the time-left.
//
// This was a trash can (mock 72), and CAMPFIRE_REDESIGN_SPEC's 🔴 is precisely that: "Manage = a
// kebab / hamburger, not a trash can. The trash-can-as-manage is confusing." It was already the
// wrong glyph for what it did — the old comment here argued at length that the trash was "neutral
// on purpose" because it opens Manage rather than deleting anything, which is the tell: an icon
// that needs a paragraph explaining it does not mean what it depicts is the wrong icon. Now that
// Delete genuinely lives inside the sheet, a trash can would be actively misleading about which
// of the four actions you were about to get.
//
// Visible on every card that has a sheet to open, not only active ones: Delete has to be reachable
// on a draft that never started and on a finished row, which is where it is most wanted.
function ManageKebab({ visible, onPress }: { visible: boolean; onPress: () => void }) {
  if (!visible) return null;
  return (
    <Pressable onPress={onPress} hitSlop={8} style={styles.manageKebab} accessibilityRole="button" accessibilityLabel="Manage challenge">
      <Ionicons name="ellipsis-horizontal" size={15} color={Colors.muted} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.card,
    borderRadius: Radius.card,
    padding: Spacing.three,
    overflow: 'hidden',
  },
  cardInvite: {
    borderWidth: 1,
    borderColor: Colors.coral,
    backgroundColor: Colors.selectedBg,
  },
  cardPending: {
    opacity: 0.9,
  },
  pendingStripe: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: 3,
    backgroundColor: Colors.amber,
  },
  manageKebab: {
    width: 28,
    height: 28,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    marginLeft: 3,
  },
  cancelLink: {
    marginTop: Spacing.two,
    alignSelf: 'flex-start',
  },
  cancelLinkText: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 11.5,
    color: Colors.danger,
  },
  labelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: Spacing.two,
  },
  labelLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    flexShrink: 1,
  },
  labelText: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 11,
    color: Colors.achieverText,
    flexShrink: 1,
  },
  clock: {
    fontFamily: Fonts.body,
    fontSize: 11,
    color: Colors.muted,
  },
  pendingClock: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 11,
    color: Colors.amber,
  },
  livePulse: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: Colors.coral,
  },
  title: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 13.5,
    color: Colors.ink,
    marginBottom: Spacing.two,
  },
  // ── H2H tug-of-war ──
  matchRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginTop: Spacing.one,
    marginBottom: Spacing.two,
  },
  matchSide: {
    width: 96,
    alignItems: 'center',
    gap: 4,
  },
  ring: {
    borderRadius: 999,
    borderWidth: 2.5,
    padding: 1,
  },
  ringYou: {
    borderColor: Colors.coral,
  },
  ringOpp: {
    borderColor: Colors.sky,
  },
  matchName: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 12.5,
    color: Colors.ink,
    maxWidth: 92,
  },
  matchScore: {
    fontFamily: Fonts.bodyBold,
    fontSize: 15,
    fontVariant: ['tabular-nums'],
  },
  vsText: {
    fontFamily: Fonts.bodyBold,
    fontSize: 12,
    color: Colors.textTertiary,
    marginTop: 22,
  },
  tugTrack: {
    flexDirection: 'row',
    height: 12,
    borderRadius: Radius.pill,
    backgroundColor: Colors.sky,
    overflow: 'hidden',
    marginTop: Spacing.one,
  },
  tugYou: {
    backgroundColor: Colors.coral,
    height: '100%',
  },
  tugOpp: {
    flex: 1,
  },
  leadLabel: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 11.5,
    textAlign: 'center',
    marginTop: 7,
  },
  // ── grade meters ──
  gradeWrap: {
    gap: 6,
    marginTop: Spacing.one,
  },
  gradeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  gradeName: {
    width: 62,
    fontFamily: Fonts.bodySemiBold,
    fontSize: 11.5,
    color: Colors.muted,
  },
  gradeTrack: {
    flex: 1,
    height: 10,
    borderRadius: Radius.pill,
    backgroundColor: Colors.disabled,
    overflow: 'hidden',
  },
  gradeFill: {
    height: '100%',
    borderRadius: Radius.pill,
  },
  gradeTick: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 2,
    backgroundColor: Colors.ink,
    opacity: 0.65,
  },
  gradeValue: {
    width: 52,
    textAlign: 'right',
    fontFamily: Fonts.bodyBold,
    fontSize: 12,
    color: Colors.muted,
    fontVariant: ['tabular-nums'],
  },
  gradeValueOk: {
    color: Colors.green,
  },
  gradeTargetNote: {
    fontFamily: Fonts.body,
    fontSize: 10.5,
    color: Colors.textTertiary,
    textAlign: 'center',
    marginTop: 1,
  },
  reportBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: Spacing.two,
    paddingVertical: 9,
    borderRadius: Radius.input,
    backgroundColor: Colors.selectedBg,
    borderWidth: 1,
    borderColor: Colors.lineStrong,
  },
  reportLabel: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 12,
    color: Colors.ink,
  },
  // ── Group ──
  groupCountRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
  },
  groupCount: {
    fontFamily: Fonts.body,
  },
  groupCountBig: {
    fontFamily: Fonts.bodyBold,
    fontSize: 18,
    color: Colors.ink,
  },
  groupCountMuted: {
    fontFamily: Fonts.body,
    fontSize: 12.5,
    color: Colors.muted,
  },
  groupDoneTag: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 11,
    color: Colors.green,
  },
  segRow: {
    flexDirection: 'row',
    gap: 5,
    marginTop: 8,
  },
  seg: {
    flex: 1,
    height: 8,
    borderRadius: Radius.pill,
    backgroundColor: Colors.disabled,
  },
  segOn: {
    backgroundColor: Colors.green,
  },
  // ── shared footer / result ──
  footRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: Spacing.two,
  },
  footText: {
    flex: 1,
    fontFamily: Fonts.bodySemiBold,
    fontSize: 11.5,
    color: Colors.achieverText,
  },
  resultRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
    marginTop: Spacing.two,
    paddingTop: Spacing.two,
    borderTopWidth: 1,
    borderTopColor: Colors.line,
  },
  resultText: {
    flexShrink: 1,
    fontFamily: Fonts.bodyBold,
    fontSize: 13,
  },
  resultWon: {
    color: Colors.green,
  },
  resultLost: {
    color: Colors.muted,
  },
  resultTied: {
    color: Colors.amber,
  },
  rematchBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: Colors.achieverBg,
    borderRadius: Radius.pill,
    paddingVertical: 5,
    paddingHorizontal: 10,
  },
  rematchText: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 11,
    color: Colors.achieverText,
  },
  actsRow: {
    flexDirection: 'row',
    gap: Spacing.two,
    marginTop: Spacing.two,
  },
  acceptBtn: {
    flex: 1,
    backgroundColor: Colors.coral,
    borderRadius: Radius.input,
    paddingVertical: Spacing.two,
    alignItems: 'center',
  },
  acceptLabel: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 12.5,
    color: Colors.ink,
  },
  declineBtn: {
    flex: 1,
    borderWidth: 1,
    borderColor: Colors.lineStrong,
    borderRadius: Radius.input,
    paddingVertical: Spacing.two,
    alignItems: 'center',
  },
  declineLabel: {
    fontFamily: Fonts.body,
    fontSize: 12.5,
    color: Colors.muted,
  },
});
