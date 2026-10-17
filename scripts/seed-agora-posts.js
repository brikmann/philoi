#!/usr/bin/env node

/**
 * Seed one Agora post per demo student so the Agora feed shows cosmetics on display —
 * each post renders the author's equipped FLAME (name), HALO (avatar ring), BANNER and CARD.
 * (Flare does NOT render here — it's a lock-in-only perimeter aura.)
 *
 * Prereq: run scripts/seed-leaderboard-demo.js first — these are the same demo accounts
 * (demo.*@philoi.demo) with the loadouts from scripts/demo-loadouts.md already equipped.
 *
 * Needs the service_role key (bypasses RLS to insert as each author). NEVER commit the key. Run:
 *   PowerShell:  $env:SUPABASE_URL="https://auth.philoi.app"; $env:SUPABASE_SERVICE_ROLE_KEY="<key>"; node scripts/seed-agora-posts.js
 *   bash:        SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/seed-agora-posts.js
 *
 * Idempotent: clears each demo account's existing Agora posts first, so re-running won't stack.
 * Teardown rides the main one: `delete from auth.users where email like '%@philoi.demo'` cascades
 * these posts away with the accounts.
 */

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY before running.');
  process.exit(1);
}

const VISIBILITY = 'public'; // shows globally; demo accounts are all Laurier so 'campus' would also reach your feed

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// handle (from the leaderboard seed) → what they say. Short, authentic student voice, study + gym mix
// so both disciplines show. Minutes-ago staggers the feed so it reads naturally.
const POSTS = [
  { handle: 'maya.k',     minsAgo: 14,  body: "6am library before anyone else is up. the board doesn't climb itself." },
  { handle: 'devinr',     minsAgo: 47,  body: "midterm szn. locked in 4 hours straight, one 10-min break. protect the streak." },
  { handle: 'priya.s',    minsAgo: 96,  body: "finally cracked that orgo problem set. the dopamine when the fire hits roaring >>>" },
  { handle: 'liamocon',   minsAgo: 150, body: "leg day logged ✅ three gym lock-ins this week, holding the challenge with the boys" },
  { handle: 'chloeb',     minsAgo: 220, body: "not the biggest sessions but i show up every single day. consistency is the cheat code." },
  { handle: 'noah.t.lkd', minsAgo: 300, body: "study with friends > study alone. seeing everyone's fire lit keeps me off my phone fr" },
];

async function run() {
  // map handle → user id
  const { data: list } = await admin.auth.admin.listUsers();
  const byEmail = new Map((list?.users ?? []).map((u) => [u.email, u.id]));

  for (const p of POSTS) {
    const email = `demo.${p.handle}@philoi.demo`;
    const userId = byEmail.get(email);
    if (!userId) { console.error(`no account for ${email} — run seed-leaderboard-demo.js first`); continue; }

    // clear prior demo posts for this user so re-runs don't duplicate
    await admin.from('agora_posts').delete().eq('user_id', userId);

    const created = new Date(Date.now() - p.minsAgo * 60_000).toISOString();
    const { error } = await admin.from('agora_posts').insert({
      user_id: userId,
      body: p.body,
      visibility: VISIBILITY,
      created_at: created,
    });
    if (error) { console.error(`post ${p.handle}:`, error.message); continue; }
    console.log(`✓ ${p.handle.padEnd(12)} "${p.body.slice(0, 48)}${p.body.length > 48 ? '…' : ''}"`);
  }

  console.log('\nDone. Open the app → The Agora → Global to shoot the feed (cosmetics on display).');
  console.log('Flame / halo / banner / card render per author; flare does not (lock-in only).');
}

run().catch((e) => { console.error(e); process.exit(1); });
