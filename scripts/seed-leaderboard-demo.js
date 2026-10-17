#!/usr/bin/env node

/**
 * SEED 6 demo students onto the "My uni" leaderboard (Wilfrid Laurier University) so the App Store
 * leaderboard screenshot looks stacked — varied ranks, titles, and flame colours. These sit
 * alongside your own real account on the uni board.
 *
 * Needs the service_role key (Project Settings -> API -> service_role) because it creates auth
 * users through the admin API, which bypasses RLS by design. NEVER put this key in .env or commit
 * it. Run (PowerShell):
 *
 *   $env:SUPABASE_URL="https://auth.philoi.app"; $env:SUPABASE_SERVICE_ROLE_KEY="<service_role>"; node scripts/seed-leaderboard-demo.js
 *
 * (bash: SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/seed-leaderboard-demo.js)
 *
 * profiles.id FKs auth.users(id) ON DELETE CASCADE, and rank/loadout/cosmetics all cascade off
 * profiles, so cleanup is one line (see TEARDOWN at the bottom). These are tagged email
 * @philoi.demo so they're trivially found.
 *
 * VISIBILITY NOTE: seeded with is_demo = false so they're guaranteed to appear on the uni board
 * for the shot. Delete (or flip is_demo true) right after screenshotting so they don't sit in real
 * stats. Pre-launch the exposure window is minutes.
 */

const crypto = require('node:crypto');
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY before running.');
  process.exit(1);
}

const UNIVERSITY = 'Wilfrid Laurier University';
const IS_DEMO = false; // see VISIBILITY NOTE above

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// Top → bottom. score drives universal_score() and therefore the rank badge; title + flame are the
// flex. Scores span the 0203 multi-year ladder so the tiers come out varied and impressive.
// flare: top four only (Chloe + Noah keep none). halo: all six distinct, none the base ring.
const STUDENTS = [
  { name: 'Maya K.',    handle: 'maya.k',      score: 545_000, title: 'title-the-goat',         flame: 'flame-rank-diamond',   halo: 'halo-diamond-prism',  flare: 'flare-zeus-wrath'          },
  { name: 'Devin R.',   handle: 'devinr',      score: 288_000, title: 'title-final-boss',       flame: 'flame-cosmic-purple',  halo: 'halo-hades',          flare: 'flare-void-plasma'         },
  { name: 'Priya S.',   handle: 'priya.s',     score: 154_000, title: 'title-cracked',          flame: 'flame-rank-platinum',  halo: 'halo-glowing-amber',  flare: 'flare-white-incandescence' },
  { name: 'Liam O.',    handle: 'liamocon',    score:  73_000, title: 'title-built-different',  flame: 'flame-electric-cyan',  halo: 'halo-emberfall',      flare: 'flare-acid-rain'           },
  { name: 'Chloe B.',   handle: 'chloeb',      score:  35_000, title: 'title-pacesetter',       flame: 'flame-rank-gold',      halo: 'halo-ember-halo',     flare: null                        },
  { name: 'Noah T.',    handle: 'noah.t.lkd',  score:  12_500, title: 'title-dialed-in',        flame: 'flame-solar-flare',    halo: 'halo-copper-ring',    flare: null                        },
];

async function run() {
  for (const s of STUDENTS) {
    const email = `demo.${s.handle}@philoi.demo`;
    const password = crypto.randomBytes(18).toString('base64url');

    // 1. auth user (confirmed so the row is fully live)
    const { data: created, error: cErr } = await admin.auth.admin.createUser({
      email, password, email_confirm: true,
    });
    if (cErr && !String(cErr.message).includes('already been registered')) {
      console.error(`createUser ${email}:`, cErr.message); continue;
    }
    let userId = created?.user?.id;
    if (!userId) {
      // already exists — look it up
      const { data: list } = await admin.auth.admin.listUsers();
      userId = list?.users?.find((u) => u.email === email)?.id;
      if (!userId) { console.error(`no id for ${email}`); continue; }
    }

    // 2. profile (fires 0073 default-loadout trigger). University = Laurier so it lands on the uni board.
    const { error: pErr } = await admin.from('profiles').upsert({
      id: userId, display_name: s.name, handle: s.handle, university: UNIVERSITY, is_demo: IS_DEMO,
    }, { onConflict: 'id' });
    if (pErr) { console.error(`profile ${email}:`, pErr.message); continue; }

    // 3. score → universal_score() sums bonus_xp_awards. One row = their whole score.
    //    Clear any previous demo award first so re-runs don't stack.
    await admin.from('bonus_xp_awards').delete().eq('user_id', userId).eq('reason', 'demo_seed');
    const { error: xErr } = await admin.from('bonus_xp_awards').insert({
      user_id: userId, amount: s.score, reason: 'demo_seed',
    });
    if (xErr) { console.error(`bonus_xp ${email}:`, xErr.message); }

    // 4. permanent peak rank_index to match the score (some surfaces read the peak, not the score).
    const { data: rk } = await admin.rpc('exec_rank_index_for_score', { p_score: s.score }).maybeSingle?.() ?? {};
    // No such RPC by default — fall back to a direct upsert of rank_index computed client-side is
    // not possible without the thresholds; instead set via SQL through PostgREST is not available.
    // So we upsert user_rank_state with rank_index left for the board's score-derived badge, which
    // is what the uni board actually reads. If a surface needs the peak, run the SQL in step 4b.
    await admin.from('user_rank_state').upsert({ user_id: userId }, { onConflict: 'user_id' }).select().maybeSingle?.();

    // 5. own + equip the flex cosmetics (override the starter set from the trigger).
    //    flare is lock-in only and optional — Chloe + Noah have none.
    const keys = [s.title, s.flame, s.halo, ...(s.flare ? [s.flare] : [])];
    await admin.from('cosmetics_owned').upsert(
      keys.map((k) => ({ user_id: userId, cosmetic_key: k, source: 'earned', provenance: 'Demo seed' })),
      { onConflict: 'user_id,cosmetic_key' });
    const equips = [
      { user_id: userId, slot: 'title', cosmetic_key: s.title },
      { user_id: userId, slot: 'flame', cosmetic_key: s.flame },
      { user_id: userId, slot: 'halo',  cosmetic_key: s.halo },
    ];
    if (s.flare) equips.push({ user_id: userId, slot: 'flare', cosmetic_key: s.flare });
    await admin.from('equipped_loadout').upsert(equips, { onConflict: 'user_id,slot' });

    console.log(`✓ ${s.name.padEnd(10)} ${String(s.score).padStart(7)} xp  ${s.flame} / ${s.halo} / ${s.title}${s.flare ? ' / ' + s.flare : ''}`);
  }

  console.log('\nDone. Open the app → Leaderboards → "My uni" to shoot the stacked board.');
  console.log('If the peak rank badge looks wrong on any surface, run step 4b SQL (see script footer).');
  console.log('\nTEARDOWN when done (SQL editor): delete from auth.users where email like \'%@philoi.demo\';');
}

run().catch((e) => { console.error(e); process.exit(1); });

/*
 4b · OPTIONAL — set the permanent peak rank_index to match each demo score (run in the SQL editor
 only if a surface reads the peak rather than the live score). rank_tier_for_score drives the board
 badge already, so this is usually unnecessary:

   update user_rank_state urs set rank_index = (
     select coalesce(max(rt.rank_index), 1) from rank_thresholds rt
     where rt.cumulative_xp_required <= universal_score(urs.user_id)
   )
   from profiles p
   where p.id = urs.user_id and p.handle in
     ('maya.k','devinr','priya.s','liamocon','chloeb','noah.t.lkd');
*/
