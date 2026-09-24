import { track } from '@/lib/analytics';
import { supabase } from '@/lib/supabase';
import type { Profile, RankVisibility } from '@/types/database';

/**
 * SEASON RANK VISIBILITY — three dials (migration 0217, extending 0170's Private mode).
 *
 *   public   (default) — anyone can see your rank; you see the open boards and get the placement push.
 *   friends            — only accepted friends see you; your boards are you + your friends ("#1 of 6").
 *   private            — nobody but you. No board, no position, no comparison — just your own climb.
 *
 * The wall is symmetric and enforced server-side in can_see_rank: a friends-dial user's boards come
 * back already re-ranked over their friends, and a private user's come back as just themselves. The
 * client's job is to label that honestly, not to filter it.
 *
 * 🔴 WHAT IT IS NOT. It is not a reward setting. XP, ranks, streaks and every season reward are
 * computed on the real numbers regardless of the dial — an anonymous racer can still win, a private
 * climber is still paid their placement. Say so wherever the dial is shown.
 *
 * Writes only the caller's own row — the RPC is security definer and keys on auth.uid().
 */
export async function setRankVisibility(scope: RankVisibility): Promise<void> {
  const { error } = await supabase.rpc('set_rank_visibility', { p_scope: scope });
  if (error) throw error;
  track('rank_visibility_changed', { scope });
}

/**
 * The caller's dial, read defensively. A profile fetched from a database that predates 0217 has no
 * `rank_visibility`, only 0170's boolean — which meant "friends only", so that is what it maps to.
 */
export function rankVisibilityOf(profile: Pick<Profile, 'rank_visibility' | 'leaderboard_private'> | null | undefined): RankVisibility {
  if (profile?.rank_visibility) return profile.rank_visibility;
  return profile?.leaderboard_private ? 'friends' : 'public';
}
