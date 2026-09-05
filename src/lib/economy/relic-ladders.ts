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
  /**
   * The same discipline in one word, for the profile shelf's 54px tile caption (mock 107).
   *
   * Separate from `label` rather than derived from it: "Gym / Lift" wraps to three lines under a
   * tile and "Movement" must NOT shorten to "Run" — §4a-2 renamed that ladder away from running on
   * purpose ("total distance moved; walking counts, NOT just running"), and a caption that said Run
   * would tell every walker the ladder is not for them.
   */
  short: string;
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
    short: 'Gym',
    unit: 'lb',
    thresholds: [10_000, 25_000, 50_000, 100_000, 250_000],
    rarities: ['uncommon', 'rare', 'epic', 'legendary', 'mythic'],
  },
  {
    family: 'distance',
    relicKey: 'relic-pheidippides-sandals',
    label: 'Movement',
    short: 'Movement',
    unit: 'km',
    // 414 km is the Athens->Sparta round trip — the top rung is the lore, not a round number.
    thresholds: [50, 100, 250, 414],
    rarities: ['rare', 'epic', 'legendary', 'mythic'],
  },
  {
    family: 'study',
    relicKey: 'relic-socrates-scroll',
    label: 'Study',
    short: 'Study',
    unit: 'h',
    thresholds: [10, 25, 50, 100],
    rarities: ['uncommon', 'rare', 'epic', 'legendary'],
  },
  {
    family: 'deep_work',
    relicKey: 'relic-daedalus-blueprint',
    label: 'Deep work',
    short: 'Deep work',
    unit: 'h',
    thresholds: [10, 25, 50, 100],
    rarities: ['uncommon', 'rare', 'epic', 'legendary'],
  },
  {
    family: 'meditate',
    relicKey: 'relic-oracles-stillness',
    label: 'Meditate',
    short: 'Meditate',
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

// ─────────────────────────── THE PROFILE SHELF (§4a-2 · mock 107) ───────────────────────────

/** The Mythic set-completion capstone. Rides no ladder — its metric is the other five. */
export const OLYMPUS_RELIC_KEY = 'relic-crown-of-olympus';

/**
 * One tile on the Discipline Relics shelf: a ladder relic, or the Olympus capstone.
 *
 * WHY THIS IS DERIVED RATHER THAN READ. get_trophy_hall returns a ladder relic only once it has
 * been granted OR has `value > 0`, so a discipline nobody has touched is simply absent from the
 * array. The shelf's whole job is to show the FULL set — a locked Daedalus at 0% is the tile that
 * tells someone the discipline exists — so the five ladders are enumerated from RELIC_LADDERS and
 * the hall's rows are matched onto them, never the other way round.
 */
export type DisciplineStanding = {
  relicKey: string;
  /** The ladder this tile draws, or null for the capstone. */
  ladder: RelicLadder | null;
  /** The tile caption — a discipline for a ladder, 'Olympus' for the capstone. */
  short: string;
  /** Holds at least rung one (capstone: granted). Drives lit vs greyed. */
  earned: boolean;
  /** Rung held, 1-based; 0 while the first threshold is ahead. Always 0 or 1 for the capstone. */
  tier: number;
  maxTier: number;
  value: number;
  unit: string;
  /** The rung being chased, or null once the top rung is held. */
  nextThreshold: number | null;
  /**
   * 0…1 toward `nextThreshold`, measured from the rung already cleared — 1 at the top.
   *
   * Deliberately NOT measured against the ladder's TOP threshold: a bar against 250,000 lb sits
   * near zero for the whole first rung and reads as "nothing is happening" during the stretch that
   * needs the most encouragement. It is the same span RelicLadderRow draws in the Trophy Hall, so
   * the shelf's "78%" and the hall's bar can never disagree.
   */
  pct: number;
  /** The rung's rarity, or the first rung's while still unearned — never a rarity being claimed. */
  rarity: Rarity;
};

/**
 * The shelf, in ladder order, with the capstone last.
 *
 * `relics` is `TrophyHall.relics` — from get_trophy_hall(p_user), so this works unchanged on
 * someone else's profile. §4a-2 shows ladder thresholds to everyone (only the §4a ancient relics
 * stay secret), so a visitor seeing a stranger's locked tiles leaks nothing.
 */
export function disciplineStandings(
  relics: { key: string; tier: number | null; value: number | null; unit: string | null; next_threshold: number | null; in_progress: boolean }[]
): DisciplineStanding[] {
  const byKey = new Map(relics.map((r) => [r.key, r]));

  const rungs: DisciplineStanding[] = RELIC_LADDERS.map((ladder) => {
    const row = byKey.get(ladder.relicKey);
    const tier = row?.tier ?? 0;
    const value = row?.value ?? 0;
    const maxTier = ladder.thresholds.length;
    // `in_progress` is the earned line and it is exact: get_trophy_hall sets it false only for rows
    // that exist in cosmetics_owned. Deliberately not `tier >= 1`, which infers ownership from the
    // standing and would grey out an owned relic whose progress row went missing.
    const earned = row !== undefined && !row.in_progress;
    const nextThreshold = row ? row.next_threshold : ladder.thresholds[0];
    const floor = tier >= 1 ? ladder.thresholds[tier - 1] : 0;
    const span = nextThreshold === null ? 0 : nextThreshold - floor;

    return {
      relicKey: ladder.relicKey,
      ladder,
      short: ladder.short,
      earned,
      tier,
      maxTier,
      value,
      unit: row?.unit ?? ladder.unit,
      nextThreshold,
      pct: nextThreshold === null ? 1 : span <= 0 ? 0 : clamp01((value - floor) / span),
      rarity: ladderRarity(ladder.relicKey, tier) ?? ladder.rarities[0],
    };
  });

  // THE CAPSTONE'S METRIC IS THE OTHER FIVE. It has no relic_progress row of its own — the server
  // grants it by counting maxed ladders — so its progress is counted here from the same rungs the
  // rest of the shelf just drew, which is what keeps "4 / 5 maxed" and the tiles agreeing.
  const ladderCount = rungs.length;
  const maxed = rungs.filter((r) => r.tier >= r.maxTier).length;
  const held = byKey.has(OLYMPUS_RELIC_KEY);

  rungs.push({
    relicKey: OLYMPUS_RELIC_KEY,
    ladder: null,
    short: 'Olympus',
    earned: held,
    tier: held ? 1 : 0,
    maxTier: 1,
    value: maxed,
    unit: 'maxed',
    nextThreshold: held ? null : ladderCount,
    pct: held ? 1 : clamp01(maxed / Math.max(ladderCount, 1)),
    rarity: 'mythic',
  });

  return rungs;
}

/** "3 / 5" — earned disciplines over the ladder count. The capstone is shown, never counted. */
export function earnedDisciplineCount(standings: DisciplineStanding[]): { earned: number; total: number } {
  const ladders = standings.filter((s) => s.ladder !== null);
  return { earned: ladders.filter((s) => s.earned).length, total: ladders.length };
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

/**
 * The earn metric for an owned ladder relic, from its rarity alone — "Deep work · rung δ, 100 h".
 *
 * FOR THE COLLECTION, which has no relic_progress in hand. The rung's rarity is what
 * cosmetics_owned.rarity_override stores, and within a single ladder every rung has a DISTINCT
 * rarity (§4a-2's "Ceilings, by design" is what guarantees it: Gym runs uncommon→mythic over five
 * rungs, Movement rare→mythic over four, Hours uncommon→legendary over four). So the rarity the
 * closet already shows identifies the rung exactly, and the threshold it cost can be stated with no
 * second round trip.
 *
 * It says what was ACHIEVED, not what is next — the closet is a record of what someone holds, and
 * the live chase belongs on the Trophy Hall's bar and the profile shelf. Returns null for a relic
 * that rides no ladder (a medal, a secret §4a relic, the capstone), whose lore is the whole story.
 */
export function ladderEarnMetric(relicKey: string, rarity: Rarity): string | null {
  const ladder = BY_KEY.get(relicKey);
  if (!ladder) return null;

  const rung = ladder.rarities.indexOf(rarity) + 1;
  // A rarity this ladder does not use — an override written by a future retune, or a catalog edit
  // that outran this file. Naming the discipline is still true; inventing a threshold would not be.
  if (rung < 1) return ladder.label;

  const glyph = rungGlyph(rung) ?? '';
  return `${ladder.label} · rung ${glyph} — ${formatLadderValue(ladder.thresholds[rung - 1], ladder.unit)} ${ladder.unit}`;
}
