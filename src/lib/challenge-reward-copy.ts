// Challenge / season reward-screen copy (CHALLENGE_REWARD_COPY.md is the source of truth for the
// exact strings; mocks 47 + 48 are the screens).
//
// Deliberately a ROTATING POOL, unlike rank-up-copy.ts's ten fixed lines. The two are solving
// opposite problems: a tier crossing happens a handful of times ever, so it gets one authored line
// each. A challenge resolves constantly — every duel, every campfire close, every season — so a
// fixed line per placement would be the same sentence forever, which reads as a template. The
// pools are what keep a regular from seeing the same headline twice in a row.
//
// `{name}` is interpolated; the lines already end in ", {name}." so nothing is appended.

/** Placement buckets, most-selective first — the order selection actually walks. */
export type PlacementTier =
  | 'rank1'
  | 'rank2'
  | 'rank3'
  | 'top1'
  | 'top5'
  | 'top10'
  | 'top25'
  | 'top50'
  | 'below50';

/**
 * Which pool set to draw from. A 1v1 loss must never read as mockery, which is the whole reason
 * this axis exists: the `below50` "Fraud Watch" pool is fine on a 200-person season board and
 * cruel to someone who lost a duel to their friend by four minutes.
 */
export type RewardContext = 'duel' | 'board';

type Pools = Partial<Record<PlacementTier, string[]>>;

// ── 1v1 duel / small group ──
const DUEL_POOLS: Pools = {
  rank1: [
    'Total dominance, {name}.',
    'Left them in the ash, {name}.',
    'Claimed the crown, {name}.',
    'No contest, {name}.',
  ],
  // The loser of a duel lands here BY DESIGN — never in below50. Close-loss / rematch tone.
  rank2: ['Narrow margin, {name}.', 'Pushed to the limit, {name}.', 'Razor thin, {name}.'],
  rank3: ['Locked on the board, {name}.', 'In the fight till the end, {name}.'],
};

// ── whole campfire / university / season ──
const BOARD_POOLS: Pools = {
  rank1: [
    'The arena belongs to you, {name}.',
    'Campfire King, {name}.',
    'Top of the food chain, {name}.',
    'You ran this semester, {name}.',
    'Undisputed, {name}.',
    'The whole tribe bows to the blaze, {name}.',
    'Set the curve. Broke the scale, {name}.',
    'History remembers this, {name}.',
    'You conquered them all, {name}.',
    'The throne is yours alone, {name}.',
    'Nobody even came close, {name}.',
  ],
  rank2: [
    'One step from the throne, {name}.',
    'Silver-forged performance, {name}.',
    'Chasing the apex, {name}.',
    'Stole the spotlight, {name}.',
    'Striking distance, {name}.',
    'Heavy metal finish, {name}.',
  ],
  rank3: [
    'Podium locked, {name}.',
    'Top tier energy, {name}.',
    'Standing with the elite, {name}.',
    'Heat rising, {name}.',
    'Earned your place, {name}.',
  ],
  top1: [
    'Immortal, {name}.',
    'Etched into the marble, {name}.',
    'One in a hundred, {name}.',
    'Walking with the gods, {name}.',
    'Legend of the season, {name}.',
    'The peak has your name on it, {name}.',
    'Untouchable, {name}.',
  ],
  top5: [
    'Titan tier, {name}.',
    'Top 5% of the whole board, {name}.',
    'Ascendant, {name}.',
    'Breathing rare air, {name}.',
    'Elite of the elite, {name}.',
    'Carving your name in, {name}.',
  ],
  top10: [
    'Vanguard status, {name}.',
    'Top 10% on campus, {name}.',
    'Pacesetter for the tribe, {name}.',
    'Dragging the average up, {name}.',
    'Pure high-frequency execution, {name}.',
    "They're watching your shadow, {name}.",
  ],
  top25: [
    'Solid ground, {name}.',
    'In the upper echelon, {name}.',
    'Fanning the flame, {name}.',
    'Main character momentum, {name}.',
    'In striking range for next season, {name}.',
    'Overperforming the pack, {name}.',
  ],
  top50: [
    'Holding the line, {name}.',
    'In the arena, {name}.',
    'Fueling the fire, {name}.',
    'Alive in the fight, {name}.',
    'Baseline established, {name}.',
    'Time to turn up the heat, {name}.',
  ],
  // "Motivational, not cruel — the fire's not out, get back in." Never reachable from a duel.
  below50: [
    'On Fraud Watch, {name}.',
    'Stoke the embers, {name}.',
    'Cold execution, {name}.',
    "Don't let the fire die out, {name}.",
    'Your Campfire needs you locked in, {name}.',
    'Next season starts right now, {name}.',
  ],
};

