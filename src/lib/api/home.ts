import type { IconName } from '@/components/ui/icon';
import { friendActivityLabel, cheerPresetMeta } from '@/lib/api/lockin-cheers';
import { formatSessionDuration } from '@/lib/format';
import { supabase } from '@/lib/supabase';
import type { GoalType, RankTierName } from '@/types/database';

/**
 * HOME AS A CONNECTION SURFACE (mock 318, migration 0281) — you + your people, not a feed.
 *
 * Three reads, no writes:
 *   • your week vs your OWN last week (ipsative — never "#47"),
 *   • the friends who cheered you this week,
 *   • what your people are doing right now, reverse-chronological and never ranked.
 *
 * The week is the shared Sunday 00:00 UTC boundary (0071 / src/lib/time/week.ts); the server owns
 * the math so the comparison can't drift from every other weekly reset. Cheering goes through the
 * paths that already exist (send_cheer for a live friend, cheer_agora_post for a post) — nothing
 * here writes.
 */

function displayName(name: string | null, handle: string | null): string {
  return (name ?? '').trim() || handle || 'A friend';
}

// ───────────────────────────── 1 · your week ─────────────────────────────

export type MyWeek = {
  weekStart: string;
  thisWeekSeconds: number;
  /** All of last week — where the dashed marker sits. */
  lastWeekSeconds: number;
  /** Last week up to this same point in the week — what "ahead" is judged against. */
  lastWeekToDateSeconds: number;
  sessionsThisWeek: number;
  currentStreak: number;
  longestStreak: number;
  tier: RankTierName;
  division: number;
  /** Rank is a lifetime climb (0230), so this only ever goes up or holds. */
  climbedThisWeek: boolean;
};

type WeekRow = {
  out_week_start: string;
  out_this_week_seconds: number;
  out_last_week_seconds: number;
  out_last_week_to_date_secs: number;
  out_sessions_this_week: number;
  out_current_streak: number;
  out_longest_streak: number;
  out_tier: string;
  out_division: number;
  out_rank_index: number;
  out_week_start_rank_index: number;
};

export async function fetchMyWeek(): Promise<MyWeek | null> {
  const { data, error } = await supabase.rpc('get_my_week_vs_last');
  if (error) throw error;
  const r = ((data ?? []) as WeekRow[])[0];
  if (!r) return null;
  return {
    weekStart: r.out_week_start,
    thisWeekSeconds: r.out_this_week_seconds ?? 0,
    lastWeekSeconds: r.out_last_week_seconds ?? 0,
    lastWeekToDateSeconds: r.out_last_week_to_date_secs ?? 0,
    sessionsThisWeek: r.out_sessions_this_week ?? 0,
    currentStreak: r.out_current_streak ?? 0,
    longestStreak: r.out_longest_streak ?? 0,
    tier: r.out_tier as RankTierName,
    division: r.out_division,
    climbedThisWeek: r.out_rank_index > r.out_week_start_rank_index,
  };
}

/** "▲ +2h" / "▲ +40m" — a positive delta only; anything else has no chip (no shame framing). */
export function formatDeltaChip(seconds: number): string | null {
  if (seconds < 60) return null;
  return `▲ +${formatSessionDuration(seconds)}`;
}

export type WeekHeadline = {
  title: string;
  sub: string;
  /** True only when ahead — the sub-line goes green then, neutral otherwise. */
  ahead: boolean;
  /** For the greeting's second line. */
  short: string;
};

/**
 * The adaptive headline. Ahead of where you were at this point last week → say so and by how much.
 * Anything else is an encouraging neutral line — never "behind", never a deficit number. Wellbeing
 * over pressure: a slow week shouldn't open the app with a scolding.
 */
