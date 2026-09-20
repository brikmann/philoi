#!/usr/bin/env node
/**
 * Sign-In guard: google-services.json must carry the PLAY APP SIGNING SHA-1, not just the upload key.
 *
 * The app is delivered as an AAB and re-signed by Play App Signing, so the certificate it runs under
 * is NOT the upload certificate. Google Sign-In resolves an Android OAuth client by
 * (package_name, runtime SHA-1); when only the upload-key hash is registered, that lookup finds
 * nothing and the SDK throws DEVELOPER_ERROR for every account. The failure is total and it looks
 * like a code bug, which is why it cost a debugging cycle.
 *
 * Run this AFTER replacing ./google-services.json with a fresh download from the Firebase console
 * (Project settings -> com.philoi.app -> the App signing key SHA-1 must be in the fingerprint list).
 *
 * Run: npm run check:google-services
 *
 * NOTE: this proves the BAKED CONFIG is no longer stale. It cannot reach Google's OAuth backend, so
 * it cannot prove the SHA is registered server-side -- that is what the on-device sign-in test
 * proves, and that is the one that actually protects a user.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const FILE = path.join(ROOT, 'google-services.json');

// The upload key SHA-1 that was already present. Anything equal to this alone is the stale config.
const UPLOAD_KEY_SHA1 = 'b4b7a9048a4f419f24d1ae4d5df2b182decc0f12';
const PACKAGE = 'com.philoi.app';
// Must stay in lockstep with GOOGLE_WEB_CLIENT_ID in eas.json (checked below, not hardcoded twice).
const EAS = path.join(ROOT, 'eas.json');

const fail = [];
const warn = [];

if (!fs.existsSync(FILE)) {
  console.error('✗ google-services.json is missing from the repo root');
  process.exit(1);
}

let cfg;
try {
  cfg = JSON.parse(fs.readFileSync(FILE, 'utf8'));
} catch (e) {
  console.error(`✗ google-services.json is not valid JSON: ${e.message}`);
  process.exit(1);
}

const client = (cfg.client || []).find(
  (c) => c?.client_info?.android_client_info?.package_name === PACKAGE,
);
if (!client) {
  console.error(`✗ no client entry for package ${PACKAGE}`);
  process.exit(1);
}

const oauth = client.oauth_client || [];
const android = oauth.filter((o) => o.client_type === 1);
const web = oauth.filter((o) => o.client_type === 3);

// ── 1. The whole point: more than one Android client, and one of them is not the upload key ──
const hashes = android.map((o) => (o.android_info?.certificate_hash || '').toLowerCase());
const extra = hashes.filter((h) => h && h !== UPLOAD_KEY_SHA1);

if (android.length === 0) {
  fail.push('no client_type:1 (Android) OAuth client at all');
} else if (extra.length === 0) {
  fail.push(
    `only the upload-key SHA-1 (${UPLOAD_KEY_SHA1}) is present.\n` +
      '    The Play App Signing SHA-1 was NOT added in Firebase, or the file was not re-downloaded.\n' +
      '    Firebase console -> Project settings -> com.philoi.app -> Add fingerprint (App signing key SHA-1),\n' +
      '    then download google-services.json again and replace the repo root copy.',
  );
}

for (const h of hashes) {
  if (h && !/^[0-9a-f]{40}$/.test(h)) {
    fail.push(`certificate_hash is not 40 hex chars: "${h}"`);
  }
}
const dupes = hashes.filter((h, i) => hashes.indexOf(h) !== i);
if (dupes.length) fail.push(`duplicate certificate_hash entries: ${[...new Set(dupes)].join(', ')}`);

// ── 2. The web client must not have moved: it is the webClientId the SDK sends for the idToken ──
if (web.length !== 1) {
  fail.push(`expected exactly 1 client_type:3 (web) OAuth client, found ${web.length}`);
} else if (fs.existsSync(EAS)) {
  const easRaw = fs.readFileSync(EAS, 'utf8');
  const ids = [...easRaw.matchAll(/"GOOGLE_WEB_CLIENT_ID"\s*:\s*"([^"]+)"/g)].map((m) => m[1]);
  const unique = [...new Set(ids)];
  if (unique.length > 1) {
    fail.push(`eas.json has ${unique.length} different GOOGLE_WEB_CLIENT_ID values: ${unique.join(', ')}`);
  } else if (unique.length === 1 && unique[0] !== web[0].client_id) {
    fail.push(
      `web client mismatch:\n      google-services.json: ${web[0].client_id}\n      eas.json:             ${unique[0]}`,
    );
  } else if (unique.length === 0) {
    warn.push('no GOOGLE_WEB_CLIENT_ID found in eas.json to cross-check');
  }
}

// ── 3. Identity sanity ──
if (cfg.project_info?.project_id !== 'philoi-504010') {
  fail.push(`project_id is ${cfg.project_info?.project_id}, expected philoi-504010`);
}

const report = (label, list) => list.forEach((m) => console.error(`${label} ${m}`));

if (fail.length) {
  report('✗', fail);
  report('!', warn);
  console.error(`\n✗ google-services.json check FAILED (${fail.length} problem(s))`);
  process.exit(1);
}

report('!', warn);
console.log(`✓ package ${PACKAGE}`);
console.log(`✓ ${android.length} Android OAuth client(s): ${hashes.join(', ')}`);
console.log(`✓ Play App Signing SHA-1 present (${extra.join(', ')})`);
console.log(`✓ web client matches eas.json: ${web[0].client_id}`);
console.log('\n✓ google-services.json is ready to build');
