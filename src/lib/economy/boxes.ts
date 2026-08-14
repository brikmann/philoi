// The six loot boxes (21g / REWARD_ECONOMY §8.2 + §8.5).
//
// Odds here are PUBLISHED — they render verbatim on the box-detail screen (mock 57). That is not a
// nicety: the audience skews students and minors, Belgium/NL ban paid loot boxes outright, and
// both app stores require disclosed drop rates.
//
// Those odds are also AUTHORITATIVE: economy_roll_rarity does a straight weighted roll over them
// with no clamping, so the printed number is the real per-open probability. §8.2's per-box "floor"
// is implemented as PITY instead (see `Pity` below) — a floor that clamped the roll would have
// turned Hestia's printed 22% Epic into ~92% and made the published table a lie.
//
// The server rolls the result BEFORE any animation plays — §8.5 is explicit that the animation
// only visualizes a decided outcome. These numbers exist so the odds table can render without a
// round-trip; economy_config in migration 0064 is what the roll actually reads.

import type { Rarity } from '@/lib/economy/rarity';

export const BOX_KEYS = ['kindling', 'ignition', 'furnace', 'hestia', 'hephaestus', 'promethean'] as const;
export type BoxKey = (typeof BOX_KEYS)[number];

/** Per-tier CRACK style (§8.5 stage 1) — the box-open animation switches on this. */
export type CrackStyle = 'chop' | 'fuse' | 'grate' | 'oil' | 'unlock' | 'spin';

/**
 * The bad-luck backstop. NOT a floor on the roll — the published odds are authoritative and every
 * open matches them exactly. This only says: go `every` opens without hitting `rarity` or better,
 * and the next one is forced to it. Mirrors economy_config('box_pity') in migration 0064.
 *
 * Targets are picked to be MEANINGFUL. Where §8.2's floor is the box's most likely outcome
 * (Kindling floor:Common at 80%, Ignition floor:Uncommon at 40%, Promethean floor:Legendary at
 * 48%), promising it would promise something you already get nearly every open, so those step up
 * to the next genuinely scarce tier.
 */
export type Pity = { rarity: Rarity; every: number };

export type LootBox = {
  key: BoxKey;
  name: string;
  rarity: Rarity;
  price: number;
  /** The free path — every box is earnable, never purchase-only (21g). */
  earnedBy: string;
  /** Published per-rarity drop rates, in percent. Must sum to 100, and every roll matches them. */
  odds: Record<Rarity, number>;
  pity: Pity;
  crack: CrackStyle;
  /** One-line description of the crack, used as the box-detail flavour. */
  crackCopy: string;
};

export const BOXES: Record<BoxKey, LootBox> = {
  kindling: {
    key: 'kindling',
    name: 'Kindling',
    rarity: 'common',
    price: 80,
    earnedBy: 'Daily login streak · one focus block',
    odds: { common: 80, uncommon: 17.5, rare: 2.4, epic: 0.1, legendary: 0, mythic: 0 },
    pity: { rarity: 'rare', every: 10 },
    crack: 'chop',
    crackCopy: 'A flat chop straight down the middle, splitting the logs in half.',
  },
  ignition: {
    key: 'ignition',
    name: 'Ignition Crate',
    rarity: 'uncommon',
    price: 200,
    earnedBy: 'A weekly habit · win a 1v1 duel',
    odds: { common: 45, uncommon: 40, rare: 12, epic: 2.8, legendary: 0.2, mythic: 0 },
    pity: { rarity: 'rare', every: 10 },
    crack: 'fuse',
    crackCopy: 'The fuse ignites — a spark races down it, then the crate blows.',
  },
  furnace: {
    key: 'furnace',
    name: 'The Furnace',
    rarity: 'rare',
    price: 500,
    earnedBy: 'Forge Pass tier 15+ · top 25% of a campfire challenge',
    odds: { common: 15, uncommon: 45, rare: 30, epic: 8.5, legendary: 1.4, mythic: 0.1 },
    pity: { rarity: 'epic', every: 10 },
    crack: 'grate',
    crackCopy: 'The grates blow out; molten light erupts through both faces.',
  },
  hestia: {
    key: 'hestia',
    name: 'Vessel of Hestia',
    rarity: 'epic',
    price: 1200,
    earnedBy: 'Gold rank · top 10% of a challenge · a Forge Pass milestone',
    odds: { common: 0, uncommon: 20, rare: 50, epic: 22, legendary: 7.2, mythic: 0.8 },
    pity: { rarity: 'epic', every: 10 },
    crack: 'oil',
    crackCopy: 'Unholy oil pours in and lights the purple flame far bigger than it already burns.',
  },
  hephaestus: {
    key: 'hephaestus',
    name: "Hephaestus' Chest",
    rarity: 'legendary',
    price: 3000,
    earnedBy: 'Diamond rank · 1st in a full campfire · an end-of-season milestone',
    odds: { common: 0, uncommon: 0, rare: 35, epic: 45, legendary: 17.5, mythic: 2.5 },
    pity: { rarity: 'legendary', every: 8 },
    crack: 'unlock',
    crackCopy: 'The lock turns and the lid unlocks.',
  },
  promethean: {
    key: 'promethean',
    name: 'Promethean Vault',
    rarity: 'mythic',
    price: 8000,
    earnedBy: 'Infernal rank · semester Champion · top 1% provincial',
    odds: { common: 0, uncommon: 0, rare: 0, epic: 40, legendary: 48, mythic: 12 },
    pity: { rarity: 'mythic', every: 3 },
    crack: 'spin',
    crackCopy: 'It spins itself up to a blur, then flies open.',
  },
};

export const BOX_LIST: LootBox[] = BOX_KEYS.map((k) => BOXES[k]);

/**
 * The batch sizes a multi-open offers. ×5 sits between the two originals (punchlist 9 §2) because
 * ×1 and ×10 alone force a 10x jump — on a Promethean that's 800 vs 80,000 embers with nothing in
 * between, and the pity counters (`every: 3` there, 8–10 elsewhere) make a mid-size batch the one
 * that actually lands a guarantee.
 *
 * Shared with the Inventory's unopened stacks, which offer the same sizes capped at what's in the
 * stack — so "Open 5" means the same thing in both places.
 */
export const OPEN_COUNTS = [1, 5, 10] as const;
export type OpenCount = (typeof OPEN_COUNTS)[number];

/**
 * Plain-language pity copy. 21g explicitly bans the words "soft pity" and "hard pity" from the UI —
 * a student audience should be told what they actually get, not gambling jargon. Rendered as its
 * own block, clearly separate from the odds table, so neither reads as qualifying the other.
 */
export function pityLine(box: LootBox): string {
  const name = box.pity.rarity.charAt(0).toUpperCase() + box.pity.rarity.slice(1);
  return `A guaranteed ${name} or better at least once every ${box.pity.every} boxes.`;
}

/** The companion line: says plainly that the odds above are the real per-open numbers. */
export function oddsAreRealLine(box: LootBox): string {
  return `Every ${box.name} rolls on exactly the odds above — nothing is adjusted up or down for you.`;
}

/** Rarities with a non-zero chance — the odds table only lists what can actually drop. */
export function oddsRows(box: LootBox): { rarity: Rarity; pct: number }[] {
  return (Object.entries(box.odds) as [Rarity, number][])
    .filter(([, pct]) => pct > 0)
    .map(([rarity, pct]) => ({ rarity, pct }));
}
