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
import type { Rarity } from '@/lib/economy/rarity';

// ───────────────────────────── Season 1 · Emberfall ─────────────────────────────
//
// COPY RULE: the Forge Pass counts in LEVELS. The rank ladder counts in TIERS. The two never share
// a word in code or in UI — "Tier 40" meaning two different things in the same app was the single
// most confusing thing about the old build, so `tier` is now reserved for RankTierName and every
// symbol here says level.
//
// The season is DATE-GATED and the gate is hard (FORGE_PASS_SEASON1 §"Season window"). The window
// below is the client's copy of it; economy_config('season') is authoritative and the server
// re-checks on every purchase and every claim. The client's copy exists to render "opens in 26
// days" without a round trip, never to decide whether something is allowed.
export const SEASON = {
  id: 'S1',
  name: 'Emberfall',
  totalLevels: 100,
  /** Laurier + Waterloo Fall term. */
  startsAt: Date.UTC(2026, 8, 10),
  endsAt: Date.UTC(2026, 11, 23),
  /**
   * After `endsAt` the track freezes but already-earned rewards stay claimable for a week. Without
   * it, anyone who finished the season on the last day and didn't open the app that evening would
   * lose everything they earned — the freeze is meant to stop further progress, not to confiscate.
   */
  claimWindowDays: 7,
} as const;

/** Seasonal subscription — auto-renews per SEASON, not per month (the monthly tiers are dropped). */
export const PASS_PRICE_LABEL = '$9.99/season';
export const PASS_FINE_PRINT = 'Auto-renews each season · cancel anytime · cosmetics only';

export type SeasonPhase = 'upcoming' | 'live' | 'claim-window' | 'closed';

/**
 * Where the season is right now. Everything user-facing branches on this: the pass is not
 * purchasable outside 'live', XP does not accrue outside 'live', and claims are refused after
 * 'claim-window'.
 */
export function seasonPhase(now: number = Date.now()): SeasonPhase {
  if (now < SEASON.startsAt) return 'upcoming';
  if (now < SEASON.endsAt) return 'live';
  if (now < SEASON.endsAt + SEASON.claimWindowDays * 86_400_000) return 'claim-window';
  return 'closed';
}

/** Milliseconds until the season opens (upcoming) or closes (live). 0 once it has closed. */
export function msUntilSeasonBoundary(now: number = Date.now()): number {
  const phase = seasonPhase(now);
  if (phase === 'upcoming') return SEASON.startsAt - now;
  if (phase === 'live') return SEASON.endsAt - now;
  if (phase === 'claim-window') return SEASON.endsAt + SEASON.claimWindowDays * 86_400_000 - now;
  return 0;
}

/**
 * The XP curve: 250 for Level 1 ramping linearly to 1,450 for Level 100.
 *
 * Those endpoints are chosen to make the sum land on exactly 85,000 — the season total
 * FORGE_PASS_SEASON1 §"XP curve" targets — since for a linear ramp the total is just
 * `levels × (first + last) / 2`, and 100 × (250 + 1450) / 2 = 85,000. The spec's "~1,500 late" is
 * the shape; 1,450 is the value that makes the shape hit the stated total rather than overshoot it
 * by 2,500.
 *
 * ⚠️ UNTUNED against real lock-in earn rates — this is the third of the three numbers flagged for
 * Noah. The design target is that ~1 focused hour/day + challenges reaches L100 by Dec 23; whether
 * 85,000 is that number depends on measured Pass-XP-per-day, which needs live data.
 * economy_config('pass_level_curve') is authoritative server-side; this is what draws the bar.
 */
export const SEASON_XP_TOTAL = 85_000;
const FIRST_LEVEL_XP = 250;
const LAST_LEVEL_XP = 1_450;

export function levelCost(level: number): number {
  return Math.round(FIRST_LEVEL_XP + ((level - 1) * (LAST_LEVEL_XP - FIRST_LEVEL_XP)) / (SEASON.totalLevels - 1));
}

/** Total Pass XP needed to have COMPLETED the given level. */
export function cumulativeXpThroughLevel(level: number): number {
  let total = 0;
  for (let l = 1; l <= level; l += 1) total += levelCost(l);
  return total;
}

/** Where a raw Pass-XP total puts you: current level + progress into the next. */
export function levelFromXp(xp: number): { level: number; intoLevel: number; nextLevelCost: number } {
  let remaining = xp;
  for (let l = 1; l <= SEASON.totalLevels; l += 1) {
    const cost = levelCost(l);
    if (remaining < cost) return { level: l - 1, intoLevel: remaining, nextLevelCost: cost };
    remaining -= cost;
  }
  return { level: SEASON.totalLevels, intoLevel: 0, nextLevelCost: 0 };
}

export type PassReward =
  | { kind: 'embers'; amount: number }
  | { kind: 'box'; box: BoxKey }
  | { kind: 'item'; itemId: string }
  | { kind: 'badge'; badgeKey: string; label: string };

