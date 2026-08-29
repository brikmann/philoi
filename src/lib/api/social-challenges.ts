import { track } from '@/lib/analytics';
import { supabase } from '@/lib/supabase';
import type {
  ChallengeChangeKind,
  ChallengeChangeRequest,
  ChallengeChangeRequestDetail,
  ChallengeResultRow,
  ChallengeReward,
  SocialChallenge,
  SocialChallengeRaceMetric,
  UnseenChallengeReward,
} from '@/types/database';

export async function fetchMySocialChallenges(): Promise<SocialChallenge[]> {
  const { data, error } = await supabase.rpc('get_my_social_challenges');
  if (error) throw error;
  return data ?? [];
}

/**
 * An explicit span, when the creator picked dates rather than a preset (0124).
 *
 * Both null is the preset case, and the server then does exactly what it did before —
 * start_challenge derives the window from window_hours at the gun. When they ARE set,
 * start_challenge (0096) already prefers them; it has since long before anything sent them.
 */
type CustomSpan = {
  /** ISO. Null for a preset window. */
  startsOn?: string | null;
  /** ISO. Null for a preset window. */
  endsOn?: string | null;
};

export async function createH2HChallenge(
  input: {
    opponentId: string;
    raceMetric: SocialChallengeRaceMetric;
    windowHours: number;
    /** Optional "let a campfire watch" — friend-to-friend H2H never requires one (§16). */
    circleId?: string | null;
    /** The user-set public name (v2). Null/blank falls back to the metric naming it. */
    publicName?: string | null;
  } & CustomSpan
): Promise<SocialChallenge> {
  const { data, error } = await supabase.rpc('create_h2h_challenge', {
    p_opponent_id: input.opponentId,
    p_race_metric: input.raceMetric,
    p_window_hours: input.windowHours,
    p_circle_id: input.circleId ?? null,
    p_public_name: input.publicName ?? null,
    p_starts_on: input.startsOn ?? null,
    p_ends_on: input.endsOn ?? null,
  });
  if (error) throw error;
  track('challenge_created', { mode: 'h2h', circle_id: input.circleId ?? null, custom_span: input.endsOn != null });
  return data;
}

export async function createGroupChallenge(
  input: {
    circleId: string;
    targetCount: number;
    windowHours: number;
    publicName?: string | null;
  } & CustomSpan
): Promise<SocialChallenge> {
  const { data, error } = await supabase.rpc('create_group_challenge', {
    p_circle_id: input.circleId,
    p_target_count: input.targetCount,
    p_window_hours: input.windowHours,
    p_public_name: input.publicName ?? null,
    p_starts_on: input.startsOn ?? null,
    p_ends_on: input.endsOn ?? null,
  });
  if (error) throw error;
  track('challenge_created', { mode: 'group', circle_id: input.circleId, custom_span: input.endsOn != null });
  return data;
}

/**
 * The third shape (mock 114, 0126) — everyone in the campfire ranked 1..N on one metric, paid by
 * percentile band.
 *
 * NO INVITE STEP AND NO SEPARATE START. `shape = 'placement'` has been a legal value since 0096 and
 * nothing ever created one. Unlike a collective goal this enrols the whole campfire as accepted
 * on the server and takes every baseline in the same statement, because "who is in this race" is
 * not a question for a class of 48 — being in the course campfire IS the entry.
 *
 * Admin-gated server-side. MyGroup carries no role, so the client cannot grey the tile out; a
 * non-admin gets the RPC's own refusal, which says the useful thing.
 */
export async function createPlacementChallenge(
  input: {
    circleId: string;
    raceMetric: SocialChallengeRaceMetric;
    windowHours: number;
    publicName?: string | null;
  } & CustomSpan
): Promise<SocialChallenge> {
  const { data, error } = await supabase.rpc('create_placement_challenge', {
    p_circle_id: input.circleId,
    p_race_metric: input.raceMetric,
    p_window_hours: input.windowHours,
    p_public_name: input.publicName ?? null,
    p_starts_on: input.startsOn ?? null,
    p_ends_on: input.endsOn ?? null,
  });
  if (error) throw error;
  track('challenge_created', { mode: 'placement', circle_id: input.circleId, custom_span: input.endsOn != null });
  return data;
}

