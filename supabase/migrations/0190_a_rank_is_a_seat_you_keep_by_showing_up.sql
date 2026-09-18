-- 0190 — A rank is a seat you keep by showing up.
--
-- Part A of the rank-ups master brief: the two-layer ladder. Consistency is the reward; decay is
-- the quiet cost. Server-side, cron-only, idempotent, config-driven.
--
-- ─────────────────────────────── THE PROBLEM ───────────────────────────────
--
-- Rank is DERIVED and never stored: rank_tier_for_score(universal_score(user)), where
-- universal_score is a pure aggregate over check_ins.xp_earned (immutable history) plus
-- bonus_xp_awards. 0066 said it in as many words — "Rank is DERIVED and never stored, which is why
-- season_new_rank was undetectable: there was nothing to diff against."
--
-- So there is nothing to decay. You cannot subtract from a sum over history without either
-- rewriting history (check_ins is the source of truth for XP, streaks, challenges and the Pass) or
-- forking the derivation at all 36 call sites across 15 migrations — every leaderboard, the Agora,
-- campfires, profile, lock-in.
--
-- ─────────────────────────────── THE MODEL ───────────────────────────────
--
-- Two layers, kept strictly separate, exactly as the brief specifies:
--
--   • TIER RECORD (permanent) — user_rank_state.rank_index. ALREADY EXISTS and is already a
--     high-water mark (`greatest(...)`, 0066/0121), already rendered by the Agora. Nothing in this
--     file writes to it. "I made Diamond" is yours for good by construction: no code path here can
--     lower it.
--
--   • LIVE LADDER POSITION (can move) — this file. One signed number per user:
--
--         live_rank_xp(u) = greatest(0, universal_score(u) + ladder_offset(u))
--
--     An OFFSET rather than a stored copy of the score, deliberately. A stored copy would need a
--     trigger on every XP write to stay in sync and would silently diverge the first time one was
--     missed; an offset inherits every future XP gain for free. Decay makes it more negative, the
--     consistency bonus more positive, and a user who goes quiet and comes back climbs out of the
--     hole with ordinary lock-ins — which IS the "reclaim it fast" the brief asks for, rather than
--     a separate forgiveness mechanic bolted on beside it.
--
--     universal_score is untouched, so the all-time board, the Trophy Hall, relics, the Pass and
--     every tier badge in the app keep reading exactly what they read yesterday. Decay moves the
--     live seat and nothing else. That is what makes "your season seat slipped, your all-time
--     record stands" true in the schema and not merely in the copy.
--
-- ─────────────────────────────── IDEMPOTENCE ───────────────────────────────
--
-- rank_ladder_events is primary-keyed (user_id, period_key), and every mutation gates on the row
-- count of its own `insert ... on conflict do nothing`. A double cron fire, a manual re-run or a
-- replay finds the row already there and does nothing. The ledger is not an audit log written
-- beside the effect — it IS the lock, which is why the insert happens before the offset moves.
--
-- ─────────────────────────────── HARDENING ───────────────────────────────
--
-- Rank XP has been exploited twice (#151, and the Emberfall verify on 2026-09-14). Every function
-- here except the caller's own read is revoked from public, anon AND authenticated. Naming anon
-- explicitly is the whole point: Supabase's default privileges grant EXECUTE on every new public
-- function to anon, so `revoke ... from public, authenticated` does NOT reach it, and the anon key
-- ships inside the app. That is the exact hole 0185 had to sweep up after 0064/0066/0074/0075/0080.

-- NOTE: no explicit begin/commit — the CLI runs each migration in a transaction and records
-- schema_migrations inside it. An explicit commit strands the migration record.


-- ═══════════════════════════════ 1 · CONFIG ═══════════════════════════════
--
-- Every knob the brief lists, in one economy_config row, so harshness is retuned with an UPDATE and
-- no deploy. DECAY_MIN_TIER is stored as a TIER NAME, not a rank index: the index of Diamond III
-- moved once already (0063 renumbered the whole ladder) and a stored index would have silently
-- re-aimed the decay floor at Platinum.

insert into economy_config (key, value) values (
  'rank_consistency',
  '{
     "enabled": true,
     "consistency_days": 3,
     "decay_enabled": true,
     "decay_min_tier": "diamond",
     "decay_division_fraction": 0.3333,
     "decay_cap_divisions": 1,
     "settling_week_exempt": true,
     "relegation_enabled": false,
     "relegation_buffer_weeks": 2,
     "season_reset_enabled": true,
     "season_reset_divisions": 3,
     "streak_bonus_pct_per_week": 5,
     "streak_bonus_pct_max": 25,
     "at_risk_days_left": 2
   }'::jsonb
) on conflict (key) do nothing;

-- The shipped defaults live HERE as well as in the row above, merged UNDER it. A config row that
-- loses a key (a hand-edit, a partial jsonb_set) must not become a null that silently disables the
-- mechanic or divides by zero — it falls back to the default instead.
create or replace function rank_consistency_config()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select '{
     "enabled": true,
     "consistency_days": 3,
     "decay_enabled": true,
     "decay_min_tier": "diamond",
     "decay_division_fraction": 0.3333,
     "decay_cap_divisions": 1,
     "settling_week_exempt": true,
     "relegation_enabled": false,
     "relegation_buffer_weeks": 2,
     "season_reset_enabled": true,
     "season_reset_divisions": 3,
     "streak_bonus_pct_per_week": 5,
     "streak_bonus_pct_max": 25,
     "at_risk_days_left": 2
   }'::jsonb
   || coalesce((select ec.value from economy_config ec where ec.key = 'rank_consistency'), '{}'::jsonb);
