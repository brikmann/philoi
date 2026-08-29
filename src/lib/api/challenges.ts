import { track } from '@/lib/analytics';
import { requestInventoryRefresh } from '@/lib/economy/wallet-refresh';
import { formatLocalDate } from '@/lib/local-day';
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
  /** Custom goals only (0061) — 'lockin_time' accrues HOURS from lock-ins whose detail matches
   * `label`, which is what makes that name behave like its own lock-in type. Minutes until 0113;
   * the target has always been in hours, so the credit was 60x too generous. */
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
): Promise<{ challenge: Challenge; justCompleted: boolean; award: GoalDayAward | null }> {
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
  return { challenge, justCompleted: just_completed, award: just_completed ? await awardGoalDay(challengeId) : null };
}

/** What economy_award_goal_day pays back — see migration 0085. */
export type GoalDayAward = {
  already_awarded: boolean;
  embers: number;
  milestone: number;
  box: string | null;
  streak: number;
  difficulty: string;
  /** True when the weekly ceiling clipped the payout, so the UI can say so rather than silently
   * showing a smaller number than the goal advertises. */
  capped: boolean;
};

/**
 * Bank the day's embers for a completed personal goal (§B).
 *
 * The ONLY thing sent is the goal and the device's local calendar date. Difficulty and streak are
 * derived server-side from the goal row and from goal_day_awards — 0083 originally took both as
 * parameters, which meant any signed-in caller could claim a 30-day streak and mint 400 embers
 * plus a box on day one. 0085 closed that.
 *
 * The local date has to come from the device: the server cannot know the caller's calendar day,
 * which is the whole reason §A3 exists. It is bounded server-side to no-further-than-tomorrow.
 *
 * Never throws into the log path. A goal that completed but failed to pay is a support ticket, not
 * a reason to fail the progress write the user actually asked for — and the call is idempotent per
 * local day, so a later retry settles it.
 *
 * EXPORTED as of #167, because this was the whole bug. `logChallengeProgress` below calls it on
 * `just_completed`, and for a long time that read as "every completion pays". It does not: it is
 * every completion that goes through THIS MODULE. Three of the five auto-sync routes do not —
 * `sync_challenge_from_lock_ins` calls the SQL `log_challenge_progress` directly, and the
 * Strava/Whoop Edge Functions call it as the user from the server — so `just_completed` came back
 * true inside a function nobody had taught to award, and a goal met by a study lock-in or a Strava
 * run banked nothing at all. Idempotency is what makes a second caller safe: the award is keyed on
 * (goal, local day) server-side (0085), so calling this from the sync path cannot double-pay a goal
 * the manual path already banked today — the second call comes back `already_awarded: true`.
 */
export async function awardGoalDay(challengeId: string): Promise<GoalDayAward | null> {
  try {
    const { data, error } = await supabase.rpc('economy_award_goal_day', {
      p_goal_id: challengeId,
      p_local_day: formatLocalDate(new Date()),
    });
    if (error) throw error;
    const award = data as GoalDayAward | null;
    if (award && !award.already_awarded) {
      track('goal_day_awarded', {
        challenge_id: challengeId,
        embers: award.embers,
        milestone: award.milestone,
        streak: award.streak,
      });
      // The wallet just moved. Fired HERE rather than from the screen that shows the reveal,
      // because this function is the one place every payout passes through — a manual log, an
      // auto-sync from Health Connect, a lock-in credit — and only two of those have a screen
      // watching. Without it the ember pill keeps its pre-payout figure until something remounts
      // it (see lib/economy/wallet-refresh.ts).
      requestInventoryRefresh();
    }
    return award;
  } catch (e) {
    console.warn('[goals] could not award goal day:', e);
    return null;
  }
}

/**
 * The caller's live time-counted custom goals — the ones a lock-in can actually feed.
 *
 * Exists for the lock-in goal picker's chips. The credit matches lower(trim(label)) against the
 * session's free-text detail, so the ONLY reliable way to hit it was to retype the goal's name
 * exactly; the chips make the match a tap instead. Deliberately not routed through
 * useMyChallenges, which fires a device-fitness sync per focus — far too much work for a bottom
 * sheet that just needs a handful of names.
 */
export async function fetchLockinTimeGoals(userId: string): Promise<Challenge[]> {
  const { data, error } = await supabase
    .from('challenges')
    .select('*')
    .eq('user_id', userId)
    .eq('count_mode', 'lockin_time')
    .is('completed_at', null)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data ?? [];
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

/**
 * Credits a finished lock-in's HOURS to any time-counted custom goal whose name matches the
 * session's detail (0061, repaired in 0113 — it used to credit minutes against a target the
 * create screen states in hours, so every such goal was 60x too easy).
 *
 * Now a retry rather than the primary path: 0113 moved the work onto an AFTER INSERT trigger on
 * check_ins, so the credit — and, since 0116, the goal-day drip that a completion earns — already
 * landed in the same transaction that created the check-in. This call almost always finds the work
 * done and returns 0, which is the point: a backgrounded app can no longer lose either one.
 */
export async function creditLockInTimeGoals(checkInId: string): Promise<number> {
  const { data, error } = await supabase.rpc('credit_lockin_time_goals', { p_check_in_id: checkInId });
  if (error) throw error;
  return data ?? 0;
}
