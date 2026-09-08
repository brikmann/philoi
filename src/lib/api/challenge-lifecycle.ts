import { respondToH2HChallenge } from '@/lib/api/social-challenges';
import { track } from '@/lib/analytics';
import { isDuel } from '@/lib/challenge-metric';
import { supabase } from '@/lib/supabase';
import type { SocialChallenge } from '@/types/database';

// Handoff B — the v2 challenge lifecycle: draft → invited → live → settled (migration 0095).
//
// NO AUTO-START. Every one of these is a deliberate step someone takes, which is the point: a
// challenge used to begin the moment it was created, so it started whether or not anyone agreed to
// race. Baselines are captured server-side at start, not at creation.
//
// Admin gating lives in the RPCs, not here. A client-side `isAdmin` check decides what to RENDER;
// it is not what decides what is allowed, and these calls will be refused for a member regardless
// of what the UI let them tap.

/** Invite a subset of the campfire — the member ticker. Admin-only, pre-start only. */
export async function inviteChallengeMembers(challengeId: string, userIds: string[]): Promise<number> {
  const { data, error } = await supabase.rpc('invite_challenge_members', {
    p_challenge: challengeId,
    p_user_ids: userIds,
  });
  if (error) throw error;
  track('challenge_members_invited', { challenge_id: challengeId, count: userIds.length });
  return data ?? 0;
}

/** Accept or decline your own invite — the one lifecycle action that belongs to the invitee. */
export async function respondToChallengeInvite(challengeId: string, accept: boolean): Promise<void> {
  const { error } = await supabase.rpc('respond_to_challenge_invite', {
    p_challenge: challengeId,
    p_accept: accept,
  });
  if (error) throw error;
  track('challenge_invite_answered', { challenge_id: challengeId, accepted: accept });
}

/**
 * Answer an invite with the RPC that is actually correct for THIS challenge's shape.
 *
 * 🔴 THE BUG THIS EXISTS TO KILL. There are two respond RPCs, they are not interchangeable, and
 * every list surface was calling the wrong one for duels:
 *
 *   respond_to_challenge_invite  — updates challenge_participants.state and NOTHING ELSE. Correct
 *                                  for a group/collective/placement race, which an admin starts
 *                                  separately via start_challenge (that is where those baselines
 *                                  are taken).
 *   respond_to_h2h_challenge     — the duel's whole gun. On accept it sets status='active',
 *                                  starts_at=now(), ends_at, and writes a baseline for BOTH
 *                                  racers; on decline it sets the CHALLENGE to 'declined'.
 *
 * A duel has no admin and no separate start step — accepting IS the start. So answering one
 * through respond_to_challenge_invite flipped the roster row to 'accepted' and left the challenge
 * `pending` forever: no starts_at, no ends_at, no baselines, nothing for the settle sweep to score.
 * The duel was accepted and never ran.
 *
 * It went unnoticed because SocialChallengeCard — rendered directly ABOVE ChallengeAcceptRow in
 * both the tab and the campfire feed — has always had its own Accept wired to the h2h RPC. A
 * pending duel therefore showed TWO Accept buttons doing two different things, and whether the
 * race started depended on which one the user happened to press. Prod bears this out: all 9
 * declined and all 5 completed duels carry challenge-level state only respond_to_h2h_challenge
 * writes, i.e. every duel that ever worked went through the card.
 *
 * Dispatching here rather than at the three call sites is the point — `isDuel` is the same test
 * the rest of the app uses for this exact question, and a fourth surface added later gets the
 * right RPC without having to know this note exists.
 */
export async function answerChallengeInvite(
  challenge: Pick<SocialChallenge, 'id' | 'shape' | 'mode'>,
  accept: boolean
): Promise<void> {
  if (isDuel(challenge)) {
    await respondToH2HChallenge(challenge.id, accept);
    return;
  }
  await respondToChallengeInvite(challenge.id, accept);
}

/**
 * Start the race. Admin-only, and the moment every baseline is taken.
 *
 * Anyone who never answered is dropped server-side rather than carried — a permanently 'invited'
 * row makes a collective goal impossible to complete and inflates the placement denominator with
 * someone who never ran.
 */
export async function startChallenge(challengeId: string): Promise<void> {
  const { error } = await supabase.rpc('start_challenge', { p_challenge: challengeId });
  if (error) throw error;
  track('challenge_started', { challenge_id: challengeId });
}
