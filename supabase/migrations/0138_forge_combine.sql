-- 0138 — The Forge (mocks 155/156). Tier-up combine: N owned cosmetics of one rarity become one
-- cosmetic of the next rarity up.
--
-- ─────────────────────────── what this is NOT ───────────────────────────
--
-- Not a new currency, not a crafting economy, not a resource system. There are no scraps as a
-- separate thing to hold, no ember cost, no yields to tune. "Scraps" is just the word for cosmetics
-- you own and do not want. The Forge siphons the item economy that already exists: it deletes rows
-- from cosmetics_owned and inserts one, and every price, pool and grant path it touches is one that
-- was already here.
--
-- That is why this migration is short despite being net-new. The only genuinely new fact in the
-- database is the ladder, and the only genuinely new code is the eligibility gate.
--
-- ─────────────────────────── the ladder ───────────────────────────
--
--   5 x Common     -> 1 Uncommon
--   3 x Uncommon   -> 1 Rare
--   3 x Rare       -> 1 Epic
--   3 x Epic       -> 1 Legendary
--   3 x Legendary  -> 1 Mythic
--
-- Five for the first step, three for every step after, all the way up. Mythic IS forgeable — it is
-- the top OUTPUT — and is never an input: there is no rung above it, so a call naming it as the
-- input rarity is refused rather than silently treated as legendary.
--
-- The output TIER is guaranteed. The gamble is WHICH item of that tier you get, rolled here, before
-- the hammer-strike animation plays a single frame — same ordering rule as open_loot_box (REWARD
-- ECONOMY §8.5): the server decides, the client visualises a decided outcome.
--
-- Ratios live in economy_config rather than as constants in this function, following the house rule
-- 0064 set out in its own header ("Amounts are deliberately NOT constants in these functions — they
-- read economy_config"). src/lib/economy/forge.ts keeps a display copy for rendering the recipe
-- tabs, exactly as boxes.ts mirrors box_odds; this is the one the grant obeys.
--
-- ─────────────────────────── 🔴 season items, in and out ───────────────────────────
--
-- The hard requirement: forging must never MINT a season-exclusive (which would break the season
-- grind's whole exclusivity) and must never CONSUME one by accident (which would eat something that
-- can no longer be re-earned). Both are one principle — the forge operates solely over the loot-box
-- drop pool, box_droppable_items, which 0090 already established as the server's authority on what a
-- box may ever produce.
--
--   OUTPUT  drawn from box_droppable_items at the target rarity. Season and Flame-Pass items are
--           granted with a season source (economy_grant_cosmetic(..., 'forge_pass'|'earned', ...) —
--           flare-emberfall-ascendant, card-emberfall-sovereign, the medals) and have never been in
--           that table, so 3 Legendary -> 1 Mythic can only ever roll one of the five drop-pool
--           mythics. Reusing the box's own pool rather than hand-listing them is the point: a
--           hand-list is a second source of truth that drifts, and the drift would be a minted
--           Emberfall Ascendant.
--
--   INPUT   must be a row the caller owns whose key is in box_droppable_items AT THE SELECTED
--           RARITY, and whose grant source is 'box' or 'paid'. Anything sourced 'earned' or
--           'forge_pass' is refused even if its key somehow appeared in the pool. Two gates for one
--           fact, deliberately: the key check is the strong one, the source check is what makes the
--           refusal say the right thing to the user.
--
-- Relics fall out of this for free — every relic is acquisition 'earned' and none is in
-- box_droppable_items — but the error message names them explicitly, because "relics are never
-- forged" is a rule players will test on purpose.
--
-- Starter/default-loadout items (#88) are likewise outside the drop pool and so ineligible, which is
-- the correct answer: 0064's own note on the default set is that salvaging one would leave a slot
-- that can never be filled again, and feeding one to the forge is the same deletion by another name.
--
-- ─────────────────────────── fails CLOSED, unlike open_loot_box ───────────────────────────
--
-- 0090's open_loot_box fails OPEN while box_droppable_items is empty — until the sync step has run
-- there is nothing to check against, and refusing every box open on deploy would be worse than
-- trusting the client's pool for a moment.
--
-- The forge must not copy that. With an empty allowlist, failing open here would mean no input gate
-- (any owned item becomes fuel, including relics and Emberfall mythics) and no output pool at all.
-- So an empty table refuses every forge with a message that names the deploy step. The whole
-- security model of this function is that table; running without it is not a degraded forge, it is
-- a different and much worse one.

-- ───────────────────────────── the ladder, server-side ─────────────────────────────

insert into economy_config (key, value) values
  ('forge_ratios', '{
     "common":    {"need": 5, "into": "uncommon"},
     "uncommon":  {"need": 3, "into": "rare"},
     "rare":      {"need": 3, "into": "epic"},
     "epic":      {"need": 3, "into": "legendary"},
     "legendary": {"need": 3, "into": "mythic"}
   }')
on conflict (key) do nothing;

-- ───────────────────────────── forge_combine ─────────────────────────────

/**
 * Consume N owned cosmetics of p_rarity and grant one of the next rarity up.
 *
 * p_item_ids are cosmetics_owned.id values, not cosmetic keys. The row id is the thing being
 * destroyed, so it is what the caller should have to name — and it makes "you selected the same
 * item three times" a distinguishable mistake rather than a silent one.
 *
 * Atomic by construction: this is one plpgsql function, therefore one transaction. There is no
 * ordering of the deletes and the grant that can leave items consumed with nothing granted, or a
 * grant with nothing consumed — either the whole combine commits or none of it did. A retry of a
 * call that already succeeded finds the rows gone and fails on ownership, which is the honest
 * outcome; this is not a token-keyed idempotent endpoint and does not pretend to be one.
 *
 * Returns the finished result for the reveal:
 *   { cosmetic_key, rarity, dupe, embers, input_rarity, consumed, consumed_keys }
 */
create or replace function forge_combine(p_rarity text, p_item_ids uuid[])
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_rarity text := lower(trim(coalesce(p_rarity, '')));
  v_recipe jsonb;
  v_need int;
  v_next text;
  v_ids uuid[];
  v_eligible int;
  v_owned int;
  v_bad_key text;
  v_pick text;
  v_consumed text[];
  v_result jsonb;
begin
  if v_user is null then raise exception 'Not signed in'; end if;

  -- Fail closed. See the header — an empty allowlist would disable both the input gate and the
  -- output pool at once, which is precisely the state that could mint or eat a season item.
  if not exists (select 1 from box_droppable_items) then
    raise exception 'The Forge is not available yet. (box_droppable_items is empty — run economy_set_droppable_items from the deploy step.)';
  end if;

  -- ── the recipe ──
  v_recipe := (select value from economy_config where key = 'forge_ratios') -> v_rarity;
  if v_recipe is null then
    -- Mythic lands here, and the message says why rather than "unknown rarity": it is the one
    -- rarity a player can reasonably expect to be an input, and "there is nothing above it" is the
    -- actual answer.
    if v_rarity = 'mythic' then
      raise exception 'Mythic is the top of the ladder — it can be forged, but never forged FROM';
    end if;
    raise exception 'Nothing can be forged from %', coalesce(nullif(v_rarity, ''), 'that');
  end if;
  v_need := (v_recipe ->> 'need')::int;
  v_next := v_recipe ->> 'into';

  -- ── the inputs ──
  -- Deduplicated first. Passing one item id five times is a wrong count, not a five-item combine,
  -- and catching it here is what stops the count check below from being satisfied by one row.
  select array_agg(distinct id) into v_ids from unnest(coalesce(p_item_ids, '{}'::uuid[])) id;
  v_ids := coalesce(v_ids, '{}'::uuid[]);

  if array_length(v_ids, 1) is distinct from v_need then
    raise exception 'This recipe takes % distinct %s, not %',
      v_need, v_rarity, coalesce(array_length(v_ids, 1), 0);
  end if;

  -- Locked before anything is checked, so two taps that race cannot both pass the count check and
  -- both consume the same three items. Under READ COMMITTED the second call re-qualifies its rows
  -- after the lock is granted; the deleted ones drop out and its own count check then fails.
  -- PERFORM rather than SELECT count(*): Postgres refuses FOR UPDATE alongside an aggregate, and
  -- the lock is the point of this statement — the count falls out of ROW_COUNT.
  perform 1 from cosmetics_owned co
  where co.id = any (v_ids) and co.user_id = v_user
  for update;
  get diagnostics v_owned = row_count;

  if v_owned <> v_need then
    raise exception '% of those % items are not in your inventory', v_need - v_owned, v_need;
  end if;

  -- Now the eligibility gate, stated as the count of rows that pass EVERY condition.
  select count(*) into v_eligible
  from cosmetics_owned co
  join box_droppable_items d
    on d.item_key = co.cosmetic_key and d.rarity = v_rarity
  where co.id = any (v_ids)
    and co.user_id = v_user
    and co.source in ('box', 'paid')
    -- A placement grant carries its own rarity, which is not the catalog's and not the pool's
    -- (0067/21j). Those are 'earned' and excluded already; this is belt-and-braces so a future
    -- override on a box-sourced row can never be fed in at the wrong tier.
    and co.rarity_override is null;

  if v_eligible <> v_need then
    -- Name the first offender rather than failing anonymously. A user who selected something the
    -- client should not have offered deserves to know which item, and so does the bug report.
    select co.cosmetic_key into v_bad_key
    from cosmetics_owned co
    where co.id = any (v_ids)
      and co.user_id = v_user
      and (
        -- sourced from a season/earned grant rather than the drop pool
        co.source not in ('box', 'paid')
        -- a placement grant wearing a rarity that is not the pool's
        or co.rarity_override is not null
        -- not in the drop pool at all, or in it at a different tier than the one selected
        or not exists (
          select 1 from box_droppable_items d
          where d.item_key = co.cosmetic_key and d.rarity = v_rarity
        )
      )
    limit 1;

    if v_bad_key like 'relic-%' then
      raise exception 'Relics are never forged — % is earned, not fuel', v_bad_key;
    end if;
    raise exception 'Not eligible as % fuel: % (season and Flame Pass items, starter gear and relics stay out of the Forge)',
      v_rarity, coalesce(v_bad_key, 'one of those items');
  end if;

  -- ── the roll ──
  -- Un-owned first, which is what mock 155 promises on the screen itself ("a random Epic YOU DON'T
  -- OWN"). It also has to be this way round to be worth doing at all: cosmetics_owned is unique on
  -- (user_id, cosmetic_key), so there is no such thing as holding two copies — a "dupe" output is
  -- not more forge fuel, it is economy_grant_cosmetic auto-salvaging to embers. Rolling blind at
  -- Mythic, where the pool is five items, would hand embers to anyone holding four of them most of
  -- the time, for three Legendaries.
  select d.item_key into v_pick
  from box_droppable_items d
  where d.rarity = v_next
    and not exists (
      select 1 from cosmetics_owned co
      where co.user_id = v_user and co.cosmetic_key = d.item_key
    )
  order by random()
  limit 1;

  -- Nothing left un-owned at that tier: fall back to the full pool. The grant then salvages to
  -- embers, and the reveal says so — a completionist who owns every Mythic still gets something for
  -- three Legendaries rather than a dead end.
  if v_pick is null then
    select d.item_key into v_pick
    from box_droppable_items d
    where d.rarity = v_next
    order by random()
    limit 1;
  end if;

  if v_pick is null then
    raise exception 'The Forge has nothing to make at % yet', v_next;
  end if;

  -- ── consume, then grant ──
  select array_agg(co.cosmetic_key) into v_consumed
  from cosmetics_owned co where co.id = any (v_ids) and co.user_id = v_user;

  -- Clear the loadout first, for the reason 0070 spelled out when it rewrote salvage_cosmetic:
  -- deleting the owned row alone leaves a dangling (user, slot) pointing at an item the user no
  -- longer has — a phantom equipped flame.
  delete from equipped_loadout el
  where el.user_id = v_user and el.cosmetic_key = any (v_consumed);

  delete from cosmetics_owned co where co.id = any (v_ids) and co.user_id = v_user;

  -- Slot is null, matching open_loot_box: the client derives the slot from the catalog, and the
  -- partial unique index on (user_id, slot) only applies to equipped rows anyway.
  --
  -- Source 'box' rather than a new item_source value. It is accurate — a forged item is a drop-pool
  -- item — and it is what keeps a forged item re-forgeable, since the input gate reads exactly this
  -- field. The provenance line is where "this came out of the Forge" is recorded.
  v_result := economy_grant_cosmetic(
    v_user, v_pick, null, v_next, 'box',
    format('Forged from %s x %s', v_need, initcap(v_rarity))
  );

  return v_result || jsonb_build_object(
    'input_rarity', v_rarity,
    'consumed', v_need,
    'consumed_keys', to_jsonb(v_consumed)
  );
end;
$$;

-- ───────────────────────────── grants (the post-#151 rule) ─────────────────────────────
--
-- 0132's finding was that Postgres gives PUBLIC execute on a new function by default, so every
-- economy function written since inherited a client-facing grant nobody asked for. This one is a
-- real RPC and does need `authenticated` — but it must not reach `anon`, and revoking the two named
-- roles without revoking PUBLIC would look closed and stay open, since both roles are members of
-- PUBLIC.
revoke all on function forge_combine(text, uuid[]) from public, anon, authenticated;
grant execute on function forge_combine(text, uuid[]) to authenticated;

-- ───────────────────────────── proof, in the migration ─────────────────────────────

-- 1. The grants, both directions. A migration that reports success on a function anon can still
--    call has not done its job.
do $assert_grants$
declare
  v_fn oid;
begin
  select p.oid into v_fn
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'forge_combine';

  if v_fn is null then raise exception 'forge_combine was not created'; end if;

  if not has_function_privilege('authenticated', v_fn, 'EXECUTE') then
    raise exception 'forge_combine is not callable by authenticated — the screen would 404';
  end if;
  if has_function_privilege('anon', v_fn, 'EXECUTE') then
    raise exception 'forge_combine is callable by anon';
  end if;
  -- PUBLIC checked separately: anon and authenticated are both members of it, so a lingering
  -- PUBLIC grant is invisible in the two checks above once the explicit grant is in place.
  if exists (
    select 1 from pg_proc p, aclexplode(p.proacl) a
    where p.oid = v_fn and a.grantee = 0 and a.privilege_type = 'EXECUTE'
  ) then
    raise exception 'forge_combine still carries the default PUBLIC execute grant';
  end if;
end;
$assert_grants$;

-- 2. Additive-only (the wave rule). This migration restates no existing function, so every economy
--    function it builds on must still be exactly what its own migration left behind. Checked by
--    substring against the load-bearing line of each, which is what would actually go missing if a
--    parallel branch's CREATE OR REPLACE were restated from an older base.
do $assert_additive$
declare
  v_src text;
begin
  select prosrc into v_src from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'economy_grant_cosmetic';
  if v_src is null or v_src not like '%salvage_embers%' then
    raise exception 'economy_grant_cosmetic is missing or no longer auto-salvages dupes';
  end if;

  select prosrc into v_src from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'open_loot_box';
  if v_src is null or v_src not like '%box_droppable_items%' then
    raise exception 'open_loot_box no longer intersects the drop-pool allowlist (0090 reverted?)';
  end if;

  select prosrc into v_src from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'salvage_cosmetic';
  if v_src is null or v_src not like '%equipped_loadout%' then
    raise exception 'salvage_cosmetic no longer clears the loadout (0070 reverted?)';
  end if;
end;
$assert_additive$;

-- 3. The season guarantee, asserted against the real table rather than trusted. If any key the
--    season grants ever appears in the drop pool, forging could mint it — so the deploy fails here
--    instead of the day someone forges an Emberfall Ascendant.
do $assert_season$
declare
  v_leak text;
begin
  select string_agg(k, ', ') into v_leak
  from unnest(array[
    'flare-emberfall-ascendant', 'flame-forge',
    'card-emberfall-sovereign', 'medal-emberfall-champion',
    'banner-emberfall-elite', 'particle-emberfall-ascendant',
    'medal-emberfall-centurion', 'medal-emberfall-participant',
    'title-emberfall-initiate', 'title-s1-warming-up'
  ]) k
  where exists (select 1 from box_droppable_items d where d.item_key = k);

  if v_leak is not null then
    raise exception 'season-exclusive keys are in the box drop pool and would become forgeable: %', v_leak;
  end if;

  -- Same check for relics, which the forge refuses by the same mechanism.
  select string_agg(d.item_key, ', ') into v_leak
  from box_droppable_items d where d.item_key like 'relic-%';
  if v_leak is not null then
    raise exception 'relics are in the box drop pool: %', v_leak;
  end if;
end;
$assert_season$;

-- 4. 🔴 The Common rung is currently UNREACHABLE, and this says so out loud rather than shipping a
--    tab that can never be satisfied in silence.
--
--    5 x Common -> 1 Uncommon needs five distinct commons in the drop pool. There are four:
--    title-kindled, title-ember-stoker, title-night-owl, title-locked-in. Every other common in the
--    catalog is 'default' (the starter loadout, ineligible by design) or 'earned'
--    (medal-emberfall-participant, ineligible by design). And cosmetics_owned is unique on
--    (user_id, cosmetic_key), so nobody can hold a fifth by holding a duplicate.
--
--    Deliberately a NOTICE, not an exception: the ladder is Noah's and is written down correctly
--    here, the recipe works the moment a fifth common enters the drop pool, and failing the deploy
--    over a content gap would be the tail wagging the dog. The client greys the tab and says the
--    same thing on screen.
do $notice_common$
declare
  v_commons int;
begin
  select count(*) into v_commons from box_droppable_items where rarity = 'common';
  if v_commons < 5 then
    raise notice 'FORGE: 5 x Common -> 1 Uncommon is unreachable — the drop pool holds % common item(s), and cosmetics_owned allows one row per key. Add a fifth droppable common to open the rung.', v_commons;
  end if;
end;
$notice_common$;
