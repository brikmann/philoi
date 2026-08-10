-- Turning the economy over (Step 21 follow-up P2): embers actually accrue, Pass XP actually
-- climbs, and grant_reward actually fires. 0064 built the vault; this fills it.
--
-- Everything here runs server-side off ALREADY-RECORDED effort. Nothing trusts a client call:
-- the entry points are triggers on lock_in_sessions / daily_fire / social_challenges, so a reward
-- can only ride on a row the server itself wrote (REWARD_ECONOMY §0.2, Step 18).

-- ───────────────────────────── config ─────────────────────────────

insert into economy_config (key, value) values
  -- Step 18's verified-effort floor. A session shorter than this pays nothing at all — it is the
  -- same floor the XP economy uses, restated here so no reward can outrun it.
  ('lock_in_min_seconds', '300'),
  -- Ember earn rates. `daily_cap` is the anti-grind rail: past it, extra lock-ins still earn XP
  -- and still climb the Pass, they just stop minting currency. Without it a marathon day could
  -- print more embers than an ember pack sells, which would gut the paid economy (§5 / 21e).
  ('ember_earn', '{"lock_in_base":15,"lock_in_per_10min":5,"lock_in_session_cap":60,"daily_cap":150,"flame_meter":50}')
on conflict (key) do nothing;

-- ───────────────────────────── internals ─────────────────────────────