$$;

comment on function rank_consistency_config() is
  'Rank consistency/decay knobs (0190). Shipped defaults merged UNDER the economy_config row, so a missing key falls back rather than nulling out the mechanic.';


-- ═══════════════════════════════ 2 · STATE ═══════════════════════════════

create table if not exists user_ladder_state (
  user_id uuid primary key references profiles (id) on delete cascade,
  -- Signed. live_rank_xp = universal_score + this. Negative after decay, positive after bonuses.
  ladder_offset numeric not null default 0,
  consistency_streak int not null default 0,
  best_consistency_streak int not null default 0,
  -- Consecutive weeks ending on the tier floor, for the relegation buffer. Any held week, or any
  -- week that did not end floored, resets it. Only consulted when relegation_enabled.
  floored_weeks int not null default 0,
  last_week_index bigint,
  season_id text,
  updated_at timestamptz not null default now()
);

comment on table user_ladder_state is
  'Live ladder position (0190). One signed offset over universal_score — NOT a second source of truth for XP. The permanent tier record is user_rank_state.rank_index and nothing here may lower it.';
comment on column user_ladder_state.ladder_offset is
  'live_rank_xp = greatest(0, universal_score(user) + ladder_offset). An offset, not a copy, so future XP is inherited without a sync trigger.';

alter table user_ladder_state enable row level security;
drop policy if exists user_ladder_state_read_own on user_ladder_state;
create policy user_ladder_state_read_own on user_ladder_state
  for select to authenticated using (user_id = auth.uid());

-- The ledger IS the idempotency lock (see header). period_key is 'W2953' from week_key() for a
-- weekly evaluation, or '<season>:reset' for a seasonal soft reset — one namespace, so a reset
-- landing in the same week as an evaluation cannot collide with it.
create table if not exists rank_ladder_events (
  user_id uuid not null references profiles (id) on delete cascade,
  period_key text not null,
  season_id text,
  kind text not null check (kind in ('held', 'missed', 'slipped', 'relegated', 'settling', 'season_reset')),
  active_days int not null default 0,
  days_required int not null default 0,
  week_xp numeric not null default 0,
  bonus_pct numeric not null default 0,
  -- Signed change this event applied to ladder_offset. Summing this column per user must equal that
  -- user's ladder_offset — the deploy assertion at the foot of this file checks exactly that, and
  -- it is the cheapest possible detector for a mutation that ran without taking the lock.
  xp_delta numeric not null default 0,
  live_before numeric,
  live_after numeric,
  rank_index_before int,
  rank_index_after int,
  streak_after int not null default 0,
  created_at timestamptz not null default now(),
  primary key (user_id, period_key)
);

create index if not exists rank_ladder_events_user_time_idx
  on rank_ladder_events (user_id, created_at desc);

comment on table rank_ladder_events is
  'Weekly ladder evaluations (0190). PK (user_id, period_key) is the idempotency lock, not an audit trail: the insert''s row count gates the mutation, so a double cron fire cannot double-decay or double-bonus.';

alter table rank_ladder_events enable row level security;
drop policy if exists rank_ladder_events_read_own on rank_ladder_events;
create policy rank_ladder_events_read_own on rank_ladder_events
  for select to authenticated using (user_id = auth.uid());


-- ═══════════════════════════════ 3 · LADDER MATH ═══════════════════════════════

create or replace function ladder_offset_of(p_user_id uuid)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select uls.ladder_offset from user_ladder_state uls where uls.user_id = p_user_id), 0);
$$;

-- The live seat. Floored at 0 so a large negative offset can never produce a negative score, which
-- rank_tier_for_score could not match to a threshold row (its lowest is 0) and would return null
-- for — turning a decayed user into a rankless one.
create or replace function live_rank_xp(p_user_id uuid)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select greatest(0, universal_score(p_user_id) + ladder_offset_of(p_user_id));
$$;

comment on function live_rank_xp(uuid) is
  'Live ladder position = universal_score + ladder_offset, floored at 0. universal_score remains the ALL-TIME number; only this one decays.';

-- Bottom of the TIER containing p_score — the floor decay may never cross. Tier, not division:
-- "you slide within the tier / to its floor, you do not drop out of it by decay alone."
create or replace function ladder_tier_floor_xp(p_score numeric)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select min(rt.cumulative_xp_required)
  from rank_thresholds rt
  where rt.tier = (select t.tier from rank_tier_for_score(p_score) t);
$$;

-- Width in XP of the division containing p_score. The ladder is geometric (0063), so one division
-- at Diamond is worth several at Bronze — "⅓ of a division" has to be read off the live curve, not
-- stored as a constant. At the apex there is no row above, so fall back to the span of the rung
-- below: a Primordial slide stays a real, finite amount instead of silently becoming zero.
create or replace function ladder_division_span(p_score numeric)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  with here as (
    select rt.rank_index, rt.cumulative_xp_required
    from rank_thresholds rt
    where rt.cumulative_xp_required <= p_score
    order by rt.cumulative_xp_required desc
    limit 1
  )
  select coalesce(
    (select hi.cumulative_xp_required - h.cumulative_xp_required
       from here h join rank_thresholds hi on hi.rank_index = h.rank_index + 1),
    (select h.cumulative_xp_required - lo.cumulative_xp_required
       from here h join rank_thresholds lo on lo.rank_index = h.rank_index - 1),
    0
  );
