import { GOAL_TYPE_META } from '@/lib/goal-types';
import { supabase } from '@/lib/supabase';
import type { GoalType } from '@/types/database';

/**
 * Lock-in cheers + session-scoped messages (migration 0270, mock 298).
 *
 * Everything here is LIVE-ONLY. A cheer needs the friend to be locked in. A message starts only
 * toward a friend who is locked in (you needn't be), and the thread stays open while at least one
 * of you is. There is no inbox and no history: once neither is live the thread reads back empty
 * and the server refuses the rows outright — so nothing in this module caches a thread past the
 * screen that is showing it.
 */

export type CheerPreset = 'lock_in' | 'lets_go' | 'respect' | 'keep_going' | 'for_the_house' | 'proud_of_you';

/** The fixed list, in picker order. `short` is the mini-picker caption, `line` the sent text. */
export const CHEER_PRESETS: { key: CheerPreset; emoji: string; short: string; line: string }[] = [
  { key: 'lock_in', emoji: '🔥', short: 'Lock in', line: '🔥 Lock in' },
  { key: 'lets_go', emoji: '💪', short: "Let's go", line: "💪 Let's go" },
  { key: 'respect', emoji: '🫡', short: 'Respect', line: '🫡 Respect' },
  { key: 'keep_going', emoji: '⚡', short: 'Keep going', line: '⚡ Keep going' },
  { key: 'for_the_house', emoji: '🏛', short: 'House', line: '🏛 For the house' },
  { key: 'proud_of_you', emoji: '👑', short: 'Proud', line: '👑 Proud of you' },
];

export function cheerPresetMeta(key: string) {
  return CHEER_PRESETS.find((p) => p.key === key) ?? CHEER_PRESETS[0];
}

/** Quick lines offered in a thread, beside the text field. */
export const THREAD_QUICK_LINES = ['🔥 Lock in', "😤 Let's go", 'Almost done', 'Back to it 🫡'];

export const LOCKIN_MESSAGE_MAX = 140;

export type FriendLockedIn = {
  userId: string;
  name: string;
  avatarUrl: string | null;
  /** False for a friend listed only because your thread with them is still open (you're live). */
  live: boolean;
  /** Null when they hide what they're doing (show_live_activity off), or aren't live. */
  goalType: GoalType | null;
  category: string | null;
  activity: string | null;
  startedAt: string | null;
  paused: boolean;
  iCheered: boolean;
  threadOpen: boolean;
  /** Unread messages from them in the open thread. */
  unread: number;
};

type FriendRow = {
  out_user_id: string;
  out_display_name: string | null;
  out_handle: string | null;
  out_avatar_url: string | null;
  out_live: boolean;
  out_goal_type: string | null;
  out_category: string | null;
  out_activity: string | null;
  out_started_at: string | null;
  out_paused: boolean;
  out_i_cheered: boolean;
  out_thread_open: boolean;
  out_unread: number;
};

function displayName(name: string | null, handle: string | null): string {
  return (name ?? '').trim() || handle || 'A friend';
}

export async function fetchFriendsLockedIn(): Promise<FriendLockedIn[]> {
  const { data, error } = await supabase.rpc('get_friends_locked_in');
  if (error) throw error;
  return ((data ?? []) as FriendRow[]).map((r) => ({
    userId: r.out_user_id,
    name: displayName(r.out_display_name, r.out_handle),
    avatarUrl: r.out_avatar_url,
    live: r.out_live,
    goalType: (r.out_goal_type as GoalType | null) ?? null,
    category: r.out_category,
    activity: r.out_activity,
    startedAt: r.out_started_at,
    paused: r.out_paused,
    iCheered: r.out_i_cheered,
    threadOpen: r.out_thread_open,
    unread: r.out_unread ?? 0,
  }));
}

/** "🧠 Deep Work", "🏋️ Gym" — or a neutral line when they keep the activity private. */
export function friendActivityLabel(f: Pick<FriendLockedIn, 'live' | 'goalType' | 'category' | 'activity'>): string {
  if (!f.live) return 'Not locked in';
  if (f.category === 'deep_work') return '🧠 Deep Work';
  if (f.category === 'study') return `${GOAL_TYPE_META.study.emoji} ${GOAL_TYPE_META.study.label}`;
  if (f.category === 'fitness' && f.activity === 'cardio') return `${GOAL_TYPE_META.run.emoji} ${GOAL_TYPE_META.run.label}`;
  if (f.category === 'fitness') return `${GOAL_TYPE_META.gym.emoji} ${GOAL_TYPE_META.gym.label}`;
  const meta = f.goalType ? GOAL_TYPE_META[f.goalType] : undefined;
  return meta ? `${meta.emoji} ${meta.label}` : '🔥 Locked in';
}

