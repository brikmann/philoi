#!/usr/bin/env node
/**
 * Division guard: the roman numeral the app PRINTS must agree with the XP the ladder CHARGES.
 *
 * WS9 flipped the numerals so III is the top of each tier — you climb I → II → III, because "3 is
 * the best one" is what people already recognise. It flipped them at the display layer only:
 * `rank_thresholds` still stores division 3 for the CHEAPEST rung in a tier and 1 for the dearest,
 * because rank_tier_for_score, rankOrdinal, nextRank and every last-seen-rank baseline already
 * written to a device all depend on that direction. One map in src/lib/rank-tiers.ts inverts it.
 *
 * That makes the two halves independently editable, which is the whole risk. Re-cut the thresholds
 * (the ladder has been rebalanced twice already) or "fix" the numeral map back to its old order, and
 * nothing breaks loudly — the app just tells everyone they are Gold I when they are one rung from
 * Platinum. A silent off-by-a-tier on the number the entire product is a ladder toward.
 *
 * So this asserts the thing that has to stay true no matter which half moves:
 *
 *   1. The numerals are a bijection over {1,2,3} — no rung unnamed, no numeral used twice.
 *   2. Within every tier, the rung with the MOST cumulative XP required is displayed "III" and the
 *      one with the least is displayed "I". This is the flip itself, stated as an invariant.
 *   3. `divisionMarks` (the badge's chevron count) equals the numeral's own value, so a badge can
 *      never show two chevrons under a "III".
 *   4. Cumulative XP rises monotonically with `rankOrdinal`. This is what makes rank-up DETECTION
 *      correct: the watcher fires when the ordinal increases, so if a higher ordinal could ever be
 *      reachable at less XP, a promotion would land as a demotion or not fire at all. Relabelling
 *      does not touch it — and this check is how we know that stays true.
 *
 * Parses everything as TEXT (no bundler, no ts-node, no dependencies), matching the other
 * check:* scripts. Reads the LATEST authority for the thresholds: schema.sql, unless a
 * higher-numbered migration re-inserts them, which is how a rebalance ships.
 *
 * Run: npm run check:rank-divisions  (also runs as part of `npm run typecheck`)
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const RANK_TIERS = path.join(ROOT, 'src', 'lib', 'rank-tiers.ts');
const SCHEMA = path.join(ROOT, 'supabase', 'schema.sql');
const MIGRATIONS = path.join(ROOT, 'supabase', 'migrations');

const problems = [];
const fail = (msg) => problems.push(msg);

// ─────────────────────────── the numerals, from rank-tiers.ts ───────────────────────────

const tiersSrc = fs.readFileSync(RANK_TIERS, 'utf8');

const numeralMatch = tiersSrc.match(/DIVISION_NUMERAL[^=]*=\s*\{([^}]*)\}/);
if (!numeralMatch) {
  console.error('check-rank-divisions: could not find DIVISION_NUMERAL in src/lib/rank-tiers.ts');
  process.exit(1);
}
/** stored division -> displayed numeral, e.g. { 3: 'I', 2: 'II', 1: 'III' }. */
const NUMERAL = {};
for (const [, division, numeral] of numeralMatch[1].matchAll(/(\d+)\s*:\s*'([IVX]+)'/g)) {
  NUMERAL[Number(division)] = numeral;
}

/** Roman numeral -> its value. Only I/II/III are ever a division. */
const VALUE = { I: 1, II: 2, III: 3 };

// 1 · a bijection over the three rungs
const stored = Object.keys(NUMERAL).map(Number).sort();
if (stored.join(',') !== '1,2,3') {
  fail(`DIVISION_NUMERAL must map exactly the stored divisions 1, 2 and 3 — got [${stored.join(', ')}]`);
}
const printed = Object.values(NUMERAL);
if (new Set(printed).size !== printed.length) {
  fail(`DIVISION_NUMERAL reuses a numeral: ${printed.join(', ')}`);
}
for (const n of printed) {
  if (!(n in VALUE)) fail(`DIVISION_NUMERAL contains "${n}", which is not one of I, II, III`);
}

