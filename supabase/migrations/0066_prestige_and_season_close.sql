-- Step 21 final pass: the PRESTIGE half of the reward economy.
--
-- 0064 built the vault, 0065 made embers and Pass XP flow. What was still missing is the thing
-- REWARD_ECONOMY §5 says actually matters: "earned rewards skew to prestige". Until now a season
-- win paid embers and a box — the same currency you can buy — and none of the un-buyable status
-- that makes earning worth it. This emits the badges and the 21j placement titles.
--
-- Invariant restated: every title and badge below is source='earned'. §8.4 keeps `earned` out of
-- the direct-buy pool by construction, so nothing here can ever be bought.

-- ───────────────────────── owned-item metadata for placement grants ─────────────────────────

-- 21j needs two things the catalog alone can't express, because the SAME title id is granted at
-- different scopes with different weight:
--   • rarity_override — "percentile titles read one rarity notch hotter at Global". A Top 1% at
--     MIT and a Top 1% globally are the same item with different prestige.
--   • season_stamp    — "Ascended · S1", "🌍 GLOBAL #1", "MIT · TOP 1%". Renders next to the name.
-- Both null for ordinary box drops, which is every cosmetic that isn't a placement award.
alter table cosmetics_owned
  add column if not exists rarity_override text,
  add column if not exists season_stamp text;

comment on column cosmetics_owned.rarity_override is
  'Placement grants only (21j). Overrides the catalog rarity for display AND salvage value — a Global Top 1% is worth more than a campus one. Null everywhere else.';

-- ───────────────────────── rank index (for rank-up events) ─────────────────────────

create or replace function rank_index_for_score(p_score numeric)
returns int
language sql
stable
set search_path = public
as $$
  select rt.rank_index
  from rank_thresholds rt
  where rt.cumulative_xp_required <= p_score
  order by rt.cumulative_xp_required desc
  limit 1;
$$;

-- Rank is DERIVED and never stored (0063), which is why `season_new_rank` was undetectable: there
-- was nothing to diff against. This is the minimum state needed to notice a crossing — one row per
-- user holding the last index we saw. It is NOT a second source of truth for rank; universal_score
-- remains authoritative and this is only a high-water mark.
create table if not exists user_rank_state (
  user_id uuid primary key references profiles (id) on delete cascade,
  rank_index int not null,
  updated_at timestamptz not null default now()
);

alter table user_rank_state enable row level security;
drop policy if exists user_rank_state_read_own on user_rank_state;
create policy user_rank_state_read_own on user_rank_state for select to authenticated using (user_id = auth.uid());

create table if not exists rank_up_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles (id) on delete cascade,
  from_rank_index int,
  to_rank_index int not null,
  from_tier text,
  from_division int,
  to_tier text not null,
  to_division int not null,
  season_id text not null,
  created_at timestamptz not null default now()
);

create index if not exists rank_up_events_user_idx on rank_up_events (user_id, created_at desc);

alter table rank_up_events enable row level security;
drop policy if exists rank_up_events_read_own on rank_up_events;
create policy rank_up_events_read_own on rank_up_events for select to authenticated using (user_id = auth.uid());

-- Fires off a check-in, which is the only thing that moves universal_score. Records ONLY ordinal
-- increases — a score that dips (decay, a deleted check-in) must never emit a "rank up".
create or replace function economy_track_rank_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
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
  on conflict (user_id) do update set rank_index = greatest(user_rank_state.rank_index, excluded.rank_index),
                                      updated_at = now();

  -- First sighting establishes the baseline without claiming a rank-up for the whole history.
  if v_prev is null or v_index <= v_prev then return new; end if;

  select tier, division into v_to from rank_thresholds where rank_index = v_index;
  select tier, division into v_from from rank_thresholds where rank_index = v_prev;

  insert into rank_up_events (user_id, from_rank_index, to_rank_index, from_tier, from_division, to_tier, to_division, season_id)
  values (new.user_id, v_prev, v_index, v_from.tier, v_from.division, v_to.tier, v_to.division, v_season);

  perform economy_credit_pass_xp_for(new.user_id, 'season_new_rank', 500, v_season);
  return new;
