import { track } from '@/lib/analytics';
import { supabase } from '@/lib/supabase';
import type {
  DifficultyTier,
  MatchSport,
  TeamMatch,
  TeamMatchScoreMode,
  TeamMatchSettlement,
  TeamSide,
} from '@/types/database';

// TEAM MODE (CODE_PROMPT_team_mode.md, mock 177, migration 0173).
//
// Two teams play a sport, somebody keeps the score, and EVERY PLAYER ON EACH SIDE GETS THE SAME
// REWARD — winners a tier above losers. Campfire-only, because the shape cannot exist anywhere
// else: it is a `social_challenges` row on a circle_id, admin-created, with a roster whose only
// per-user fact is which side you were on.
//
// 🔒 WHAT THIS MODULE DELIBERATELY CANNOT DO. Every function here is a thin call over an RPC that
// re-decides the permission server-side, and they are gated on four DIFFERENT things:
//
//   createTeamMatch      campfire owner/admin, re-read from group_members
//   joinTeamMatch        any member of the campfire — hosting is the admin act, joining is not
//   refSetScore/-Clock/  ref_user_id and nobody else. "Only the scorekeeper can edit" is a
//     refEndMatch          database refusal, not a hidden button
//   reportTeamMatchScore a rostered player, on either side
//   confirmTeamMatchScore a rostered player on the OTHER side from whoever reported
//   resolveTeamMatch     a campfire admin, and only they can settle without both sides agreeing
//
// There is no client path to `settle_team_match`: it is revoked from `authenticated`, because a
// caller who could reach it could name its own final score and the dual confirmation below would
// be theatre.

/** The sport picker's grid (mock 177 §A). A plain table read — RLS admits any signed-in user, and
 *  the catalog is the same for everyone, so there is no RPC to wrap. */
export async function fetchMatchSports(): Promise<MatchSport[]> {
  const { data, error } = await supabase
    .from('match_sports')
    .select('key,label,emoji,score_step_label,step_values,sort_order')
    .order('sort_order');
  if (error) throw error;
  return (data ?? []) as MatchSport[];
}

/**
 * The whole match, for all four of its surfaces.
 *
 * RETURNS NULL RATHER THAN THROWING for a challenge that is not a team match, and that null is
 * load-bearing rather than defensive: the campfire timeline asks this of every `challenge`
 * attachment it renders, and uses the null to fall back to the ordinary campfire-challenge card.
 * A throw there would mean a spinner and an error state on every counted challenge in the fire.
 */
export async function fetchTeamMatch(challengeId: string): Promise<TeamMatch | null> {
  const { data, error } = await supabase.rpc('get_team_match', { p_challenge_id: challengeId });
  if (error) throw error;
  return (data as TeamMatch | null) ?? null;
}

export async function createTeamMatch(input: {
  circleId: string;
  sportKey: string;
  /** Only read when sportKey is 'custom' — every other sport carries the catalog's own label, so
   *  two matches in the same sport are never named two different ways. */
  customSportLabel?: string | null;
  teamAName: string;
  teamBName: string;
  teamAColor: string;
  teamBColor: string;
  /** Defaults to the creator server-side. Must be in the campfire. */
  refUserId?: string | null;
  /** 'confirm' is the default and the intramural path — see TeamMatchScoreMode. */
  scoreMode: TeamMatchScoreMode;
  winnerTier: DifficultyTier;
  loserTier: DifficultyTier;
}): Promise<{ challenge_id: string; circle_id: string; circle_name: string; name: string }> {
  const { data, error } = await supabase.rpc('create_team_match', {
    p_circle_id: input.circleId,
    p_sport_key: input.sportKey,
    p_team_a_name: input.teamAName,
    p_team_b_name: input.teamBName,
    p_team_a_color: input.teamAColor,
    p_team_b_color: input.teamBColor,
    p_ref_user_id: input.refUserId ?? null,
    p_score_mode: input.scoreMode,
    p_winner_tier: input.winnerTier,
    p_loser_tier: input.loserTier,
    p_custom_sport_label: input.customSportLabel ?? null,
  });
  if (error) throw error;
  track('challenge_created', { mode: 'team_match', circle_id: input.circleId, custom_span: false });
  return data;
}

/** Pick a side, or move to the other one. Open until full time, because a pickup game reshuffles
 *  and a roster that hardened at kick-off would pay the wrong people. */
