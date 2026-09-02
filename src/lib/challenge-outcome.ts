import type { RewardRevealKind } from '@/components/economy/reward-reveal';
import { formatMetricValue } from '@/lib/challenge-metric';
import { formatTimeLeft } from '@/lib/format';
import type { ChallengeShape, SocialChallenge } from '@/types/database';

/**
 * WHICH OF THE THREE CHALLENGE REVEALS THIS IS, so it queues at its own priority — a placement
 * result outranks a duel, and all three clear before a rank-up.
 *
 * Shared because there are TWO places a challenge reveal can be presented from: the global
 * settlement watcher, and the challenge-info screen when you open a settled race yourself. They
 * consume the same one-per-challenge budget (`reward_seen_at`), so they must also agree on what
 * kind of reveal it is — otherwise the same settlement queues at two different priorities
 * depending on which door it came through.
 *
 * `shape` is the authoritative field; `mode` only distinguishes h2h from group and says nothing
 * about placement races.
 */
export function challengeRevealKind(c: { shape?: ChallengeShape | null; mode?: string }): RewardRevealKind {
  if (c.shape === 'placement') return 'challenge_placement';
  if (c.shape === 'collective' || c.mode === 'group') return 'challenge_team';
  return 'challenge_solo';
}

// ONE PLACE THAT KNOWS WHO WON.
//
// 🔴 The bug this exists for. A finished duel rendered "You 2h 12m vs Noah 32m", drew the bar with
// YOU ahead, and then printed "Noah Brikman leads by 1h 40m" and "Noah Brikman won" underneath it.
// Three statements about one race, from three different derivations, and two of them wrong.
//
// The card was doing this:
//
//   const ahead = c.status === 'completed' ? c.winner_id === myUserId : myScore > oppScore;
//   const tied  = myScore === oppScore;
//   ... tied ? "It's a tie" : ahead ? 'You won' : `${otherName} won`
//
// Two independent faults in three lines:
//
//   1. `ahead` is a BOOLEAN over a three-valued result. A settled duel is won / lost / DRAWN, and
//      the server records a draw as `winner_id IS NULL`. So a real draw fell out of `ahead` as
//      false and rendered as the opponent winning — the exact screenshot. It only ever read "It's
//      a tie" when `tied` caught it first, and `tied` is derived from the two LIVE scores, not
//      from the settled result. The scores agreeing numerically is a coincidence the copy was
//      relying on: the "Most XP 1,116 vs 1,116" case rendered correctly for that reason and no
//      other.
//
//   2. The lead line never changed tense. `leadText` is built once and says "leads by" whether the
//      clock is running or the race settled a week ago.
//
// THE RULE, and the reason this is a module rather than a tidier ternary: once a challenge is
// settled the STORED RESULT IS AUTHORITATIVE. `winner_id` is what finalize_social_challenges wrote,
// what the economy trigger paid against, and what the notification announced. The two live scores
// are a display of the same race computed a second way, and a screen that lets them outvote the
// stored result will disagree with the embers already in the wallet. Live races are the other way
// round — there is no stored result yet, so the scores are all there is.
//
// Every finished-challenge surface reads this: the tab card, the challenge-info screen and the
// watch screen. That is the point — three copies of "who won" is how one race got described three
// ways on one screen.

export type ChallengeVerdict = 'won' | 'lost' | 'draw' | 'undecided';

export type DuelOutcome = {
  /** Whether the clock has stopped. Decides tense everywhere below. */
  settled: boolean;
  verdict: ChallengeVerdict;
  /** "You won", "Noah Brikman won", "It's a tie" — the headline on a finished card. */
  verdictText: string;
  /** "You lead by 2h 2m" / "You won by 1h 40m" / "Neck and neck". Already in the right tense. */
  leadText: string;
  /** True when THIS VIEWER is the one ahead — for tinting the bar and the lead line. Null on a
   *  draw or a scoreless race, where neither side should be coloured as the leader. */
  viewerAhead: boolean | null;
  myScore: number;
  opponentScore: number;
  /** The viewer's share of the tug bar, 6–94% so neither avatar's end ever collapses to nothing. */
  myPercent: number;
};

/**
 * A settled challenge is one whose result is written and paid. 'expired' is deliberately NOT
 * settled-with-a-result: it is how the sweep marks a race that never had a field to rank
 * (0127's `v_field_count = 0` arm), so there is no winner to announce and no draw to celebrate.
 */
export function isSettled(status: string): boolean {
  return status === 'completed';
}

export function isFinished(status: string): boolean {
  return status === 'completed' || status === 'expired';
}