export function weekHeadline(w: MyWeek): WeekHeadline {
  const ahead = w.thisWeekSeconds > w.lastWeekToDateSeconds && w.thisWeekSeconds >= 60;
  if (ahead) {
    const more = w.thisWeekSeconds - w.lastWeekToDateSeconds;
    const pastAll = w.lastWeekSeconds > 0 && w.thisWeekSeconds > w.lastWeekSeconds;
    return {
      title: 'You’re ahead of last week',
      sub: pastAll
        ? `↑ already past all of last week · ${formatSessionDuration(w.thisWeekSeconds)} locked in`
        : `↑ ${formatSessionDuration(more)} more locked in than this point last week`,
      ahead: true,
      short: 'you’re ahead of last week',
    };
  }
  if (w.thisWeekSeconds >= 60) {
    return {
      title: 'Your week is moving',
      sub: `${formatSessionDuration(w.thisWeekSeconds)} locked in so far — every session counts.`,
      ahead: false,
      short: 'your week is moving',
    };
  }
  return {
    title: 'A fresh week',
    sub: w.lastWeekSeconds > 0
      ? `Last week you locked in ${formatSessionDuration(w.lastWeekSeconds)}. One session gets this one going.`
      : 'One session gets this one going.',
    ahead: false,
    short: 'a fresh week',
  };
}

// ───────────────────────────── 2 · who's backing you ─────────────────────────────

export type Backer = {
  userId: string;
  name: string;
  avatarUrl: string | null;
  cheers: number;
  /** Their latest cheer, for the human line. */
  line: string;
  at: string;
};

type BackerRow = {
  out_user_id: string;
  out_display_name: string | null;
  out_handle: string | null;
  out_avatar_url: string | null;
  out_cheers: number;
  out_kind: 'lockin' | 'post' | 'milestone';
  out_preset: string | null;
  out_goal_type: string | null;
  out_category: string | null;
  out_activity: string | null;
  out_attach_kind: string | null;
  out_detail: string | null;
  out_at: string;
};

/** "Deep Work", "Studying", "Gym" — the activity word, or null when it is masked. */
function activityWord(goalType: string | null, category: string | null, activity: string | null): string | null {
  if (!goalType && !category) return null;
  const label = friendActivityLabel({ live: true, goalType: goalType as GoalType | null, category, activity });
  return label === 'Locked in' ? null : label;
}

function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] || name;
}

function backerLine(r: BackerRow, name: string): string {
  const who = firstName(name);
  if (r.out_kind === 'lockin') {
    const what = activityWord(r.out_goal_type, r.out_category, r.out_activity);
    const preset = cheerPresetMeta(r.out_preset ?? 'lock_in');
    return what ? `${who} cheered your ${what} ${preset.emoji}` : `${who}: “${preset.line.replace(/^\S+\s/, '')}” ${preset.emoji}`;
  }
  if (r.out_kind === 'post') {
    if (r.out_attach_kind === 'pr') return r.out_detail ? `${who} backed your ${r.out_detail} PR` : `${who} backed your PR`;
    if (r.out_attach_kind === 'lockin') {
      const what = activityWord(r.out_goal_type, null, null);
      return what ? `${who} cheered your ${what} session` : `${who} cheered your session`;
    }
    return `${who} cheered your post`;
  }
  return `${who} cheered your milestone`;
}

export async function fetchMyBackers(): Promise<Backer[]> {
  const { data, error } = await supabase.rpc('get_my_backers_this_week');
  if (error) throw error;
  return ((data ?? []) as BackerRow[]).map((r) => {
    const name = displayName(r.out_display_name, r.out_handle);
    return {
      userId: r.out_user_id,
      name,
      avatarUrl: r.out_avatar_url,
      cheers: r.out_cheers ?? 1,
      line: backerLine(r, name),
      at: r.out_at,
    };
  });
}

// ───────────────────────────── 3 · what your people are doing ─────────────────────────────

export type FriendEffort = {
  userId: string;
  name: string;
  avatarUrl: string | null;
  kind: 'live' | 'lockin' | 'pr' | 'post';
  live: boolean;
  goalType: GoalType | null;
  category: string | null;
  activity: string | null;
  durationSeconds: number | null;
  startedAt: string | null;
  paused: boolean;
  exercise: string | null;
  /** lb, as the gym tracker logs it. */
  weightLb: number | null;
  reps: number | null;
  body: string | null;
  /** Their Agora post for this effort — the target of a non-live Cheer. */
  postId: string | null;
  iCheered: boolean;
  at: string;
  /** Friends with something to show, before the limit. */
  total: number;
};