export type PassLevel = {
  level: number;
  /**
   * A lane is a LIST, not a single reward. Several levels hand over two things at once — L50's
   * Mythic halo arrives with the Emberfall Strike sting, L100's crown with its title — and
   * modelling that as one reward would have meant either dropping half of each or inventing
   * fake intermediate levels to hold the remainder.
   */
  free: PassReward[];
  premium: PassReward[];
  /** The four Mythic milestones (25/50/75/100) — the big violet anvil nodes on the track. */
  milestone: boolean;
};

/** Box key by the rarity the spec's reward table names ("Rare Box" → furnace). */
const BOX_BY_RARITY: Record<Rarity, BoxKey> = {
  common: 'kindling',
  uncommon: 'ignition',
  rare: 'furnace',
  epic: 'hestia',
  legendary: 'hephaestus',
  mythic: 'promethean',
};

const box = (rarity: Rarity): PassReward => ({ kind: 'box', box: BOX_BY_RARITY[rarity] });
const embers = (amount: number): PassReward => ({ kind: 'embers', amount });
const gear = (itemId: string): PassReward => ({ kind: 'item', itemId });

/**
 * Bought the pass → these land immediately, before a single level is climbed
 * (FORGE_PASS_SEASON1 §"Level 0"). This is the purchase's receipt: the marquee Mythic flare is
 * here rather than at a milestone precisely so the $9.99 buys something the same second it clears.
 */
export const LEVEL_ZERO_UNLOCK: PassReward[] = [
  gear('flare-emberfall-ascendant'),
  gear('flame-forge'),
  embers(1_000),
];

/**
 * Off-level ember drip (FORGE_PASS_SEASON1 §"Off-level ember drip"). Every level that isn't a
 * multiple of 5 still pays, so 1→2→3 always pops — a track with nothing on four levels out of five
 * is a track people stop looking at.
 */
const PHASES = [
  { name: 'Crucible', from: 1, to: 25, free: 20, premium: 40 },
  { name: 'Arena', from: 26, to: 50, free: 30, premium: 60 },
  { name: 'Pantheon', from: 51, to: 75, free: 40, premium: 80 },
  { name: 'Transcendent', from: 76, to: 100, free: 50, premium: 100 },
] as const;

export type PhaseName = (typeof PHASES)[number]['name'];

export function phaseForLevel(level: number): PhaseName {
  return (PHASES.find((p) => level >= p.from && level <= p.to) ?? PHASES[PHASES.length - 1]).name;
}

function drip(level: number): { free: number; premium: number } {
  const phase = PHASES.find((p) => level >= p.from && level <= p.to) ?? PHASES[PHASES.length - 1];
  return { free: phase.free, premium: phase.premium };
}

/**
 * The named levels — every multiple of 5, straight off FORGE_PASS_SEASON1 §"Named levels".
 *
 * Note what is NOT here: no Streak Shield at any level. The roadmap had one and it was cut, because
 * a purchasable object that protects a streak is pay-for-standing, and the one promise this economy
 * makes is that money buys cosmetics and never rank, streaks, or position.
 */
const NAMED_LEVELS: Record<number, { free: PassReward[]; premium: PassReward[] }> = {
  // ── Crucible ──
  5: { free: [box('common')], premium: [box('uncommon'), gear('flame-molten-copper')] },
  10: { free: [box('uncommon')], premium: [box('rare'), gear('title-kindled')] },
  15: { free: [embers(50)], premium: [embers(250), gear('audio-monastery-drone')] },
  20: { free: [box('uncommon')], premium: [box('rare'), gear('banner-emberfall')] },
  25: { free: [box('rare')], premium: [gear('banner-emberfall-mythic')] },
  // ── Arena ──
  30: { free: [box('uncommon')], premium: [box('rare'), embers(500)] },
  35: { free: [embers(75)], premium: [gear('card-emberfall'), embers(250)] },
  40: { free: [box('rare')], premium: [box('epic'), gear('particle-void-smoke')] },
  45: { free: [box('rare')], premium: [gear('halo-emberfall'), embers(500)] },
  50: { free: [box('epic')], premium: [gear('halo-emberfall-mythic'), gear('sfx-emberfall-strike')] },
  // ── Pantheon ──
  55: { free: [box('epic')], premium: [box('legendary'), embers(750)] },
  60: { free: [box('rare')], premium: [gear('title-dialed-in')] },
  65: { free: [embers(125)], premium: [gear('audio-deep-space-sub-bass')] },
  70: { free: [box('epic')], premium: [gear('banner-ashfall'), embers(1_000)] },
  75: { free: [box('epic')], premium: [gear('card-emberfall-mythic')] },
  // ── Transcendent ──
  80: { free: [box('legendary')], premium: [box('mythic'), embers(1_500)] },
  85: { free: [box('epic')], premium: [gear('particle-falling-ash')] },
  90: { free: [embers(200)], premium: [gear('relic-emberfall')] },
  95: { free: [box('legendary')], premium: [box('mythic'), embers(2_000)] },
  // The Apex. Both lanes carry a completion title — finishing the free track without paying a cent
  // is its own achievement and gets its own name, not a dimmed version of the paid one.
  100: {
    free: [box('legendary'), gear('title-s1-the-relentless')],
    premium: [gear('medal-emberfall-crown'), gear('title-forged-in-ember')],
  },
};

