#!/usr/bin/env node
/**
 * Disclosure guard: the loot-box odds the app can print MUST equal the weights the server rolls on.
 *
 * Google Play requires the odds of a paid random item to be disclosed before the purchase or open,
 * and Philoi sells embers for real money — so a drop table that overstates a tier is not a cosmetic
 * bug, it is the app telling a regulator's exact question the wrong answer. Belgium and the
 * Netherlands ban paid loot boxes outright and the audience skews students and minors, so the bar
 * here is the truth, not "close enough".
 *
 * At runtime the screens read the LIVE weights (economy_config.box_odds, via hooks/use-box-odds.ts),
 * so what they show cannot drift from the roll. The table in src/lib/economy/boxes.ts is only the
 * fallback that paints before that read lands and offline — and a fallback nobody checks is exactly
 * the parallel hand-maintained odds table this whole design exists to avoid. This is the check.
 *
 * Parses both as TEXT (no bundler, no ts-node, no dependencies) and fails loudly on:
 *   - a box in one list and not the other
 *   - any rarity weight that differs between them
 *   - a box whose weights don't sum to 100
 *
 * Run: npm run check:box-odds  (also runs as part of `npm run typecheck`)
 *
 * NOTE: this proves the MIGRATION and the app agree. It cannot reach the prod database, and
 * economy_config seeds with `on conflict do nothing` — so a row hand-edited in prod would pass here
 * and still be caught at runtime by the Sentry drift report in use-box-odds.ts.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const MIGRATIONS = path.join(ROOT, 'supabase', 'migrations');
const CLIENT = path.join(ROOT, 'src', 'lib', 'economy', 'boxes.ts');

const RARITIES = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic'];
const EPSILON = 1e-9;

const fail = (msg) => {
  console.error(`✗ ${msg}`);
  process.exit(1);
};

/**
 * The authoritative weights: the HIGHEST-numbered migration that writes box_odds wins, so a future
 * retune migration is picked up here automatically rather than silently checked against 0064.
 */
function serverOdds() {
  const files = fs
    .readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  for (const file of files.reverse()) {
    const sql = fs.readFileSync(path.join(MIGRATIONS, file), 'utf8');
    // `('box_odds', '{ ... }')` — the seed's insert and any later update both take this shape.
    const match = sql.match(/'box_odds'\s*,\s*'(\{[\s\S]*?\})'/);
    if (!match) continue;
    let parsed;
    try {
      parsed = JSON.parse(match[1]);
    } catch (e) {
      fail(`${file} has a box_odds literal that isn't valid JSON: ${e.message}`);
    }
    return { file, odds: parsed };
  }
  return fail('no migration writes economy_config box_odds');
}

/** The fallback mirror: every `key: '<box>'` … `odds: { … }` block in boxes.ts. */
function clientOdds() {
  const src = fs.readFileSync(CLIENT, 'utf8');
  const out = {};
  const blocks = src.matchAll(/key:\s*'([a-z]+)',[\s\S]*?odds:\s*\{([^}]*)\}/g);
  for (const [, key, body] of blocks) {
    const weights = {};
    for (const [, rarity, value] of body.matchAll(/([a-z]+):\s*([0-9.]+)/g)) {
      weights[rarity] = Number(value);
    }
    out[key] = weights;
  }
  if (Object.keys(out).length === 0) fail('could not parse any odds table out of src/lib/economy/boxes.ts');
  return out;
}

const { file, odds: server } = serverOdds();
const client = clientOdds();
const problems = [];

for (const key of new Set([...Object.keys(server), ...Object.keys(client)])) {
  if (!server[key]) problems.push(`${key}: in boxes.ts but not in ${file}`);
  else if (!client[key]) problems.push(`${key}: in ${file} but not in boxes.ts`);
  else {
    for (const rarity of RARITIES) {
      const s = server[key][rarity] ?? 0;
      const c = client[key][rarity] ?? 0;
      if (Math.abs(s - c) > EPSILON) problems.push(`${key}.${rarity}: server ${s}% vs boxes.ts ${c}%`);
    }
    const sum = RARITIES.reduce((t, r) => t + (server[key][r] ?? 0), 0);
    // A disclosure that doesn't total 100 can't be printed honestly at any precision.
    if (Math.abs(sum - 100) > EPSILON) problems.push(`${key}: weights sum to ${sum}%, not 100%`);
  }
}

if (problems.length > 0) {
  console.error(`✗ published drop odds disagree with the roll (${file} ↔ src/lib/economy/boxes.ts):`);
  for (const p of problems) console.error(`    ${p}`);
  console.error('  The migration is authoritative — economy_roll_rarity reads it. Fix boxes.ts to match.');
  process.exit(1);
}

console.log(`✓ Drop odds identical for ${Object.keys(server).length} boxes (${file} ↔ src/lib/economy/boxes.ts)`);