-- credit_pass_xp() reads auth.uid(), which is null inside a trigger. This is the same logic with
-- the user passed in; the public RPC delegates here so there's exactly one implementation of the
-- once-per-period rule.
create or replace function economy_credit_pass_xp_for(
  p_user uuid, p_achievement text, p_xp int, p_period text
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_season text := (select value ->> 'id' from economy_config where key = 'season');
  v_inserted int;
begin
  insert into pass_xp_ledger (user_id, season_id, achievement_key, xp, period_key)
  values (p_user, v_season, p_achievement, p_xp, p_period)
  on conflict (user_id, achievement_key, period_key) do nothing;
  get diagnostics v_inserted = row_count;
  if v_inserted = 0 then return; end if;

  insert into forge_pass_state (user_id, season_id, pass_xp) values (p_user, v_season, p_xp)
  on conflict (user_id, season_id) do update set pass_xp = forge_pass_state.pass_xp + p_xp;
end;
$$;

drop function if exists credit_pass_xp(text, int, text);
create function credit_pass_xp(p_achievement text, p_xp int, p_period text)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_season text := (select value ->> 'id' from economy_config where key = 'season');
begin
  if v_user is null then raise exception 'Not signed in'; end if;
  perform economy_credit_pass_xp_for(v_user, p_achievement, p_xp, p_period);
  return coalesce((select pass_xp from forge_pass_state where user_id = v_user and season_id = v_season), 0);
end;
$$;

-- ───────────────────────────── P2a · ember earning ─────────────────────────────

create or replace function economy_award_lock_in_embers(p_user uuid, p_seconds int, p_ref uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cfg jsonb := (select value from economy_config where key = 'ember_earn');
  v_min int := (select value::int from economy_config where key = 'lock_in_min_seconds');
  v_award int;
  v_earned_today int;
  v_room int;
begin
  -- Below the floor this is not counted effort, so it cannot pay.
  if p_seconds is null or p_seconds < v_min then return; end if;

  v_award := least(
    (v_cfg ->> 'lock_in_session_cap')::int,
    (v_cfg ->> 'lock_in_base')::int + (p_seconds / 600) * (v_cfg ->> 'lock_in_per_10min')::int
  );

  -- Daily cap measured off the ledger itself rather than a counter column — the ledger is the
  -- record, and deriving from it means the cap can never drift out of sync with what was paid.
  select coalesce(sum(delta), 0) into v_earned_today
  from ember_ledger
  where user_id = p_user and reason = 'lock_in' and created_at >= date_trunc('day', now());

  v_room := greatest(0, (v_cfg ->> 'daily_cap')::int - v_earned_today);
  v_award := least(v_award, v_room);
  if v_award <= 0 then return; end if;

  perform economy_move_embers(p_user, v_award, 'lock_in', p_ref);
end;
$$;

-- ───────────────────────────── P2b · Pass XP achievement engine ─────────────────────────────
--
-- Detects checkpoint completion off already-recorded sessions. Every credit goes through
-- economy_credit_pass_xp_for, whose unique (user, achievement, period) index is what makes a daily
-- once-per-day — so this can be re-run as often as we like and will never double-pay.
--
-- NOT YET DETECTED (each needs signal this schema doesn't carry; the UI simply never ticks them):
--   daily_with_a_friend      — needs overlapping-session detection across a campfire
--   weekly_hit_goal          — needs per-goal cadence evaluation
--   season_new_rank          — needs rank history; rank is derived, never stored (see 0063)
create or replace function evaluate_pass_achievements(p_user uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_day text := to_char(now(), 'YYYY-MM-DD');
  v_week text := to_char(now(), 'IYYY-"W"IW');
  v_season text := (select value ->> 'id' from economy_config where key = 'season');
  v_min int := (select value::int from economy_config where key = 'lock_in_min_seconds');
  v_today_count int;
  v_today_deep boolean;
  v_today_gym boolean;
  v_today_types text[];
  v_yesterday_types text[];
  v_week_days int;
  v_week_seconds numeric;
  v_week_gym int;
  v_streak_days int;
begin
  -- ── daily ──
  select count(*),
         bool_or(extract(epoch from (s.last_confirmed_at - s.started_at)) >= 5400),
         bool_or(g.type ilike '%gym%'),
         array_agg(distinct g.type)
    into v_today_count, v_today_deep, v_today_gym, v_today_types
  from lock_in_sessions s
  join goals g on g.id = s.goal_id
  where s.user_id = p_user
    and s.status = 'completed'
    and s.started_at >= date_trunc('day', now())
    and extract(epoch from (s.last_confirmed_at - s.started_at)) >= v_min;

  if coalesce(v_today_count, 0) >= 1 then
    perform economy_credit_pass_xp_for(p_user, 'daily_first_lock_in', 50, v_day);
  end if;
  if coalesce(v_today_count, 0) >= 3 then
    perform economy_credit_pass_xp_for(p_user, 'daily_three_lock_ins', 75, v_day);
  end if;
  if coalesce(v_today_deep, false) then
    perform economy_credit_pass_xp_for(p_user, 'daily_deep_session', 100, v_day);
  end if;
  if coalesce(v_today_gym, false) then
    perform economy_credit_pass_xp_for(p_user, 'daily_gym_lock_in', 60, v_day);
  end if;

  -- "A different goal type than yesterday" — rewards varying what you do, which is the habit the
  -- app is actually trying to build (FORGE_PASS wellbeing note).
  select array_agg(distinct g.type) into v_yesterday_types
  from lock_in_sessions s
  join goals g on g.id = s.goal_id
  where s.user_id = p_user
    and s.status = 'completed'
    and s.started_at >= date_trunc('day', now()) - interval '1 day'
    and s.started_at < date_trunc('day', now());

  if v_today_types is not null and v_yesterday_types is not null
     and exists (select 1 from unnest(v_today_types) t where t <> all(v_yesterday_types)) then
    perform economy_credit_pass_xp_for(p_user, 'daily_different_goal', 40, v_day);
  end if;

  -- ── weekly ──
  select count(distinct s.started_at::date),
         coalesce(sum(extract(epoch from (s.last_confirmed_at - s.started_at))), 0),
         count(*) filter (where g.type ilike '%gym%')
    into v_week_days, v_week_seconds, v_week_gym
  from lock_in_sessions s
  join goals g on g.id = s.goal_id
  where s.user_id = p_user
    and s.status = 'completed'
    and s.started_at >= date_trunc('week', now())
    and extract(epoch from (s.last_confirmed_at - s.started_at)) >= v_min;

  if coalesce(v_week_days, 0) >= 6 then
    perform economy_credit_pass_xp_for(p_user, 'weekly_six_active_days', 300, v_week);
  end if;
  if coalesce(v_week_seconds, 0) >= 36000 then
    perform economy_credit_pass_xp_for(p_user, 'weekly_ten_hours', 250, v_week);
  end if;
  if coalesce(v_week_gym, 0) >= 5 then
    perform economy_credit_pass_xp_for(p_user, 'weekly_five_gym', 200, v_week);
  end if;

  -- ── season ──
  select count(distinct s.started_at::date) into v_streak_days
  from lock_in_sessions s
  where s.user_id = p_user
    and s.status = 'completed'
    and s.started_at >= now() - interval '30 days';

  if coalesce(v_streak_days, 0) >= 30 then
    perform economy_credit_pass_xp_for(p_user, 'season_thirty_day_streak', 500, v_season);
  end if;
end;
$$;

-- ───────────────────────────── triggers: the only entry points ─────────────────────────────

create or replace function economy_on_lock_in_completed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_seconds int;
begin
  -- Only the transition INTO completed. Without this guard any later touch of a finished row
  -- would pay again.
  if new.status <> 'completed' or coalesce(old.status, '') = 'completed' then
    return new;
  end if;

  v_seconds := greatest(0, extract(epoch from (new.last_confirmed_at - new.started_at))::int);
  perform economy_award_lock_in_embers(new.user_id, v_seconds, new.id);
  perform evaluate_pass_achievements(new.user_id);
  return new;
end;
$$;

drop trigger if exists lock_in_sessions_economy on lock_in_sessions;
create trigger lock_in_sessions_economy
  after update of status on lock_in_sessions
  for each row execute function economy_on_lock_in_completed();

-- Flame-meter completion. publish_flame_completion() only publishes a post — it has never granted
-- embers — so the grant hangs off daily_fire flipping complete, which is where the actual
-- achievement happens regardless of whether the user chooses to share it.
create or replace function economy_on_flame_meter_complete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not new.completed or coalesce(old.completed, false) then
    return new;
  end if;
  perform economy_move_embers(
    new.user_id,
    ((select value from economy_config where key = 'ember_earn') ->> 'flame_meter')::int,
    'flame_meter',
    null
  );
  return new;
end;
$$;

drop trigger if exists daily_fire_economy on daily_fire;
create trigger daily_fire_economy
  after update of completed on daily_fire
  for each row execute function economy_on_flame_meter_complete();

-- ───────────────────────────── P2c · grant_reward wiring ─────────────────────────────

-- Social challenge close (21c). finalize_social_challenges() sets status = 'completed' and, for
-- h2h, winner_id — so that transition is the hook. Group mode has no single winner, so everyone
-- who took part is paid at the completion band and the winner bonus is h2h-only.
create or replace function economy_on_social_challenge_closed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_days int;
  v_scope int;
begin
  if new.status <> 'completed' or coalesce(old.status, '') = 'completed' then
    return new;
  end if;

  v_days := greatest(1, ceil(new.window_hours / 24.0)::int);

  if new.mode = 'h2h' then
    v_scope := 1;
    if new.winner_id is not null then
      perform grant_reward(new.winner_id, 'friend_h2h', 1.0, v_days, v_scope, 0.0, true, new.id);
      -- The loser still finished the thing. Completion band only — placement 1.0 is last place.
      perform grant_reward(
        case when new.winner_id = new.created_by then new.opponent_id else new.created_by end,
        'friend_h2h', 1.0, v_days, v_scope, 1.0, true, new.id
      );
    end if;
  else
    -- Group mode has no participants table. Membership alone isn't participation either — being
    -- in the campfire while the challenge ran shouldn't pay. So a participant is someone who
    -- actually completed a qualifying lock-in inside the window, which is the same
    -- verified-effort signal everything else in this file keys off (Step 18).
    if new.circle_id is null then return new; end if;

    with participants as (
      select distinct s.user_id
      from lock_in_sessions s
      join group_members gm on gm.user_id = s.user_id and gm.group_id = new.circle_id
      where s.status = 'completed'
        and s.started_at >= new.starts_at
        and s.started_at <= coalesce(new.ends_at, now())
        and extract(epoch from (s.last_confirmed_at - s.started_at))
            >= (select value::int from economy_config where key = 'lock_in_min_seconds')
    )
    select count(*) into v_scope from participants;

    -- Real percentile placement needs the per-member standings the watch RPCs compute; until
    -- that's factored out of the read path, everyone lands on the completion band rather than
    -- being handed a guessed rank.
    perform grant_reward(pt.user_id, 'campfire_group', 1.0, v_days, greatest(v_scope, 1), 0.75, true, new.id)
    from (
      select distinct s.user_id
      from lock_in_sessions s
      join group_members gm on gm.user_id = s.user_id and gm.group_id = new.circle_id
      where s.status = 'completed'
        and s.started_at >= new.starts_at
        and s.started_at <= coalesce(new.ends_at, now())
        and extract(epoch from (s.last_confirmed_at - s.started_at))
            >= (select value::int from economy_config where key = 'lock_in_min_seconds')
    ) pt;
  end if;

  return new;
end;
$$;

drop trigger if exists social_challenges_economy on social_challenges;
create trigger social_challenges_economy
  after update of status on social_challenges
  for each row execute function economy_on_social_challenge_closed();

-- Personal goal challenges — the solo `challenges` table. No opponents, so scope is 1 and the
-- payout rides on duration alone, which is what §4a's "scale by difficulty × duration" reduces to
-- when there's nobody to place against.
create or replace function economy_on_challenge_completed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.completed_at is null or old.completed_at is not null then
    return new;
  end if;
  perform grant_reward(
    new.user_id, 'friend_h2h', 1.0,
    case when new.period = 'week' then 7 else 1 end,
    1, 0.0, true, new.id
  );
  perform evaluate_pass_achievements(new.user_id);
  return new;
end;
$$;

drop trigger if exists challenges_economy on challenges;
create trigger challenges_economy
  after update of completed_at on challenges
  for each row execute function economy_on_challenge_completed();

-- Season close (21d). Deliberately NOT a trigger: a season ends when we say it does, and it pays
-- every ranked user at once. Service-role only — no grant to `authenticated`, so nobody can close
-- a season (or re-close one to farm it) from the client.
create or replace function close_season_rewards(p_university text default null, p_limit int default 500)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_paid int := 0;
  r record;
begin
  for r in
    select p.id as user_id,
           row_number() over (order by universal_score(p.id) desc) as rank,
           count(*) over () as board_size
    from profiles p
    where not p.is_demo and not p.is_disabled
      and (p_university is null or (p.university = p_university and p.university_email_verified))
    limit p_limit
  loop
    perform grant_reward(
      r.user_id, 'season', 1.0, 90, r.board_size::int,
      (r.rank::numeric / greatest(r.board_size, 1)), true, null
    );
    v_paid := v_paid + 1;
  end loop;
  return v_paid;
end;
$$;

revoke all on function close_season_rewards(text, int) from public, authenticated;

-- ───────────────────────────── reads the client needs ─────────────────────────────

-- Other people's equipped cosmetics. get_inventory is own-rows-only by design, but "how others
-- see you" is the entire point of a loadout — so this exposes ONLY the equipped cosmetic keys of
-- the users asked for. No balances, no unopened boxes, no provenance, nothing sellable.
drop function if exists get_public_loadouts(uuid[]);
create function get_public_loadouts(p_user_ids uuid[])
returns table (user_id uuid, slot text, cosmetic_key text)
language sql
security definer
set search_path = public
stable
as $$
  select c.user_id, c.slot, c.cosmetic_key
  from cosmetics_owned c
  join profiles p on p.id = c.user_id
  where c.user_id = any(p_user_ids)
    and c.equipped
    and c.slot is not null
    and not p.is_disabled;
$$;

-- Live achievement progress for the Pass XP tab, so the list shows "2 / 3" off real data instead
-- of only a claimed/unclaimed tick.
drop function if exists get_pass_achievement_progress();
create function get_pass_achievement_progress()
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_user uuid := auth.uid();
  v_min int := (select value::int from economy_config where key = 'lock_in_min_seconds');
  v_today int;
  v_week_days int;
  v_week_seconds numeric;
  v_week_gym int;
begin
  if v_user is null then raise exception 'Not signed in'; end if;

  select count(*) into v_today
  from lock_in_sessions s
  where s.user_id = v_user and s.status = 'completed'
    and s.started_at >= date_trunc('day', now())
    and extract(epoch from (s.last_confirmed_at - s.started_at)) >= v_min;

  select count(distinct s.started_at::date),
         coalesce(sum(extract(epoch from (s.last_confirmed_at - s.started_at))), 0),
         count(*) filter (where g.type ilike '%gym%')
    into v_week_days, v_week_seconds, v_week_gym
  from lock_in_sessions s
  join goals g on g.id = s.goal_id
  where s.user_id = v_user and s.status = 'completed'
    and s.started_at >= date_trunc('week', now())
    and extract(epoch from (s.last_confirmed_at - s.started_at)) >= v_min;

  return jsonb_build_object(
    'daily_three_lock_ins', coalesce(v_today, 0),
    'weekly_six_active_days', coalesce(v_week_days, 0),
    'weekly_ten_hours', round(coalesce(v_week_seconds, 0) / 3600.0, 1),
    'weekly_five_gym', coalesce(v_week_gym, 0)
  );
end;
$$;
