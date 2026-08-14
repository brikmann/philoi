// The Forge Pass season track (21k / FORGE_PASS.md). 100 tiers, a Free lane everyone climbs and a
// Premium lane unlocked by the seasonal subscription.
//
// Two things here are load-bearing and easy to get wrong:
//
// 1. Pass XP is NOT rank XP. It's a separate ledger fed only by achievements. If the Pass shared
//    the rank curve, either ranks would trivialize or the Pass would be unreachable — Infernal is
//    thousands of hours by design. So climbing here rewards *showing up*, not grinding.
// 2. Daily achievements are once-per-day, and that cap IS the wellbeing guardrail. You cannot
//    marathon the Pass: the deep-session achievement pays for ONE good 90-minute block, not ten.

import type { BoxKey } from '@/lib/economy/boxes';

export const SEASON = { id: 'S1', name: 'Emberfall', totalTiers: 100 } as const;

/** Seasonal subscription — auto-renews per SEASON, not per month (the monthly tiers are dropped). */
export const PASS_PRICE_LABEL = '$8.99/season';
export const PASS_FINE_PRINT = 'Auto-renews each season · cancel anytime · cosmetics only';

/**
 * Gentle ramp: 200 Pass XP for tier 1 rising linearly to 600 for tier 100, which totals ≈40,000 —
 * the representative figure in FORGE_PASS.md. Server-tunable; economy_config('pass_tier_curve')
 * is authoritative and this is only what the client draws the progress bar with.
 *
 * (Mock 68 shows "1,240 / 1,800 Pass XP → Tier 13". That 1,800 can't coexist with a 40,000 season
 * total across 100 tiers, so the spec's number wins and the mock's is treated as placeholder art.)
 */
export function tierCost(tier: number): number {
  return Math.round(200 + ((tier - 1) * 400) / (SEASON.totalTiers - 1));
}

/** Total Pass XP needed to have COMPLETED the given tier. */
export function cumulativeXpThroughTier(tier: number): number {
  let total = 0;
  for (let t = 1; t <= tier; t += 1) total += tierCost(t);
  return total;
}

/** Where a raw Pass-XP total puts you: current tier + progress into the next. */
export function tierFromXp(xp: number): { tier: number; intoTier: number; nextTierCost: number } {
  let remaining = xp;
  for (let t = 1; t <= SEASON.totalTiers; t += 1) {
    const cost = tierCost(t);
    if (remaining < cost) return { tier: t - 1, intoTier: remaining, nextTierCost: cost };
    remaining -= cost;
  }
  return { tier: SEASON.totalTiers, intoTier: 0, nextTierCost: 0 };
}

export type PassReward =
  | { kind: 'embers'; amount: number }
  | { kind: 'box'; box: BoxKey }
  | { kind: 'item'; itemId: string }
  | { kind: 'badge'; badgeKey: string; label: string };

export type PassTier = {
  tier: number;
  free: PassReward | null;
  premium: PassReward | null;
  /** Milestone tiers get the ★ treatment on the track (mock 68). */
  milestone: boolean;
};

// The named tiers from FORGE_PASS.md's representative map. Everything not listed is filled in by
// the generator below: premium gets a reward at EVERY tier (that's the value proposition), free
// gets embers sprinkled between its milestone drops.
const NAMED_TIERS: Record<number, { free: PassReward | null; premium: PassReward | null }> = {
  1: { free: { kind: 'embers', amount: 10 }, premium: { kind: 'item', itemId: 'flame-emberfall' } },
  5: { free: { kind: 'box', box: 'kindling' }, premium: { kind: 'item', itemId: 'card-emberfall' } },
  10: { free: { kind: 'embers', amount: 25 }, premium: { kind: 'item', itemId: 'halo-emberfall' } },
  25: { free: { kind: 'box', box: 'ignition' }, premium: { kind: 'box', box: 'furnace' } },
  50: { free: { kind: 'item', itemId: 'title-kindled' }, premium: { kind: 'item', itemId: 'banner-emberfall' } },
  75: { free: { kind: 'embers', amount: 50 }, premium: { kind: 'box', box: 'furnace' } },
  90: { free: { kind: 'box', box: 'kindling' }, premium: { kind: 'item', itemId: 'title-kindled-by-emberfall' } },
  100: {
    free: { kind: 'item', itemId: 'flame-molten-copper' },
    premium: { kind: 'item', itemId: 'flare-emberfall-ascendant' },
  },
};

const FREE_MILESTONES = new Set([1, 5, 10, 25, 50, 75, 90, 100]);

