// Drop-odds DISPLAY math — the Google Play loot-box disclosure (and the Belgium/NL bans, and the
// student/minor audience) all turn on one property: the number on screen is the number the roll
// uses. So nothing in this file invents a probability. It takes the weights it is handed —
// ideally the live `economy_config.box_odds` row that `economy_roll_rarity` itself reads
// (migration 0064) — and only decides how to PRINT them.
//
// Two things it has to get right that a bare `.toFixed(1)` gets wrong:
//
//   1. THE COLUMN MUST SUM TO 100%. A disclosure that adds up to 99.9% invites exactly the
//      "so where's the other 0.1%?" reading the requirement exists to prevent.
//   2. A RARE TIER MUST NOT BE ROUNDED INTO A LIE. Furnace prints Mythic at 0.1%; at whole-number
//      precision that is "0%", which reads as "cannot drop", and rounding it up to "1%" overstates
//      it tenfold. Both directions are the misleading-odds failure, so precision is chosen per
//      box from the weights rather than fixed.

import { RARITIES, type Rarity } from '@/lib/economy/rarity';

/** A box's rarity -> weight map, exactly as `economy_config.box_odds -> <box_key>` stores it. */
export type BoxWeights = Partial<Record<Rarity, number>>;

export type OddsRow = {
  rarity: Rarity;
  /** The exact percentage — use this for bar widths, never for the printed string. */
  pct: number;
  /** What to print, already rounded so the column sums to 100. Excludes the '%'. */
  label: string;
};

const MAX_DECIMALS = 2;
// Weights are floats out of jsonb; 0.1 + 0.2 arithmetic means an exact compare needs slack.
const EPSILON = 1e-9;

/**
 * Rows for one box, in rarity order, non-zero tiers only.
 *
 * Weights are normalised rather than assumed to be percentages: today every box_odds entry sums to
 * 100, but a future retune that expresses the same pool as 800/175/24/1 must still disclose the
 * same probabilities rather than print raw weights with a '%' on them.
 */
export function oddsTable(weights: BoxWeights): OddsRow[] {
  const present = RARITIES.map((rarity) => ({ rarity, weight: weights[rarity] ?? 0 })).filter(
    (r) => Number.isFinite(r.weight) && r.weight > 0
  );
  const total = present.reduce((sum, r) => sum + r.weight, 0);
  if (present.length === 0 || total <= 0) return [];

  const exact = present.map((r) => ({ rarity: r.rarity, pct: (r.weight / total) * 100 }));

  // Prefer a precision that prints the weights EXACTLY. When one exists there is no rounding at
  // all, so the column sums to 100 on its own and no remainder has to be pushed around.
  for (let d = 0; d <= MAX_DECIMALS; d += 1) {
    if (exact.every((r) => Math.abs(Number(r.pct.toFixed(d)) - r.pct) < EPSILON)) {
      return exact.map((r) => ({ ...r, label: trimZeros(r.pct.toFixed(d)) }));
    }
  }

  return largestRemainder(exact);
}

/**
 * Nothing prints exactly at 2dp, so round to hundredths and hand the leftover hundredths to the
 * rows that lost the most in rounding (largest remainder). That keeps the total at exactly 100.00
 * while moving each row by at most 0.01.
 */
function largestRemainder(exact: { rarity: Rarity; pct: number }[]): OddsRow[] {
  const SCALE = 10 ** MAX_DECIMALS;
  const TARGET = 100 * SCALE;

  const parts = exact.map((r) => {
    const scaled = r.pct * SCALE;
    return { ...r, units: Math.floor(scaled), remainder: scaled - Math.floor(scaled) };
  });

  // A tier that CAN drop must never print as 0.00% — that reads as "impossible", which is the one
  // rounding error that changes what the disclosure means. Give it the smallest printable share
  // and let the ranking below settle the rest.
  for (const p of parts) if (p.units === 0) p.units = 1;

  let leftover = TARGET - parts.reduce((sum, p) => sum + p.units, 0);
  const byRemainder = [...parts].sort((a, b) => b.remainder - a.remainder);
  for (let i = 0; leftover > 0 && byRemainder.length > 0; i += 1) {
    byRemainder[i % byRemainder.length].units += 1;
    leftover -= 1;
  }
  // Over-allocated (the floor-to-1 bumps above, or float slop): claw back off the biggest rows,
  // which are the only ones that can lose a hundredth without approaching zero.
  const byUnits = [...parts].sort((a, b) => b.units - a.units);
  for (let i = 0; leftover < 0 && byUnits.length > 0; i += 1) {
    const p = byUnits[i % byUnits.length];
    if (p.units > 1) {
      p.units -= 1;
      leftover += 1;
    }
  }

  return parts.map((p) => ({
    rarity: p.rarity,
    pct: p.pct,
    label: trimZeros((p.units / SCALE).toFixed(MAX_DECIMALS)),
  }));
}

/** '80.0' -> '80', '17.50' -> '17.5', '0.10' -> '0.1'. Whole numbers where clean. */
function trimZeros(s: string): string {
  return s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '') : s;
}

/** True when two weight maps describe the same roll — the drift check in use-box-odds. */
export function sameWeights(a: BoxWeights, b: BoxWeights): boolean {
  return RARITIES.every((r) => Math.abs((a[r] ?? 0) - (b[r] ?? 0)) < EPSILON);
}
