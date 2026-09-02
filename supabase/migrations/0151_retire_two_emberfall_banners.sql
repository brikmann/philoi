-- 0151 · Retire banner-emberfall and banner-emberfall-elite (§0 of the banner-set pass).
--
-- Noah cut both as too specific. The client catalog entries are gone (src/lib/economy/catalog.ts)
-- and the Forge Pass table in the app now hands out banner-obsidian-colosseum at L20 instead.
-- This migration is the SERVER half of that, because the app's copy of the pass table is not the
-- one that grants: pass_track_rewards is, and it is seeded independently.
--
-- RENUMBERED FROM 0148. This was written as 0148 and never pushed; by the time it was due, a
-- parallel session had already created AND applied its own 0148 (one_active_goal_per_source), plus
-- 0149 and 0150. Two files sharing a leading number is the exact failure MIGRATIONS.md opens with —
-- the duplicate version silently rolls back and the CLI blames the schema_migrations INSERT rather
-- than the collision. A number is taken the moment the file exists, so this one moved to the next
-- genuinely free slot rather than the other file being touched.
--
-- ══════════════════════════════════════════════════════════════════════════════════════════════
-- WHAT ACTUALLY REFERENCED THESE TWO KEYS. Found by sweeping every table with an item-key column
-- plus every function body mentioning them, rather than by grepping the migrations — several of
-- these are seeded rows that no single migration file makes obvious:
--
--   cosmetics_owned                    2 rows   · GRANDFATHERED — see below, deliberately untouched
--   equipped_loadout                   1 row    · 🔴 an EQUIPPED banner. Fixed here.
--   pass_track_rewards                 1 row    · S1 L20 premium. Fixed here.
--   season_titles.banner_asset         3 rows   · ⚠ NOT fixed here — Noah's call, see §3
--   grant_season_placement_rewards()   2 literals · ⚠ NOT fixed here — Noah's call, see §3
--   box_droppable_items                0 rows   · already clean, nothing to do
--   0138's season-leak assertion       1 literal · a one-time check in an applied migration; inert
--
-- ══════════════════════════════════════════════════════════════════════════════════════════════
-- WHY OWNED ITEMS ARE NOT DELETED.
--
-- Removing a catalog entry is not the same as revoking property, and the brief is explicit: don't
-- hard-delete anyone's item. A cosmetics_owned row for a key the client no longer knows is a
-- SOFT failure everywhere it lands — bannerColors() falls back to base Hearthlight, the campfire
-- draws the Hearthlight scene, the inventory row takes its unknown-item path. Nothing crashes.
--
-- An EQUIPPED row is the exception, and it is why §2 exists: equipped_loadout is what the profile
-- and the campfire header read, so leaving a dead key there means the person is actively wearing
-- something that renders as the free default with no way to tell why. That one gets moved.
--
-- WHO IS AFFECTED, checked on prod before writing this: exactly one account owns either key —
-- Noah (@brikmnn), both acquired 2026-08-24 through a "Full catalog grant", i.e. a dev grant and
-- not an earned season reward. No real player has earned Emberfall Elite, because no season has
-- ever settled (season_placement_closures is empty and season_reward_grants has zero rows). So
-- this migration moves one test loadout and orphans nobody.

-- ─────────────────────────── 1 · the Forge Pass slot ───────────────────────────
--
-- The brief: "don't leave the pass granting a deleted item." L20's premium lane, ord 1, was
-- banner-emberfall.
--
-- WHY COLOSSEUM AND NOT THE TWO THE BRIEF SUGGESTED. Emberfall Standard and Ashfall were both
-- named as candidates, and both are ALREADY in this table — Standard at L25, Ashfall at L70.
-- Granting the same banner twice in one pass is a worse bug than the one being fixed (the second
-- claim is a no-op and the level reads as an empty reward), so the slot takes the one legendary
-- banner the pass does not otherwise hand out. Same rarity and same slot as the item it replaces,
-- so nothing downstream of pass_track_rewards changes shape.
--
-- Keep in step with NAMED_LEVELS in src/lib/economy/forge-pass.ts, which is the client's copy of
-- this same table and is what the pass SCREEN renders from. They are two sources for one fact;
-- 0133 exists because they had already drifted once.
update pass_track_rewards
   set item_key = 'banner-obsidian-colosseum'
 where season_id = 'S1'
   and lane = 'premium'
   and level = 20
   and item_key = 'banner-emberfall';

