#!/usr/bin/env node

/**
 * Seed the "Distance Challenge" standings for the App Store challenge shot.
 * 5 racers, Noah mid-pack (#2): Maya 50.2, Noah 30.4, Liam 16.3, Priya 8.4, Chloe 5.3 (km).
 *
 * TWO-STEP (keeps all schema guesswork out of this script):
 *   1. FIRST, in the app, Noah hosts a campfire challenge named exactly "Distance Challenge" —
 *      a km / group / semester-long challenge for the "Run Club" campfire (create that campfire first
 *      if it doesn't exist, owned by you). 100 km, through December, named exactly "Distance Challenge".
 *      Host it as a DISTANCE race (the "Distance" pill / placement path), NOT through Cindy — Cindy's
 *      host tool only makes COUNTED challenges, which scores by lock-in count and ties everyone at 1.
 *      Hosting sets every evolved column
 *      correctly (race_metric='count', count_unit='km', status='active', window, etc.) and mints
 *      Noah's own mirror goal.
 *   2. THEN run this script. It enrols the 4 demo accounts into that same challenge, mints each one's
 *      mirror goal via the real RPC, and sets every racer's progress (including Noah's).
 *
 * Prereq: scripts/seed-leaderboard-demo.js already run (the demo.* accounts exist with loadouts).
 * Needs the service_role key. NEVER commit it. Run (PowerShell):
 *   $env:SUPABASE_URL="https://auth.philoi.app"; $env:SUPABASE_SERVICE_ROLE_KEY="<key>"; node scripts/seed-distance-challenge.js
 *
 * Idempotent: re-running re-enrols and re-sets progress (no duplicates — participant PK + per-user goal).
 * Teardown: delete from social_challenges where public_name='Distance Challenge'; (cascades participants);
 *           the demo mirror goals cascade when the demo accounts are removed.
 */

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY before running.');
  process.exit(1);
}
const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// The race to seed, by its exact public name: CHALLENGE_NAME env, else the first CLI argument.
//   node scripts/seed-distance-challenge.js "Most km run · 30 days"
const CHALLENGE_NAME = process.env.CHALLENGE_NAME || process.argv[2] || 'Distance Challenge';
// Accounts to take OUT of the race (their participant row is deleted, so they leave the field and
// the board). Comma-separated EXCLUDE env; defaults to Noah's second account, which every seeded
// shot so far has had to drop by hand.
const EXCLUDE = (process.env.EXCLUDE ?? 'spikeythedoge1@gmail.com').split(',').map((e) => e.trim()).filter(Boolean);
// email → progress km. Noah is #2 (30.4). Standings rank by progress desc.
const RACERS = [
  { email: 'noahbrikman@gmail.com',       km: 30.4, host: true },
  { email: 'demo.maya.k@philoi.demo',     km: 50.2 },
  { email: 'demo.liamocon@philoi.demo',   km: 16.3 },
  { email: 'demo.priya.s@philoi.demo',    km: 8.4 },
  { email: 'demo.chloeb@philoi.demo',     km: 5.3 },
];

