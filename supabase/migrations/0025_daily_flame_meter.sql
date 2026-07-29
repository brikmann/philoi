-- Daily flame meter (design-mocks/26, PHILOI_UI_SPEC.md §5 "Daily flame meter") — an XP-goal
-- progress bar for TODAY, separate from the forever rank track. "Today" is a client-supplied
-- local calendar date + local day-start/day-end timestamps (same pattern as
-- fetchMyTodayLockInCount) — the server has no way to know the caller's timezone otherwise.

alter table profiles add column if not exists daily_goal_mode text not null default 'auto'
  check (daily_goal_mode in ('auto', 'manual'));
alter table profiles add column if not exists daily_goal_manual_target int check (daily_goal_manual_target >= 1);
-- Opt-in, default off (§5/§19) — gates whether completing the meter can post a card to the
-- user's campfires at all.
alter table profiles add column if not exists publish_flame_completion boolean not null default false;
-- Soft-currency hook (MONETIZATION.md's phase-2 "embers" cosmetics shop) — no shop/spend UI
-- yet, this just reserves the earning side so completion has somewhere real to deposit into.
alter table profiles add column if not exists embers integer not null default 0;

create table if not exists daily_fire (
  user_id uuid not null references profiles (id) on delete cascade,
  day date not null,
  -- The smoothing state carried day-to-day (§5: "smoothed off the average") — kept as its
  -- own column distinct from goal_xp so tomorrow's computation can read yesterday's *lock-in*
  -- target directly, independent of whatever XP-per-lock-in conversion was used that day.
  goal_lockins numeric not null,
  goal_xp numeric not null,
  progress_xp numeric not null default 0,
  completed boolean not null default false,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (user_id, day)
);

alter table daily_fire enable row level security;

drop policy if exists "daily_fire: read own" on daily_fire;
create policy "daily_fire: read own" on daily_fire for select using (user_id = auth.uid());

-- No insert/update policy for regular users — RPC-gated (get_or_create_daily_fire below).

-- The opt-in "I completed my fire today" card (§5: "like a lock-in") — a separate minimal
-- events model rather than reusing check_ins, since check_ins rows are assumed elsewhere to
-- be real lock-ins/photo-check-ins (lock-in counts, the profile photo grid, streaks all filter
-- on it) — a synthetic non-lock-in row there would quietly corrupt those.
create table if not exists flame_completion_posts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles (id) on delete cascade,
  day date not null,
  created_at timestamptz not null default now(),
  unique (user_id, day)
);

create table if not exists flame_completion_circles (
  post_id uuid not null references flame_completion_posts (id) on delete cascade,
  circle_id uuid not null references groups (id) on delete cascade,
  posted_at timestamptz not null default now(),
  primary key (post_id, circle_id)
);

create index if not exists flame_completion_circles_circle_idx on flame_completion_circles (circle_id, posted_at desc);

alter table flame_completion_posts enable row level security;
alter table flame_completion_circles enable row level security;

drop policy if exists "flame_completion_posts: read if circle-mate" on flame_completion_posts;
create policy "flame_completion_posts: read if circle-mate" on flame_completion_posts for select using (
  user_id = auth.uid() or is_circle_mate_of(user_id) or is_admin()
);

drop policy if exists "flame_completion_circles: read if member" on flame_completion_circles;
create policy "flame_completion_circles: read if member" on flame_completion_circles for select using (
  is_group_member(circle_id)
);

