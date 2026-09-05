import { track } from '@/lib/analytics';
import { supabase } from '@/lib/supabase';

/**
 * PRIVATE MODE — a visibility wall with a friends allowlist (migration 0170).
 *
 * When this is on, only accepted friends can see this user: they vanish from search and from every
 * leaderboard a non-friend reads, their profile rank block reads "Rank muted", and in a challenge's
 * standings they render as "Anonymous" at the bottom with no position.
 *
 * 🔴 WHAT IT IS NOT. It is not an account freeze and it is not a notification mute. The user keeps
 * earning XP, ranks and streaks; they still see their OWN real rank everywhere; and they are still
 * ranked and PAID on the real numbers at settlement — anonymity in a race is a display layer, never
 * a scoring one. An anonymous racer can win.
 *
 * Symmetric by default: the wall faces both ways, so a private user's own boards show friends only.
 * That is the "I don't want to see everyone crushing it" half of the request, and it is one line in
 * can_see_rank if it ever needs to be split out.
 *
 * Writes only the caller's own row — the RPC is security definer and keys on auth.uid(), so there
 * is no user id to pass and no way to set someone else's.
 */
export async function setLeaderboardPrivate(on: boolean): Promise<void> {
  const { error } = await supabase.rpc('set_leaderboard_private', { p_on: on });
  if (error) throw error;
  track('leaderboard_private_changed', { on });
}