/**
 * THE CLOCK LINE, IN THE RIGHT TENSE — the one string every challenge surface puts where the
 * countdown goes.
 *
 * 🔴 What this is for. Noah's device: a duel that had clearly ended — its own body reading "Final ·
 * this challenge has ended" — still printed "Most lock-in time · ending soon" in the Watch header
 * and "Duration 72h · ending soon" in the rules table. Every one of those surfaces was calling
 * `formatTimeLeft(ends_at)` directly, and that function knows only about a clock. It cannot know
 * that the race has a RESULT, so it kept describing a future that had already happened.
 *
 * The rule, and it is the same one duelOutcome() is built on: once a challenge is settled the
 * STORED RESULT IS AUTHORITATIVE and the clock is irrelevant. So:
 *
 *   settled with a verdict   → "You won" / "You lost" / "It's a tie"   (the news)
 *   settled with no verdict  → "Final"                                 (a group race, a spectator)
 *   expired                  → "Ended"                                 (no result was recorded)
 *   clock run out, unsettled → "ended"                                 (formatTimeLeft's own word)
 *   still running            → "18h left"
 *
 * `verdict` is optional because only a duel has one. A group or placement race passes nothing and
 * gets "Final", which is what its board already said.
 */
export function challengeClockText(
  status: string,
  endsAt: string | null,
  verdict?: ChallengeVerdict
): string {
  if (status === 'expired') return 'Ended';
  if (isSettled(status)) {
    if (verdict === 'won') return 'You won';
    if (verdict === 'lost') return 'You lost';
    if (verdict === 'draw') return "It's a tie";
    return 'Final';
  }
  return formatTimeLeft(endsAt);
}

export function duelOutcome(
  c: Pick<
    SocialChallenge,
    'status' | 'winner_id' | 'my_score' | 'opponent_score' | 'race_metric' | 'created_by' | 'opponent_id'
  >,
  myUserId: string | null | undefined,
  /** What to call the other side — already resolved to this viewer's perspective by the caller. */
  otherName: string
): DuelOutcome {
  const myScore = c.my_score ?? 0;
  const opponentScore = c.opponent_score ?? 0;
  const total = myScore + opponentScore;
  const settled = isSettled(c.status);
  const finished = isFinished(c.status);

  // ── the verdict ──────────────────────────────────────────────────────────────
  let verdict: ChallengeVerdict;
  if (!settled) {
    verdict = 'undecided';
  } else if (c.winner_id == null) {
    // THE BRANCH THAT WAS MISSING. null winner on a completed duel is the server's record of a
    // dead heat (0122 pays both sides for it), not "somebody other than me won".
    verdict = 'draw';
  } else if (myUserId && c.winner_id === myUserId) {
    verdict = 'won';
  } else {
    verdict = 'lost';
  }

  const verdictText =
    verdict === 'draw' ? "It's a tie" : verdict === 'won' ? 'You won' : verdict === 'lost' ? `${otherName} won` : '';

  // ── who is ahead, and by how much ────────────────────────────────────────────
  //
  // On a settled race this follows the VERDICT, so the bar's tint, the lead line and the headline
  // can never contradict each other. On a live one it follows the scores, which are the only
  // evidence there is.
  const viewerAhead: boolean | null = settled
    ? verdict === 'draw'
      ? null
      : verdict === 'won'
    : total === 0 || myScore === opponentScore
      ? null
      : myScore > opponentScore;

  const gap = Math.abs(myScore - opponentScore);
  // Past tense the moment the clock stops. "Noah leads by 1h 40m" on a race that ended on Tuesday
  // was the second half of the screenshot.
  const verb = finished ? 'won by' : 'lead';
  const verbOther = finished ? 'won by' : 'leads by';

  let leadText: string;
  if (total === 0) {
    leadText = finished ? 'Nobody logged a lock-in' : 'No lock-ins logged yet';
  } else if (viewerAhead == null) {
    leadText = finished ? 'Dead even' : 'Neck and neck';
  } else if (viewerAhead) {
    leadText = `You ${verb} ${formatMetricValue(c.race_metric, gap)}`;
  } else {
    leadText = `${otherName} ${verbOther} ${formatMetricValue(c.race_metric, gap)}`;
  }

  return {
    settled,
    verdict,
    verdictText,
    leadText,
    viewerAhead,
    myScore,
    opponentScore,
    myPercent: total > 0 ? Math.max(6, Math.min(94, (myScore / total) * 100)) : 50,
  };
}

/**
 * WHOSE SIDE IS WHICH, from the viewer's chair.
 *
 * The watch screen rendered `created_by_name` and `opponent_name` verbatim, so a duel between the
 * two test accounts — both of whom are called "Noah Brikman" — read "Noah Brikman vs Noah
 * Brikman", and in general a competitor watching their own race saw their own name rather than
 * "You". challenge-info has always got this right; this is that rule, extracted so both screens
 * share it instead of one of them re-deriving it.
 *
 * A SPECTATOR is not on either side, and for them both names stay real — "You" would be a lie.
 */
export function viewerLabels(
  sides: { createdById: string; createdByName: string; opponentId: string | null; opponentName: string | null },
  myUserId: string | null | undefined
): { createdByLabel: string; opponentLabel: string; viewerIsCreator: boolean; viewerIsCompetitor: boolean } {
  const viewerIsCreator = Boolean(myUserId) && myUserId === sides.createdById;
  const viewerIsOpponent = Boolean(myUserId) && myUserId === sides.opponentId;
  return {
    createdByLabel: viewerIsCreator ? 'You' : sides.createdByName,
    opponentLabel: viewerIsOpponent ? 'You' : (sides.opponentName ?? 'Waiting…'),
    viewerIsCreator,
    viewerIsCompetitor: viewerIsCreator || viewerIsOpponent,
  };
}
