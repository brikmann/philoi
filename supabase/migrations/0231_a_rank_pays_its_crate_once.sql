-- 0231 — a rank pays its crate once. 🎁 Part B of the lifetime climb (0230 is Part A).
--
-- ─────────────────────────────── WHY ───────────────────────────────
--
-- After 0230 rank never resets, and on 0203's curve it is a ~2,500 h climb. 0121 paid every
-- crossing one of three flat rows (division 100 / tier 300 / primordial 1,200 embers + a box),
-- so Bronze II and Immortal II paid the same. A multi-year grind needs every rung to pay, and to
-- pay more the higher it is.
--
-- ─────────────────────────────── WHAT CHANGES ───────────────────────────────
--
-- 1. rank_rung_crates — one row per rung, rank_index 1..27 (0 = Bronze I, the start, has none).
--    embers, pass_xp, box_key, and exclusive_item_key on the nine TIER ENTRIES only (Silver I,
--    Gold I, Platinum I, Diamond I, Hero I, Titan I, Divine I, Immortal I, Primordial). Server-
--    authored, select-only for clients. rank_up_rewards (0121) is RETIRED: nothing pays from it
--    after this file. It is left in place, not dropped, because dropping a table an installed
--    build could still select from is a crash for no gain.
--
--    Curves (TUNABLE — re-cut this table, nothing else):
--      embers   150 → 6,000   constant ratio (~15.3% per rung), rounded to 25. Σ 44,400.
--      pass_xp  200 → 2,500   constant ratio (~10.2% per rung), rounded to 25. Σ 25,075.
--      box      Bronze/Silver kindling · Gold/Platinum furnace · Diamond/Hero hestia
--               · Titan/Divine hephaestus · Immortal/Primordial promethean (the Vault).
--    Against the live economy: lock-ins pay ≤150 embers/day (ember_earn.daily_cap), so the whole
--    ladder is ~18 embers per climbed hour on top — a bonus, not a second faucet. The Primordial
--    crate (6,000 + a Vault, list 8,000) sits after a single 1,400 h step.
--
-- 2. rank_crate_grants — the once-ever ledger, PK (user_id, rank_index). No season key: rank
--    never resets, so each rung is crossed once in a lifetime. The insert claims the rung, and
--    only the session whose insert landed pays it, so concurrent check-ins cannot double-pay.
--
--    🔴 IT IS NOT KEYED ON user_rank_state. That high-water mark is STALE-HIGH on prod from the
--    pre-0203 thresholds (a peak of 12 on a score that maps to 7; a peak of 6 on a 2), and
--    economy_track_rank_change returns early until the score passes it. A crate path behind that
--    early return would pay those users nothing for five rungs they are now really climbing. So the
--    crate check runs on the SCORE-derived index, before the early return.
--
-- 3. NO RETROACTIVE DUMP (product default). Every existing profile is seeded with `baseline` rows
--    for rungs 1..rank_index_for_score(universal_score) — the rungs they already stand on are
--    marked crossed and pay nothing. Their next new rung pays. A profile created after this file has
--    no baseline, so every rung it climbs pays.
--
-- 4. economy_track_rank_change — restated from 0227's body. Detection, rank_up_events and 0227's
--    retirement of the flat 'season_new_rank' 500 are unchanged. The 0121 flat reward block is replaced
--    by one call to economy_grant_rank_crates(user, score index).
--
-- 5. economy_grant_rank_crates — per new rung: embers ('season_reward'), Pass XP via
--    economy_credit_pass_xp_for(user, 'rank_reward:<i>', xp, season) into pass_xp_ledger /
--    forge_pass_state (the Pass's own ledger; season-gated, so out of season it records 0), the box
--    via the same loot_boxes insert 0121 used (provenance names the crate: "Diamond I Box"), the
--    exclusive via economy_grant_cosmetic, and the 'ranked_up' bell row.
--
-- 6. Reads. get_my_last_rank_up_reward (0142) keeps its exact signature and columns — installed
--    builds call it — and now reads the crate that was actually paid. get_my_recent_rank_crates()
--    is the new build's read: every crate of the last 7 days with pass XP, box id and exclusive.
--
-- Installed builds: the bell keeps payload.rank in 0121's format (notifications.tsx parses the
-- numeral as the STORED division), the nine flames are unknown keys there and are skipped by
-- inventory and collection (both drop keys they have no entry for), and an unknown pass ledger key
-- is ignored by the old Pass screen. Nothing an old build reads changes shape.
--
-- The nine exclusives are 'earned': out of box_droppable_items (asserted below), out of the client
-- boxPool() and direct-buy row, and unsellable (0213 fences salvage of source 'earned').
--
-- NOTE: no explicit begin/commit — the migration runs in its own transaction.