type EffortRow = {
  out_user_id: string;
  out_display_name: string | null;
  out_handle: string | null;
  out_avatar_url: string | null;
  out_kind: FriendEffort['kind'];
  out_live: boolean;
  out_goal_type: string | null;
  out_category: string | null;
  out_activity: string | null;
  out_duration_seconds: number | null;
  out_started_at: string | null;
  out_paused: boolean;
  out_exercise: string | null;
  out_weight: number | null;
  out_reps: number | null;
  out_body: string | null;
  out_post_id: string | null;
  out_i_cheered: boolean;
  out_at: string;
  out_total: number;
};

export async function fetchFriendsRecentEffort(limit = 5): Promise<FriendEffort[]> {
  const { data, error } = await supabase.rpc('get_friends_recent_effort', { p_limit: limit });
  if (error) throw error;
  return ((data ?? []) as EffortRow[]).map((r) => ({
    userId: r.out_user_id,
    name: displayName(r.out_display_name, r.out_handle),
    avatarUrl: r.out_avatar_url,
    kind: r.out_kind,
    live: r.out_live,
    goalType: (r.out_goal_type as GoalType | null) ?? null,
    category: r.out_category,
    activity: r.out_activity,
    durationSeconds: r.out_duration_seconds,
    startedAt: r.out_started_at,
    paused: r.out_paused,
    exercise: r.out_exercise,
    weightLb: r.out_weight == null ? null : Number(r.out_weight),
    reps: r.out_reps,
    body: r.out_body,
    postId: r.out_post_id,
    iCheered: r.out_i_cheered,
    at: r.out_at,
    total: r.out_total ?? 0,
  }));
}

const LB_PER_KG = 2.20462;

/**
 * The row's second line: [brain] "locked in · Deep Work · 42m", [dumbbell] "new PR · 115 kg × 3",
 * "“orgo final in 3 days”". The glyph comes back beside the text, not inside it, so the row can draw
 * the bespoke icon. The activity is already masked server-side for a friend who hides it.
 */
export function effortLine(e: FriendEffort, unit: 'lb' | 'kg', now: number = Date.now()): { icon: IconName | null; text: string } {
  if (e.kind === 'post') return { icon: null, text: `“${e.body ?? ''}”` };
  if (e.kind === 'pr') {
    const weight =
      e.weightLb != null && e.weightLb > 0
        ? unit === 'kg'
          ? `${Math.round((e.weightLb / LB_PER_KG) * 2) / 2} kg`
          : `${Math.round(e.weightLb)} lb`
        : null;
    const set = weight ? `${weight} × ${e.reps ?? 1}` : `${e.reps ?? 0} reps`;
    return { icon: 'gym', text: `new PR · ${e.exercise ?? 'lift'} · ${set}` };
  }
  const label = friendActivityLabel({ live: true, goalType: e.goalType, category: e.category, activity: e.activity });
  const what = label;
  const masked = what === 'Locked in';
  const icon = effortIcon(e);
  if (e.kind === 'live') {
    const mins = e.startedAt ? Math.max(0, Math.floor((now - new Date(e.startedAt).getTime()) / 60_000)) : 0;
    const time = mins < 60 ? `${mins}m` : formatSessionDuration(mins * 60);
    return { icon, text: `locked in${masked ? '' : ` · ${what}`} · ${e.paused ? 'paused' : time}` };
  }
  const dur = e.durationSeconds ? ` · ${formatSessionDuration(e.durationSeconds)}` : '';
  return { icon, text: `${masked ? 'locked in' : what}${dur}` };
}

function effortIcon(e: FriendEffort): IconName {
  if (e.category === 'deep_work') return 'deep-work';
  if (e.category === 'study') return 'study';
  if (e.category === 'fitness') return e.activity === 'cardio' ? 'run' : 'gym';
  if (e.goalType === 'gym') return 'gym';
  if (e.goalType === 'run') return 'run';
  if (e.goalType === 'study' || e.goalType === 'read') return 'study';
  return 'flame';
}