// 3 · the badge's chevron count is the numeral's value
const marksMatch = tiersSrc.match(/function divisionMarks\(division: number\): number \{\s*return ([^;]+);/);
if (!marksMatch) {
  fail('could not find divisionMarks() in src/lib/rank-tiers.ts — the badge derives its chevrons from it');
} else {
  // Evaluated from source rather than reimplemented here, so the check cannot drift from the
  // function it is checking. The body is one arithmetic expression out of our own repo.
  const divisionMarks = new Function('division', `return ${marksMatch[1]};`);
  for (const d of stored) {
    const want = VALUE[NUMERAL[d]];
    const got = divisionMarks(d);
    if (got !== want) {
      fail(`divisionMarks(${d}) = ${got}, but stored division ${d} displays as "${NUMERAL[d]}" (${want} chevrons)`);
    }
  }
}

// ─────────────────────────── the thresholds, from whichever file owns them ───────────────────────────

/** Every `(rank_index, tier, division, cumulative_xp_required)` tuple in a rank_thresholds insert. */
function parseThresholds(sql) {
  const insert = sql.lastIndexOf('insert into rank_thresholds');
  if (insert === -1) return null;
  const body = sql.slice(insert);
  const end = body.indexOf('on conflict');
  const rows = [];
  for (const [, index, tier, division, xp] of (end === -1 ? body : body.slice(0, end)).matchAll(
    /\(\s*(\d+)\s*,\s*'(\w+)'\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/g
  )) {
    rows.push({ index: Number(index), tier, division: Number(division), xp: Number(xp) });
  }
  return rows.length ? rows : null;
}

let source = 'supabase/schema.sql';
let rows = parseThresholds(fs.readFileSync(SCHEMA, 'utf8'));

// A rebalance ships as a migration that re-inserts the table; the highest-numbered one wins, which
// is the same order the CLI applies them in.
for (const file of fs.readdirSync(MIGRATIONS).sort()) {
  if (!file.endsWith('.sql')) continue;
  const parsed = parseThresholds(fs.readFileSync(path.join(MIGRATIONS, file), 'utf8'));
  if (parsed) {
    rows = parsed;
    source = `supabase/migrations/${file}`;
  }
}

if (!rows) {
  console.error('check-rank-divisions: found no `insert into rank_thresholds` in schema.sql or the migrations');
  process.exit(1);
}

// 2 · within each tier, the dearest rung is "III" and the cheapest is "I"
const byTier = new Map();
for (const row of rows) {
  if (!byTier.has(row.tier)) byTier.set(row.tier, []);
  byTier.get(row.tier).push(row);
}

for (const [tier, tierRows] of byTier) {
  // The apex is singular — one row, whose stored division exists only so the ordinal sorts above
  // the tier below it. Nothing displays a numeral for it (formatRankTier returns the bare name).
  if (tierRows.length === 1) continue;
  const sorted = [...tierRows].sort((a, b) => a.xp - b.xp);
  const cheapest = NUMERAL[sorted[0].division];
  const dearest = NUMERAL[sorted[sorted.length - 1].division];
  if (cheapest !== 'I') {
    fail(
      `${tier}: the cheapest rung (${sorted[0].xp.toLocaleString()} XP, stored division ${sorted[0].division}) ` +
        `displays as "${cheapest}" — the bottom of a tier must read "I"`
    );
  }
  if (dearest !== 'III') {
    fail(
      `${tier}: the dearest rung (${sorted[sorted.length - 1].xp.toLocaleString()} XP, stored division ` +
        `${sorted[sorted.length - 1].division}) displays as "${dearest}" — the top of a tier must read "III"`
    );
  }
}

// 4 · rank-up detection: XP must rise with the ordinal, or a promotion isn't one
const order = (tiersSrc.match(/RANK_TIER_ORDER: RankTierName\[\] = \[([^\]]*)\]/) || [])[1];
if (!order) {
  fail('could not find RANK_TIER_ORDER in src/lib/rank-tiers.ts');
} else {
  const TIER_ORDER = [...order.matchAll(/'(\w+)'/g)].map((m) => m[1]);
  const rankOrdinal = (tier, division) => TIER_ORDER.indexOf(tier) * 3 + (3 - division);
  const byOrdinal = [...rows].sort((a, b) => rankOrdinal(a.tier, a.division) - rankOrdinal(b.tier, b.division));
  for (let i = 1; i < byOrdinal.length; i++) {
    const lo = byOrdinal[i - 1];
    const hi = byOrdinal[i];
    if (hi.xp <= lo.xp) {
      fail(
        `rank-up boundary: ${hi.tier} ${NUMERAL[hi.division] ?? hi.division} (${hi.xp.toLocaleString()} XP) ranks ` +
          `above ${lo.tier} ${NUMERAL[lo.division] ?? lo.division} (${lo.xp.toLocaleString()} XP) but costs no more — ` +
          `the watcher would read reaching it as a demotion or not fire at all`
      );
    }
  }
  // Every tier in the ladder needs thresholds, or a user can never be in it.
  for (const tier of TIER_ORDER) {
    if (!byTier.has(tier)) fail(`${tier} is in RANK_TIER_ORDER but has no rank_thresholds rows in ${source}`);
  }
}

if (problems.length) {
  console.error(`check-rank-divisions FAILED (thresholds from ${source}):`);
  for (const p of problems) console.error(`  · ${p}`);
  process.exit(1);
}

const ladder = [...byTier.keys()];
console.log(
  `check-rank-divisions ok — ${rows.length} rungs across ${ladder.length} tiers (${source}); ` +
    `climbs ${NUMERAL[3]} -> ${NUMERAL[2]} -> ${NUMERAL[1]} with XP rising at every step.`
);
