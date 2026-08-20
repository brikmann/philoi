-- Season titles — the season-exclusive placement honours (SEASON_TITLES_SPEC.md).
--
-- Every season ships its OWN themed title ladder. A title is earned at season close by your final
-- placement band, is permanent, and can never be re-earned once the season retires — that
-- non-repeatability is the entire point ("I was there for Emberfall" has to keep meaning something).
--
-- Which is why the ladder is a TABLE, not a CASE block in a function: a new season is then a row
-- insert, and the copy the app shows (title, rarity, the god's significance blurb) is data the
-- client reads rather than strings baked into a shipped build. The spec says this outright —
-- "Copy is data, not hardcoded".
--
-- What this replaces: close_season_scope()'s hardcoded generic placement titles (Ascended / Titan /
-- Demigod / The Untouchable / Elite Ember / Ashborne / Kept the Fire). Those were scope-generic and
-- identical every season. The bands move with the spec too: 1% / 10% / 25% / 50%, not 1/5/10/50.
--
-- What this does NOT touch: 0075's pass-XP placement bundle (loot boxes, embers, cards, medals).
-- That is a different board paying a different thing, and it stays exactly as it was — this only
-- adds a ledger row for each of its grants so the season share card can list what was actually paid
-- instead of re-deriving it.
--
-- NOTE: no explicit begin/commit — `supabase db push` runs each migration in its own transaction.

-- ───────────────────────────── the ladder ─────────────────────────────

create table if not exists season_titles (
  season_id text not null,
  -- The seven bands, top to bottom. Below p50 there is deliberately no row: participation is not a
  -- title, and a null lookup is how the grant path knows to hand out nothing.
  band text not null check (band in ('rank_1', 'rank_2', 'rank_3', 'p1', 'p10', 'p25', 'p50')),
  /** The worn string, e.g. Surtur. Quoted at render time, not in the data. */
  title text not null,
  /** The inventory key granted into cosmetics_owned. Also present in src/lib/economy/catalog.ts so
   * inventory/profile can draw the tile; THIS row is the source of truth for the copy. */
  cosmetic_key text not null,
  rarity text not null check (rarity in ('common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic')),
  /** Permanent banner granted alongside the title, or null for bands that don't earn one. */
  banner_asset text,
  /** The significance blurb — shown on the title, the earn card, and the profile. For the podium
   * gods this is where the lore earns its keep. */
  description text not null,
  primary key (season_id, band)
);

alter table season_titles enable row level security;

-- Public by nature: the ladder is the advertisement. Every signed-in client reads it to render a
-- title someone else is wearing, not just their own.
drop policy if exists season_titles_read on season_titles;
create policy season_titles_read on season_titles for select to authenticated using (true);