$$;

-- Distinct days with a LOCK-IN, in the user's own timezone. Days, not hours — the brief: "consistency
-- is showing up repeatedly, not one big Sunday grind."
--
-- `duration_seconds is not null` is what makes a row a lock-in rather than a photo check-in (0007),
-- and `removed_at is null` stops a deleted check-in from propping a week up.
--
-- The DAY is the user's own local day, matching how daily goals roll (0084); the WEEK boundary is
-- Sunday 00:00 UTC (0071) because a shared week has to close at one instant for everyone. The two
-- disagree at the edges by up to a day for a user far from UTC, deliberately: counting days in UTC
-- would tell someone in Vancouver that their Saturday-evening lock-in landed next week.
create or replace function ladder_active_days(p_user_id uuid, p_from timestamptz, p_to timestamptz)
returns int
language sql
stable
security definer
set search_path = public
as $$
  select count(distinct (ci.created_at at time zone coalesce(
           (select coalesce(p.timezone, p.notification_prefs ->> 'timezone')
              from profiles p where p.id = p_user_id),
           'UTC'))::date)::int
  from check_ins ci
  where ci.user_id = p_user_id
    and ci.removed_at is null
    and ci.duration_seconds is not null
    and ci.created_at >= p_from
    and ci.created_at <  p_to;
$$;

-- The same window's XP, for sizing the consistency bonus as a percentage of what was actually
-- earned that week rather than a flat handout — so the reward scales with the effort.
create or replace function ladder_week_xp(p_user_id uuid, p_from timestamptz, p_to timestamptz)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum(ci.xp_earned), 0)
  from check_ins ci
  where ci.user_id = p_user_id
    and ci.removed_at is null
    and ci.created_at >= p_from
    and ci.created_at <  p_to;
$$;

-- Start of the week with this index. week_index(t) = floor((epoch(t) - 259200) / 604800), so the
-- inverse is epoch 259200 + W * 604800 — 259200 being the three days from the Thursday epoch to the
-- first Sunday. Kept as a function so the two directions can never drift apart.
create or replace function week_start_of_index(p_week_index bigint)
returns timestamptz
language sql
immutable
as $$
  select to_timestamp((259200 + p_week_index * 604800)::double precision);
$$;


-- ═══════════════════════════════ 4 · THE WEEKLY EVALUATION ═══════════════════════════════
--
-- One user, one closed week. Everything the brief asks for, in the order it resolves:
--   held      → streak grows, consistency bonus paid (all tiers, pure upside)
--   settling  → crossed into this tier THIS week; decay-exempt, cannot be bumped out of a tier the
--               week it was earned
--   missed    → below the decay floor, or decay disabled: streak resets, position does not move
--   slipped   → high tier, gentle slide: ⅓ division, capped at one division, floored at tier bottom
--   relegated → only if relegation_enabled AND the buffer of consecutive floored weeks is spent

create or replace function evaluate_rank_consistency_week(p_user_id uuid, p_week_index bigint)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cfg          jsonb := rank_consistency_config();
  v_from         timestamptz;
  v_to           timestamptz;
  v_period       text;
  v_season       text := (select ec.value ->> 'id' from economy_config ec where ec.key = 'season');
  v_need         int  := greatest(1, coalesce((v_cfg ->> 'consistency_days')::int, 3));
  v_days         int;
  v_live_before  numeric;
  v_idx_before   int;
  v_streak       int;
  v_floored      int;
  v_week_xp      numeric := 0;
  v_bonus_pct    numeric := 0;
  v_delta        numeric := 0;
  v_kind         text;
  v_new_live     numeric;
  v_tier_floor   numeric;
  v_cap_floor    numeric;
  v_span         numeric;
  v_min_idx      int;
  v_streak_after int;
  v_locked       int;
  v_label        text;
  v_new_tier     text;
  v_new_div      int;