/** "42m in", "1h 06m in". */
export function timeInLabel(startedAt: string, now: number = Date.now()): string {
  const mins = Math.max(0, Math.floor((now - new Date(startedAt).getTime()) / 60_000));
  if (mins < 60) return `${mins}m in`;
  return `${Math.floor(mins / 60)}h ${String(mins % 60).padStart(2, '0')}m in`;
}

export type ReceivedCheer = {
  id: string;
  fromUserId: string;
  name: string;
  avatarUrl: string | null;
  preset: CheerPreset;
  createdAt: string;
};

type CheerRow = {
  out_id: string;
  out_from_user: string;
  out_display_name: string | null;
  out_handle: string | null;
  out_avatar_url: string | null;
  out_preset: string;
  out_created_at: string;
};

/** Cheers received on your current session — the tally under the timer. Empty when not live. */
export async function fetchMyLockInCheers(): Promise<ReceivedCheer[]> {
  const { data, error } = await supabase.rpc('get_my_lockin_cheers');
  if (error) throw error;
  return ((data ?? []) as CheerRow[]).map((r) => ({
    id: r.out_id,
    fromUserId: r.out_from_user,
    name: displayName(r.out_display_name, r.out_handle),
    avatarUrl: r.out_avatar_url,
    preset: r.out_preset as CheerPreset,
    createdAt: r.out_created_at,
  }));
}

/** True when sent; false when you already cheered this session of theirs. */
export async function sendCheer(toUserId: string, preset: CheerPreset): Promise<boolean> {
  const { data, error } = await supabase.rpc('send_cheer', { p_to_user: toUserId, p_preset: preset });
  if (error) throw error;
  return data === true;
}

export type LockInThreadMessage = { id: string; fromMe: boolean; body: string; createdAt: string };

/** The open thread with one friend. Empty when either of you isn't live. Marks theirs as read. */
export async function fetchLockInThread(withUserId: string): Promise<LockInThreadMessage[]> {
  const { data, error } = await supabase.rpc('get_lockin_thread', { p_with_user: withUserId });
  if (error) throw error;
  return ((data ?? []) as { out_id: string; out_from_me: boolean; out_body: string; out_created_at: string }[]).map(
    (r) => ({ id: r.out_id, fromMe: r.out_from_me, body: r.out_body, createdAt: r.out_created_at })
  );
}

export async function sendLockInMessage(toUserId: string, body: string): Promise<string> {
  const { data, error } = await supabase.rpc('send_lockin_message', { p_to_user: toUserId, p_body: body });
  if (error) throw error;
  return data as string;
}

export async function reportLockInThread(withUserId: string, reason: string): Promise<void> {
  const { error } = await supabase.rpc('report_lockin_thread', { p_with_user: withUserId, p_reason: reason });
  if (error) throw error;
}

export type LockInInbound =
  | { kind: 'cheer'; fromUserId: string; preset: CheerPreset }
  | { kind: 'message'; fromUserId: string; body: string };

/**
 * Realtime — a cheer or a line addressed to you lands live. RLS scopes delivery to rows you can
 * read (your own, and for messages only while the thread is open); the to_user filter keeps the
 * subscription from leaning on RLS for the fan-out. Returns an unsubscribe function.
 */
export function subscribeToLockInInbound(userId: string, onInbound: (e: LockInInbound) => void): () => void {
  const channel = supabase
    .channel(`lockin-cheers:${userId}`)
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'lockin_cheers', filter: `to_user=eq.${userId}` },
      (payload) => {
        const row = payload.new as { from_user: string; preset: CheerPreset };
        onInbound({ kind: 'cheer', fromUserId: row.from_user, preset: row.preset });
      }
    )
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'lockin_messages', filter: `to_user=eq.${userId}` },
      (payload) => {
        const row = payload.new as { from_user: string; body: string };
        onInbound({ kind: 'message', fromUserId: row.from_user, body: row.body });
      }
    )
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}

/** Push types this feature sends; the in-app banner replaces the OS one while foregrounded. */
export const LOCKIN_CHEER_PUSH_TYPES = new Set(['lockin_cheer', 'lockin_message']);

// Whether a focused screen is painting its own inbound banner right now (the running timer). Read
// by the foreground notification handler, which cannot see React state.
let inboundSurfaceActive = false;

export function setLockInInboundSurfaceActive(active: boolean): void {
  inboundSurfaceActive = active;
}

export function isLockInInboundSurfaceActive(): boolean {
  return inboundSurfaceActive;
}
