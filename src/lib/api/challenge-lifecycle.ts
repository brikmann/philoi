import { track } from '@/lib/analytics';
import { supabase } from '@/lib/supabase';

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
