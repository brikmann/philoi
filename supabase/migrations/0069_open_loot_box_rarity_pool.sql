-- Punchlist 8 §1 — open_loot_box was picking its item from the WHOLE cross-rarity pool.
--
-- 0064 documented p_pool as "the caller's candidate item ids AT THAT RARITY", but the client cannot
-- know the rarity before it calls (the server rolls it), so src/lib/api/inventory.ts sent every
-- rarity's ids concatenated into one flat array. The body then did
--
--   select p into v_pick from unnest(p_pool) p order by random() limit 1;
--
-- which picks uniformly across all ~61 box items with no reference to v_rarity, and grants it
-- labelled with v_rarity anyway. Two things break from that:
--
--   1. The published odds are a lie in the direction that matters most. An 8,000-ember Promethean
--      rolls Mythic 12% of the time and then hands over whatever the flat pick landed on — Common
--      included. `rolled_rarity` and the item's real catalog rarity disagree on nearly every open.
--   2. Salvage is mispriced. economy_grant_cosmetic is paid p_rarity, not the item's own rarity, so
--      a dupe Common pulled from a Mythic roll auto-salvages for the Mythic payout (2,000 embers
--      against a 40-ember item) — an ember faucet straight through the flagship box.
--
-- Fixed by making the pool a rarity -> ids MAP. The server still owns the roll and still chooses
-- WHICH item within the tier; the client just can't collapse the tiers any more. Sending the map
-- rather than moving the catalog into Postgres keeps 0064's original trade-off intact.
--
-- Signature change (text[] -> jsonb), so the old overload is DROPPED, not replaced: leaving both
-- would give PostgREST two candidates to resolve between and old clients would keep hitting the
-- broken one.

drop function if exists open_loot_box(uuid, text[]);
drop function if exists open_loot_box(uuid, jsonb);

create function open_loot_box(p_box_id uuid, p_pool jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_box loot_boxes;
  v_rarity text;
  v_pick text;
  v_bucket jsonb;
  -- Descending, so a tier this build's catalog can't fill steps DOWN to the next one it can.
  v_ladder text[] := array['mythic', 'legendary', 'epic', 'rare', 'uncommon', 'common'];
  v_i int;
begin
  if v_user is null then raise exception 'Not signed in'; end if;
  if p_pool is null or jsonb_typeof(p_pool) <> 'object' then
    raise exception 'Drop pool must be a rarity -> item-id object';
  end if;

  -- Locked so a double-tap can't open the same box twice.
  select * into v_box from loot_boxes where id = p_box_id and user_id = v_user and not opened for update;
  if v_box.id is null then raise exception 'Box not found or already opened'; end if;

  v_rarity := economy_roll_rarity(v_user, v_box.box_key);
  v_bucket := p_pool -> v_rarity;

  -- A rolled tier with no items in it is a catalog/app-version mismatch, not a user error, and the
  -- box has already been paid for. Step down to the nearest tier that CAN be filled and report that
  -- as rolled_rarity, so the grant, the salvage price and what the screen shows all agree.
  if v_bucket is null or jsonb_typeof(v_bucket) <> 'array' or jsonb_array_length(v_bucket) = 0 then
    for v_i in coalesce(array_position(v_ladder, v_rarity), 1) + 1 .. array_length(v_ladder, 1) loop
      if jsonb_typeof(p_pool -> v_ladder[v_i]) = 'array'
         and jsonb_array_length(p_pool -> v_ladder[v_i]) > 0 then
        v_rarity := v_ladder[v_i];
        v_bucket := p_pool -> v_rarity;
        exit;
      end if;
    end loop;
  end if;

  if v_bucket is null or jsonb_typeof(v_bucket) <> 'array' or jsonb_array_length(v_bucket) = 0 then
    raise exception 'Empty drop pool for rarity %', v_rarity;
  end if;

  select e into v_pick from jsonb_array_elements_text(v_bucket) e order by random() limit 1;
  if v_pick is null then raise exception 'Empty drop pool for rarity %', v_rarity; end if;

  update loot_boxes set opened = true, opened_at = now() where id = p_box_id;

  return economy_grant_cosmetic(v_user, v_pick, null, v_rarity, 'box', v_box.provenance)
         || jsonb_build_object('box_key', v_box.box_key, 'rolled_rarity', v_rarity);
end;
$$;
