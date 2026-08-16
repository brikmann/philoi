#!/usr/bin/env node
/**
 * Money-critical guard: the app and the webhook MUST agree on every IAP product id and amount.
 *
 * The two lists cannot share a module — supabase/functions/* is a Deno edge function that can't
 * import from the app bundle — so they are duplicated, and nothing in the type system notices when
 * they drift. That drift is not a crash or a test failure; it is a card that gets charged and an
 * account that receives nothing, because the webhook's unknown-product path deliberately grants
 * zero rather than guessing.
 *
 * This parses both files as TEXT (no bundler, no ts-node, no dependencies) and fails loudly on:
 *   - an id in one list and not the other
 *   - the same id mapped to different ember amounts
 *   - the Forge Pass id disagreeing between the two
 *   - any id missing the required `app.philoi.` prefix
 *
 * Run: npm run check:iap
 *
 * NOTE: this proves the two halves of the CODEBASE agree. It cannot reach App Store Connect, so it
 * cannot prove either half matches the real store — that check is the sandbox purchase in
 * PHASE4_IAP_TESTING.md, and it is the one that actually protects a customer.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const CLIENT = path.join(ROOT, 'src', 'lib', 'economy', 'forge-pass.ts');
const IAP = path.join(ROOT, 'src', 'lib', 'economy', 'iap.ts');
const WEBHOOK = path.join(ROOT, 'supabase', 'functions', 'revenuecat-webhook', 'index.ts');

const REQUIRED_PREFIX = 'app.philoi.';

const read = (p) => {
  if (!fs.existsSync(p)) {
    console.error(`✗ missing file: ${path.relative(ROOT, p)}`);
    process.exit(1);
  }
  return fs.readFileSync(p, 'utf8');
};

/** Numeric literals may carry _ separators (1_200), so strip them before parsing. */
const num = (s) => Number(String(s).replace(/_/g, ''));

// ── client: EMBER_PACKS rows ──
// Matches `embers: 1_200, name: 'Pile', ... productId: 'app.philoi.embers.1200'` in either order of
// the trailing fields, which is why productId is captured with its own scan of the same row.
function parseClientPacks(src) {
  const block = src.match(/export const EMBER_PACKS[^=]*=\s*\[([\s\S]*?)\];/);
  if (!block) throw new Error('could not find EMBER_PACKS in forge-pass.ts');
  const out = new Map();
  for (const row of block[1].split('\n')) {
    if (!row.includes('productId')) continue;
    const embers = row.match(/embers:\s*([\d_]+)/);
    const id = row.match(/productId:\s*'([^']+)'/);
    if (embers && id) out.set(id[1], num(embers[1]));
  }
  return out;
}

// ── webhook: EMBERS_BY_PRODUCT map ──
function parseWebhookPacks(src) {
  const block = src.match(/const EMBERS_BY_PRODUCT[^=]*=\s*\{([\s\S]*?)\};/);
  if (!block) throw new Error('could not find EMBERS_BY_PRODUCT in the webhook');
  const out = new Map();
  for (const m of block[1].matchAll(/'([^']+)'\s*:\s*([\d_]+)/g)) out.set(m[1], num(m[2]));
  return out;
}

const grabConst = (src, name, file) => {
  const m = src.match(new RegExp(`${name}\\s*=\\s*'([^']+)'`));
  if (!m) throw new Error(`could not find ${name} in ${file}`);
  return m[1];
};

let failures = 0;
const fail = (msg) => {
  console.error(`✗ ${msg}`);
  failures += 1;
};

const clientPacks = parseClientPacks(read(CLIENT));
const webhookSrc = read(WEBHOOK);
const webhookPacks = parseWebhookPacks(webhookSrc);
const clientPassId = grabConst(read(IAP), 'FORGE_PASS_PRODUCT_ID', 'iap.ts');
const webhookPassId = grabConst(webhookSrc, 'FORGE_PASS_PRODUCT_ID', 'the webhook');

if (clientPacks.size === 0) fail('client EMBER_PACKS parsed as empty — the regex or the file shape changed');

// Forge Pass
if (clientPassId !== webhookPassId) {
  fail(`Forge Pass id mismatch:\n    app:     ${clientPassId}\n    webhook: ${webhookPassId}`);
}

// Every id, both directions
for (const [id, embers] of clientPacks) {
  if (!webhookPacks.has(id)) {
    fail(`"${id}" is sold by the app but the webhook does not know it — a purchase would grant NOTHING`);
    continue;
  }
  if (webhookPacks.get(id) !== embers) {
    fail(`"${id}" amount mismatch: app grants ${embers}, webhook grants ${webhookPacks.get(id)}`);
  }
}
for (const id of webhookPacks.keys()) {
  if (!clientPacks.has(id)) fail(`"${id}" is in the webhook map but nothing in the app sells it`);
}

// Prefix — catches the exact class of bug this script was written for (philoi.* vs app.philoi.*)
for (const id of [...clientPacks.keys(), ...webhookPacks.keys(), clientPassId, webhookPassId]) {
  if (!id.startsWith(REQUIRED_PREFIX)) fail(`"${id}" is missing the required "${REQUIRED_PREFIX}" prefix`);
}

// No hardcoded prices may creep back into the pack list.
if (/EMBER_PACKS[\s\S]*?\];/.test(read(CLIENT)) && /price:\s*'\$/.test(read(CLIENT).match(/EMBER_PACKS[\s\S]*?\];/)[0])) {
  fail('a hardcoded `price: \'$…\'` is back in EMBER_PACKS — prices must come from the store at runtime');
}

if (failures > 0) {
  console.error(`\n${failures} problem(s). These ids are money-critical — do not ship until they match.`);
  process.exit(1);
}

console.log('✓ IAP ids aligned');
console.log(`  Forge Pass: ${clientPassId}`);
for (const [id, embers] of clientPacks) console.log(`  ${id.padEnd(28)} → ${embers.toLocaleString('en-US')} embers`);
console.log(`\n  ${clientPacks.size} ember packs + 1 pass, app and webhook in agreement.`);
console.log('  NOTE: this does not verify App Store Connect — see PHASE4_IAP_TESTING.md.');