export async function joinTeamMatch(challengeId: string, team: TeamSide) {
  const { data, error } = await supabase.rpc('join_team_match', {
    p_challenge_id: challengeId,
    p_team: team,
  });
  if (error) throw error;
  track('team_match_joined', { challenge_id: challengeId, team });
  return data;
}

/**
 * Move one team's score. `delta` is signed — Undo is a −1, not a separate endpoint, which is why
 * the mock's ↶ and its "+1 goal" are the same call.
 *
 * The first call also starts the match: it flips draft → live and starts the clock, so the LIVE
 * dot on the campfire card is true the instant the first goal goes in and nobody has to remember
 * to press start.
 */
export async function refSetScore(challengeId: string, team: TeamSide, delta: number) {
  const { data, error } = await supabase.rpc('ref_set_score', {
    p_challenge_id: challengeId,
    p_team: team,
    p_delta: delta,
  });
  if (error) throw error;
  return data;
}

export async function refSetClock(challengeId: string, running: boolean) {
  const { data, error } = await supabase.rpc('ref_set_clock', {
    p_challenge_id: challengeId,
    p_running: running,
  });
  if (error) throw error;
  return data;
}

/** Full time on a live-scored match. Settles at whatever the board says and pays both sides. */
export async function refEndMatch(challengeId: string): Promise<TeamMatchSettlement> {
  const { data, error } = await supabase.rpc('ref_end_match', { p_challenge_id: challengeId });
  if (error) throw error;
  track('team_match_ended', { challenge_id: challengeId, via: 'scorekeeper' });
  return data as TeamMatchSettlement;
}

/** Report the final score of a real game. Settles NOTHING on its own — the other side has to
 *  confirm it, and that is the whole anti-cheese of the default mode. */
export async function reportTeamMatchScore(challengeId: string, scoreA: number, scoreB: number) {
  const { data, error } = await supabase.rpc('report_team_match_score', {
    p_challenge_id: challengeId,
    p_score_a: scoreA,
    p_score_b: scoreB,
  });
  if (error) throw error;
  track('team_match_score_reported', { challenge_id: challengeId });
  return data;
}

/**
 * The other side agrees (settles and pays) or disagrees (marks it disputed and clears the report
 * so both sides re-enter).
 *
 * The server refuses anyone rostered on the REPORTING side. That refusal is not a UX nicety —
 * it is the property dual confirmation buys, and it is why the confirm button is only rendered
 * for `my_team !== reported_team`.
 */
export async function confirmTeamMatchScore(
  challengeId: string,
  agree: boolean
): Promise<TeamMatchSettlement | { challenge_id: string; disputed: true }> {
  const { data, error } = await supabase.rpc('confirm_team_match_score', {
    p_challenge_id: challengeId,
    p_agree: agree,
  });
  if (error) throw error;
  track(agree ? 'team_match_score_confirmed' : 'team_match_score_disputed', { challenge_id: challengeId });
  return data;
}

/** A campfire admin settles a disputed match at a score they name — the only route that does not
 *  need both sides to agree, and deliberately the host's. */
export async function resolveTeamMatch(
  challengeId: string,
  scoreA: number,
  scoreB: number
): Promise<TeamMatchSettlement> {
  const { data, error } = await supabase.rpc('resolve_team_match', {
    p_challenge_id: challengeId,
    p_score_a: scoreA,
    p_score_b: scoreB,
  });
  if (error) throw error;
  track('team_match_ended', { challenge_id: challengeId, via: 'host_resolve' });
  return data as TeamMatchSettlement;
}

export async function reassignTeamMatchRef(challengeId: string, userId: string) {
  const { data, error } = await supabase.rpc('reassign_team_match_ref', {
    p_challenge_id: challengeId,
    p_user_id: userId,
  });
  if (error) throw error;
  return data;
}

/**
 * The score, live, for everyone in the campfire.
 *
 * Rides the SAME postgres_changes mechanism the message stream and the reaction counts already
 * use (0171), filtered to the one row — so a match card in a busy fire wakes on its own goals and
 * not on every message. 0173 adds `social_challenges` to the realtime publication; RLS on that
 * table is "read if circle member", which is exactly the audience the mock's live card is for.
 *
 * Returns an unsubscribe; the caller owns calling it on unmount.
 */
export function subscribeToTeamMatch(challengeId: string, onChange: () => void): () => void {
  const channel = supabase
    .channel(`team_match:${challengeId}`)
    .on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'social_challenges', filter: `id=eq.${challengeId}` },
      onChange
    )
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}