-- ─────────────────────────── 2 · nobody wears a dead key ───────────────────────────
--
-- Written as a general rule rather than as Noah's user id, so it is correct if anyone else turns
-- out to hold one by the time it runs.
--
-- The replacement is the best banner they ALREADY OWN, falling back to Hearthlight — which is
-- granted by DEFAULT_LOADOUT rather than as a row, so it is always available to everyone. Picking
-- a banner they do NOT own would be granting a cosmetic under cover of a cleanup migration, which
-- is not this file's business.
--
-- "Best" is an EXPLICIT KEY ORDER, not a rarity sort, because the database does not know rarity:
-- cosmetics_owned.rarity_override is null on all 18 banner rows on prod (it is an override, and
-- nothing has ever needed to override). Rarity lives in the client catalog. So the ladder is
-- written out here — mythic, then the three legendaries, then the two epics — and anything not
-- listed sorts last and breaks ties on most-recently-acquired.
update equipped_loadout el
   set cosmetic_key = coalesce(
     (
       select co.cosmetic_key
         from cosmetics_owned co
        where co.user_id = el.user_id
          and co.cosmetic_key like 'banner-%'
          and co.cosmetic_key not in ('banner-emberfall', 'banner-emberfall-elite')
        order by case co.cosmetic_key
                   when 'banner-emberfall-mythic' then 6      -- mythic
                   when 'banner-ashfall' then 5               -- legendary
                   when 'banner-obsidian-colosseum' then 4    -- legendary
                   when 'banner-the-great-forge' then 3       -- legendary
                   when 'banner-emberfall-night' then 2       -- epic
                   when 'banner-ashfall-ridge' then 1         -- epic
                   else 0
                 end desc,
                 co.acquired_at desc
        limit 1
     ),
     'banner-base-hearth'
   )
 where el.cosmetic_key in ('banner-emberfall', 'banner-emberfall-elite');

-- cosmetics_owned is DELIBERATELY NOT TOUCHED. The rows stay; the items are grandfathered. If they
-- are ever to be swept, that is a separate decision with a separate migration, and it should be
-- taken knowing that a dead key costs nothing but a fallback render.

-- ─────────────────────────── 3 · ⚠ LEFT FOR NOAH, ON PURPOSE ───────────────────────────
--
-- Two places still hand out banner-emberfall-elite, and BOTH are season placement rewards. What
-- Season 1's Top 10 and Top 1% should fly now that Emberfall Elite is cut is a product decision
-- about the season's reward ladder, not a cleanup, so this migration reports it rather than
-- guessing:
--
--   season_titles.banner_asset
--     ('S1','p1')     → 'banner-emberfall'         -- the Top 1% band's banner
--     ('S1','rank_2') → 'banner-emberfall-elite'
--     ('S1','rank_3') → 'banner-emberfall-elite'
--
--   grant_season_placement_rewards(), the `r.rank <= 10` branch, two literals:
--     economy_grant_cosmetic(..., 'banner-emberfall-elite', 'banner', 'legendary', 'earned', ...)
--     season_log_grant(...,        'banner-emberfall-elite', 'Emberfall Elite', 'legendary', ...)
--
-- THIS IS NOT URGENT AND THAT IS A MEASURED CLAIM, not an assumption: no season has ever settled
-- (0 rows in season_placement_closures, 0 in season_reward_grants), so neither has ever granted
-- anything to anyone. It becomes urgent the first time a season closes, at which point the Top 10
-- would be minted a key the client cannot name.
--
-- The fix once Noah picks a banner is three UPDATEs and one function restatement. Restating
-- grant_season_placement_rewards means retyping 5.5KB of live body to change two string literals,
-- which is exactly the clobber MIGRATIONS.md is about — so do it the way 0147 did: read the
-- CURRENT prosrc out of pg_proc, change only the literals, and diff the two before pushing.

-- ─────────────────────────── 4 · verification ───────────────────────────
--
-- NOTICEs, not assertions. A failed DO block would roll back the whole migration over a reporting
-- problem; these are for reading in the push output.
do $$
declare
  v_pass int;
  v_equipped int;
  v_owned int;
  v_season int;
begin
  select count(*) into v_pass from pass_track_rewards
   where item_key in ('banner-emberfall', 'banner-emberfall-elite');
  select count(*) into v_equipped from equipped_loadout
   where cosmetic_key in ('banner-emberfall', 'banner-emberfall-elite');
  select count(*) into v_owned from cosmetics_owned
   where cosmetic_key in ('banner-emberfall', 'banner-emberfall-elite');
  select count(*) into v_season from season_titles
   where banner_asset in ('banner-emberfall', 'banner-emberfall-elite');

  if v_pass = 0 then
    raise notice '0151 ok — no pass level grants a retired banner.';
  else
    raise notice '0151 WARNING — % pass_track_rewards row(s) still grant a retired banner.', v_pass;
  end if;

  if v_equipped = 0 then
    raise notice '0151 ok — nobody has a retired banner equipped.';
  else
    raise notice '0151 WARNING — % equipped_loadout row(s) still wear a retired banner.', v_equipped;
  end if;

  raise notice '0151 note — % cosmetics_owned row(s) keep a retired banner (grandfathered, expected).', v_owned;
  raise notice '0151 note — % season_titles row(s) still point at a retired banner (see §3, Noah decides).', v_season;
end;
$$;