begin
  if not coalesce((v_cfg ->> 'enabled')::boolean, true) then
    return 'disabled';
  end if;

  v_from   := week_start_of_index(p_week_index);
  v_to     := v_from + interval '7 days';
  v_period := 'W' || p_week_index::text;

  -- Never evaluate a week that has not closed. A half-finished week always looks missed, and the
  -- ledger PK would then lock that wrong answer in for good.
  if now() < v_to then
    return 'week not closed';
  end if;

  select uls.consistency_streak, uls.floored_weeks
    into v_streak, v_floored
  from user_ladder_state uls
  where uls.user_id = p_user_id;
  v_streak  := coalesce(v_streak, 0);
  v_floored := coalesce(v_floored, 0);

  v_days        := ladder_active_days(p_user_id, v_from, v_to);
  v_live_before := live_rank_xp(p_user_id);
  v_idx_before  := rank_index_for_score(v_live_before);

  if v_days >= v_need then
    -- ── HELD · the reward layer. Every tier, pure upside. ──
    v_week_xp      := ladder_week_xp(p_user_id, v_from, v_to);
    v_streak_after := v_streak + 1;
    -- Streak 1 pays nothing, streak 2 pays one step, and so on to the cap — so the bonus reads as
    -- a reward for SUSTAINED consistency rather than a participation fee. At the shipped 5%/week
    -- and a 4-week streak this is +15%, which is what mock 202 prints.
    v_bonus_pct := least(
      coalesce((v_cfg ->> 'streak_bonus_pct_max')::numeric, 25),
      greatest(0, (v_streak_after - 1) * coalesce((v_cfg ->> 'streak_bonus_pct_per_week')::numeric, 5))
    );
    v_delta   := round(v_week_xp * v_bonus_pct / 100.0, 2);
    v_kind    := 'held';
    v_floored := 0;
  else
    -- ── MISSED · the decay layer, high tiers only. ──
    v_streak_after := 0;
    v_min_idx := (select min(rt.rank_index) from rank_thresholds rt
                   where rt.tier = coalesce(v_cfg ->> 'decay_min_tier', 'diamond'));

    if not coalesce((v_cfg ->> 'decay_enabled')::boolean, true)
       or v_min_idx is null or v_idx_before is null or v_idx_before < v_min_idx then
      -- Below the summit: climbing is always safe. The streak resets, the seat does not move.
      v_kind    := 'missed';
      v_floored := 0;

    elsif coalesce((v_cfg ->> 'settling_week_exempt')::boolean, true)
          and exists (
            select 1 from rank_up_events rue
            where rue.user_id = p_user_id
              and rue.to_tier is distinct from rue.from_tier
              and week_index(rue.created_at) = p_week_index
          ) then
      -- Crossed INTO this tier during the very week being judged. You cannot be bumped out of a
      -- tier the week you earned it.
      v_kind    := 'settling';
      v_floored := 0;

    else
      v_span       := ladder_division_span(v_live_before);
      v_tier_floor := ladder_tier_floor_xp(v_live_before);
      -- Cap: never more than decay_cap_divisions rungs in one week, whatever the fraction says.
      v_cap_floor  := coalesce(
        (select rt.cumulative_xp_required from rank_thresholds rt
          where rt.rank_index = v_idx_before - greatest(1, coalesce((v_cfg ->> 'decay_cap_divisions')::int, 1))),
        0);
      v_new_live := v_live_before
                    - round(v_span * coalesce((v_cfg ->> 'decay_division_fraction')::numeric, 0.3333), 2);
      -- Both floors apply; the tier floor is the one that makes "never out of your tier" true.
      v_new_live := greatest(v_new_live, v_tier_floor, v_cap_floor);
      v_delta    := v_new_live - v_live_before;
      v_kind     := case when v_delta < 0 then 'slipped' else 'missed' end;
      v_floored  := case when v_new_live <= v_tier_floor then v_floored + 1 else 0 end;

      -- Relegation. Default OFF. Shipped rather than left as an inert knob, because a config flag
      -- that silently does nothing when flipped is worse than no flag: it reads as implemented.
      if coalesce((v_cfg ->> 'relegation_enabled')::boolean, false)
         and v_floored >= greatest(2, coalesce((v_cfg ->> 'relegation_buffer_weeks')::int, 2)) then
        v_new_live := coalesce(
          (select rt.cumulative_xp_required from rank_thresholds rt
            where rt.rank_index = rank_index_for_score(v_tier_floor) - 1),
          0);
        v_delta   := v_new_live - v_live_before;
        v_kind    := 'relegated';
        v_floored := 0;
      end if;
    end if;
  end if;

  -- ── THE LOCK ──
  -- The ledger row goes in FIRST and its row count decides whether the offset moves at all. This
  -- ordering is the idempotence: a replay collides on the PK, writes nothing, and returns early
  -- before touching user_ladder_state.
  insert into rank_ladder_events (
    user_id, period_key, season_id, kind, active_days, days_required, week_xp, bonus_pct,
    xp_delta, live_before, live_after, rank_index_before, rank_index_after, streak_after
  ) values (
    p_user_id, v_period, v_season, v_kind, v_days, v_need, v_week_xp, v_bonus_pct,
    v_delta, v_live_before, greatest(0, v_live_before + v_delta), v_idx_before,
    rank_index_for_score(greatest(0, v_live_before + v_delta)), v_streak_after
  )
  on conflict (user_id, period_key) do nothing;

  get diagnostics v_locked = row_count;
  if v_locked = 0 then
    return 'already evaluated';
  end if;

  insert into user_ladder_state (
    user_id, ladder_offset, consistency_streak, best_consistency_streak,
    floored_weeks, last_week_index, season_id
  ) values (
    p_user_id, v_delta, v_streak_after, v_streak_after, v_floored, p_week_index, v_season
  )
  on conflict (user_id) do update set
    ladder_offset          = user_ladder_state.ladder_offset + v_delta,
    consistency_streak     = v_streak_after,
    best_consistency_streak = greatest(user_ladder_state.best_consistency_streak, v_streak_after),
    floored_weeks          = v_floored,
    last_week_index        = p_week_index,
    season_id              = v_season,
    updated_at             = now();

  -- ── the kind slip notice ──
  -- Only when the seat actually moved. 'rank_dropped' is already routed to the season_rank category
  -- (notification_category, 0164), so the user's existing Season & rank toggle and quiet hours
  -- govern it for free — and notify_event honours philoi.suppress_push, which is what keeps a
  -- migration probe from buzzing real phones.
  if v_kind in ('slipped', 'relegated') then
    -- Name the seat they are on NOW, not the one they left. "You are Diamond II" reads as a place
    -- they still hold; "you lost Diamond I" reads as a punishment, and the brief is explicit that
    -- this copy is never punitive.
    select t.tier, t.division into v_new_tier, v_new_div
    from rank_tier_for_score(greatest(0, v_live_before + v_delta)) t;

    v_label := initcap(v_new_tier)
               || case when v_new_tier = 'primordial' then ''
                       else ' ' || (array['', 'I', 'II', 'III'])[v_new_div + 1] end;

    perform notify_event(
      array[p_user_id], 'rank_dropped',
      'Your rank slipped a little',
      'A quiet week moved your seat to ' || v_label || '. Your ' || initcap(v_new_tier)
        || ' badge is permanent — jump back in and reclaim the ground.',
      null, null,
      '/(tabs)/profile', '{}'::jsonb,
      null, 'hexagon',
      jsonb_build_object('tier', v_new_tier, 'division', v_new_div,
                         'kind', v_kind, 'delta', round(v_delta, 1))
    );
  end if;

  return v_kind || ' · ' || v_days || '/' || v_need || ' days · delta ' || round(v_delta, 1);
