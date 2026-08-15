// Forge Pass claims + Pass XP (21k). Premium ownership is checked SERVER-side inside
// claim_pass_tier — the `owns_premium` flag the client reads is for rendering locks, never for
// authorization.

import { track } from '@/lib/analytics';
import { getItem } from '@/lib/economy/catalog';
import type { PassReward } from '@/lib/economy/forge-pass';
import { supabase } from '@/lib/supabase';
import { weekKey } from '@/lib/time/week';

/**
 * Claim one LEVEL's rewards for one lane.
 *
 * Takes the whole bundle, not a single reward, because a level can hand over more than one thing —
 * L50 premium is a Mythic halo AND the Emberfall Strike sting. The old one-reward-per-call shape
 * couldn't express that: `pass_claims` is unique on (user, season, level, lane), so looping this
 * function over a bundle would have granted the first reward and then thrown a duplicate-key error
 * on the second, leaving the user with half a level and no way to ask for the rest.
 *
 * The server re-derives everything that matters — level reached, lane ownership, the season window
 * — and grants the whole array in one transaction.
 */
export async function claimPassLevel(level: number, lane: 'free' | 'premium', rewards: PassReward[]): Promise<void> {
  const payload = rewards.map((reward) => {
    const item = reward.kind === 'item' ? getItem(reward.itemId) : undefined;
    return {
      kind: reward.kind,
      embers: reward.kind === 'embers' ? reward.amount : null,
      box_key: reward.kind === 'box' ? reward.box : null,
      item_key: reward.kind === 'item' ? reward.itemId : reward.kind === 'badge' ? reward.badgeKey : null,
      item_rarity: item?.rarity ?? null,
      item_slot: item?.slot ?? null,
    };
  });
  const { error } = await supabase.rpc('claim_pass_level', {
    p_level: level,
    p_lane: lane,
    p_rewards: payload,
  });
  if (error) throw error;
  track('pass_level_claimed', { level, lane, rewards: rewards.length });
}

/**
 * Credit an achievement's Pass XP. The period key is what makes a daily achievement once-per-day —
 * the server has a unique index on (user, achievement, period), so calling twice in the same day
 * is a safe no-op rather than a double credit.
 */
export async function creditPassXp(achievementKey: string, xp: number, periodKey: string): Promise<number> {
  const { data, error } = await supabase.rpc('credit_pass_xp', {
    p_achievement: achievementKey,
    p_xp: xp,
    p_period: periodKey,
  });
  if (error) throw error;
  return data as number;
}

/**
 * Live counters for the progress-style achievements ("2 / 3", "6.5 / 10 h"). Separate from
 * get_inventory because it's a set of aggregate scans over lock_in_sessions — cheap, but not
 * something every shop screen should pay for just to show an ember balance.
 */
export async function fetchAchievementProgress(): Promise<Record<string, number>> {
  const { data, error } = await supabase.rpc('get_pass_achievement_progress');
  if (error) throw error;
  return data ?? {};
}

export type SeasonStanding = {
  season_id: string;
  university: string;
  rank: number;
  board_size: number;
  pass_xp: number;
  pass_level: number;
  percentile: number;
};

/**
 * Your final placing once the season has been closed out (migration 0075). Returns null until the
 * standings snapshot exists, which is exactly how the client knows the close job hasn't run yet —
 * there is deliberately no separate "is the season closed" flag to drift out of sync with it.
 */
export async function fetchMySeasonStanding(): Promise<SeasonStanding | null> {
  const { data, error } = await supabase.rpc('get_my_season_standing', { p_season: null });
  if (error) throw error;
  return (data as SeasonStanding | null) ?? null;
}

/** `2026-08-07` for dailies, `W2953` for weeklies, the season id for one-time milestones. */
export function periodKeyFor(cadence: 'daily' | 'weekly' | 'season', seasonId: string, now = new Date()): string {
  if (cadence === 'season') return seasonId;
  if (cadence === 'daily') {
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  }
  // The shared Sunday-anchored week (punchlist 8 §5). This key is compared against one the SERVER
  // writes for the same achievements — `pass_xp_ledger` is deduped on (user, achievement, period),
  // so the two sides producing different strings for the same week would let one weekly credit
  // twice. This used to count `(now − Jan 1) / 7 days` in LOCAL time while the server wrote ISO
  // `to_char(now(), 'IYYY-"W"IW')`: different boundary, different format, and a mismatch that only
  // showed up as a duplicate credit. `week_key()` in migration 0071 is the other half of this.
  return weekKey(now.getTime());
}