-- ── base check · the trigger body restated below is 0227's ──
do $base$
declare
  v_live text;
begin
  select md5(replace(p.prosrc, chr(13), '')) into v_live
  from pg_proc p where p.proname = 'economy_track_rank_change' and p.pronamespace = 'public'::regnamespace;
  if v_live is distinct from '3f589cda8634b063ac2781857b45e22e' then
    raise exception '0231: live economy_track_rank_change is not 0227''s body (md5 %) — rebase onto it', v_live;
  end if;
end;
$base$;

-- ═══════════════════════════════ 1 · the crates ═══════════════════════════════

create table if not exists rank_rung_crates (
  rank_index int primary key references rank_thresholds (rank_index) check (rank_index between 1 and 27),
  embers int not null check (embers >= 0),
  pass_xp int not null check (pass_xp >= 0),
  box_key text not null,
  exclusive_item_key text
);

alter table rank_rung_crates enable row level security;
drop policy if exists rank_rung_crates_read on rank_rung_crates;
-- "What does the next rung pay" is a question the client should be able to answer before the fact.
create policy rank_rung_crates_read on rank_rung_crates for select to authenticated using (true);

insert into rank_rung_crates (rank_index, embers, pass_xp, box_key, exclusive_item_key) values
  -- bronze
  (1,   150,  200, 'kindling',   null),
  (2,   175,  225, 'kindling',   null),
  -- silver
  (3,   200,  250, 'kindling',   'flame-rank-silver'),
  (4,   225,  275, 'kindling',   null),
  (5,   275,  300, 'kindling',   null),
  -- gold
  (6,   300,  325, 'furnace',    'flame-rank-gold'),
  (7,   350,  350, 'furnace',    null),
  (8,   400,  400, 'furnace',    null),
  -- platinum
  (9,   475,  425, 'furnace',    'flame-rank-platinum'),
  (10,  550,  475, 'furnace',    null),
  (11,  625,  525, 'furnace',    null),
  -- diamond
  (12,  725,  575, 'hestia',     'flame-rank-diamond'),
  (13,  825,  650, 'hestia',     null),
  (14,  950,  700, 'hestia',     null),
  -- hero
  (15, 1100,  775, 'hestia',     'flame-rank-hero'),
  (16, 1250,  850, 'hestia',     null),
  (17, 1450,  950, 'hestia',     null),
  -- titan
  (18, 1675, 1050, 'hephaestus', 'flame-rank-titan'),
  (19, 1925, 1150, 'hephaestus', null),
  (20, 2225, 1275, 'hephaestus', null),
  -- divine ('olympian' is the enum key)
  (21, 2550, 1400, 'hephaestus', 'flame-rank-divine'),
  (22, 2950, 1550, 'hephaestus', null),
  (23, 3400, 1700, 'hephaestus', null),
  -- immortal
  (24, 3925, 1875, 'promethean', 'flame-rank-immortal'),
  (25, 4525, 2050, 'promethean', null),
  (26, 5200, 2275, 'promethean', null),
  -- primordial
  (27, 6000, 2500, 'promethean', 'flame-rank-primordial')
on conflict (rank_index) do update set
  embers = excluded.embers,
  pass_xp = excluded.pass_xp,
  box_key = excluded.box_key,
  exclusive_item_key = excluded.exclusive_item_key;

-- The nine exclusives' sale price (0213 reads this table). An UPSERT of these nine only: 0232
-- carries the full catalog re-seed that scripts/check-cosmetic-rarity.js reads, and nothing here
-- deletes a row.
insert into cosmetic_rarity (cosmetic_key, rarity) values
  ('flame-rank-silver', 'rare'),
  ('flame-rank-gold', 'rare'),
  ('flame-rank-platinum', 'epic'),
  ('flame-rank-diamond', 'epic'),
  ('flame-rank-hero', 'legendary'),
  ('flame-rank-titan', 'legendary'),
  ('flame-rank-divine', 'legendary'),
  ('flame-rank-immortal', 'mythic'),
  ('flame-rank-primordial', 'mythic')
on conflict (cosmetic_key) do update set rarity = excluded.rarity;

-- ═══════════════════════════════ 2 · the once-ever ledger ═══════════════════════════════