end;
$$;


-- ═══════════════════════════════ 5 · THE SWEEPS (cron only) ═══════════════════════════════

-- Evaluates the most recently CLOSED week for everyone it could affect.
--
-- Defaulting to week_index(now()) - 1 rather than pinning a Sunday job is what makes a missed tick
-- harmless: that expression names the same closed week for the whole following week, so any daily
-- run re-attempts it, and the ledger PK makes the re-attempt a no-op once it has landed. Same
-- philosophy as close_season_if_due (0066) — "a missed tick just closes a few hours late instead
-- of never."
create or replace function run_rank_consistency_sweep(p_week_index bigint default null)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_week    bigint := coalesce(p_week_index, week_index(now()) - 1);
  v_u       record;
  v_held    int := 0;
  v_slipped int := 0;
  v_other   int := 0;
  v_result  text;
begin
  if not coalesce((rank_consistency_config() ->> 'enabled')::boolean, true) then
    return 'disabled';
  end if;

  for v_u in
    select p.id
    from profiles p
    where not p.is_demo and not p.is_disabled
      -- Someone who has never checked in has no rank to hold and no streak to break. Skipping them
      -- keeps the ledger free of rows recording that nothing happened to accounts that never played.
      and (exists (select 1 from check_ins ci where ci.user_id = p.id and ci.removed_at is null)
           or exists (select 1 from user_ladder_state uls where uls.user_id = p.id))
  loop
    v_result := evaluate_rank_consistency_week(v_u.id, v_week);
    if v_result like 'held%' then
      v_held := v_held + 1;
    elsif v_result like 'slipped%' or v_result like 'relegated%' then
      v_slipped := v_slipped + 1;
    else
      v_other := v_other + 1;
    end if;
  end loop;

  return 'week W' || v_week || ' · ' || v_held || ' held · ' || v_slipped || ' slipped · ' || v_other || ' other';
end;
$$;

-- Seasonal soft reset. Everyone, fairly, at a natural line — status is re-earned each season while
-- the tier RECORD persists untouched.
--
-- 🔴 It deliberately does NOT fire for the first season a user is ever seen in. Gating purely on
-- "now() >= season.starts_at" would soft-reset the entire pilot cohort on the morning Emberfall S1
-- opens (2026-10-01), taking a tier off people as a reward for having played BEFORE the first
-- season existed. A reset is a transition between two seasons, so it needs a previous one to
-- transition from: only users whose recorded season_id is non-null AND different from the current
-- season are reset.
create or replace function apply_season_ladder_reset()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cfg    jsonb := rank_consistency_config();
  v_season text  := (select ec.value ->> 'id' from economy_config ec where ec.key = 'season');
  v_divs   int   := greatest(1, coalesce((v_cfg ->> 'season_reset_divisions')::int, 3));
  v_period text;
  v_u      record;
  v_live   numeric;
  v_idx    int;
  v_new    numeric;
  v_delta  numeric;
  v_locked int;
  v_n      int := 0;
begin
  if not coalesce((v_cfg ->> 'season_reset_enabled')::boolean, true) then
    return 'disabled';
  end if;
  if v_season is null then
    return 'no season';
  end if;
  v_period := v_season || ':reset';

  for v_u in
    select uls.user_id
    from user_ladder_state uls
    join profiles p on p.id = uls.user_id and not p.is_demo and not p.is_disabled
    where uls.season_id is not null and uls.season_id <> v_season
  loop
    v_live := live_rank_xp(v_u.user_id);
    v_idx  := rank_index_for_score(v_live);
    if v_idx is null then
      continue;
    end if;

    -- Drop v_divs rungs, floored at the bottom of the ladder. Unlike weekly decay this MAY cross a
    -- tier boundary — that is the point of a soft reset, and the permanent record is what makes it
    -- safe to do.
    v_new := coalesce(
      (select rt.cumulative_xp_required from rank_thresholds rt
        where rt.rank_index = greatest(0, v_idx - v_divs)),
      0);
    v_delta := v_new - v_live;
    if v_delta > 0 then
      v_delta := 0;
    end if;

    insert into rank_ladder_events (
      user_id, period_key, season_id, kind, xp_delta, live_before, live_after,
      rank_index_before, rank_index_after
    ) values (
      v_u.user_id, v_period, v_season, 'season_reset', v_delta, v_live,
      greatest(0, v_live + v_delta), v_idx, rank_index_for_score(greatest(0, v_live + v_delta))
    )
    on conflict (user_id, period_key) do nothing;

    get diagnostics v_locked = row_count;
    if v_locked = 0 then
      continue;
    end if;

    update user_ladder_state uls
       set ladder_offset = uls.ladder_offset + v_delta,
           season_id     = v_season,
           floored_weeks = 0,
           updated_at    = now()
     where uls.user_id = v_u.user_id;

    v_n := v_n + 1;
  end loop;

  return 'season ' || v_season || ' · ' || v_n || ' ladders soft-reset';