/** The four Mythic milestones — the bigger violet anvil nodes on the track (code prompt §1). */
const MILESTONES: ReadonlySet<number> = new Set([25, 50, 75, 100]);

export const PASS_LEVELS: PassLevel[] = Array.from({ length: SEASON.totalLevels }, (_, i) => {
  const level = i + 1;
  const named = NAMED_LEVELS[level];
  const d = drip(level);
  return {
    level,
    // Every level rewards something on BOTH lanes — the off-level drip is what makes the free track
    // worth opening daily instead of only on the fives.
    free: named?.free ?? [embers(d.free)],
    premium: named?.premium ?? [embers(d.premium)],
    milestone: MILESTONES.has(level),
  };
});

/**
 * Past 100 the track keeps paying every 5 levels (FORGE_PASS_SEASON1 §"Post-100 prestige loop") —
 * it keeps heavy users engaged through Dec 23 without needing a single new piece of art.
 *
 * The Paid cache is 10% a legacy Legendary/Mythic and 90% 1,000 embers; the roll happens
 * SERVER-side like every other roll in this economy, so this is only the label.
 */
export const PRESTIGE_INTERVAL = 5;
export const PRESTIGE_FREE: PassReward = { kind: 'embers', amount: 100 };
export const PRESTIGE_PAID_LABEL = 'Prestige Cache';

/** Prestige levels are 105, 110, 115… — a level past the apex that pays out. */
export function isPrestigeLevel(level: number): boolean {
  return level > SEASON.totalLevels && (level - SEASON.totalLevels) % PRESTIGE_INTERVAL === 0;
}

/** Level 100 premium also carries the completionist badge alongside the Mythic capstone. */
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
  // Sunday, matching every other weekly timer in the app (punchlist 8 §5 / lib/time/week.ts).
  weekly: 'resets Sun',
  season: 'one-time',
};

// ───────────────────────────── Ember packs (real money · RevenueCat) ─────────────────────────────
//
// Consumables. Buying embers buys COSMETICS and nothing else — never XP, rank, streaks or standing,
// which is the same rule the Pass and every box already run on.
//
// ⚠️ REPRICED IN PHASE 4, and the shift is large enough to be a product decision rather than a
// tune. The old ladder ran 100–140 embers per dollar (500 @ $4.99 → 7,000 @ $49.99). These are the
// Phase-4 prompt's numbers and they run ~600–750 per dollar — roughly 5–6× more ember per dollar.
//
// The reason to accept that: it fixes an incoherence with the Pass. The Forge Pass costs $9.99 and
// carries ~13,350 embers of drip alongside every cosmetic on the premium track. Under the OLD
// ladder a $9.99 ember pack bought 1,200 embers, which made the Pass 11× better value and the packs
// look like a trap. At 6,500 the Pass is still the clearly better buy (~2× the embers, plus all the
// cosmetics) without the packs being insulting.
//
// Sanity-check against what embers actually buy — a Promethean vault is 8,000, a Hestia 1,200:
// $19.99 now buys ~1.9 Prometheans where it used to buy ~0.3. That IS a real loosening of shop
// scarcity, and it is the same open question flagged as Noah's #1. Reversible in this one array.
export type EmberPack = {
  key: string;
  embers: number;
  name: string;
  /** Display fallback only. The REAL price shown to the user comes from the store (localized). */
  price: string;
  best?: boolean;
  /** App Store / Play product id. Must match RevenueCat + App Store Connect exactly. */
  productId: string;
};

export const EMBER_PACKS: EmberPack[] = [
  { key: 'remnant', embers: 1_200, name: 'Remnant', price: '$1.99', productId: 'philoi.embers.1200' },
  { key: 'pile', embers: 3_000, name: 'Pile', price: '$4.99', productId: 'philoi.embers.3000' },
  { key: 'stack', embers: 6_500, name: 'Stack', price: '$9.99', best: true, productId: 'philoi.embers.6500' },
  { key: 'hoard', embers: 15_000, name: 'Hoard', price: '$19.99', productId: 'philoi.embers.15000' },
];

export const EMBER_PACK_BY_PRODUCT: Record<string, EmberPack> = Object.fromEntries(
  EMBER_PACKS.map((p) => [p.productId, p])
);
