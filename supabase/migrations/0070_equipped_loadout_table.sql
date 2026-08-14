-- PUNCHLIST_13 — move the equipped loadout off cosmetics_owned and into its own table.
--
-- The old model put equip state on the OWNED ROW (`cosmetics_owned.slot` + `equipped` bool), which
-- makes "equipped" a property of the item. That can hold an item in exactly one slot, and the two
-- SFX slots need the same sting in both Start and End at once. Inverting it — the loadout is a map
-- of (user, slot) -> key, and the owned row only records ownership — makes any item equippable in
-- any number of slots and drops the swap logic to a single upsert.
--
-- cosmetics_owned.slot/equipped are deliberately LEFT IN PLACE rather than dropped: an app build
-- that predates this migration still reads them out of get_inventory, and dropping the columns
-- would take those clients down mid-rollout. They stop being authoritative here and can be dropped
-- in a later migration once the old builds are gone.

create table if not exists equipped_loadout (
  user_id uuid not null references profiles (id) on delete cascade,
  slot text not null,
  cosmetic_key text not null,
  equipped_at timestamptz not null default now(),
  primary key (user_id, slot)
);

create index if not exists equipped_loadout_user_idx on equipped_loadout (user_id);

alter table equipped_loadout enable row level security;

-- Readable by any signed-in user: equipped cosmetics are public by design (they're how other people
-- see you), and get_public_loadouts reads them for the feed and leaderboards. Writes go exclusively
-- through equip_cosmetic/unequip_cosmetic, which are security-definer and check ownership — there is
-- deliberately no insert/update/delete policy, so a client cannot equip something it doesn't own.
drop policy if exists equipped_loadout_read on equipped_loadout;
create policy equipped_loadout_read on equipped_loadout for select to authenticated using (true);

-- ── One-time backfill of the existing equip state ──────────────────────────────────────────────
-- 'sfx' became two slots (sfx_start/sfx_stop). Anyone with an SFX equipped chose it as their one
-- sting, so it carries into BOTH new slots — that reproduces the old single-sound behaviour at
-- start and end rather than silently emptying a slot the user had filled.
insert into equipped_loadout (user_id, slot, cosmetic_key)
select c.user_id, c.slot, c.cosmetic_key
from cosmetics_owned c
where c.equipped and c.slot is not null and c.slot <> 'sfx'
on conflict (user_id, slot) do nothing;

insert into equipped_loadout (user_id, slot, cosmetic_key)
select c.user_id, s.slot, c.cosmetic_key
from cosmetics_owned c
cross join (values ('sfx_start'), ('sfx_stop')) as s(slot)
where c.equipped and c.slot = 'sfx'
on conflict (user_id, slot) do nothing;

-- ── equip ──────────────────────────────────────────────────────────────────────────────────────
-- Ownership is checked HERE and nowhere else: the table has no write policy, so this function is
-- the only path in. Previously the check was implicit (the update simply matched no rows if you
-- didn't own the item, and failed silently); an explicit raise is what turns "nothing happened"
-- into an error the client can show.
drop function if exists equip_cosmetic(text, text);
create function equip_cosmetic(p_key text, p_slot text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then raise exception 'Not signed in'; end if;
  if p_slot is null then raise exception 'This item is showcase-only and cannot be equipped'; end if;
  if not exists (select 1 from cosmetics_owned where user_id = v_user and cosmetic_key = p_key) then
    raise exception 'You do not own this item';
  end if;

  insert into equipped_loadout (user_id, slot, cosmetic_key, equipped_at)
  values (v_user, p_slot, p_key, now())
  on conflict (user_id, slot) do update
    set cosmetic_key = excluded.cosmetic_key, equipped_at = excluded.equipped_at;
end;
$$;

-- ── unequip ────────────────────────────────────────────────────────────────────────────────────
-- Takes a SLOT, not a key (PUNCHLIST_13). With one item allowed in several slots, "unequip this
-- item" is ambiguous — the same sting in both SFX slots has to be removable from one and left in
-- the other. Same (text) arity as the old key-based version, so the old overload is dropped rather
-- than replaced: leaving it would let a stale client's unequip_cosmetic('flame-ember') silently
-- resolve here and delete whatever sits in a slot literally named after an item.
drop function if exists unequip_cosmetic(text);
create function unequip_cosmetic(p_slot text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then raise exception 'Not signed in'; end if;
  delete from equipped_loadout where user_id = v_user and slot = p_slot;
end;
$$;

-- ── salvage: keep "selling unequips it" true ───────────────────────────────────────────────────
-- The old version relied on the owned row being deleted, which took its equipped flag with it. Now
-- that the loadout is a separate table, deleting the row alone would leave a dangling (user, slot)
-- pointing at an item the user no longer owns — a phantom equipped flame. Rewritten to clear every
-- slot holding the key, which is also why it can't just be a foreign key: cosmetic_key isn't
-- unique on its own and the loadout has to survive being read by clients that don't know the item.
drop function if exists salvage_cosmetic(text, text);
create function salvage_cosmetic(p_key text, p_rarity text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_payout int;
begin
  if v_user is null then raise exception 'Not signed in'; end if;
  if not exists (select 1 from cosmetics_owned where user_id = v_user and cosmetic_key = p_key) then
    raise exception 'You do not own this item';
  end if;

  v_payout := ((select value from economy_config where key = 'salvage_embers') ->> p_rarity)::int;
  delete from equipped_loadout where user_id = v_user and cosmetic_key = p_key;
  delete from cosmetics_owned where user_id = v_user and cosmetic_key = p_key;
  perform economy_move_embers(v_user, v_payout, 'salvage', null);
  return jsonb_build_object('embers', v_payout);
end;
$$;

-- ── reads ──────────────────────────────────────────────────────────────────────────────────────
-- get_inventory gains a `loadout` object (slot -> key). `cosmetics[].equipped` is still emitted,
-- now DERIVED from the loadout, purely so an app build older than this migration keeps working
-- through the rollout; new clients read `loadout` and ignore it. It can't express "in two slots",
-- which is exactly why the new field exists.
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
    'loadout', coalesce((
      select jsonb_object_agg(e.slot, e.cosmetic_key)
      from equipped_loadout e where e.user_id = v_user
    ), '{}'::jsonb),
    'cosmetics', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', c.id, 'cosmetic_key', c.cosmetic_key, 'slot', c.slot,
        'source', c.source, 'provenance', c.provenance,
        -- Legacy shape for pre-0070 clients. A key in ANY slot reads as equipped.
        'equipped', exists (
          select 1 from equipped_loadout e
          where e.user_id = v_user and e.cosmetic_key = c.cosmetic_key
        ),
        'acquired_at', c.acquired_at,
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

-- Other people's equipped set. Same contract as 0067 (keys only, plus the public stamp/override),
-- but sourced from the loadout table. The join back to cosmetics_owned is what carries the stamp
-- and rarity override — those live on the grant, not on the slot.
drop function if exists get_public_loadouts(uuid[]);
create function get_public_loadouts(p_user_ids uuid[])
returns table (user_id uuid, slot text, cosmetic_key text, rarity_override text, season_stamp text)
language sql
security definer
set search_path = public
stable
as $$
  select e.user_id, e.slot, e.cosmetic_key, c.rarity_override, c.season_stamp
  from equipped_loadout e
  join profiles p on p.id = e.user_id
  left join cosmetics_owned c on c.user_id = e.user_id and c.cosmetic_key = e.cosmetic_key
  where e.user_id = any(p_user_ids)
    and not p.is_disabled;
$$;