/**
 * Placement -> tier, walking most-selective first.
 *
 * `absoluteRank` wins over the percentile when it is a literal podium: being THE champion of a
 * 400-person board outranks being *among* the top 1%, in both the copy's grandeur and the screen's
 * intensity, so #1/#2/#3 override before the percentile is even considered.
 */
export function placementTier(input: {
  absoluteRank: number | null;
  /** 0 = top of the board, 1 = bottom. Null for a duel, which has no percentile. */
  percentile: number | null;
  boardSize: number;
}): PlacementTier {
  const { absoluteRank, percentile, boardSize } = input;

  if (absoluteRank === 1) return 'rank1';
  if (absoluteRank === 2) return 'rank2';
  if (absoluteRank === 3) return 'rank3';

  // A small group (<= 8) has no meaningful percentile — 4th of 6 is not "top 50%", it is 4th — so
  // anyone off the podium there falls to the mid pools rather than being handed a percentile that
  // implies a bigger field than they actually beat.
  if (boardSize <= 8 || percentile === null) return 'top50';

  if (percentile <= 0.01) return 'top1';
  if (percentile <= 0.05) return 'top5';
  if (percentile <= 0.1) return 'top10';
  if (percentile <= 0.25) return 'top25';
  if (percentile <= 0.5) return 'top50';
  return 'below50';
}

/**
 * One headline for this outcome.
 *
 * `previous` is the last line this user was shown, so the picker can avoid an immediate repeat —
 * the spec asks for it explicitly, and with pools this small a naive random repeats often enough
 * to notice. Falls back to the raw pick when the pool has only one entry.
 */
export function challengeHeadline(
  tier: PlacementTier,
  context: RewardContext,
  name: string,
  previous?: string | null
): string {
  const pools = context === 'duel' ? DUEL_POOLS : BOARD_POOLS;
  // A duel only defines the three podium pools; anything else (a 4-person group's 4th place)
  // borrows the board set, which is still never the cruel one because placementTier() cannot
  // return below50 for a small field.
  const pool = pools[tier] ?? BOARD_POOLS[tier] ?? BOARD_POOLS.top50!;

  const candidates = pool.length > 1 && previous ? pool.filter((line) => fill(line, name) !== previous) : pool;
  const from = candidates.length > 0 ? candidates : pool;
  return fill(from[Math.floor(Math.random() * from.length)], name);
}

function fill(line: string, name: string): string {
  return line.replace('{name}', name);
}

/**
 * The screen's energy for a tier (the spec's "intensity ladder").
 *
 * Returned as data rather than baked into the component so the reward screen, the share card and
 * any future settlement screen all escalate identically. `level` 0-7 climbs with the finish;
 * the podium deliberately sits ABOVE top1, per the ladder table.
 */
export const TIER_INTENSITY: Record<PlacementTier, { level: number; label: string; accent: string }> = {
  rank1: { level: 7, label: 'CHAMPION', accent: '#F2A33C' },
  rank2: { level: 6, label: 'PODIUM', accent: '#C4CBD6' },
  rank3: { level: 6, label: 'PODIUM', accent: '#CD7F32' },
  top1: { level: 5, label: 'IMMORTAL', accent: '#A06CD5' },
  top5: { level: 4, label: 'TITAN', accent: '#4FB0E5' },
  top10: { level: 3, label: 'VANGUARD', accent: '#F2A33C' },
  top25: { level: 2, label: 'CONTENDER', accent: '#F2A33C' },
  top50: { level: 1, label: 'IN THE MIX', accent: '#A99CBD' },
  below50: { level: 0, label: 'NEEDS IGNITION', accent: '#8F84A6' },
};

/** The placement line under the headline — "🥇 1st · You beat Dee · Most lock-in time". */
export const TIER_MEDAL: Record<PlacementTier, string> = {
  rank1: '🥇 1st',
  rank2: '🥈 2nd',
  rank3: '🥉 3rd',
  top1: 'TOP 1%',
  top5: 'TOP 5%',
  top10: 'TOP 10%',
  top25: 'TOP 25%',
  top50: 'TOP 50%',
  below50: 'BOTTOM 50%',
};