create table if not exists rank_crate_grants (
  user_id uuid not null references profiles (id) on delete cascade,
  rank_index int not null references rank_rung_crates (rank_index),
  -- true = the rung was already under the user when 0231 shipped; marked crossed, paid nothing.
  baseline boolean not null default false,
  -- What was actually paid (0 / null on a baseline row, and pass_xp 0 when no season was live).
  embers int not null default 0,
  pass_xp int not null default 0,
  box_key text,
  box_id uuid,
  exclusive_item_key text,
  granted_at timestamptz not null default now(),
  primary key (user_id, rank_index)
);

alter table rank_crate_grants enable row level security;
drop policy if exists rank_crate_grants_read_own on rank_crate_grants;
create policy rank_crate_grants_read_own on rank_crate_grants
  for select to authenticated using (user_id = auth.uid());

-- 3 · the baseline. Score-derived, NOT user_rank_state (see header).
insert into rank_crate_grants (user_id, rank_index, baseline)
select p.id, c.rank_index, true
from profiles p
cross join lateral (select rank_index_for_score(universal_score(p.id)) as idx) s
join rank_rung_crates c on c.rank_index <= coalesce(s.idx, 0)
on conflict (user_id, rank_index) do nothing;

-- ═══════════════════════════════ helpers ═══════════════════════════════

-- The DISPLAY label: "Diamond I" for stored division 3 (rank-tiers.ts DIVISION_NUMERAL), "Divine"
-- for the 'olympian' key, bare "Primordial".
create or replace function rank_display_label(p_rank_index int)
returns text
language sql
stable
set search_path = public
as $$
  select case
    when t.tier = 'primordial' then 'Primordial'
    else (case t.tier when 'olympian' then 'Divine' else initcap(t.tier) end)
         || ' ' || (case t.division when 3 then 'I' when 2 then 'II' else 'III' end)
  end
  from rank_thresholds t
  where t.rank_index = p_rank_index;
$$;

-- ═══════════════════════════════ 5 · the grant ═══════════════════════════════

create or replace function economy_grant_rank_crates(p_user uuid, p_index int)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  v_live boolean := season_phase() = 'live';
  v_season text := season_config() ->> 'id';
  v_label text;
  v_legacy text;
  v_kind text;
  v_pass int;
  v_box uuid;
  v_n int := 0;
begin
  if p_user is null or coalesce(p_index, 0) < 1 then return 0; end if;

  for r in
    select c.rank_index, c.embers, c.pass_xp, c.box_key, c.exclusive_item_key, t.tier, t.division
    from rank_rung_crates c
    join rank_thresholds t on t.rank_index = c.rank_index
    where c.rank_index <= p_index
      and not exists (select 1 from rank_crate_grants g
                      where g.user_id = p_user and g.rank_index = c.rank_index)
    order by c.rank_index
  loop
    -- Claim the rung. Only the insert that lands pays — a concurrent check-in that loses the race
    -- skips it.
    insert into rank_crate_grants (user_id, rank_index) values (p_user, r.rank_index)
    on conflict (user_id, rank_index) do nothing;
    if not found then continue; end if;

    v_label := rank_display_label(r.rank_index);

    if r.embers > 0 then
      perform economy_move_embers(p_user, r.embers, 'season_reward'::ember_reason, null);
    end if;

    -- Season-gated inside economy_credit_pass_xp_for; record what actually landed.
    v_pass := case when v_live then r.pass_xp else 0 end;
    if v_pass > 0 then
      perform economy_credit_pass_xp_for(p_user, 'rank_reward:' || r.rank_index, v_pass, v_season);
    end if;

    insert into loot_boxes (user_id, box_key, obtained_via, provenance)
    values (p_user, r.box_key, 'season'::box_obtained_via, v_label || ' Box')
    returning id into v_box;

    if r.exclusive_item_key is not null then
      perform economy_grant_cosmetic(
        p_user, r.exclusive_item_key, 'flame',
        coalesce((select cr.rarity from cosmetic_rarity cr where cr.cosmetic_key = r.exclusive_item_key), 'rare'),
        'earned'::item_source, 'Rank set · ' || v_label
      );
    end if;

    update rank_crate_grants
    set embers = r.embers, pass_xp = v_pass, box_key = r.box_key, box_id = v_box,
        exclusive_item_key = r.exclusive_item_key
    where user_id = p_user and rank_index = r.rank_index;

    v_kind := case when r.tier = 'primordial' then 'primordial'
                   when r.exclusive_item_key is not null then 'tier'
                   else 'division' end;
    -- 0121's format, which notifications.tsx parses as the STORED division ("Gold III" = stored 3).
    -- Kept byte-compatible so the bell badge on installed builds still draws the right rung.
    v_legacy := initcap(r.tier) || case when r.tier = 'primordial' then ''
                  else ' ' || (array['', 'I', 'II', 'III'])[r.division + 1] end;

    -- actor null: notify_event drops a recipient equal to the actor (0120).
    perform notify_event(
      array[p_user], 'ranked_up',
      '⚔️ You ranked up — ' || v_label,
      case v_kind
        when 'primordial' then 'You reached Primordial. The ' || v_label || ' Box, +' || r.embers
                               || ' embers and The First Fire are yours.'
        when 'tier'       then 'A new tier. The ' || v_label || ' Box, +' || r.embers
                               || ' embers and a flame only climbers wear.'
        else                   'Up a division. The ' || v_label || ' Box and +' || r.embers || ' embers.'
      end,
      null, null,
      '/inventory', '{}'::jsonb,
      null, 'hexagon',
      jsonb_build_object('embers', r.embers, 'box', r.box_key, 'box_id', v_box,
                         'pass_xp', v_pass, 'exclusive', r.exclusive_item_key,
                         'rank', v_legacy, 'label', v_label, 'kind', v_kind,
                         'to_rank_index', r.rank_index)
    );

    v_n := v_n + 1;
  end loop;

  return v_n;
