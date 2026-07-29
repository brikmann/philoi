-- Fixes "column reference \"day\" is ambiguous" (and the same latent bug for "completed") in
-- get_or_create_daily_fire, which was silently breaking the daily flame meter for every user —
-- confirmed live by simulating the RPC call as a real authenticated user:
--   ERROR: 42702: column reference "day" is ambiguous
--   DETAIL: It could refer to either a PL/pgSQL variable or a table column.
--   QUERY: select * from daily_fire where user_id = auth.uid() and day = p_day
-- The function's own RETURNS TABLE(day date, ..., completed boolean, ...) implicitly declares
-- `day` and `completed` as PL/pgSQL variables in scope for the whole function body, which
-- collide with daily_fire's own `day`/`completed` columns the instant either is referenced
-- unqualified inside a query. Every daily_fire reference below is now qualified through a `df`
-- alias. Body-only fix — signature and return shape are unchanged, so a plain
-- `create or replace function` is correct (no drop-first needed).
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
  select * into v_row from daily_fire df where df.user_id = auth.uid() and df.day = p_day;

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

      select df.goal_lockins into v_prev_goal from daily_fire df
      where df.user_id = auth.uid() and df.day = p_day - 1;

      with recursive streak_days as (
        select (p_day - 1) as d
        where exists (
          select 1 from daily_fire df where df.user_id = auth.uid() and df.day = p_day - 1 and df.completed = true
        )
        union all
        select streak_days.d - 1 from streak_days
        where exists (
          select 1 from daily_fire df where df.user_id = auth.uid() and df.day = streak_days.d - 1 and df.completed = true
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

  update daily_fire df
  set progress_xp = v_progress,
      completed = df.completed or (v_progress >= v_row.goal_xp),
      completed_at = case when v_just_completed then now() else df.completed_at end
  where df.user_id = auth.uid() and df.day = p_day
  returning * into v_row;

  return query select v_row.day, v_row.goal_xp, v_row.progress_xp, v_row.completed, v_just_completed, v_bonus_xp, v_bonus_embers;
end;
$$;
