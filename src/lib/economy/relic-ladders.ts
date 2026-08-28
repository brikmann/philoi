// The discipline-relic ladders (ITEM_CATALOG §4a-2), for rendering.
//
// THE SERVER IS THE AUTHORITY. `relic_ladders` in migration 0119 decides what is granted and at
// what rarity; this file exists so a tile can draw its rung letter and "43 / 50 km" without a
// round trip, and so the labels live somewhere a designer can find them. get_my_relic_progress()
// returns the thresholds and rarities too — prefer those when you have them, and treat what is
// here as the offline/initial-render copy. If the two ever disagree, the server is right.
//
// Keep in step with the `relic_ladders` insert in 0119.

import type { Rarity } from '@/lib/economy/rarity';

/** The four families a relic can ride. Matches `relic_ladders.family` exactly. */
export type RelicFamily = 'volume' | 'distance' | 'study' | 'deep_work' | 'meditate';

/**
 * §4a-2's rung glyph: α I · β II · γ III · δ IV · Ω V.
 *
 * Colour and letter are INDEPENDENT signals — rarity is the tile's glow, the letter is which rung.
 * A maxed movement relic reads red + δ (its fourth rung is Mythic) and a maxed hours relic orange
 * + δ, which is only legible if the letter is never derived from the rarity.
 */
export const RUNG_GLYPH = ['α', 'β', 'γ', 'δ', 'Ω'] as const;

export type RelicLadder = {
  family: RelicFamily;
  relicKey: string;
  /** Discipline label for the tap sheet ("Gym / Lift"). */
  label: string;
  /** Suffix rendered after a threshold — 'lb', 'km', 'h'. */
  unit: string;
  thresholds: number[];
  rarities: Rarity[];
};

export const RELIC_LADDERS: RelicLadder[] = [
  {
    family: 'volume',
    relicKey: 'relic-hercules-might',
    label: 'Gym / Lift',
    unit: 'lb',
    thresholds: [10_000, 25_000, 50_000, 100_000, 250_000],
    rarities: ['uncommon', 'rare', 'epic', 'legendary', 'mythic'],
  },
  {
    family: 'distance',
    relicKey: 'relic-pheidippides-sandals',
    label: 'Movement',
    unit: 'km',
    // 414 km is the Athens->Sparta round trip — the top rung is the lore, not a round number.
    thresholds: [50, 100, 250, 414],
    rarities: ['rare', 'epic', 'legendary', 'mythic'],
  },
  {
    family: 'study',
    relicKey: 'relic-socrates-scroll',
    label: 'Study',
    unit: 'h',
    thresholds: [10, 25, 50, 100],
    rarities: ['uncommon', 'rare', 'epic', 'legendary'],
  },
  {
    family: 'deep_work',
    relicKey: 'relic-daedalus-blueprint',
    label: 'Deep work',
    unit: 'h',
    thresholds: [10, 25, 50, 100],
    rarities: ['uncommon', 'rare', 'epic', 'legendary'],
  },
  {
    family: 'meditate',
    relicKey: 'relic-oracles-stillness',
    label: 'Meditate',
    unit: 'h',
    thresholds: [10, 25, 50, 100],
    rarities: ['uncommon', 'rare', 'epic', 'legendary'],
  },
];

const BY_KEY = new Map(RELIC_LADDERS.map((l) => [l.relicKey, l]));

export function ladderForRelic(relicKey: string): RelicLadder | undefined {
  return BY_KEY.get(relicKey);
}

/** True for a relic that carries a rung, so a tile knows whether to draw a Greek glyph at all. */
export function isLadderRelic(relicKey: string): boolean {
  return BY_KEY.has(relicKey);
}

/**
 * The rarity a ladder relic is CURRENTLY worth — its rung's, not the catalog's.
 *
 * The catalog entry carries the FIRST rung's rarity (it is what the relic is worth when granted),
 * and the server raises `cosmetics_owned.rarity_override` on every rung after that. Anywhere the
 * override is not in hand — `featuredTrophies` in milestone-badges.ts ranks by `getItem().rarity`,
 * and get_trophy_hall does not return the override — this is how to resolve the real one from the
 * tier that get_my_relic_progress() reports.
 *
 * Returns null for a relic with no ladder, so the caller falls back to the catalog rarity.
 */
export function ladderRarity(relicKey: string, tier: number): Rarity | null {
  const ladder = BY_KEY.get(relicKey);
  if (!ladder || tier < 1) return null;
  return ladder.rarities[Math.min(tier, ladder.rarities.length) - 1];
}

/** `α`…`Ω` for a 1-based rung, or null at rung 0 (not yet earned). */
export function rungGlyph(tier: number): string | null {
  if (tier < 1 || tier > RUNG_GLYPH.length) return null;
  return RUNG_GLYPH[tier - 1];
}

/**
 * "43 / 50 km" — what §4a-2 asks the tap sheet to show.
 *
 * Hours and km read to one decimal because a whole-number floor makes an hour of study look like
 * nothing happened; pounds are whole, since 12,480.4 lb is noise.
 */
export function formatLadderValue(value: number, unit: string): string {
  if (unit === 'lb') return Math.floor(value).toLocaleString();
  return (Math.round(value * 10) / 10).toLocaleString();
}