end;
$$;

-- ═══════════════════════════════ 4 · the trigger ═══════════════════════════════
-- Restated from 0227's body. Edits marked 0231.

create or replace function public.economy_track_rank_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_score numeric;
  v_index int;
  v_prev int;
  v_from record;
  v_to record;
  v_season text := (select value ->> 'id' from economy_config where key = 'season');
begin
  v_score := universal_score(new.user_id);
  v_index := rank_index_for_score(v_score);
  if v_index is null then return new; end if;

  select rank_index into v_prev from user_rank_state where user_id = new.user_id;

  insert into user_rank_state (user_id, rank_index) values (new.user_id, v_index)
  on conflict (user_id) do update
    set rank_index = greatest(user_rank_state.rank_index, excluded.rank_index),
        updated_at = now();

  -- 0231: the crates. On the SCORE index and BEFORE the early return below, because
  -- user_rank_state is stale-high for pre-0203 users. Once-ever per rung (rank_crate_grants), and a
  -- no-op on every check-in that does not reach a new rung.
  perform economy_grant_rank_crates(new.user_id, v_index);

  -- First sighting establishes the baseline without claiming a rank-up for the whole history.
  if v_prev is null or v_index <= v_prev then return new; end if;

  select tier, division into v_to   from rank_thresholds where rank_index = v_index;
  select tier, division into v_from from rank_thresholds where rank_index = v_prev;

  insert into rank_up_events (user_id, from_rank_index, to_rank_index,
                              from_tier, from_division, to_tier, to_division, season_id)
  values (new.user_id, v_prev, v_index, v_from.tier, v_from.division,
          v_to.tier, v_to.division, v_season);

  -- 0227: the flat 'season_new_rank' 500 Pass XP that lived here is retired — 0231's rank crate
  -- pays Pass XP per rung instead.

  -- 0231: 0121's flat division / tier / primordial reward and its bell row lived here. Both now
  -- come from economy_grant_rank_crates above, per rung.
  return new;
end;
$function$;

-- ═══════════════════════════════ 6 · the reads ═══════════════════════════════

-- 0142's read, same signature and columns (installed builds call it), now over what was PAID.
-- kind is re-derived so an old celebration still picks its copy: tier entry → 'tier'.
create or replace function get_my_last_rank_up_reward()
returns table (
  kind text,
  embers int,
  box_key text,
  to_tier text,
  to_division int,
  awarded_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  -- 🔴 Every column qualified: RETURNS TABLE's OUT params shadow same-named columns.
  select
    case when t.tier = 'primordial' then 'primordial'
         when g.exclusive_item_key is not null then 'tier'
         else 'division' end,
    g.embers,
    g.box_key,
    t.tier,
    t.division,
    g.granted_at
  from rank_crate_grants g
  join rank_thresholds t on t.rank_index = g.rank_index
  where g.user_id = auth.uid() and not g.baseline
  order by g.granted_at desc, g.rank_index desc
  limit 1;
$$;

-- The new build's read: every crate paid in the last 7 days, highest rung first. The watcher keeps
-- the ones between the rank it last showed and the rank it is celebrating. jsonb, not RETURNS
-- TABLE, so no OUT parameter can shadow a column.
create or replace function get_my_recent_rank_crates()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(to_jsonb(x) order by x.rank_index desc), '[]'::jsonb)
  from (
    select g.rank_index, rank_display_label(g.rank_index) as label, t.tier, t.division,
           g.embers, g.pass_xp, g.box_key, g.box_id, g.exclusive_item_key, g.granted_at
    from rank_crate_grants g
    join rank_thresholds t on t.rank_index = g.rank_index
    where g.user_id = auth.uid() and not g.baseline
      and g.granted_at > now() - interval '7 days'
    order by g.rank_index desc
    limit 30
  ) x;