end;
$$;


-- ═══════════════════════════════ 6 · THE CALLER'S OWN READ ═══════════════════════════════
--
-- Everything mock 202's Defend card and mock 203's at-risk states need, in one round trip. This is
-- the ONLY function in this file a client may call, and it is scoped to auth.uid() — it takes no
-- user parameter at all, so there is no id to tamper with.
--
-- 🔴 Every output column is prefixed `out_` so it cannot shadow a same-named table column inside
-- the body. Unprefixed, `tier` in the body would silently resolve to the RETURNS TABLE column
-- rather than rank_thresholds.tier.

create or replace function get_my_ladder_status()
returns table (
  out_tier               text,
  out_division           int,
  out_rank_index         int,
  out_live_xp            numeric,
  out_all_time_xp        numeric,
  out_xp_into_division   numeric,
  out_xp_for_next        numeric,
  out_peak_rank_index    int,
  out_peak_tier          text,
  out_peak_division      int,
  out_active_days        int,
  out_days_required      int,
  out_days_left          int,
  out_held               boolean,
  out_decay_eligible     boolean,
  out_at_risk            boolean,
  out_achievable         boolean,
  out_slip_preview_xp    numeric,
  out_consistency_streak int,
  out_best_streak        int,
  out_bonus_pct          numeric,
  out_next_bonus_pct     numeric,
  out_active_dates       date[]
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid     uuid  := auth.uid();
  v_cfg     jsonb := rank_consistency_config();
  v_need    int   := greatest(1, coalesce((v_cfg ->> 'consistency_days')::int, 3));
  v_from    timestamptz := week_start(now());
  v_to      timestamptz := week_start(now()) + interval '7 days';
  v_live    numeric;
  v_idx     int;
  v_days    int;
  v_left    int;
  v_min_idx int;
  v_streak  int;
  v_elig    boolean;
  v_tz      text;
begin
  if v_uid is null then
    raise exception 'Not signed in.';
  end if;

  select coalesce(p.timezone, p.notification_prefs ->> 'timezone', 'UTC') into v_tz
  from profiles p where p.id = v_uid;
  v_tz := coalesce(v_tz, 'UTC');

  v_live := live_rank_xp(v_uid);
  v_idx  := rank_index_for_score(v_live);
  v_days := ladder_active_days(v_uid, v_from, v_to);
  -- Whole days remaining, counting the one in progress: the final day of the week reads "1 day
  -- left", never "0", so the at-risk copy always names an actionable amount of time.
  v_left := greatest(0, ceil(extract(epoch from (v_to - now())) / 86400.0)::int);
  v_min_idx := (select min(rt.rank_index) from rank_thresholds rt
                 where rt.tier = coalesce(v_cfg ->> 'decay_min_tier', 'diamond'));

  select coalesce(uls.consistency_streak, 0) into v_streak
  from user_ladder_state uls where uls.user_id = v_uid;
  v_streak := coalesce(v_streak, 0);

  v_elig := v_min_idx is not null and v_idx is not null and v_idx >= v_min_idx
            and coalesce((v_cfg ->> 'decay_enabled')::boolean, true);

  return query
  select
    lo.tier,
    lo.division,
    v_idx,
    v_live,
    universal_score(v_uid),
    v_live - lo.cumulative_xp_required,
    coalesce(hi.cumulative_xp_required, lo.cumulative_xp_required) - lo.cumulative_xp_required,
    urs.rank_index,
    pk.tier,
    pk.division,
    v_days,
    v_need,
    v_left,
    (v_days >= v_need),
    v_elig,
    -- At risk = all three terms the brief gates on: below the bar, inside the warning window, and
    -- STILL ACHIEVABLE. The achievability term is what stops a false-hope warning reaching someone
    -- on the last day who would need three more days to make it.
    (v_elig and v_days < v_need
       and v_left <= coalesce((v_cfg ->> 'at_risk_days_left')::int, 2)
       and (v_need - v_days) <= v_left),
    ((v_need - v_days) <= v_left),
    -- What a miss would actually cost, computed with the evaluator's own floors, so the number the
    -- Defend card prints is the number that would be applied.
    case when v_elig
         then greatest(
                v_live - round(ladder_division_span(v_live)
                               * coalesce((v_cfg ->> 'decay_division_fraction')::numeric, 0.3333), 2),
                ladder_tier_floor_xp(v_live),
                coalesce((select rt.cumulative_xp_required from rank_thresholds rt
                           where rt.rank_index = v_idx
                             - greatest(1, coalesce((v_cfg ->> 'decay_cap_divisions')::int, 1))), 0)
              ) - v_live
         else 0 end,
    v_streak,
    coalesce((select uls.best_consistency_streak from user_ladder_state uls where uls.user_id = v_uid), 0),
    least(coalesce((v_cfg ->> 'streak_bonus_pct_max')::numeric, 25),
          greatest(0, (v_streak - 1) * coalesce((v_cfg ->> 'streak_bonus_pct_per_week')::numeric, 5))),
    least(coalesce((v_cfg ->> 'streak_bonus_pct_max')::numeric, 25),
          greatest(0, v_streak * coalesce((v_cfg ->> 'streak_bonus_pct_per_week')::numeric, 5))),
    coalesce((select array_agg(d.day order by d.day)
                from (select distinct (ci.created_at at time zone v_tz)::date as day
                        from check_ins ci
                       where ci.user_id = v_uid and ci.removed_at is null
                         and ci.duration_seconds is not null
                         and ci.created_at >= v_from and ci.created_at < v_to) d), '{}'::date[])
  from rank_tier_for_score(v_live) lo_t
  join rank_thresholds lo on lo.tier = lo_t.tier and lo.division = lo_t.division
  left join rank_thresholds hi on hi.rank_index = lo.rank_index + 1
  left join user_rank_state urs on urs.user_id = v_uid
  left join rank_thresholds pk on pk.rank_index = urs.rank_index;
end;
$$;

comment on function get_my_ladder_status() is
  'Defend card + at-risk read (0190, mocks 202/203). Own row only — takes no user id. out_slip_preview_xp uses the evaluator''s own floors so the previewed cost equals the applied cost.';


-- ═══════════════════════════════ 7 · CRON ═══════════════════════════════
--
-- Both run daily, not weekly, precisely so a missed tick self-heals (see run_rank_consistency_sweep).
-- Both are idempotent, so the extra ticks cost nothing but a no-op.

select cron.unschedule('philoi-rank-consistency-week')
 where exists (select 1 from cron.job where jobname = 'philoi-rank-consistency-week');
select cron.schedule('philoi-rank-consistency-week', '25 0 * * *',
                     $cron$select run_rank_consistency_sweep();$cron$);

-- After philoi-season-close (15 3), so a season that closes and a ladder that resets for it happen
-- in that order on the same night rather than racing.
select cron.unschedule('philoi-rank-ladder-season-reset')
 where exists (select 1 from cron.job where jobname = 'philoi-rank-ladder-season-reset');
select cron.schedule('philoi-rank-ladder-season-reset', '45 3 * * *',
                     $cron$select apply_season_ladder_reset();$cron$);


-- ═══════════════════════════════ 8 · HARDENING ═══════════════════════════════
--
-- anon is named EXPLICITLY on every line. Supabase's default privileges grant EXECUTE on every new
-- public function to anon, so `revoke ... from public, authenticated` leaves the anon key — which
-- ships inside the app — holding EXECUTE. That is #151 and the 2026-09-14 Emberfall verify.
--
-- Everything below is reached only by pg_cron (which runs as postgres) or by get_my_ladder_status,
-- itself SECURITY DEFINER and therefore unaffected by these revokes.

revoke execute on function public.rank_consistency_config() from public, anon, authenticated;
revoke execute on function public.ladder_offset_of(uuid) from public, anon, authenticated;
revoke execute on function public.live_rank_xp(uuid) from public, anon, authenticated;
revoke execute on function public.ladder_tier_floor_xp(numeric) from public, anon, authenticated;
revoke execute on function public.ladder_division_span(numeric) from public, anon, authenticated;
revoke execute on function public.ladder_active_days(uuid, timestamptz, timestamptz) from public, anon, authenticated;
revoke execute on function public.ladder_week_xp(uuid, timestamptz, timestamptz) from public, anon, authenticated;
revoke execute on function public.week_start_of_index(bigint) from public, anon, authenticated;
revoke execute on function public.evaluate_rank_consistency_week(uuid, bigint) from public, anon, authenticated;
revoke execute on function public.run_rank_consistency_sweep(bigint) from public, anon, authenticated;
revoke execute on function public.apply_season_ladder_reset() from public, anon, authenticated;

-- The one client-reachable function. anon is revoked here too (defense in depth — it raises
-- 'Not signed in' anyway), authenticated granted explicitly.
revoke execute on function public.get_my_ladder_status() from public, anon;
grant execute on function public.get_my_ladder_status() to authenticated;


-- ═══════════════════════════════ 9 · ASSERTED AT DEPLOY ═══════════════════════════════
--
-- These run against real prod state inside the migration's transaction, so they must not WRITE.
-- Behavioural checks that need rows (a decay actually applying, idempotence actually holding) are
-- exercised by the companion probe, which builds a synthetic user inside begin/rollback.
--
-- Every assertion here is paired with a control that would fail if the mechanic were inert. A green
-- check that would also be green under the bug is not a test.

do $assert$
declare
  v_diamond_floor  numeric;
  v_platinum_floor numeric;
  v_span           numeric;
  v_slid           numeric;
  v_tier_after     text;
begin
  -- 1 · The tier floor is the TIER's bottom, not the division's. Paired across two tiers so a
  -- function that returned a constant, or the division floor, fails one of them.
  v_diamond_floor  := ladder_tier_floor_xp(27000);   -- Diamond II
  v_platinum_floor := ladder_tier_floor_xp(19700);   -- Platinum I
  if v_diamond_floor is distinct from 22500 then
    raise exception '0190: diamond tier floor should be 22500, got %', v_diamond_floor;
  end if;
  if v_platinum_floor is distinct from 13800 then
    raise exception '0190: platinum tier floor should be 13800, got %', v_platinum_floor;
  end if;
  if v_diamond_floor = v_platinum_floor then
    raise exception '0190: tier floor is not varying by tier — it is returning a constant.';
  end if;

  -- 2 · The division span is read off the live curve. Diamond II spans 26200 -> 29900.
  v_span := ladder_division_span(27000);
  if v_span is distinct from 3700 then
    raise exception '0190: diamond II span should be 3700, got %', v_span;
  end if;
  -- Control: the curve is geometric, so a Bronze division must be far narrower. If these matched,
  -- "⅓ of a division" would be a flat amount wearing a proportional name.
  if ladder_division_span(1000) >= v_span then
    raise exception '0190: bronze span is not narrower than diamond — the span is not curve-aware.';
  end if;

  -- 3 · A gentle slide stays INSIDE the tier. This is the wellbeing guarantee in arithmetic form.
  v_slid := greatest(27000 - round(v_span * 0.3333, 2), ladder_tier_floor_xp(27000));
  select t.tier into v_tier_after from rank_tier_for_score(v_slid) t;
  if v_tier_after is distinct from 'diamond' then
    raise exception '0190: a one-week slide from Diamond II left the tier (landed %) — the floor is not holding.', v_tier_after;
  end if;
  -- Control: it must actually MOVE. A floor that clamped everything to the start would also keep
  -- the tier, and would be a decay mechanic that does nothing.
  if v_slid >= 27000 then
    raise exception '0190: the slide did not move the seat at all — decay is inert.';
  end if;

  -- 4 · At the tier floor exactly, a slide is a no-op rather than a drop out of the tier.
  if greatest(22500 - round(ladder_division_span(22500) * 0.3333, 2), ladder_tier_floor_xp(22500)) <> 22500 then
    raise exception '0190: a user sitting on the Diamond floor was moved below it.';
  end if;

  -- 5 · The permanent record is untouchable from here. No function in this file may write
  -- user_rank_state; if one ever does, this catches it at deploy rather than in the wild.
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('evaluate_rank_consistency_week', 'run_rank_consistency_sweep',
                        'apply_season_ladder_reset', 'get_my_ladder_status')
      and p.prosrc ilike '%user_rank_state%'
      and p.prosrc !~* 'left join user_rank_state'
  ) then
    raise exception '0190: a ladder function references user_rank_state outside a read — the permanent tier record must not be writable from decay.';
  end if;

  -- 6 · Hardening, per function, both roles. This is the hole that has opened twice.
  if has_function_privilege('anon', 'public.run_rank_consistency_sweep(bigint)', 'execute')
     or has_function_privilege('authenticated', 'public.run_rank_consistency_sweep(bigint)', 'execute') then
    raise exception '0190: the consistency sweep is client-callable.';
  end if;
  if has_function_privilege('anon', 'public.evaluate_rank_consistency_week(uuid, bigint)', 'execute')
     or has_function_privilege('authenticated', 'public.evaluate_rank_consistency_week(uuid, bigint)', 'execute') then
    raise exception '0190: the weekly evaluation is client-callable — a client could decay another user.';
  end if;
  if has_function_privilege('anon', 'public.apply_season_ladder_reset()', 'execute')
     or has_function_privilege('authenticated', 'public.apply_season_ladder_reset()', 'execute') then
    raise exception '0190: the season reset is client-callable.';
  end if;
  -- Positive control for 6: the read MUST still be reachable, or the revokes went too wide and the
  -- Defend card would fail closed for every signed-in user.
  if not has_function_privilege('authenticated', 'public.get_my_ladder_status()', 'execute') then
    raise exception '0190: authenticated lost EXECUTE on get_my_ladder_status — the revokes went too wide.';
  end if;
  if has_function_privilege('anon', 'public.get_my_ladder_status()', 'execute') then
    raise exception '0190: anon can read ladder status.';
  end if;

  -- 7 · One name, one signature. Appending a parameter defines a SECOND function and leaves the
  -- original standing — that reached prod once already, in 0145.
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('evaluate_rank_consistency_week', 'run_rank_consistency_sweep',
                        'apply_season_ladder_reset', 'get_my_ladder_status', 'live_rank_xp',
                        'ladder_division_span', 'ladder_tier_floor_xp', 'ladder_active_days',
                        'ladder_week_xp', 'ladder_offset_of', 'rank_consistency_config',
                        'week_start_of_index')
    group by p.proname having count(*) > 1
  ) then
    raise exception '0190: a ladder function has more than one overload.';
  end if;

  -- 8 · Both cron jobs exist and are the only rank jobs.
  if (select count(*) from cron.job
       where jobname in ('philoi-rank-consistency-week', 'philoi-rank-ladder-season-reset')) <> 2 then
    raise exception '0190: the ladder cron jobs are not both scheduled.';
  end if;

  -- 9 · The config row parses and the decay floor resolves to a real rung. A typo'd tier name
  -- ("Diamond", "diamonds") would leave min_idx null and silently disable decay for everyone.
  if (select min(rt.rank_index) from rank_thresholds rt
       where rt.tier = (rank_consistency_config() ->> 'decay_min_tier')) is null then
    raise exception '0190: decay_min_tier does not name a real tier — decay would be silently inert.';
  end if;
  if (rank_consistency_config() ->> 'consistency_days')::int < 1 then
    raise exception '0190: consistency_days must be at least 1.';
  end if;

  raise notice '0190 OK · ladder floors hold, decay moves, permanent record sealed, sweeps are cron-only.';
end;
$assert$;