end;
$$;

drop trigger if exists check_ins_rank_tracking on check_ins;
create trigger check_ins_rank_tracking
  after insert on check_ins
  for each row execute function economy_track_rank_change();

-- ───────────────────────── prestige grants ─────────────────────────

-- One place badges are minted. Idempotent on (user, badge_key), so a season badge whose key
-- carries the season stamp can never be double-granted on a re-run.
create or replace function economy_grant_badge(
  p_user uuid, p_key text, p_provenance text
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into owned_badges (user_id, badge_key, source, provenance)
  values (p_user, p_key, 'earned', p_provenance)
  on conflict (user_id, badge_key) do nothing;
end;
$$;

-- Placement titles (21j). Earn-only, season-stamped, never re-issued.
create or replace function economy_grant_title(
  p_user uuid, p_item_key text, p_provenance text, p_stamp text, p_rarity_override text default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into cosmetics_owned (user_id, cosmetic_key, slot, source, provenance, season_stamp, rarity_override)
  values (p_user, p_item_key, 'title', 'earned', p_provenance, p_stamp, p_rarity_override)
  on conflict (user_id, cosmetic_key) do nothing;
end;
$$;

-- grant_reward, now emitting prestige. Same signature as 0064 (full param list on the drop), so
-- every existing caller and trigger keeps working — the return object just gains `badge`.
drop function if exists grant_reward(uuid, text, numeric, int, int, numeric, boolean, uuid);
create function grant_reward(
  p_user uuid, p_type text, p_difficulty numeric, p_duration_days int,
  p_scope int, p_placement_pct numeric, p_verified boolean, p_ref uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sig numeric;
  v_embers int;
  v_box text;
  v_badge text;
  v_band text;
  v_season text := (select value ->> 'id' from economy_config where key = 'season');
begin
  if not p_verified then
    perform economy_move_embers(p_user, 10, 'challenge_win', p_ref);
    return jsonb_build_object('embers', 10, 'box', null, 'badge', null, 'band', 'completion');
  end if;

  v_sig := p_difficulty
         * greatest(1, log(greatest(p_scope, 1)::numeric + 1))
         * greatest(1, p_duration_days::numeric / 7)
         * greatest(0.2, 1 - coalesce(p_placement_pct, 1));

  if    v_sig >= 24 then v_embers := 1200; v_box := 'promethean';  v_band := 'apex';
  elsif v_sig >= 12 then v_embers := 600;  v_box := 'hephaestus';  v_band := 'elite';
  elsif v_sig >= 6  then v_embers := 300;  v_box := 'hestia';      v_band := 'impressive';
  elsif v_sig >= 3  then v_embers := 150;  v_box := 'furnace';     v_band := 'notable';
  elsif v_sig >= 1  then v_embers := 60;   v_box := 'ignition';    v_band := 'casual';
  else                   v_embers := 25;   v_box := null;          v_band := 'completion';
  end if;

  perform economy_move_embers(p_user, v_embers, case when p_type = 'season' then 'season_reward' else 'challenge_win' end, p_ref);

  if v_box is not null then
    insert into loot_boxes (user_id, box_key, obtained_via, provenance)
    values (p_user, v_box, case when p_type = 'season' then 'season' else 'challenge' end,
            case when p_type = 'season' then 'Season reward · ' || v_season else 'Challenge reward' end);
  end if;

  -- The prestige half (§5 / 21c): the top two bands mint an UN-BUYABLE earned badge. This is what
  -- the biggest wins are actually for — the embers above are the same currency anyone can buy, so
  -- on their own they'd make a season win feel purchasable.
  if v_band in ('elite', 'apex') then
    v_badge := case
      when p_type = 'season' then 'season-' || v_band || '-' || v_season
      else 'challenge-' || v_band
    end;
    perform economy_grant_badge(
      p_user, v_badge,
      case when p_type = 'season'
        then 'Season ' || v_season || ' · ' || initcap(v_band) || ' finish'
        else initcap(v_band) || ' challenge win'
      end
    );
  end if;

  return jsonb_build_object('embers', v_embers, 'box', v_box, 'badge', v_badge, 'band', v_band, 'significance', v_sig);
end;
$$;

-- ───────────────────────── daily_with_a_friend ─────────────────────────
-- The last undetectable daily. "Lock in with a friend / in a campfire" means your session actually
-- OVERLAPPED theirs — not merely that you both used the app today, which would fire for everyone.

create or replace function economy_locked_in_with_friend(p_user uuid)
returns boolean
language sql
stable
set search_path = public
as $$
  select exists (
    select 1
    from lock_in_sessions me
    join friend_requests fr
      on fr.status = 'accepted'
     and (fr.requester_id = me.user_id or fr.recipient_id = me.user_id)
    join lock_in_sessions them
      on them.user_id = case when fr.requester_id = me.user_id then fr.recipient_id else fr.requester_id end
    where me.user_id = p_user
      and me.started_at >= date_trunc('day', now())
      and them.started_at >= date_trunc('day', now()) - interval '1 day'
      -- Real overlap: each started before the other finished.
      and me.started_at <= them.last_confirmed_at
      and them.started_at <= me.last_confirmed_at
  );
$$;

-- Replaces 0065's version to add the friend check. Kept as an override of the TRIGGER function
-- rather than re-declaring the whole 200-line evaluate_pass_achievements — one small addition
-- shouldn't mean maintaining two copies of the achievement engine.
create or replace function economy_on_lock_in_completed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_seconds int;
  v_season text := (select value ->> 'id' from economy_config where key = 'season');
begin
  if new.status <> 'completed' or coalesce(old.status, '') = 'completed' then
    return new;
  end if;

  v_seconds := greatest(0, extract(epoch from (new.last_confirmed_at - new.started_at))::int);
  perform economy_award_lock_in_embers(new.user_id, v_seconds, new.id);
  perform evaluate_pass_achievements(new.user_id);

  if economy_locked_in_with_friend(new.user_id) then
    perform economy_credit_pass_xp_for(
      new.user_id, 'daily_with_a_friend', 50, to_char(now(), 'YYYY-MM-DD')
    );
  end if;

  return new;
end;
$$;

-- ───────────────────────── group-challenge percentiles ─────────────────────────
-- Replaces the flat completion band. Standings are computed from the same verified signal the
-- watch screens rank on: qualifying lock-ins inside the window. Falls back to the completion band
-- when there aren't enough participants for a placement to mean anything.

create or replace function economy_on_social_challenge_closed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_days int;
  v_min int := (select value::int from economy_config where key = 'lock_in_min_seconds');
  v_count int;
  r record;
begin
  if new.status <> 'completed' or coalesce(old.status, '') = 'completed' then
    return new;
  end if;

  v_days := greatest(1, ceil(new.window_hours / 24.0)::int);

  if new.mode = 'h2h' then
    if new.winner_id is not null then
      perform grant_reward(new.winner_id, 'friend_h2h', 1.0, v_days, 1, 0.0, true, new.id);
      perform grant_reward(
        case when new.winner_id = new.created_by then new.opponent_id else new.created_by end,
        'friend_h2h', 1.0, v_days, 1, 1.0, true, new.id
      );
    end if;
    return new;
  end if;

  if new.circle_id is null then return new; end if;

  -- Deliberately a CTE in the loop query rather than a temp table: a temp table created inside a
  -- row-level trigger persists for the whole transaction, so a batch close that fires this trigger
  -- for several challenges at once would have them stomping each other's standings.
  for r in
    with participants as (
      select s.user_id,
             count(*)::int as lockins,
             sum(extract(epoch from (s.last_confirmed_at - s.started_at))) as seconds
      from lock_in_sessions s
      join group_members gm on gm.user_id = s.user_id and gm.group_id = new.circle_id
      where s.status = 'completed'
        and s.started_at >= new.starts_at
        and s.started_at <= coalesce(new.ends_at, now())
        and extract(epoch from (s.last_confirmed_at - s.started_at)) >= v_min
      group by s.user_id
    )
    select user_id,
           row_number() over (order by lockins desc, seconds desc)::int as place,
           count(*) over ()::int as total
    from participants
  loop
    v_count := r.total;
    perform grant_reward(
      r.user_id, 'campfire_group', 1.0, v_days, v_count,
      -- Fallback: with one participant there is no field to place against, so pay completion.
      case when v_count < 2 then 0.75 else (r.place::numeric / v_count) end,
      true, new.id
    );
    -- Campfire podium caps at EPIC (21j) — a six-person campfire #1 is not a god, so the
    -- god-tier names (Demigod / Titan / Ascended) never appear off this board.
    if r.place = 1 and v_count >= 3 then
      perform economy_grant_title(
        r.user_id, 'title-campfire-champion',
        'First in a campfire challenge',
        '🔥 CAMPFIRE #1',
        null
      );
    end if;
  end loop;

  return new;
end;
$$;

-- ───────────────────────── season close (21d + 21j) ─────────────────────────

-- Idempotence guard: a season closes exactly once per scope, whatever re-runs the cron does.
create table if not exists season_closures (
  season_id text not null,
  scope text not null,
  scope_key text not null default '',
  closed_at timestamptz not null default now(),
  primary key (season_id, scope, scope_key)
);

alter table season_closures enable row level security;
-- No policy: nothing about closure bookkeeping belongs to a client.

drop function if exists close_season_rewards(text, int);

/**
 * Individual placement close for one board scope.
 *   p_scope = 'uni'    → p_key is the university; rank 1 gets Mythic "Ascended"
 *   p_scope = 'global' → whole app; rank 1 gets the 1-of-1 "Ascended · Global"
 * Percentile titles carry the scope stamp and read one rarity notch hotter at Global (21j).
 */
create or replace function close_season_scope(p_season text, p_scope text, p_key text default null)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_paid int := 0;
  v_hotter boolean := (p_scope = 'global');
  v_stamp_prefix text := case when p_scope = 'global' then '🌍 GLOBAL' else '🎓 ' || upper(coalesce(p_key, '')) end;
  r record;
  v_pct numeric;
  v_title text;
  v_override text;
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

    v_title := null;
    v_override := null;

    if r.rank = 1 then
      -- Global #1 is the single rarest cosmetic in Philoi — one person per season.
      v_title := case when p_scope = 'global' then 'title-ascended-global' else 'title-ascended' end;
    elsif r.rank = 2 then v_title := 'title-titan';
    elsif r.rank = 3 then v_title := 'title-demigod';
    elsif v_pct <= 0.01 then
      v_title := 'title-the-untouchable';
      if v_hotter then v_override := 'legendary'; end if;
    elsif v_pct <= 0.05 then
      v_title := 'title-elite-ember';
      if v_hotter then v_override := 'legendary'; end if;
    elsif v_pct <= 0.10 then
      v_title := 'title-ashborne';
      if v_hotter then v_override := 'legendary'; end if;
    elsif v_pct <= 0.50 then
      v_title := 'title-kept-the-fire';
      if v_hotter then v_override := 'epic'; end if;
    end if;

    if v_title is not null then
      perform economy_grant_title(
        r.user_id, v_title,
        'Season ' || p_season || ' · ' || p_scope || ' placement #' || r.rank,
        v_stamp_prefix || ' ' ||
          case when r.rank <= 3 then '#' || r.rank
               when v_pct <= 0.01 then '· TOP 1%'
               when v_pct <= 0.05 then '· TOP 5%'
               when v_pct <= 0.10 then '· TOP 10%'
               else '· TOP 50%' end
          || ' · ' || p_season,
        v_override
      );
    end if;

    v_paid := v_paid + 1;
  end loop;

  return v_paid;
end;
$$;

/**
 * Vs-Unis is COLLECTIVE (21j): the SCHOOL places, not the person. Every contributing member of a
 * top-3 university earns the shared campus title; the season's top contributors get the ★
 * Legendary variant. Nobody ever earns "Ascended" off this board — it's a team win.
 */
create or replace function close_season_vs_unis(p_season text)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_paid int := 0;
  u record;
  m record;
  v_title text;
  v_contributors int;
begin
  insert into season_closures (season_id, scope, scope_key) values (p_season, 'vs_unis', '')
  on conflict do nothing;
  if not found then return 0; end if;

  for u in
    select p.university, sum(universal_score(p.id)) as total,
           row_number() over (order by sum(universal_score(p.id)) desc) as place
    from profiles p
    where p.university is not null and p.university_email_verified
      and not p.is_demo and not p.is_disabled
    group by p.university
    order by total desc
    limit 3
  loop
    v_title := case u.place
      when 1 then 'title-prometheus-disciples'
      when 2 then 'title-keepers-of-the-flame'
      else 'title-champions-of-academia'
    end;

    select greatest(1, (count(*) * 0.1)::int) into v_contributors
    from profiles p
    where p.university = u.university and p.university_email_verified and not p.is_demo and not p.is_disabled;

    for m in
      select p.id as user_id,
             row_number() over (order by universal_score(p.id) desc) as contrib_rank
      from profiles p
      where p.university = u.university and p.university_email_verified
        and not p.is_demo and not p.is_disabled
    loop
      perform economy_grant_title(
        m.user_id, v_title,
        'Season ' || p_season || ' · ' || u.university || ' finished #' || u.place || ' among all schools',
        '🎓 ' || upper(u.university) || ' #' || u.place || ' · ' || p_season,
        -- ★ Legendary variant for the season's top contributors to their school's score.
        case when m.contrib_rank <= v_contributors then 'legendary' else null end
      );
      v_paid := v_paid + 1;
    end loop;
  end loop;

  return v_paid;
end;
$$;

-- The whole close, on the ONE season clock. Reads `ends_at` off the same economy_config('season')
-- row the Forge Pass reads, so the leaderboard reset, the Pass reset, and this can never drift.
create or replace function close_season_if_due()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cfg jsonb := (select value from economy_config where key = 'season');
  v_season text := v_cfg ->> 'id';
  v_ends timestamptz := (v_cfg ->> 'ends_at')::timestamptz;
  v_uni record;
  v_total int := 0;
begin
  if v_ends is null or now() < v_ends then
    return 'not due';
  end if;
  if exists (select 1 from season_closures where season_id = v_season and scope = 'global') then
    return 'already closed';
  end if;

  v_total := v_total + close_season_scope(v_season, 'global', null);
  for v_uni in
    select distinct university from profiles
    where university is not null and university_email_verified and not is_demo and not is_disabled
  loop
    v_total := v_total + close_season_scope(v_season, 'uni', v_uni.university);
  end loop;
  v_total := v_total + close_season_vs_unis(v_season);

  return 'closed ' || v_season || ' · ' || v_total || ' grants';
end;
$$;

revoke all on function close_season_scope(text, text, text) from public, authenticated;
revoke all on function close_season_vs_unis(text) from public, authenticated;
revoke all on function close_season_if_due() from public, authenticated;

-- Give S1 an end date so the clock exists. Tunable like everything else in economy_config.
update economy_config
   set value = value || jsonb_build_object('ends_at', (now() + interval '90 days')::text)
 where key = 'season' and not (value ? 'ends_at');

-- Daily check rather than a one-shot at an exact timestamp: a missed tick just closes a few hours
-- late instead of never, and close_season_if_due is idempotent so extra ticks cost nothing.
select cron.unschedule('philoi-season-close') where exists (select 1 from cron.job where jobname = 'philoi-season-close');
select cron.schedule('philoi-season-close', '15 3 * * *', $$select close_season_if_due();$$);