-- Owner-only writes (Settings, §19).
create or replace function set_daily_goal_mode(p_mode text, p_manual_target int default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_mode not in ('auto', 'manual') then
    raise exception 'Invalid daily goal mode.';
  end if;
  if p_mode = 'manual' and coalesce(p_manual_target, 0) < 1 then
    raise exception 'Manual daily target must be at least 1.';
  end if;

  update profiles
  set daily_goal_mode = p_mode,
      daily_goal_manual_target = case when p_mode = 'manual' then p_manual_target else daily_goal_manual_target end
  where id = auth.uid();
end;
$$;

create or replace function set_publish_flame_completion(p_enabled boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update profiles set publish_flame_completion = p_enabled where id = auth.uid();
end;
$$;

-- The daily flame meter's read+create+recompute RPC (PHILOI_UI_SPEC.md §5). Called on every
-- home-screen focus and right after a lock-in stops. Recomputes progress_xp fresh from
-- check_ins every call (no incremental trigger-maintained counter) so it's self-healing and
-- can't drift; only ever awards the completion bonus once per day (checked via the row's own
-- `completed` flag before flipping it).
--
-- Adaptive goal algorithm (all constants below are tunable placeholders, same "adjust once
-- there's usage data" status as the rank/campfire-level curves elsewhere in this file):
--   floor 1, cap 5 lock-ins/day-equivalent · +15% stretch once 3 completed days run in a row ·
--   smoothed 30% new / 70% yesterday's target so one big or zero day doesn't whipsaw it ·
--   new accounts (<7 days old) get a flat 1 for their first week · XP target = lock-in target
--   x the user's own recent average XP-per-lock-in (falls back to 50 with no history yet).
-- The rolling 14-day average bucket-by-day uses UTC day boundaries (an approximation — this
-- schema has no stored user timezone) while TODAY's own progress uses the caller-supplied
-- local day-start/day-end exactly, which is the boundary that actually matters for "did my
-- meter fill today."
create or replace function get_or_create_daily_fire(p_day date, p_day_start timestamptz, p_day_end timestamptz)
returns table (
  day date,
  goal_xp numeric,
  progress_xp numeric,
  completed boolean,
  just_completed boolean,
  bonus_xp numeric,
  bonus_embers int
)
language plpgsql
security definer
set search_path = public
as $$
declare
  c_floor constant numeric := 1;
  c_cap constant numeric := 5;
  c_stretch_streak constant int := 3;
  c_stretch_factor constant numeric := 1.15;
  c_smoothing_alpha constant numeric := 0.3;
  c_new_user_days constant int := 7;
  c_default_xp_per_lockin constant numeric := 50;
  c_completion_bonus_xp constant numeric := 50;
  c_completion_bonus_embers constant int := 5;

  v_row daily_fire;
  v_mode text;
  v_manual_target int;
  v_account_created_at timestamptz;
  v_avg_xp_per_lockin numeric;
  v_avg14 numeric;
  v_prev_goal numeric;
  v_streak int;
  v_raw_lockins numeric;
  v_goal_lockins numeric;
  v_goal_xp numeric;
  v_progress numeric;
  v_just_completed boolean := false;
  v_bonus_xp numeric := 0;
  v_bonus_embers int := 0;
begin
  select * into v_row from daily_fire where user_id = auth.uid() and day = p_day;

  if v_row.day is null then
    select daily_goal_mode, daily_goal_manual_target, created_at
    into v_mode, v_manual_target, v_account_created_at
    from profiles where id = auth.uid();

    select coalesce(avg(xp_earned), c_default_xp_per_lockin) into v_avg_xp_per_lockin
    from (
      select xp_earned from check_ins
      where user_id = auth.uid() and duration_seconds is not null and removed_at is null
      order by created_at desc limit 30
    ) recent;

    if v_mode = 'manual' then
      v_goal_lockins := greatest(1, coalesce(v_manual_target, 1));
    elsif v_account_created_at > p_day_start - (c_new_user_days || ' days')::interval then
      v_goal_lockins := c_floor;
    else
      select coalesce(count(*)::numeric, 0) / 14.0 into v_avg14
      from check_ins
      where user_id = auth.uid()
        and duration_seconds is not null and removed_at is null
        and created_at >= p_day_start - interval '14 days'
        and created_at < p_day_start;

      select goal_lockins into v_prev_goal from daily_fire
      where user_id = auth.uid() and day = p_day - 1;

      with recursive streak_days as (
        select (p_day - 1) as d
        where exists (
          select 1 from daily_fire where user_id = auth.uid() and day = p_day - 1 and completed = true
        )
        union all
        select streak_days.d - 1 from streak_days
        where exists (
          select 1 from daily_fire where user_id = auth.uid() and day = streak_days.d - 1 and completed = true
        )
      )
      select count(*) into v_streak from streak_days;

      v_raw_lockins := greatest(c_floor, coalesce(v_avg14, c_floor));
      if v_streak >= c_stretch_streak then
        v_raw_lockins := v_raw_lockins * c_stretch_factor;
      end if;
      v_raw_lockins := least(c_cap, v_raw_lockins);

      if v_prev_goal is not null then
        v_goal_lockins := c_smoothing_alpha * v_raw_lockins + (1 - c_smoothing_alpha) * v_prev_goal;
      else
        v_goal_lockins := v_raw_lockins;
      end if;
    end if;

    v_goal_xp := round(v_goal_lockins * v_avg_xp_per_lockin);

    insert into daily_fire (user_id, day, goal_lockins, goal_xp, progress_xp, completed)
    values (auth.uid(), p_day, v_goal_lockins, v_goal_xp, 0, false)
    returning * into v_row;
  end if;

  select coalesce(sum(xp_earned), 0) into v_progress
  from check_ins
  where user_id = auth.uid() and duration_seconds is not null and removed_at is null
    and created_at >= p_day_start and created_at < p_day_end;

  if v_progress >= v_row.goal_xp and not v_row.completed then
    v_just_completed := true;
    v_bonus_xp := c_completion_bonus_xp;
    v_bonus_embers := c_completion_bonus_embers;

    insert into bonus_xp_awards (user_id, amount, reason)
    values (auth.uid(), v_bonus_xp, 'daily_fire:' || p_day);

    update profiles set embers = embers + v_bonus_embers where id = auth.uid();
  end if;

  update daily_fire
  set progress_xp = v_progress,
      completed = completed or (v_progress >= v_row.goal_xp),
      completed_at = case when v_just_completed then now() else completed_at end
  where user_id = auth.uid() and day = p_day
  returning * into v_row;

  return query select v_row.day, v_row.goal_xp, v_row.progress_xp, v_row.completed, v_just_completed, v_bonus_xp, v_bonus_embers;
end;
$$;

-- The opt-in publish action itself — the Settings toggle only gates whether the client even
-- offers the "Share" tap; this still re-verifies completion server-side rather than trusting
-- the client.
create or replace function publish_flame_completion(p_day date)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_completed boolean;
  v_post_id uuid;
begin
  select completed into v_completed from daily_fire where user_id = auth.uid() and day = p_day;
  if not coalesce(v_completed, false) then
    raise exception 'Today''s fire is not complete yet.';
  end if;

  insert into flame_completion_posts (user_id, day)
  values (auth.uid(), p_day)
  on conflict (user_id, day) do update set user_id = excluded.user_id
  returning id into v_post_id;

  insert into flame_completion_circles (post_id, circle_id)
  select v_post_id, gm.group_id from group_members gm where gm.user_id = auth.uid()
  on conflict do nothing;
end;
$$;
