#!/usr/bin/env node
/**
 * Price guard: the rarity the server SELLS an item at must be the rarity the catalog says it is.
 *
 * Since 0213, salvage_cosmetic prices a sale off the `cosmetic_rarity` table, never off the rarity
 * the phone sends (which was a live ember exploit — a rare sold "as mythic" paid 10x). That table is
 * seeded from src/lib/economy/catalog.ts, and a seed nobody re-runs drifts: a new item would be
 * unsellable, a re-rated one sold at its old price. This is the check.
 *
 * Fails when the NEWEST migration that seeds cosmetic_rarity disagrees with the catalog in either
 * direction — an item missing from the seed, a seeded key the catalog no longer has, or a rarity
 * that differs. The fix is a new migration re-seeding the table; `--print-seed` prints the VALUES
 * block for it.
 *
 * Run: npm run check:cosmetic-rarity  (also runs as part of `npm run typecheck`)
 *
 * NOTE: like check-box-odds, this proves the MIGRATION and the app agree. It cannot reach prod.
 */

const fs = require('fs');
const path = require('path');
const { loadCatalog } = require('./lib/load-catalog');

const MIGRATIONS = path.join(__dirname, '..', 'supabase', 'migrations');

const fail = (msg) => {
  console.error(`✗ ${msg}`);
  process.exit(1);
};

function catalogRarities() {
  const { CATALOG } = loadCatalog();
  if (!Array.isArray(CATALOG) || CATALOG.length === 0) fail('catalog.ts exported no CATALOG');
  return new Map(CATALOG.map((i) => [i.id, i.rarity]));
}

function printSeed(catalog) {
  const rows = [...catalog].sort(([a], [b]) => a.localeCompare(b)).map(([k, r]) => `  ('${k.replace(/'/g, "''")}', '${r}')`);
  process.stdout.write(rows.join(',\n') + '\n');
}

/** The seed in the highest-numbered migration that writes one — a later re-seed supersedes 0213. */
function seededRarities() {
  const files = fs.readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort().reverse();
  for (const file of files) {
    const sql = fs.readFileSync(path.join(MIGRATIONS, file), 'utf8');
    const block = sql.match(/insert into cosmetic_rarity\s*\(cosmetic_key,\s*rarity\)\s*values([\s\S]*?)on conflict/i);
    if (!block) continue;
    const seed = new Map();
    for (const m of block[1].matchAll(/\(\s*'((?:[^']|'')+)'\s*,\s*'([a-z]+)'\s*\)/g)) {
      seed.set(m[1].replace(/''/g, "'"), m[2]);
    }
    if (seed.size === 0) fail(`${file} seeds cosmetic_rarity but no rows parsed`);
    return { file, seed };
  }
  return null;
}

const catalog = catalogRarities();

if (process.argv.includes('--print-seed')) {
  printSeed(catalog);
  process.exit(0);
}

const found = seededRarities();
if (!found) fail('no migration seeds cosmetic_rarity (expected 0213 or later)');
const { file, seed } = found;

const problems = [];
for (const [key, rarity] of catalog) {
  if (!seed.has(key)) problems.push(`${key} is in the catalog but not seeded — it cannot be sold`);
  else if (seed.get(key) !== rarity) problems.push(`${key}: catalog says ${rarity}, ${file} sells it as ${seed.get(key)}`);
}
for (const key of seed.keys()) {
  if (!catalog.has(key)) problems.push(`${key} is seeded but no longer in the catalog`);
}

if (problems.length) {
  fail(
    `cosmetic_rarity (${file}) disagrees with catalog.ts:\n  - ${problems.join('\n  - ')}\n` +
      'Re-seed it in a new migration: node ./scripts/check-cosmetic-rarity.js --print-seed'
  );
}
console.log(`✓ Sale prices match the catalog for ${catalog.size} items (${file} ↔ src/lib/economy/catalog.ts)`);
