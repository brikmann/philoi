-- §4 (Trophy Hall) + §7 (Collection browse), and the per-item hide the two of them share.
--
-- BOTH SURFACES RENDER ON SOMEONE ELSE'S PROFILE. That is the whole point of the Hall — cosmetics
-- can be bought, so they prove nothing; placements, medals, earned relics and a W-L record cannot,
-- and showing them side by side is the credible status compare. But every table this reads from
-- (cosmetics_owned, owned_badges, season_standings, social_challenges) is either RLS'd to its own
-- user or public-but-unjoined, so a visitor cannot assemble any of it client-side.
--
-- So the two reads below are SECURITY DEFINER and are the single place that decides what a visitor
-- may see. They apply the hide server-side: a hidden item is absent from a visitor's payload
-- entirely rather than sent-and-not-rendered, which is the difference between a privacy control and
-- a suggestion to a client that could ignore it.
--
-- THEY RETURN jsonb, not RETURNS TABLE. A hall is four differently-shaped lists plus a record; as
-- separate table-returning functions that is five round-trips to paint one section, and as one
-- flattened table it is a union of padded nulls. jsonb also sidesteps the RETURNS TABLE
-- column-shadowing trap that has bitten this schema before (0081), since nothing here declares an
-- output column that could shadow a real one.
--
-- ITEM METADATA STAYS IN THE CLIENT CATALOG. These functions return KEYS — the name, rarity, lore
-- and art are resolved from src/lib/economy/catalog.ts by getItem(), exactly as useInventory
-- already does. Copying ~60 rows of item copy into Postgres is what 0064 refused to do and what
-- 0090 refused again; the reasoning has not changed.

-- ───────────────────────────── 1 · the per-item hide ─────────────────────────────

/**
 * One row per thing its owner has hidden from visitors. Absence means visible: everything defaults
 * public (§4), and an opt-in hide keeps the honest-compare value that makes the Hall worth showing
 * at all.
 *
 * `kind` is the namespace `item_key` lives in, because the four hideable things key off four
 * different tables — a cosmetic_key, a badge_key, a season_id, and the record, which is a singleton
 * and stores the literal 'record'. One table rather than four booleans scattered across those
 * tables: the hide is a profile-presentation fact, not a fact about the item, and the tables it
 * would otherwise land in are written by grant paths that should not grow a display column.
 */
create table if not exists profile_hidden_items (
  user_id uuid not null references profiles (id) on delete cascade,
  kind text not null check (kind in ('cosmetic', 'badge', 'season', 'record')),
  item_key text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, kind, item_key)
);

alter table profile_hidden_items enable row level security;

-- Own rows only. Visitors never read this table directly — the hide reaches them as an ABSENCE in
-- the definer functions below, never as a list of what was hidden.
drop policy if exists profile_hidden_items_own on profile_hidden_items;
create policy profile_hidden_items_own on profile_hidden_items
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