-- Season 1 "Emberfall". Two classes, per the spec: the podium (#1-3) are mythological flame deities
-- (Mythic, singular), the percentiles are Gen-Z flexes. Never reused in S2 — that ladder is its own
-- set of rows with its own words.
insert into season_titles (season_id, band, title, cosmetic_key, rarity, banner_asset, description) values
  ('S1', 'rank_1', 'Surtur', 'title-s1-surtur', 'mythic', 'banner-emberfall-mythic',
   'The fire-giant of Ragnarök, whose flaming sword outshines the sun and burns the world to ash so the next can rise. There is only ever one. This season, it''s you.'),
  ('S1', 'rank_2', 'Agni', 'title-s1-agni', 'mythic', 'banner-emberfall-elite',
   'The divine fire the gods themselves speak through — alive in every hearth and every offering, never once extinguished. Second to none but the world-ender, Surtur.'),
  ('S1', 'rank_3', 'Helios', 'title-s1-helios', 'mythic', 'banner-emberfall-elite',
   'The Titan who hauls the sun across the sky each day — the blaze every mortal looks up to. Third of three, behind only Surtur and Agni — and still a god.'),
  ('S1', 'p1', 'Built Different', 'title-s1-built-different', 'legendary', 'banner-emberfall',
   'Top 1% of the whole board. Same twenty-four hours as everyone else, used like nobody else.'),
  ('S1', 'p10', 'Firebreather', 'title-s1-firebreather', 'epic', 'banner-ashfall',
   'Top 10%. Ran hot for ninety days straight and never needed to be talked into it.'),
  ('S1', 'p25', 'Certified Firestarter', 'title-s1-certified-firestarter', 'rare', null,
   'Top 25%. Lit something in the people around you, then kept it burning.'),
  ('S1', 'p50', 'Warming Up', 'title-s1-warming-up', 'uncommon', null,
   'Top half of the season. Kept a flame all the way through — that''s where every fire starts.')
on conflict (season_id, band) do update set
  title = excluded.title,
  cosmetic_key = excluded.cosmetic_key,
  rarity = excluded.rarity,
  banner_asset = excluded.banner_asset,
  description = excluded.description;

-- ───────────────────────────── band + rarity helpers ─────────────────────────────

/**
 * Final placement -> band. The bands are EXCLUSIVE (best one only): the champion is Surtur, full
 * stop, not Surtur + Built Different + Firebreather + a participation title.
 * Returns null below the halfway line, which is the spec's "participation ≠ a title".
 */
create or replace function season_band(p_rank int, p_board_size int)
returns text
language sql
immutable
as $$
  select case
    when p_rank = 1 then 'rank_1'
    when p_rank = 2 then 'rank_2'
    when p_rank = 3 then 'rank_3'
    when p_rank::numeric / greatest(p_board_size, 1) <= 0.01 then 'p1'
    when p_rank::numeric / greatest(p_board_size, 1) <= 0.10 then 'p10'
    when p_rank::numeric / greatest(p_board_size, 1) <= 0.25 then 'p25'
    when p_rank::numeric / greatest(p_board_size, 1) <= 0.50 then 'p50'
    else null
  end;
$$;

/** One notch hotter — what a GLOBAL cut is worth against the same cut on a single campus (mock 66).
 * Mythic is the ceiling, so the podium gods don't move. */
create or replace function rarity_notch_up(p_rarity text)
returns text
language sql
immutable
as $$
  select case p_rarity
    when 'common' then 'uncommon'
    when 'uncommon' then 'rare'
    when 'rare' then 'epic'
    when 'epic' then 'legendary'
    when 'legendary' then 'mythic'
    else 'mythic'
  end;
$$;

-- ───────────────────────────── the grant ledger ─────────────────────────────
--
-- What was ACTUALLY paid, per user per season. The season share card (mock 97, screen 2) lists the
-- reward bundle, and the only honest source for that list is the grant itself — re-deriving it from
-- the band at read time would drift the moment a reward ladder is retuned between seasons.

create table if not exists season_reward_grants (
  season_id text not null,
  user_id uuid not null references profiles (id) on delete cascade,
  /** 'uni' | 'global' | 'pass' — which board paid this. */
  scope text not null,
  band text,
  kind text not null check (kind in ('title', 'banner', 'card', 'particle', 'medal', 'box', 'embers')),
  item_key text not null,
  /** Display name at grant time. Denormalised on purpose: a title's copy can be re-themed for a
   * later season, and this row has to keep saying what the person actually won. */
  name text not null,
  rarity text,
  /** Titles and banners are kept forever; boxes and embers are consumed. Drives mock 97's
   * "permanent items first" ordering. */
  permanent boolean not null default false,
  amount int,
  granted_at timestamptz not null default now(),
  primary key (season_id, user_id, scope, kind, item_key)
);

create index if not exists season_reward_grants_user_idx on season_reward_grants (user_id, season_id);

alter table season_reward_grants enable row level security;

drop policy if exists season_reward_grants_read_own on season_reward_grants;
create policy season_reward_grants_read_own on season_reward_grants for select to authenticated
  using (user_id = auth.uid());

/** Ledger write. Idempotent, so a re-run of any close path can't double-list a reward. */
create or replace function season_log_grant(
  p_season text, p_user uuid, p_scope text, p_band text,
  p_kind text, p_item_key text, p_name text,
  p_rarity text default null, p_permanent boolean default false, p_amount int default null
)
returns void
language sql
security definer
set search_path = public
as $$
  insert into season_reward_grants (season_id, user_id, scope, band, kind, item_key, name, rarity, permanent, amount)
  values (p_season, p_user, p_scope, p_band, p_kind, p_item_key, p_name, p_rarity, p_permanent, p_amount)
  on conflict (season_id, user_id, scope, kind, item_key) do nothing;
$$;

revoke all on function season_log_grant(text, uuid, text, text, text, text, text, text, boolean, int) from public, authenticated;

-- ───────────────────────────── close_season_scope, retitled ─────────────────────────────
--
-- Same board, same ranking, same everything-else. The only change is the title block: instead of a
-- hardcoded ladder of generic names, it reads this season's row for the band and grants that. A
-- season with no seeded ladder grants no title rather than falling back to last season's words.

create or replace function close_season_scope(p_season text, p_scope text, p_key text default null)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_paid int := 0;
  v_is_global boolean := (p_scope = 'global');
  v_stamp_prefix text := case when p_scope = 'global' then '🌍 GLOBAL' else '🎓 ' || upper(coalesce(p_key, '')) end;
  r record;
  v_pct numeric;
  v_band text;
  v_title season_titles;
  v_rarity text;
  v_stamp text;
begin
  insert into season_closures (season_id, scope, scope_key)
  values (p_season, p_scope, coalesce(p_key, ''))
  on conflict do nothing;
  if not found then return 0; end if;

  for r in
    select p.id as user_id,
           row_number() over (order by universal_score(p.id) desc) as rank,
           count(*) over () as board_size
    from profiles p
    where not p.is_demo and not p.is_disabled
      and (p_scope <> 'uni' or (p.university = p_key and p.university_email_verified))
  loop
    v_pct := r.rank::numeric / greatest(r.board_size, 1);
    perform grant_reward(r.user_id, 'season', 1.0, 90, r.board_size::int, v_pct, true, null);

    -- Everyone who met the floor keeps a dated participation badge (§4b).
    perform economy_grant_badge(r.user_id, 'season-participant-' || p_season, 'Season ' || p_season || ' · took part');

    v_band := season_band(r.rank::int, r.board_size::int);

    if v_band is not null then
      select * into v_title from season_titles st where st.season_id = p_season and st.band = v_band;

      if v_title.cosmetic_key is not null then
        -- Global reads one notch hotter than the same cut on a single campus (mock 66). The podium
        -- gods are already Mythic, so this only ever moves the percentile bands.
        v_rarity := case when v_is_global then rarity_notch_up(v_title.rarity) else v_title.rarity end;
        v_stamp := v_stamp_prefix || ' ' ||
          case v_band
            when 'rank_1' then '#1'
            when 'rank_2' then '#2'
            when 'rank_3' then '#3'
            when 'p1' then '· TOP 1%'
            when 'p10' then '· TOP 10%'
            when 'p25' then '· TOP 25%'
            else '· TOP 50%'
          end || ' · ' || p_season;

        perform economy_grant_title(
          r.user_id, v_title.cosmetic_key,
          'Season ' || p_season || ' · ' || p_scope || ' placement #' || r.rank,
          v_stamp,
          v_rarity
        );
        perform season_log_grant(p_season, r.user_id, p_scope, v_band, 'title', v_title.cosmetic_key,
                                 v_title.title, v_rarity, true, null);

        if v_title.banner_asset is not null then
          perform economy_grant_cosmetic(r.user_id, v_title.banner_asset, 'banner', v_rarity, 'earned',
                                         'Season ' || p_season || ' · ' || v_title.title);
          perform season_log_grant(p_season, r.user_id, p_scope, v_band, 'banner', v_title.banner_asset,
                                   v_title.title || ' Banner', v_rarity, true, null);
        end if;
      end if;
    end if;

    v_paid := v_paid + 1;
  end loop;

  return v_paid;
end;
$$;

revoke all on function close_season_scope(text, text, text) from public, authenticated;

-- ───────────────────────────── ledger writes on the pass-XP bundle ─────────────────────────────
--
-- Identical rewards to 0075 — every branch pays exactly what it paid before. The additions are the
-- season_log_grant() calls, so the card can list the bundle rather than guess at it.

create or replace function grant_season_placement_rewards(p_season text default null, p_dry_run boolean default false)
returns table (university text, ranked int, granted int)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_season text := coalesce(p_season, season_config() ->> 'id');
  v_stamp text;
  v_band text;
  v_pct numeric;
  v_granted int := 0;
  r record;
begin
  if not p_dry_run and exists (select 1 from season_placement_closures where season_id = v_season) then
    raise notice 'Season % placement rewards already granted; nothing to do.', v_season;
    return query select s.university, count(*)::int, 0
      from season_standings s where s.season_id = v_season group by s.university;
    return;
  end if;

  for r in
    select * from season_standings s where s.season_id = v_season order by s.university, s.rank
  loop
    v_pct := r.rank::numeric / greatest(r.board_size, 1);
    v_band := season_band(r.rank, r.board_size);
    v_stamp := '🎓 ' || upper(r.university) || ' · ' ||
      case
        when r.rank = 1 then '#1'
        when r.rank <= 10 then 'TOP 10'
        when v_pct <= 0.01 then 'TOP 1%'
        when v_pct <= 0.10 then 'TOP 10%'
        else 'TOP 50%'
      end || ' · ' || v_season;

    if not p_dry_run then
      -- ── exclusive placement band ──
      if r.rank = 1 then
        perform economy_grant_cosmetic(r.user_id, 'card-emberfall-sovereign', 'card', 'mythic', 'earned', 'Season ' || v_season || ' Champion');
        perform economy_grant_title(r.user_id, 'title-emberfall-champion', 'Season ' || v_season || ' Champion', v_stamp);
        perform economy_grant_cosmetic(r.user_id, 'medal-emberfall-champion', null, 'mythic', 'earned', 'Season ' || v_season || ' Champion');
        perform economy_move_embers(r.user_id, 5000, 'season_reward', null);
        perform season_log_grant(v_season, r.user_id, 'pass', v_band, 'card', 'card-emberfall-sovereign', 'Emberfall Sovereign', 'mythic', true, null);
        perform season_log_grant(v_season, r.user_id, 'pass', v_band, 'medal', 'medal-emberfall-champion', 'Champion Medal', 'mythic', true, null);
        perform season_log_grant(v_season, r.user_id, 'pass', v_band, 'embers', 'embers', 'Embers', null, false, 5000);
      elsif r.rank <= 10 then
        perform economy_grant_cosmetic(r.user_id, 'banner-emberfall-elite', 'banner', 'legendary', 'earned', 'Season ' || v_season || ' Top 10');
        perform economy_grant_title(r.user_id, 'title-emberfall-elite', 'Season ' || v_season || ' Top 10', v_stamp);
        perform economy_move_embers(r.user_id, 2500, 'season_reward', null);
        perform season_log_grant(v_season, r.user_id, 'pass', v_band, 'banner', 'banner-emberfall-elite', 'Emberfall Elite', 'legendary', true, null);
        perform season_log_grant(v_season, r.user_id, 'pass', v_band, 'embers', 'embers', 'Embers', null, false, 2500);
      elsif v_pct <= 0.01 then
        perform economy_grant_cosmetic(r.user_id, 'particle-emberfall-ascendant', 'particle', 'epic', 'earned', 'Season ' || v_season || ' Top 1%');
        perform economy_grant_title(r.user_id, 'title-emberfall-ascendant', 'Season ' || v_season || ' Top 1%', v_stamp);
        perform economy_move_embers(r.user_id, 1500, 'season_reward', null);
        perform season_log_grant(v_season, r.user_id, 'pass', v_band, 'particle', 'particle-emberfall-ascendant', 'Emberfall Ascendant', 'epic', true, null);
        perform season_log_grant(v_season, r.user_id, 'pass', v_band, 'embers', 'embers', 'Embers', null, false, 1500);
      elsif v_pct <= 0.10 then
        insert into loot_boxes (user_id, box_key, obtained_via, provenance)
        values (r.user_id, 'furnace', 'season', 'Season ' || v_season || ' Top 10%');
        perform economy_grant_title(r.user_id, 'title-emberfall-contender', 'Season ' || v_season || ' Top 10%', v_stamp);
        perform economy_move_embers(r.user_id, 750, 'season_reward', null);
        perform season_log_grant(v_season, r.user_id, 'pass', v_band, 'box', 'furnace', 'Furnace Chest', null, false, 1);
        perform season_log_grant(v_season, r.user_id, 'pass', v_band, 'embers', 'embers', 'Embers', null, false, 750);
      elsif v_pct <= 0.50 then
        perform economy_grant_title(r.user_id, 'title-emberfall-initiate', 'Season ' || v_season || ' Top 50%', v_stamp);
        perform economy_move_embers(r.user_id, 500, 'season_reward', null);
        perform season_log_grant(v_season, r.user_id, 'pass', v_band, 'embers', 'embers', 'Embers', null, false, 500);
      end if;

      -- ── orthogonal medals ──
      if r.pass_level >= 100 then
        perform economy_grant_cosmetic(r.user_id, 'medal-emberfall-centurion', null, 'legendary', 'earned', 'Season ' || v_season || ' · Level 100');
        perform season_log_grant(v_season, r.user_id, 'pass', v_band, 'medal', 'medal-emberfall-centurion', 'Centurion Medal', 'legendary', true, null);
      end if;
      perform economy_grant_cosmetic(r.user_id, 'medal-emberfall-participant', null, 'common', 'earned', 'Season ' || v_season || ' · took part');
      perform season_log_grant(v_season, r.user_id, 'pass', v_band, 'medal', 'medal-emberfall-participant', 'Participant Medal', 'common', true, null);
    end if;

    v_granted := v_granted + 1;
  end loop;

  if not p_dry_run then
    insert into season_placement_closures (season_id, boards, granted)
    select v_season, count(distinct s.university), v_granted from season_standings s where s.season_id = v_season
    on conflict (season_id) do nothing;
  end if;

  return query select s.university, count(*)::int, v_granted
    from season_standings s where s.season_id = v_season group by s.university;
end;
$$;

revoke all on function grant_season_placement_rewards(text, boolean) from public, authenticated;

-- ───────────────────────────── the read for the season share card ─────────────────────────────

/**
 * Everything mock 97's two screens need, in one round trip:
 *   screen 1 — placement: percentile, absolute rank, cohort size, university, season effort
 *   screen 2 — rewards: the earned title (with its rarity + significance blurb) and the bundle
 *
 * Returns null before the season has been closed out, which is how the client knows not to offer
 * the card yet. Nothing here is computed from a band at read time — placement comes from the frozen
 * standings snapshot, rewards come from the grant ledger.
 */
create or replace function get_my_season_card(p_season text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_season text := coalesce(p_season, season_config() ->> 'id');
  v_row season_standings;
  v_title season_titles;
  v_grant season_reward_grants;
  v_band text;
  v_hours numeric;
  v_season_start timestamptz := (season_config() ->> 'starts_at')::timestamptz;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;

  select * into v_row from season_standings s
  where s.season_id = v_season and s.user_id = auth.uid();
  if v_row.user_id is null then return null; end if;

  v_band := season_band(v_row.rank, v_row.board_size);

  -- The title actually granted, preferred over the ladder row: if this account placed on the global
  -- board too, the hotter global rarity is the one they're wearing.
  select * into v_grant from season_reward_grants g
  where g.season_id = v_season and g.user_id = auth.uid() and g.kind = 'title'
  order by case g.scope when 'global' then 0 when 'uni' then 1 else 2 end
  limit 1;

  select * into v_title from season_titles st where st.season_id = v_season and st.band = v_band;

  select coalesce(round(sum(ci.duration_seconds)::numeric / 3600.0, 1), 0) into v_hours
  from check_ins ci
  where ci.user_id = auth.uid()
    and ci.removed_at is null
    and (v_season_start is null or ci.created_at >= v_season_start);

  return jsonb_build_object(
    'season_id', v_season,
    'season_name', season_config() ->> 'name',
    'university', v_row.university,
    'rank', v_row.rank,
    'board_size', v_row.board_size,
    'percentile', round((v_row.rank::numeric / greatest(v_row.board_size, 1)) * 100, 1),
    'band', v_band,
    'pass_xp', v_row.pass_xp,
    'pass_level', v_row.pass_level,
    'hours_locked_in', v_hours,
    'title', case
      when v_grant.item_key is not null then jsonb_build_object(
        'key', v_grant.item_key,
        'name', v_grant.name,
        'rarity', v_grant.rarity,
        'scope', v_grant.scope,
        'description', coalesce(v_title.description, ''),
        -- The animated 1-of-1: global #1, one person per season, and nobody else ever.
        'one_of_one', (v_grant.scope = 'global' and v_grant.band = 'rank_1')
      )
      when v_title.cosmetic_key is not null then jsonb_build_object(
        'key', v_title.cosmetic_key,
        'name', v_title.title,
        'rarity', v_title.rarity,
        'scope', 'uni',
        'description', v_title.description,
        'one_of_one', false
      )
      else null
    end,
    'rewards', coalesce((
      select jsonb_agg(jsonb_build_object(
               'kind', g.kind,
               'key', g.item_key,
               'name', g.name,
               'rarity', g.rarity,
               'permanent', g.permanent,
               'amount', g.amount
             ) order by g.permanent desc, g.kind, g.item_key)
      from season_reward_grants g
      where g.season_id = v_season and g.user_id = auth.uid()
    ), '[]'::jsonb)
  );
end;
$$;