export async function respondToH2HChallenge(challengeId: string, accept: boolean): Promise<SocialChallenge> {
  const { data, error } = await supabase.rpc('respond_to_h2h_challenge', {
    p_challenge_id: challengeId,
    p_accept: accept,
  });
  if (error) throw error;
  track(accept ? 'challenge_accepted' : 'challenge_declined', { challenge_id: challengeId });
  return data;
}

// Punchlist 3 — creator cancels an unanswered invite; either participant ends an active
// challenge early. Completed/declined/expired challenges are immutable (server-enforced).
export async function cancelSocialChallenge(challengeId: string): Promise<void> {
  const { error } = await supabase.rpc('cancel_social_challenge', { p_challenge_id: challengeId });
  if (error) throw error;
  track('challenge_cancelled', { challenge_id: challengeId });
}

/**
 * Delete the challenge outright — CAMPFIRE_REDESIGN_SPEC's missing "Delete challenge" action,
 * inside the ⋯ menu (0112).
 *
 * NOT a way out of a live race: the RPC refuses one, because a running challenge is a deal other
 * people are still keeping and cancel/forfeit above are the consented routes out. This is for a
 * draft nobody accepted, an invite that went stale, or clearing a finished row off the list.
 */
export async function deleteSocialChallenge(challengeId: string): Promise<void> {
  const { error } = await supabase.rpc('delete_social_challenge', { p_challenge_id: challengeId });
  if (error) throw error;
  track('challenge_deleted', { challenge_id: challengeId });
}

/**
 * The settled standings (0111): every racer's final figure, rank, percentile and what they were
 * actually paid.
 *
 * Read, never re-derived. The figures were written once at settlement precisely so a result page
 * cannot drift as later sessions land — recomputing them here from live data would eventually
 * disagree with the ledger, and the ledger is what moved.
 */
export async function fetchChallengeResults(challengeId: string): Promise<ChallengeResultRow[]> {
  const { data, error } = await supabase.rpc('get_challenge_results', { p_challenge_id: challengeId });
  if (error) throw error;
  return data ?? [];
}

/**
 * This viewer's own payout on a settled challenge (0116) — placement, XP, and the jsonb
 * grant_reward returned when it paid.
 *
 * 🔒 A READ. Nothing here grants anything; the embers, box and badge it describes were moved by
 * grant_reward at settlement, and the reveal screen exists to say so. A client that derived its
 * own reward figures from the same inputs would eventually disagree with the ledger.
 *
 * Returns nulls across the board for a non-participant and for a challenge that has not settled —
 * a normal answer, not an error, because the caller asks this speculatively on every open.
 */
export async function fetchChallengeReward(challengeId: string): Promise<ChallengeReward> {
  const { data, error } = await supabase.rpc('get_challenge_reward', { p_challenge_id: challengeId });
  if (error) throw error;
  return {
    placement: data?.placement ?? null,
    percentile: data?.percentile ?? null,
    field_size: data?.field_size ?? 0,
    xp: data?.xp ?? 0,
    seen_at: data?.seen_at ?? null,
    payload: data?.payload ?? null,
  };
}

/**
 * Every settled challenge this user raced in and has not been shown yet (migration 0137).
 *
 * The input to the global settlement watcher. Settlement is a pg_cron job, so a challenge closes
 * and pays while the app is shut — and until this existed the only surface that could announce it
 * was the one challenge's own info screen, which you had to think to go and open. This is the
 * "anything to celebrate?" question, asked once on foreground instead of once per challenge.
 *
 * 🔒 A READ, like get_challenge_reward. The embers, box and badge were moved by grant_reward at
 * settlement; the reveal only says so.
 */
