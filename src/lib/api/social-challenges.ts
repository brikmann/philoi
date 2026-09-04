import { track } from '@/lib/analytics';
import { supabase } from '@/lib/supabase';
import type {
  ChallengeChangeKind,
  ChallengeChangeRequest,
  ChallengeChangeRequestDetail,
  ChallengeResultRow,
  ChallengeReward,
  CircleActiveChallenge,
  DifficultyTier,
  HostedCampfireChallenge,
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
 * What THIS CAMPFIRE is running — every live challenge in it, for any member of it (0163).
 *
 * NOT a filter over fetchMySocialChallenges, and that is the whole fix. get_my_social_challenges
 * is scoped to challenge_participants, so it answers "what am I rostered on". A member who joined
 * the fire after a challenge started is not on that roster and gets back nothing — the owner saw
 * their run club's race and everyone they invited saw an empty campfire. This asks the other
 * question, by circle, gated on membership rather than enrolment, and every row carries `i_am_in`
 * so the opt-in CTA knows whether to offer itself.
 *
 * The server returns only draft/pending/active — exactly the statuses join_campfire_challenge
 * admits — so nothing here can offer a Join the server will refuse.
 */
export async function fetchCircleActiveChallenges(circleId: string): Promise<CircleActiveChallenge[]> {
  const { data, error } = await supabase.rpc('get_circle_active_challenges', { p_circle_id: circleId });
  if (error) throw error;
  return (data ?? []) as CircleActiveChallenge[];
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

/**
 * The two extra fields a grade race carries (0145). Optional on every create call, so a lock-in,
 * volume or distance race sends neither and behaves exactly as it did.
 *
 * `gradeTarget` is a PERCENTAGE. A GPA-scale entry is converted before it gets here — the column
 * stores one unit, for the same reason distance is stored in metres.
 */
type GradeTerms = {
  /** The mark to hit. Required for a grade duel or collective goal; omitted on a placement board,
   *  where the ranking is the result and there is no bar (server constraint says the same). */
  gradeTarget?: number | null;
  /** "KP451". Optional, but Cindy asks for it first for a reason — see gradeChallengeLabel. */
  courseCode?: string | null;
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
  } & CustomSpan &
    GradeTerms
): Promise<SocialChallenge> {
  const { data, error } = await supabase.rpc('create_h2h_challenge', {
    p_opponent_id: input.opponentId,
    p_race_metric: input.raceMetric,
    p_window_hours: input.windowHours,
    p_circle_id: input.circleId ?? null,
    p_public_name: input.publicName ?? null,
    p_starts_on: input.startsOn ?? null,
    p_ends_on: input.endsOn ?? null,
    p_grade_target: input.gradeTarget ?? null,
    p_course_code: input.courseCode ?? null,
  });
  if (error) throw error;
  track('challenge_created', { mode: 'h2h', circle_id: input.circleId ?? null, custom_span: input.endsOn != null });
  return data;
}

export async function createGroupChallenge(
  input: {
    circleId: string;
    /** Lock-ins each member must log. Null ONLY for a grade goal, whose bar is `gradeTarget`
     *  instead — the server takes exactly one of the two and refuses both or neither. */
    targetCount: number | null;
    windowHours: number;
    publicName?: string | null;
  } & CustomSpan &
    GradeTerms
): Promise<SocialChallenge> {
  const { data, error } = await supabase.rpc('create_group_challenge', {
    p_circle_id: input.circleId,
    p_target_count: input.targetCount,
    p_window_hours: input.windowHours,
    p_public_name: input.publicName ?? null,
    p_starts_on: input.startsOn ?? null,
    p_ends_on: input.endsOn ?? null,
    p_grade_target: input.gradeTarget ?? null,
    p_course_code: input.courseCode ?? null,
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
  } & CustomSpan &
    GradeTerms
): Promise<SocialChallenge> {
  const { data, error } = await supabase.rpc('create_placement_challenge', {
    p_circle_id: input.circleId,
    p_race_metric: input.raceMetric,
    p_window_hours: input.windowHours,
    p_public_name: input.publicName ?? null,
    p_starts_on: input.startsOn ?? null,
    p_ends_on: input.endsOn ?? null,
    p_grade_target: input.gradeTarget ?? null,
    p_course_code: input.courseCode ?? null,
  });
  if (error) throw error;
  track('challenge_created', { mode: 'placement', circle_id: input.circleId, custom_span: input.endsOn != null });
  return data;
}

/**
 * Host a COUNTED challenge for a whole campfire — "1000 pushups for Goat" (migration 0162).
 *
 * The fourth create path, and the only one that is not just an insert. `host_campfire_challenge`
 * does five things in one transaction because a half-hosted challenge is worse than a refused one:
 * it checks the caller is an owner/admin of that campfire, creates the race, enrols and equips the
 * host, stores the scoped tier, fires `challenge_hosted` at every member, and posts the card into
 * the campfire chat.
 *
 * 🔒 ADMIN-GATED SERVER-SIDE, and that is the whole point of routing it through an RPC rather than
 * assembling it here. Cindy proposes the campfire and the tier; the server re-reads the caller's
 * role out of group_members and refuses if it does not like it, so a forged campfire id or a
 * hallucinated role fails at the database. The refusal names the campfire ("You're not an admin of
 * Goat…") because Cindy relays it verbatim.
 *
 * WHAT "COUNTED" MEANS: every participant gets `metric` added to their lock-in menu as a personal
 * goal — the ⚡ challenge aura — and the race scores off that goal. So reps logged in the gym
 * tracker count toward it through the feeder that already exists (0149), with nothing new to sync.
 */
export async function hostCampfireChallenge(input: {
  circleId: string;
  /** The plural noun being counted: "pushups". Becomes the unit AND the lock-in type's name. */
  metric: string;
  target: number;
  label: string;
  /** 'everyone_hits_target' (no single winner) or 'first_to'. A ranked race is a placement
   *  challenge and a different RPC — the server refuses 'most_by_deadline' rather than quietly
   *  reshaping it, because the two settle differently. */
  shape?: 'everyone_hits_target' | 'first_to';
  windowHours?: number;
  /** Cindy's proposal. Validated and priced server-side; verifiability is derived, never sent. */
  tier?: DifficultyTier | null;
}): Promise<HostedCampfireChallenge> {
  const { data, error } = await supabase.rpc('host_campfire_challenge', {
    p_circle_id: input.circleId,
    p_metric: input.metric,
    p_target: input.target,
    p_window_hours: input.windowHours ?? 168,
    p_label: input.label,
    p_shape: input.shape ?? 'everyone_hits_target',
    p_tier: input.tier ?? null,
  });
  if (error) throw error;
  track('challenge_created', { mode: 'campfire_hosted', circle_id: input.circleId, custom_span: false });
  return data as HostedCampfireChallenge;
}

/**
 * Opt into a campfire-hosted challenge from its chat card (migration 0162).
 *
 * Any MEMBER may join — hosting is the admin act, joining is not. That asymmetry is the §Opt-in
 * model: an open challenge posts to the fire and people put themselves in it.
 *
 * Joining is also what adds the metric to your lock-in menu, adopting a goal you already have by
 * that name rather than minting a second one 0148 would refuse.
 */
export async function joinCampfireChallenge(challengeId: string): Promise<{
  challenge_id: string;
  goal_id: string | null;
  metric: string | null;
  target: number | null;
}> {
  const { data, error } = await supabase.rpc('join_campfire_challenge', { p_challenge_id: challengeId });
  if (error) throw error;
  return data as { challenge_id: string; goal_id: string | null; metric: string | null; target: number | null };
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

/**
 * Report — or correct — your mark on a grade challenge (0145).
 *
 * The one metric the app cannot observe, so it is the one metric with a write path. Editable for
 * as long as the race is live, which the RPC enforces: a mark is the racer's current standing,
 * not a one-shot submission, and a typo'd 7 for a 70 has to be fixable. It hardens at settlement
 * because the sweep simply stops reading it.
 *
 * Returns the value the SERVER stored, not the one that was sent — it rounds to 2dp and it is the
 * copy settlement will score.
 */
export async function reportChallengeGrade(challengeId: string, grade: number): Promise<number> {
  const { data, error } = await supabase.rpc('report_challenge_grade', {
    p_challenge_id: challengeId,
    p_grade: grade,
  });
  if (error) throw error;
  track('challenge_grade_reported', { challenge_id: challengeId });
  return Number(data);
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