function generatedPremium(tier: number): PassReward {
  // Boxes scale Kindling → Promethean across the season; the tiers between them pay embers, which
  // is the "monthly-feel stipend spread across tiers" from FORGE_PASS.md.
  if (tier % 20 === 0) return { kind: 'box', box: 'hestia' };
  if (tier % 10 === 0) return { kind: 'box', box: 'furnace' };
  if (tier % 5 === 0) return { kind: 'box', box: 'ignition' };
  if (tier % 3 === 0) return { kind: 'box', box: 'kindling' };
  return { kind: 'embers', amount: tier < 34 ? 25 : tier < 67 ? 50 : 75 };
}

export const PASS_TIERS: PassTier[] = Array.from({ length: SEASON.totalTiers }, (_, i) => {
  const tier = i + 1;
  const named = NAMED_TIERS[tier];
  return {
    tier,
    // The free lane is deliberately sparse between milestones — "a reward at milestone tiers +
    // embers sprinkled between", not a reward every tier. That gap is what the Premium lane sells.
    free: named?.free ?? (tier % 4 === 0 ? { kind: 'embers', amount: 10 } : null),
    premium: named?.premium ?? generatedPremium(tier),
    milestone: FREE_MILESTONES.has(tier),
  };
});

/** Tier 100 premium also carries the completionist badge alongside the Mythic capstone. */
export const CAPSTONE_BADGE: PassReward = { kind: 'badge', badgeKey: 's1-completionist', label: 'S1 Completionist' };

// ───────────────────────────── Pass XP · the achievement system ─────────────────────────────
// The ONLY source of Pass XP. Verified-effort only (Step 18) — these fire off already-counted
// lock-ins, never self-reported junk.

export type AchievementCadence = 'daily' | 'weekly' | 'season';

export type Achievement = {
  key: string;
  cadence: AchievementCadence;
  label: string;
  xp: number;
  /** Progress-style achievements show "2 / 3"; the rest are a simple done/not-done tick. */
  target?: number;
  unit?: string;
};

export const ACHIEVEMENTS: Achievement[] = [
  // Daily — each claimable once per day. This cap is the anti-marathon guardrail.
  { key: 'daily_first_lock_in', cadence: 'daily', label: 'First lock-in of the day', xp: 50 },
  { key: 'daily_three_lock_ins', cadence: 'daily', label: '3 lock-ins today', xp: 75, target: 3 },
  { key: 'daily_deep_session', cadence: 'daily', label: 'A deep session — 90+ min in one lock-in', xp: 100 },
  { key: 'daily_gym_lock_in', cadence: 'daily', label: 'A gym lock-in', xp: 60 },
  { key: 'daily_different_goal', cadence: 'daily', label: 'Try a different goal type than yesterday', xp: 40 },
  { key: 'daily_with_a_friend', cadence: 'daily', label: 'Lock in with a friend / in a campfire', xp: 50 },

  // Weekly
  { key: 'weekly_six_active_days', cadence: 'weekly', label: '6 active days this week', xp: 300, target: 6, unit: 'days' },
  { key: 'weekly_ten_hours', cadence: 'weekly', label: '10 hours locked in this week', xp: 250, target: 10, unit: 'h' },
  { key: 'weekly_five_gym', cadence: 'weekly', label: '5 gym sessions this week', xp: 200, target: 5 },
  { key: 'weekly_win_challenge', cadence: 'weekly', label: 'Win a challenge', xp: 200 },
  { key: 'weekly_hit_goal', cadence: 'weekly', label: 'Hit your weekly goal', xp: 150 },

  // Season / one-time milestones
  { key: 'season_new_rank', cadence: 'season', label: 'Reach a new rank this season', xp: 500 },
  { key: 'season_finish_campfire_challenge', cadence: 'season', label: 'Finish a full campfire challenge', xp: 300 },
  { key: 'season_thirty_day_streak', cadence: 'season', label: '30-day streak', xp: 500 },
];

export const CADENCE_LABEL: Record<AchievementCadence, string> = {
  daily: 'Daily',
  weekly: 'Weekly',
  season: 'Season',
};

export const CADENCE_RESET_HINT: Record<AchievementCadence, string> = {
  daily: 'one each per day',
  weekly: 'resets Mon',
  season: 'one-time',
};

// ───────────────────────────── Ember packs (real money — DEFERRED) ─────────────────────────────
// Task #71: these need RevenueCat and therefore a native build. They render as disabled stubs
// until src/lib/billing.ts is wired — see purchaseEmberPack().

export type EmberPack = { key: string; embers: number; name: string; price: string; best?: boolean };

export const EMBER_PACKS: EmberPack[] = [
  { key: 'remnant', embers: 500, name: 'Remnant', price: '$4.99' },
  { key: 'pile', embers: 1200, name: 'Pile', price: '$9.99', best: true },
  { key: 'stack', embers: 2600, name: 'Stack', price: '$19.99' },
  { key: 'hoard', embers: 7000, name: 'Hoard', price: '$49.99' },
];