export async function fetchUnseenChallengeRewards(): Promise<UnseenChallengeReward[]> {
  const { data, error } = await supabase.rpc('get_my_unseen_challenge_rewards');
  if (error) throw error;
  return (data ?? []) as UnseenChallengeReward[];
}

/** Fire-once: stamps reward_seen_at so re-opening a settled challenge lands on the standings. */
export async function markChallengeRewardSeen(challengeId: string): Promise<void> {
  const { error } = await supabase.rpc('mark_challenge_reward_seen', { p_challenge_id: challengeId });
  if (error) throw error;
  track('challenge_reward_seen', { challenge_id: challengeId });
}

// ───────────────────────── change / cancel consent (mocks 70 + 71) ─────────────────────────
// A challenge is a two-party agreement, so neither side rewrites it alone (migration 0058).
// Everything here is head-to-head only — a group challenge has no single counterparty to ask.

/** Ask the other side to extend/shorten the window, or to end the challenge early. */
export async function requestChallengeChange(input: {
  challengeId: string;
  kind: ChallengeChangeKind;
  /** null for a cancel; otherwise the terms to apply on agreement. */
  proposed?: { window_hours?: number; target_count?: number } | null;
}): Promise<ChallengeChangeRequest> {
  const { data, error } = await supabase.rpc('request_challenge_change', {
    p_challenge_id: input.challengeId,
    p_kind: input.kind,
    p_proposed: input.proposed ?? null,
  });
  if (error) throw error;
  track('challenge_change_requested', { challenge_id: input.challengeId, kind: input.kind });
  return data;
}

export async function respondToChallengeChange(requestId: string, agree: boolean): Promise<ChallengeChangeRequest> {
  const { data, error } = await supabase.rpc('respond_to_challenge_change', {
    p_request_id: requestId,
    p_agree: agree,
  });
  if (error) throw error;
  track(agree ? 'challenge_change_agreed' : 'challenge_change_declined', { request_id: requestId });
  return data;
}

/** The consent screen's payload — the proposal plus the CURRENT terms it would replace, so the
 * before → after can be rendered without the client guessing which term moved. */
export async function fetchChallengeChangeRequest(requestId: string): Promise<ChallengeChangeRequestDetail | null> {
  const { data, error } = await supabase.rpc('get_challenge_change_request', { p_request_id: requestId });
  if (error) throw error;
  return data ?? null;
}

/** The open request on a challenge, if any — lets the Manage sheet show "waiting on them"
 * instead of offering a second request the one-open-at-a-time index would reject. */
export async function fetchOpenChallengeChangeRequest(challengeId: string): Promise<ChallengeChangeRequestDetail | null> {
  const { data, error } = await supabase.rpc('get_open_challenge_change_request', { p_challenge_id: challengeId });
  if (error) throw error;
  return data ?? null;
}

/** The escape hatch (§2): unilateral, so a silent opponent can't trap you — but you hand them
 * the win and nobody is paid out, which is what keeps it from being a way to dodge a loss. */
export async function forfeitSocialChallenge(challengeId: string): Promise<void> {
  const { error } = await supabase.rpc('forfeit_social_challenge', { p_challenge_id: challengeId });
  if (error) throw error;
  track('challenge_forfeited', { challenge_id: challengeId });
}

/** Group races have no single counterparty to ask, so their terms stay the creator's to set
 * (migration 0060) — members are pushed a notice rather than a ballot. */
export async function updateGroupChallengeTerms(input: {
  challengeId: string;
  targetCount?: number | null;
  windowHours?: number | null;
}): Promise<SocialChallenge> {
  const { data, error } = await supabase.rpc('update_group_challenge_terms', {
    p_challenge_id: input.challengeId,
    p_target_count: input.targetCount ?? null,
    p_window_hours: input.windowHours ?? null,
  });
  if (error) throw error;
  track('challenge_terms_updated', { challenge_id: input.challengeId });
  return data;
}
