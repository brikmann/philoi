import { track } from '@/lib/analytics';
import { supabase } from '@/lib/supabase';
import type {
  Challenge,
  ChallengeCountMode,
  ChallengeFeedEvent,
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

/** A goal is the user's own — no campfire binding (migration 0059). Sharing the work behind it
 * is chosen per lock-in on the done screen, which can post to several circles at once. */
export async function createChallenge(input: {
  userId: string;
  type: ChallengeType;
  label: string | null;
  target: number;
  unit: string;
  period: ChallengePeriod;
  /** Custom goals only (migration 0061) — 'lockin_time' accrues minutes from lock-ins whose
   * detail matches `label`, which is what makes that name behave like its own lock-in type. */
  countMode?: ChallengeCountMode;
}): Promise<Challenge> {
  const { data, error } = await supabase
    .from('challenges')
    .insert({
      user_id: input.userId,
      type: input.type,
      label: input.label,
      target: input.target,
      unit: input.unit,
      period: input.period,
      count_mode: input.countMode ?? 'manual',
    })
    .select('*')
    .single();
  if (error) throw error;
  track('challenge_created', { type: input.type, target: input.target });
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

/** Credits a finished lock-in's minutes to any time-counted custom goal whose name matches the
 * session's detail (migration 0061). Idempotent per check-in, so calling it again after a
 * backgrounded app missed the first attempt is safe and cheap. */
export async function creditLockInTimeGoals(checkInId: string): Promise<number> {
  const { data, error } = await supabase.rpc('credit_lockin_time_goals', { p_check_in_id: checkInId });
  if (error) throw error;
  return data ?? 0;
}
