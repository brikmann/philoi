import { track } from '@/lib/analytics';
import { formatRankTier } from '@/lib/rank-tiers';
import { supabase } from '@/lib/supabase';
import type { PingResult, RankTierName } from '@/types/database';

const DAY_MS = 24 * 60 * 60 * 1000;

// A "friend" is a real, mutually-accepted connection (migration 0031_real_friend_graph.sql —
// see src/lib/api/friend-requests.ts for the send/accept/decline flow), not campfire
// co-membership. shared_circle_id is one circle you BOTH happen to belong to, if any — used only
// as optional challenge-creation context; two real friends may share no campfire at all.
export type Friend = {
  friend_id: string;
  display_name: string;
  avatar_url: string | null;
  /** Null when the friend's season rank is on Private (0217) — they stay your friend; the rank goes. */
  tier: RankTierName | null;
  division: number | null;
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
  // 0217 · a friend on Private has no rank to print — the streak half stands on its own.
  const rank = friend.tier && friend.division !== null ? formatRankTier(friend.tier, friend.division) : null;
  const withRank = (rest: string) => (rank ? `${rank} · ${rest}` : rest.charAt(0).toUpperCase() + rest.slice(1));
  if (goalLabel) return `Locked in now · ${goalLabel}`;
  if (friend.current_streak > 0) return withRank(`${friend.current_streak}-day streak`);
  if (friend.last_lockin_at) {
    const days = Math.max(1, Math.floor((Date.now() - new Date(friend.last_lockin_at).getTime()) / DAY_MS));
    return withRank(`going cold ${days}d`);
  }
  return withRank('getting started');
}

/**
 * One-tap nudge to a friend — now the same shape as the campfire ping (migration 0207).
 *
 * It lands in BOTH places: a bell row and a push. The bell row used to be written with no route,
 * because notify_push infers the route by sniffing the payload and has no 'lock_in_nudge' branch —
 * so the row rendered disabled and the one gesture meant to get you to the goal picker couldn't.
 * 0207 states the route instead of hoping it is inferred.
 *
 * Returns what actually happened, rather than void. "No exception" was never the same as
 * "delivered": only about 4 in 10 profiles have a registered device, and a repeat inside ten
 * minutes is now refused. The sheet shows the difference instead of claiming a send either way —
 * this is the same correction 0172 made to the campfire ping, for the same reason.
 *
 * A build talking to a pre-0207 database gets `undefined` back and falls through to 'sent', which
 * is exactly the (optimistic) behaviour it has today rather than a crash.
 *
 * ONE KIND, NOT TWO. This briefly took a `kind` so the sheet could also send 0207's 'fire' praise
 * ping — but the two sat as separate rows that both read as "send them something", and the second
 * was reported as a duplicate of the first. The nudge is the only send the friend sheet offers
 * now, so `p_kind` is omitted entirely: that is also what keeps this call resolving against a
 * pre-0207 database, where the function takes one parameter and an unknown second fails the
 * request outright rather than falling back. The server still has the 'fire' branch if praise
 * earns a surface of its own later.
 */
export async function nudgeToLockIn(userId: string): Promise<PingResult> {
  const { data, error } = await supabase.rpc('nudge_to_lock_in', { p_user_id: userId });
  if (error) throw error;
  const result = (data as PingResult | null) ?? 'sent';
  // `kind` stays in the payload as a literal: the event's shape predates this change and the
  // dashboards reading it should not have to learn about a field that went missing.
  track('friend_nudged', { friend_id: userId, kind: 'nudge', result });
  return result;
}
