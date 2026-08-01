import { track } from '@/lib/analytics';
import { supabase } from '@/lib/supabase';
import type { SocialChallenge, SocialChallengeRaceMetric } from '@/types/database';

export async function fetchMySocialChallenges(): Promise<SocialChallenge[]> {
  const { data, error } = await supabase.rpc('get_my_social_challenges');
  if (error) throw error;
  return data ?? [];
}

export async function createH2HChallenge(input: {
  opponentId: string;
  raceMetric: SocialChallengeRaceMetric;
  windowHours: number;
  /** Optional "let a campfire watch" — friend-to-friend H2H never requires one (§16). */
  circleId?: string | null;
}): Promise<SocialChallenge> {
  const { data, error } = await supabase.rpc('create_h2h_challenge', {
    p_opponent_id: input.opponentId,
    p_race_metric: input.raceMetric,
    p_window_hours: input.windowHours,
    p_circle_id: input.circleId ?? null,
  });
  if (error) throw error;
  track('challenge_created', { mode: 'h2h', circle_id: input.circleId ?? null });
  return data;
}

export async function createGroupChallenge(input: {
  circleId: string;
  targetCount: number;
  windowHours: number;
}): Promise<SocialChallenge> {
  const { data, error } = await supabase.rpc('create_group_challenge', {
    p_circle_id: input.circleId,
    p_target_count: input.targetCount,
    p_window_hours: input.windowHours,
  });
  if (error) throw error;
  track('challenge_created', { mode: 'group', circle_id: input.circleId });
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
