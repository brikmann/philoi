-- 0066 added cosmetics_owned.rarity_override / season_stamp for the 21j placement grants, but the
-- read paths were still built in 0064/0065 and don't select them — so a "Ascended · 🌍 GLOBAL #1"
-- would have rendered as a plain "Ascended". These are the two reads, updated.

drop function if exists get_inventory();
create function get_inventory()
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_user uuid := auth.uid();
  v_season text := (select value ->> 'id' from economy_config where key = 'season');
begin
  if v_user is null then
    raise exception 'Not signed in';
  end if;

  return jsonb_build_object(
    'embers', coalesce((select balance from ember_wallet where user_id = v_user), 0),
    'cosmetics', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', c.id, 'cosmetic_key', c.cosmetic_key, 'slot', c.slot,
        'source', c.source, 'provenance', c.provenance, 'equipped', c.equipped,
        'acquired_at', c.acquired_at,
        -- New in 0066: placement grants override the catalog rarity and carry a season stamp.
        'rarity_override', c.rarity_override, 'season_stamp', c.season_stamp
      ) order by c.acquired_at desc)
      from cosmetics_owned c where c.user_id = v_user
    ), '[]'::jsonb),
    'badges', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', b.id, 'badge_key', b.badge_key, 'source', b.source,
        'provenance', b.provenance, 'equipped', b.equipped, 'earned_at', b.earned_at
      ) order by b.earned_at desc)
      from owned_badges b where b.user_id = v_user
    ), '[]'::jsonb),
    'boxes', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', l.id, 'box_key', l.box_key, 'obtained_via', l.obtained_via, 'provenance', l.provenance
      ) order by l.created_at desc)
      from loot_boxes l where l.user_id = v_user and not l.opened
    ), '[]'::jsonb),
    'pass', jsonb_build_object(
      'season_id', v_season,
      'pass_xp', coalesce((select pass_xp from forge_pass_state where user_id = v_user and season_id = v_season), 0),
      'owns_premium', coalesce((select owns_premium from forge_pass_state where user_id = v_user and season_id = v_season), false),
      'claims', coalesce((
        select jsonb_agg(jsonb_build_object('tier', tier, 'lane', lane))
        from pass_claims where user_id = v_user and season_id = v_season
      ), '[]'::jsonb),
      'achievements', coalesce((
        select jsonb_agg(jsonb_build_object('key', achievement_key, 'period_key', period_key, 'xp', xp))
        from pass_xp_ledger where user_id = v_user and season_id = v_season
      ), '[]'::jsonb)
    )
  );
end;
$$;

-- Other people's equipped set. Still keys only — no balances, no unopened boxes, nothing sellable.
-- The stamp and rarity override ARE public, because a season title without its "🌍 GLOBAL #1" is
-- exactly the flex it exists to carry.
drop function if exists get_public_loadouts(uuid[]);
create function get_public_loadouts(p_user_ids uuid[])
returns table (user_id uuid, slot text, cosmetic_key text, rarity_override text, season_stamp text)
language sql
security definer
set search_path = public
stable
as $$
  select c.user_id, c.slot, c.cosmetic_key, c.rarity_override, c.season_stamp
  from cosmetics_owned c
  join profiles p on p.id = c.user_id
  where c.user_id = any(p_user_ids)
    and c.equipped
    and c.slot is not null
    and not p.is_disabled;
$$;
