import { supabase } from '@/lib/supabase';
import { weekStart } from '@/lib/time/week';

/**
 * XP each member has earned SINCE THE WEEK OPENED, keyed by user id (§5).
 *
 * ── WHY THIS IS A SEPARATE QUERY AND NOT A COLUMN ON THE LEADERBOARD ──────────────────────────
 *
 * `get_group_leaderboard(p_group_id)` returns exactly one score per member and it is
 * `universal_score(user_id)` — a LIFETIME aggregate (every domain's score plus every
 * bonus_xp_awards row, with no time bound anywhere in it). The RPC's only other weekly figure is
 * `check_ins_this_week`, a COUNT of lock-ins.
 *
 * So the panel's "This week" tab had nothing weekly to rank XP by, which is why it previously
 * ranked by lock-in count and reported that instead — honest, but not what was asked for, and
 * "both tabs show the same thing" is a fair reading of the result.
 *
 * Adding `score_this_week` to the RPC is the tidier answer and is deliberately NOT what this does:
 * that function's shape is a RETURNS TABLE, so adding a column means DROP-then-create rather than
 * `create or replace` (its own migration says so at the top: "CREATE OR REPLACE can't change an
 * existing function's RETURNS TABLE columns"), and every other caller — the university and global
 * boards share the shape — would need re-checking. This pass was scoped to the client.
 *
 * ── WHAT IT COUNTS, AND WHAT IT DOES NOT ─────────────────────────────────────────────────────
 *
 * `check_ins.xp_earned` over the current week. That is the same column `social_challenge_score`
 * sums when it scores an 'xp' race, so this figure agrees with what a challenge would have
 * measured over the same window.
 *
 * It does NOT include `bonus_xp_awards` — challenge payouts and season grants. Those rows are
 * readable for yourself but not for other members, so including them would make YOUR weekly number
 * bigger than everyone else's by construction and silently corrupt the ranking. A board that is
 * wrong only for the person reading it is the worst kind of wrong. The label in the panel says
 * "from lock-ins" for the same reason.
 *
 * The window is the shared Sunday 00:00 UTC anchor (lib/time/week.ts), which is the same boundary
 * the server's `week_start()` uses — so this rolls over at the same instant as every other weekly
 * timer in the app rather than at a boundary of its own.
 */
export async function fetchWeeklyXpByUser(userIds: string[]): Promise<Record<string, number>> {
  if (userIds.length === 0) return {};

  const since = new Date(weekStart()).toISOString();
  const { data, error } = await supabase
    .from('check_ins')
    .select('user_id, xp_earned')
    .in('user_id', userIds)
    .is('removed_at', null)
    .gte('created_at', since);
  if (error) throw error;

  const totals: Record<string, number> = {};
  for (const row of data ?? []) {
    const uid = (row as { user_id: string }).user_id;
    const xp = Number((row as { xp_earned: number | null }).xp_earned ?? 0);
    totals[uid] = (totals[uid] ?? 0) + xp;
  }
  return totals;
}
