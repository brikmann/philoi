import { track } from '@/lib/analytics';
import { formatRankTier } from '@/lib/rank-tiers';
import { supabase } from '@/lib/supabase';
import type { RankTierName } from '@/types/database';

const DAY_MS = 24 * 60 * 60 * 1000;

// A "friend" is a real, mutually-accepted connection (migration 0031_real_friend_graph.sql —
// see src/lib/api/friend-requests.ts for the send/accept/decline flow), not campfire
// co-membership. shared_circle_id is one circle you BOTH happen to belong to, if any — used only
// as optional challenge-creation context; two real friends may share no campfire at all.
export type Friend = {
  friend_id: string;
  display_name: string;
  avatar_url: string | null;
  tier: RankTierName;
  division: number;
  current_streak: number;
  /** Their last real lock-in — for the "going cold Nd" status line. Null = never locked in. */
  last_lockin_at: string | null;
  shared_circle_id: string | null;
  shared_circle_name: string | null;
};

export async function fetchMyFriends(): Promise<Friend[]> {
  const { data, error } = await supabase.rpc('get_my_friends');
  if (error) throw error;
  return data ?? [];
}

// The row/sheet status line (design-mocks/21): "Locked in now · Gym" while active, else the rank
// paired with streak state — "5-day streak", "going cold 3d" (lapsed but has locked in before),
// or "getting started" (never has). goalLabel is the live goal when locked in, else null.
export function friendStatusLine(friend: Friend, goalLabel: string | null): string {
  const rank = formatRankTier(friend.tier, friend.division);
  if (goalLabel) return `Locked in now · ${goalLabel}`;
  if (friend.current_streak > 0) return `${rank} · ${friend.current_streak}-day streak`;
  if (friend.last_lockin_at) {
    const days = Math.max(1, Math.floor((Date.now() - new Date(friend.last_lockin_at).getTime()) / DAY_MS));
    return `${rank} · going cold ${days}d`;
  }
  return `${rank} · getting started`;
}

// One-tap nudge — fires a push ("<you> pinged you to lock in 🔥"); tapping it opens the goal
// picker (see _layout.tsx's 'lock_in_nudge' handler). Push-only: no in-app notification centre.
export async function nudgeToLockIn(userId: string): Promise<void> {
  const { error } = await supabase.rpc('nudge_to_lock_in', { p_user_id: userId });
  if (error) throw error;
  track('friend_nudged', { friend_id: userId });
}
