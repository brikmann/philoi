import { track } from '@/lib/analytics';
import { supabase } from '@/lib/supabase';
import type {
  Challenge,
  ChallengeFeedEvent,
  ChallengeLeaderboardRow,
  ChallengePeriod,
  ChallengeType,
} from '@/types/database';

export async function fetchMyChallenges(userId: string): Promise<Challenge[]> {
  const { data, error } = await supabase
    .from('challenges')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function createChallenge(input: {
  userId: string;
  circleId: string | null;
  type: ChallengeType;
  label: string | null;
  target: number;
  unit: string;
  period: ChallengePeriod;
  visibility: 'circle' | 'private';
}): Promise<Challenge> {
  const { data, error } = await supabase
    .from('challenges')
    .insert({
      user_id: input.userId,
      circle_id: input.circleId,
      type: input.type,
      label: input.label,
      target: input.target,
      unit: input.unit,
      period: input.period,
      visibility: input.visibility,
    })
    .select('*')
    .single();
  if (error) throw error;
  track('challenge_created', { type: input.type, circle_id: input.circleId, target: input.target });
  return data;
}

export async function logChallengeProgress(
  challengeId: string,
  amount: number,
  note?: string
): Promise<{ challenge: Challenge; justCompleted: boolean }> {
  const { data, error } = await supabase.rpc('log_challenge_progress', {
    p_challenge_id: challengeId,
    p_amount: amount,
    p_note: note ?? null,
  });
  if (error) throw error;
  const row = (data ?? [])[0];
  if (!row) throw new Error('Could not log progress — try again.');
  const { just_completed, ...challenge } = row;
  track('challenge_logged', { challenge_id: challengeId, type: challenge.type, amount });
  if (just_completed) {
    track('challenge_completed', { challenge_id: challengeId, type: challenge.type });
  }
  return { challenge, justCompleted: just_completed };
}

export async function deleteChallenge(challengeId: string): Promise<void> {
  const { error } = await supabase.from('challenges').delete().eq('id', challengeId);
  if (error) throw error;
}

export async function fetchChallengeLeaderboard(
  circleId: string,
  type: ChallengeType
): Promise<ChallengeLeaderboardRow[]> {
  const { data, error } = await supabase.rpc('get_challenge_leaderboard', {
    p_circle_id: circleId,
    p_type: type,
  });
  if (error) throw error;
  return data ?? [];
}

export type FeedChallengeEvent = ChallengeFeedEvent & {
  profiles: { display_name: string; avatar_url: string | null; handle: string | null };
};

export async function fetchChallengeFeedEvents(groupId: string): Promise<FeedChallengeEvent[]> {
  const { data, error } = await supabase
    .from('challenge_feed_events')
    .select('*, profiles(display_name, avatar_url, handle)')
    .eq('group_id', groupId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as unknown as FeedChallengeEvent[];
}