$$;

revoke all on function economy_grant_rank_crates(uuid, int) from public, anon, authenticated;
revoke all on function rank_display_label(int) from public, anon, authenticated;
revoke all on function get_my_recent_rank_crates() from public, anon;
grant execute on function get_my_recent_rank_crates() to authenticated;
-- get_my_last_rank_up_reward keeps its grants: same signature, so create or replace preserves them.

-- ═══════════════════════════════ ASSERT ═══════════════════════════════
do $assert$
begin
  if (select count(*) from rank_rung_crates) <> 27
     or exists (select 1 from rank_thresholds t where t.rank_index between 1 and 27
                and not exists (select 1 from rank_rung_crates c where c.rank_index = t.rank_index)) then
    raise exception '0231: rank_rung_crates does not cover rungs 1..27';
  end if;

  -- Exclusives on exactly the nine tier entries: the cheapest rung of a tier (stored division 3),
  -- or Primordial.
  if exists (
    select 1 from rank_rung_crates c join rank_thresholds t using (rank_index)
    where (c.exclusive_item_key is not null) <> (t.division = 3 or t.tier = 'primordial')
  ) or (select count(*) from rank_rung_crates where exclusive_item_key is not null) <> 9 then
    raise exception '0231: exclusives are not on exactly the nine tier entries';
  end if;

  if exists (select 1 from rank_rung_crates c where c.exclusive_item_key is not null
             and not exists (select 1 from cosmetic_rarity cr where cr.cosmetic_key = c.exclusive_item_key)) then
    raise exception '0231: an exclusive has no cosmetic_rarity row';
  end if;

  if exists (select 1 from box_droppable_items d
             join rank_rung_crates c on c.exclusive_item_key = d.item_key) then
    raise exception '0231: a rank-set exclusive is in a box drop pool';
  end if;

  if exists (select 1 from rank_rung_crates c
             where not ((select value from economy_config where key = 'box_price') ? c.box_key)) then
    raise exception '0231: a crate names an unknown box_key';
  end if;

  -- Monotone: no rung pays less than the one below it.
  if exists (select 1 from rank_rung_crates a join rank_rung_crates b on b.rank_index = a.rank_index + 1
             where b.embers < a.embers or b.pass_xp < a.pass_xp) then
    raise exception '0231: a crate pays less than the rung below it';
  end if;

  if not exists (
    select 1 from pg_trigger
    where tgname = 'on_check_in_rank_tracking' and tgfoid = 'economy_track_rank_change()'::regprocedure
  ) then
    raise exception '0231: on_check_in_rank_tracking no longer calls economy_track_rank_change';
  end if;

  if has_function_privilege('authenticated', 'economy_grant_rank_crates(uuid,integer)'::regprocedure, 'EXECUTE')
     or has_function_privilege('anon', 'economy_grant_rank_crates(uuid,integer)'::regprocedure, 'EXECUTE') then
    raise exception '0231: economy_grant_rank_crates is client-callable';
  end if;
  if has_function_privilege('anon', 'get_my_recent_rank_crates()'::regprocedure, 'EXECUTE')
     or not has_function_privilege('authenticated', 'get_my_recent_rank_crates()'::regprocedure, 'EXECUTE') then
    raise exception '0231: get_my_recent_rank_crates grants are wrong';
  end if;
  if not has_function_privilege('authenticated', 'get_my_last_rank_up_reward()'::regprocedure, 'EXECUTE') then
    raise exception '0231: get_my_last_rank_up_reward lost its authenticated grant';
  end if;

  -- The reads resolve (sql bodies bind at call time).
  perform get_my_recent_rank_crates();
  perform * from get_my_last_rank_up_reward();
end;
$assert$;