/** Hide or unhide one item. Idempotent in both directions. */
create or replace function set_profile_item_hidden(p_kind text, p_key text, p_hidden boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'Not signed in.'; end if;
  if p_kind is null or p_kind not in ('cosmetic', 'badge', 'season', 'record') then
    raise exception 'Unknown hideable kind: %', p_kind;
  end if;
  if coalesce(btrim(p_key), '') = '' then raise exception 'Missing item key.'; end if;

  if coalesce(p_hidden, false) then
    insert into profile_hidden_items (user_id, kind, item_key)
    values (auth.uid(), p_kind, p_key)
    on conflict (user_id, kind, item_key) do nothing;
  else
    delete from profile_hidden_items
    where user_id = auth.uid() and kind = p_kind and item_key = p_key;
  end if;
end;
$$;

grant execute on function set_profile_item_hidden(text, text, boolean) to authenticated;

-- ───────────────────────────── 2 · the duel record ─────────────────────────────

/**
 * Head-to-head record. Split out because both the Hall and the compare banner need it and neither
 * should re-derive it.
 *
 * A DRAW IS NEITHER A WIN NOR A LOSS. finalize_social_challenges() leaves winner_id null when two
 * people tie, so counting "not a win" as a loss would quietly invent losses. Drawn is returned
 * separately and left out of the win rate's denominator — a 1-0-9 record reading as 100% would be
 * a lie, but so would 10%.
 */
create or replace function duel_record(p_user uuid)
returns jsonb
language sql
security definer
set search_path = public
stable
as $$
  select jsonb_build_object(
    'won', coalesce(count(*) filter (where c.winner_id = p_user), 0),
    'lost', coalesce(count(*) filter (where c.winner_id is not null and c.winner_id <> p_user), 0),
    'drawn', coalesce(count(*) filter (where c.winner_id is null), 0)
  )
  from social_challenges c
  where c.mode = 'h2h'
    and c.status = 'completed'
    and (c.created_by = p_user or c.opponent_id = p_user);
$$;

-- NOT granted to authenticated. get_trophy_hall applies the record's hide, and a directly callable
-- duel_record(uuid) would hand any caller the numbers the owner just chose to hide. get_trophy_hall
-- is SECURITY DEFINER, so it can still call this regardless of the grant.
revoke all on function duel_record(uuid) from public, authenticated;

-- ───────────────────────────── 3 · the Trophy Hall ─────────────────────────────

/**
 * Everything the Hall renders, for one person, from a visitor's or the owner's point of view.
 *
 * NO PEAK-RANK TILE (§4). Rank is a live, global signal and it already leads the profile on the
 * rank strip; minting a second frozen copy of it in the Hall would make the two disagree the moment
 * the user ranked up.
 *
 * RELICS AND MEDALS ARE IDENTIFIED BY KEY PREFIX. cosmetics_owned stores no item type — the type
 * lives in the client catalog — and every relic id is `relic-…` and every medal `medal-…` by
 * construction (ITEM_CATALOG §4a/§4b). The alternative is mirroring a type column into Postgres for
 * two prefixes' worth of information. If that convention ever breaks, it breaks here first and
 * loudly: the Hall renders empty rather than wrong.
 */
create or replace function get_trophy_hall(p_user uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_owner boolean := (p_user = auth.uid());
  v_seasons jsonb;
  v_relics jsonb;
  v_badges jsonb;
  v_record jsonb;
  v_record_hidden boolean := false;
  v_stats jsonb;
  v_collection int := 0;
  v_hidden int := 0;
begin
  if auth.uid() is null then raise exception 'Not signed in.'; end if;
  if p_user is null then raise exception 'Missing user.'; end if;

  -- Season placements. One row per (season, university, user) and a user belongs to one school, so
  -- this is one card per completed season. Presence in season_standings IS "completed" — the table
  -- is only ever written by the close job.
  --
  -- Title and medal come from season_reward_grants, which denormalises the display name at grant
  -- time on purpose (0080): a title's copy can be re-themed for a later season and this card has to
  -- keep saying what the person actually won.
  select coalesce(jsonb_agg(
           jsonb_build_object(
             'season_id', s.season_id,
             'placement', s.placement,
             'board_size', s.board_size,
             'title', s.title,
             'medal_key', s.medal_key,
             'hidden', s.hidden
           ) order by s.placement asc
         ), '[]'::jsonb) into v_seasons
  from (
    select
      st.season_id,
      st.rank as placement,
      st.board_size,
      (
        select g.name from season_reward_grants g
        where g.user_id = st.user_id and g.season_id = st.season_id and g.kind = 'title'
        order by g.permanent desc limit 1
      ) as title,
      (
        select g.item_key from season_reward_grants g
        where g.user_id = st.user_id and g.season_id = st.season_id and g.kind = 'medal'
        order by g.permanent desc limit 1
      ) as medal_key,
      exists (
        select 1 from profile_hidden_items h
        where h.user_id = st.user_id and h.kind = 'season' and h.item_key = st.season_id
      ) as hidden
    from season_standings st
    where st.user_id = p_user
  ) s
  where v_owner or not s.hidden;

  select coalesce(jsonb_agg(
           jsonb_build_object('key', r.key, 'acquired_at', r.acquired_at,
                              'provenance', r.provenance, 'hidden', r.hidden)
           order by r.acquired_at desc
         ), '[]'::jsonb) into v_relics
  from (
    select
      c.cosmetic_key as key,
      c.acquired_at,
      c.provenance,
      exists (
        select 1 from profile_hidden_items h
        where h.user_id = c.user_id and h.kind = 'cosmetic' and h.item_key = c.cosmetic_key
      ) as hidden
    from cosmetics_owned c
    where c.user_id = p_user and (c.cosmetic_key like 'relic-%' or c.cosmetic_key like 'medal-%')
  ) r
  where v_owner or not r.hidden;

  select coalesce(jsonb_agg(
           jsonb_build_object('key', b.key, 'earned_at', b.earned_at,
                              'provenance', b.provenance, 'hidden', b.hidden)
           order by b.earned_at desc
         ), '[]'::jsonb) into v_badges
  from (
    select
      ob.badge_key as key,
      ob.earned_at,
      ob.provenance,
      exists (
        select 1 from profile_hidden_items h
        where h.user_id = ob.user_id and h.kind = 'badge' and h.item_key = ob.badge_key
      ) as hidden
    from owned_badges ob
    where ob.user_id = p_user
  ) b
  where v_owner or not b.hidden;

  -- The record is hideable as ONE unit (§4 "hide individual items / the record"), so a visitor
  -- gets null rather than a zeroed row — 0-0 would read as "never duelled", which is a different
  -- and false claim.
  select exists (
    select 1 from profile_hidden_items h
    where h.user_id = p_user and h.kind = 'record' and h.item_key = 'record'
  ) into v_record_hidden;

  if v_owner then
    v_record := duel_record(p_user) || jsonb_build_object('hidden', v_record_hidden);
  elsif not v_record_hidden then
    v_record := duel_record(p_user) || jsonb_build_object('hidden', false);
  end if;

  -- What a visitor is NOT being shown, as a count only — "🔒 N hidden by owner" is honest about
  -- the gap without leaking which trophies fill it.
  if not v_owner then
    select count(*) into v_hidden
    from profile_hidden_items h
    where h.user_id = p_user
      and (
        (h.kind = 'season' and exists (select 1 from season_standings st where st.user_id = p_user and st.season_id = h.item_key))
        or (h.kind = 'cosmetic' and exists (select 1 from cosmetics_owned c where c.user_id = p_user and c.cosmetic_key = h.item_key
              and (c.cosmetic_key like 'relic-%' or c.cosmetic_key like 'medal-%')))
        or (h.kind = 'badge' and exists (select 1 from owned_badges ob where ob.user_id = p_user and ob.badge_key = h.item_key))
      );
  end if;

  -- The numbers behind the MILESTONE BADGE GRID (§4). The grid greys out what has not been reached
  -- yet — "a collection to complete" — so it needs the thresholds' inputs, not just the badges
  -- already granted. Streak/lock-in/hours milestones have no grant path and deliberately need one:
  -- they are a VIEW over facts the profile already stores, and minting rows for them would be a
  -- second source of truth that could disagree with the streak on the user's own home screen.
  select jsonb_build_object(
           'current_streak', coalesce(p.current_streak, 0),
           'longest_streak', coalesce(p.longest_streak, 0),
           'campus_verified', coalesce(p.university_email_verified, false),
           'lockin_count', coalesce(ci.lockin_count, 0),
           'total_seconds', coalesce(ci.total_seconds, 0)
         ) into v_stats
  from profiles p
  left join lateral (
    select count(*) as lockin_count, coalesce(sum(c.duration_seconds), 0) as total_seconds
    from check_ins c
    where c.user_id = p.id and c.duration_seconds is not null and c.removed_at is null
  ) ci on true
  where p.id = p_user;

  -- How many items the Collection entry on the profile advertises. Counted here rather than by
  -- calling get_public_collection from the profile screen: the profile needs the NUMBER, and
  -- fetching a whole closet to call .length on it is a round-trip for one integer. Counts only
  -- what this viewer would actually be shown.
  select count(*) into v_collection
  from cosmetics_owned c
  where c.user_id = p_user
    and (
      v_owner or not exists (
        select 1 from profile_hidden_items h
        where h.user_id = c.user_id and h.kind = 'cosmetic' and h.item_key = c.cosmetic_key
      )
    );

  return jsonb_build_object(
    'is_owner', v_owner,
    'seasons', coalesce(v_seasons, '[]'::jsonb),
    'relics', coalesce(v_relics, '[]'::jsonb),
    'badges', coalesce(v_badges, '[]'::jsonb),
    'record', v_record,
    'stats', coalesce(v_stats, '{}'::jsonb),
    'collection_count', coalesce(v_collection, 0),
    'hidden_count', v_hidden
  );
end;
$$;

grant execute on function get_trophy_hall(uuid) to authenticated;

-- ───────────────────────────── 4 · the Collection browse ─────────────────────────────

/**
 * Someone's whole owned closet plus what they are currently wearing (§7, mock Frame 4).
 *
 * READ-ONLY BY CONSTRUCTION. There is no equip path here and none is wanted: editing stays in the
 * inventory behind the ⚙ menu (§7), and this function is reachable for any profile, so an equip
 * verb on it would be an equip verb pointed at someone else's loadout.
 *
 * The equipped map is returned alongside the items rather than as a separate strip, because the
 * mock marks the equipped item with a ring on the tile itself — the client needs to know WHICH tile
 * to ring, not a second copy of the items to render above the grid.
 */
create or replace function get_public_collection(p_user uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_owner boolean := (p_user = auth.uid());
  v_items jsonb;
  v_loadout jsonb;
  v_hidden int := 0;
begin
  if auth.uid() is null then raise exception 'Not signed in.'; end if;
  if p_user is null then raise exception 'Missing user.'; end if;

  select coalesce(jsonb_agg(i order by i.acquired_at desc), '[]'::jsonb) into v_items
  from (
    select
      c.cosmetic_key as key,
      c.rarity_override,
      c.season_stamp,
      c.acquired_at,
      exists (
        select 1 from profile_hidden_items h
        where h.user_id = c.user_id and h.kind = 'cosmetic' and h.item_key = c.cosmetic_key
      ) as hidden
    from cosmetics_owned c
    where c.user_id = p_user
  ) i
  where v_owner or not i.hidden;

  -- The loadout is what they are wearing, and wearing something in public is already disclosing it
  -- — the profile card renders that same equipped art to every visitor (§2). So a hidden item is
  -- still reported as equipped; hiding removes it from the CLOSET listing, not from your face.
  select coalesce(jsonb_object_agg(el.slot, el.cosmetic_key), '{}'::jsonb) into v_loadout
  from equipped_loadout el
  where el.user_id = p_user;

  if not v_owner then
    select count(*) into v_hidden
    from profile_hidden_items h
    join cosmetics_owned c on c.user_id = h.user_id and c.cosmetic_key = h.item_key
    where h.user_id = p_user and h.kind = 'cosmetic';
  end if;

  return jsonb_build_object(
    'is_owner', v_owner,
    'loadout', coalesce(v_loadout, '{}'::jsonb),
    'items', coalesce(v_items, '[]'::jsonb),
    'hidden_count', v_hidden
  );
end;
$$;

grant execute on function get_public_collection(uuid) to authenticated;