async function run() {
  // 1. find the challenge Noah hosted
  const { data: ch, error: chErr } = await admin
    .from('social_challenges')
    .select('id, circle_id, count_unit, target_count, status, public_name')
    .eq('public_name', CHALLENGE_NAME)
    // Live ones only. A settled race is never re-scored, so seeding one is silently a no-op.
    .in('status', ['draft', 'pending', 'active'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (chErr) { console.error('lookup failed:', chErr.message); process.exit(1); }
  if (!ch) {
    console.error(`No "${CHALLENGE_NAME}" found. Host it in the app first (step 1 in the header).`);
    process.exit(1);
  }
  console.log(`Challenge ${ch.id}  unit=${ch.count_unit}  target=${ch.target_count}  status=${ch.status}  circle=${ch.circle_id ?? 'none'}`);

  // 2. resolve emails → ids
  const { data: list } = await admin.auth.admin.listUsers();
  const idByEmail = new Map((list?.users ?? []).map((u) => [u.email, u.id]));

  for (const email of EXCLUDE) {
    const uid = idByEmail.get(email);
    if (!uid) { console.log(`  (exclude: no account for ${email})`); continue; }
    const { error: exErr, count } = await admin.from('challenge_participants')
      .delete({ count: 'exact' }).eq('challenge_id', ch.id).eq('user_id', uid);
    if (exErr) { console.error(`  exclude ${email}:`, exErr.message); continue; }
    console.log(`  ✗ ${email.padEnd(32)} removed from the race (${count ?? 0} row)`);
  }

  for (const r of RACERS) {
    const uid = idByEmail.get(r.email);
    if (!uid) { console.error(`  no account for ${r.email}${r.host ? ' (your own? sign in once)' : ' — run seed-leaderboard-demo.js'}`); continue; }

    // (a) if the challenge is scoped to a campfire, make sure the racer is a member (some reads gate on it)
    if (ch.circle_id && !r.host) {
      await admin.from('group_members').upsert({ group_id: ch.circle_id, user_id: uid }, { onConflict: 'group_id,user_id' });
    }

    // Clear any prior seed run for this challenge+user first so re-runs don't stack distance.
    const extId = `seed-dist-${ch.id.slice(0, 8)}-${uid.slice(0, 8)}`;
    await admin.from('check_ins').delete().eq('user_id', uid).eq('external_id', extId);

    // (b) enrol as accepted. BASELINE = the racer's distance already on the books.
    //     Settlement scores challenge_metric_value(lifetime distance at ends_at) - baseline, so a
    //     baseline of 0 counted a real account's whole Strava history: the first run of this script
    //     scored Noah 59.5 km (30.4 seeded + 29.1 real) and handed him 1st. With the baseline at
    //     what they had before, score = exactly the seeded km.
    const { data: prior, error: priorErr } = await admin
      .from('check_ins').select('distance_m').eq('user_id', uid).is('removed_at', null).not('distance_m', 'is', null);
    if (priorErr) { console.error(`  baseline ${r.email}:`, priorErr.message); continue; }
    const baseline = (prior ?? []).reduce((s, c) => s + Number(c.distance_m || 0), 0);
    await admin.from('challenge_participants').upsert(
      { challenge_id: ch.id, user_id: uid, state: 'accepted', baseline, responded_at: new Date().toISOString() },
      { onConflict: 'challenge_id,user_id' }
    );

    // (c) DISTANCE scores from sum(check_ins.distance_m) — NOT a mirror goal. Give each racer one
    //     run check-in whose distance_m = their km. Dated inside the window (after starts_at) so it
    //     counts. Mirror the shape the Strava path writes (upsertStravaLockIn): goal_type='run',
    //     duration_seconds, distance_m, source, external_id, created_at.
    const { error: ciErr } = await admin.from('check_ins').insert({
      user_id: uid,
      goal_type: 'run',
      duration_seconds: Math.round(r.km * 300), // ~5 min/km, cosmetic only
      distance_m: Math.round(r.km * 1000),
      source: 'strava',
      external_id: extId,
      created_at: new Date().toISOString(),
    });
    if (ciErr) { console.error(`  check_in ${r.email}:`, ciErr.message,
      '(check_ins may have extra NOT NULL cols on live schema — add them to this insert)'); continue; }

    console.log(`  ✓ ${r.email.padEnd(32)} ${String(r.km).padStart(5)} km (${Math.round(r.km*1000)} m)${r.host ? '  · you · #2' : ''}`);
  }

  console.log('\nDone. Open the challenge → standings / Watch board → shoot the 5 racers ranked by km.');
  console.log('Teardown: delete from social_challenges where public_name = \'Distance Challenge\';');
}

run().catch((e) => { console.error(e); process.exit(1); });
