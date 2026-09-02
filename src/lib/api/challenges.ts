import { track } from '@/lib/analytics';
import { requestInventoryRefresh } from '@/lib/economy/wallet-refresh';
import { canonicalGoalUnit } from '@/lib/goal-types';
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
    // §4b — a RETIRED goal is one that was collapsed as a duplicate reading the same source as
    // another (migration 0156). It is frozen server-side: it accrues nothing and can never
    // complete, so it is over in every sense and has no business on the tab. Filtered rather than
    // deleted so the row — and its archived periods, which cascade — survive the collapse.
    .is('retired_at', null)
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
      // 🔴 §4a — THE UNIT FOLLOWS THE METRIC, not the caller. "Cold plunges · 0 / 1 bath" got onto
      // the tab because `unit` is a free text column and Cindy's create_challenge tool hands the
      // model a freeform string for it. For every built-in metric the answer is fixed by the
      // metric itself, so it is decided here rather than trusted from whoever called. A custom
      // goal keeps its owner's own word — and falls back to the goal's name rather than to
      // nothing, which used to render as a bare "0 / 1".
      //
      // Migration 0157 enforces the same rule in a trigger, so this is the helpful half: a writer
      // that never loads this file still cannot store a steps goal counted in baths.
      unit: canonicalGoalUnit(input.type, input.unit, input.label),
      period: input.period,
      count_mode: input.countMode ?? 'manual',
    })
    .select('*')
    .single();
  if (error) throw error;
  track('challenge_created', { type: input.type, target: input.target });
  return data;
}

/**
 * The one active goal already reading the source this new one would read, or null.
 *
 * 🔴 §B — THE STACKING EXPLOIT. Noah, on device: "you can set multiple 10,000-step goals for the
 * week which all have the same progress. They'd all give the same reward." Confirmed on prod: two
 * (steps, week, 10000) rows and two (steps, day, 10000) rows for one user. Auto-tracked metrics all
 * read a SHARED number — the health store, Strava, Whoop, or the user's own lock-ins — so N
 * identical goals fill from one walk and each bank their own drip.
 *
 * `goals_one_active_per_type_name` (0143) does not catch it because a personal goal is not a
 * `goals` row: this file writes it straight into `challenges`.
 *
 * THE KEY IS THE SOURCE, NOT THE TARGET. For a built-in metric the type IS the source
 * (getRealFitnessSourceForChallengeType returns one for every type except `custom`), so 8k weekly
 * steps and 12k weekly steps are still the same walk counted twice. For a custom goal the LABEL is
 * the source, because that is what both feeders match on — credit_lockin_time_goals_for (0116) and
 * the gym-set feeder (0149). Different cadences are legitimately different windows, so daily and
 * weekly versions of the same metric are fine and stay fine.
 *
 * 🔒 ADVISORY ONLY. Migration 0148's trigger is the enforcement — it refuses the insert whatever
 * this returns, so a stale read or a second device cannot get past it. This exists so the answer
 * arrives as a sentence in the form instead of as a failed round trip.
 */
export async function findDuplicateActiveGoal(input: {
  userId: string;
  type: ChallengeType;
  period: ChallengePeriod;
  /** The custom goal's name. Ignored for built-in types, which key on the type itself. */
  label: string | null;
}): Promise<Challenge | null> {
  let query = supabase
    .from('challenges')
    .select('*')
    .eq('user_id', input.userId)
    .eq('period', input.period)
    .is('completed_at', null)
    // Retired goals read no source and pay nothing, so they cannot be the other half of a stack —
    // and clashing against one would mean collapsing a duplicate silently forbade the user from
    // ever making that goal again. 0156's trigger applies the same rule server-side.
    .is('retired_at', null);

  if (input.type === 'custom') {
    const name = (input.label ?? '').trim();
    // An unnamed custom goal clashes with nothing — nothing can feed it by label either.
    if (!name) return null;
    query = query.eq('type', 'custom').ilike('label', name);
  } else {
    query = query.eq('type', input.type);
  }

  const { data, error } = await query.limit(1);
  // A failed read must not block creation: the server still refuses a real duplicate, and treating
  // "could not check" as "is a duplicate" would lock someone out of a goal they are allowed to have.
  if (error) return null;
  return data?.[0] ?? null;
}

/** What to put in front of the user when findDuplicateActiveGoal (or 0148) says no. */
export function duplicateGoalMessage(existing: Challenge): string {
  const cadence = existing.period === 'day' ? 'daily' : existing.period === 'once' ? 'one-time' : 'weekly';
  const name = existing.type === 'custom' ? (existing.label?.trim() || 'custom') : personalGoalMetricName(existing.type);
  return `You already have a ${cadence} ${name} goal running. Two goals reading the same source would both fill from one effort — finish or delete that one first.`;
}

/** Plain-English metric names for the message above. Deliberately not the picker's labels: those
 *  are written to be scanned in a list ("Run", "Sleep"), these have to read inside a sentence. */
function personalGoalMetricName(type: ChallengeType): string {
  switch (type) {
    case 'steps':
      return 'steps';
    case 'study_hours':
      return 'study time';
    case 'gym_visits':
      return 'gym visits';
    case 'run_distance':
      return 'running';
    case 'ride_distance':
      return 'riding';
    case 'workout_minutes':
      return 'workout minutes';
    case 'strain':
      return 'strain';
    case 'sleep_hours':
      return 'sleep';
    default:
      return 'custom';
  }
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
