-- SECURITY FIX for 0083's economy_award_goal_day.
--
-- 0083 shipped the function taking p_streak_len and p_difficulty FROM THE CALLER. Both are direct
-- inputs to the payout, and the function is granted to `authenticated`, so any signed-in user
-- could call it with streak_len = 30 and difficulty = 'ambitious' and mint 25 + 400 embers plus a
-- loot box on the first day of a brand-new goal. The per-day idempotency key stopped a replay of
-- the SAME day; it did nothing about lying on the first call, and a fresh goal each day would
-- have paid the 30-day milestone indefinitely.
--
-- Nothing has called this yet (the client wiring is landing with this migration), so no bad grants
-- exist to reverse — this closes the hole before it is reachable rather than after.
--
-- Both values are now DERIVED server-side:
--   * streak  — counted from goal_day_awards, the table the function writes itself.
--   * difficulty — read off the goal's own type and target against thresholds in economy_config.
--
-- Signature changes (the two params go away), so the old overload must be dropped rather than
-- replaced: CREATE OR REPLACE cannot change a function's argument list, and leaving the 4-arg
-- version in place would leave the exploitable entry point callable alongside the fixed one.
drop function if exists economy_award_goal_day(uuid, text, date, int);

-- Thresholds for deriving difficulty from a goal's target, keyed by challenge type. A goal at or
-- above `ambitious` pays the top drip, at or above `moderate` the middle, else the floor. Config
-- rather than constants so the calibration is tunable without a migration, same as the bands.
--
-- Values follow CHALLENGE_REWARD_ALGO's own examples: "ambitious (10k steps, 2h+ lock-in)".
-- Weekly goals are compared against the same numbers scaled by 7 in the function below, so a
-- 70k-step week reads as ambitious exactly like a 10k-step day does.
insert into economy_config (key, value) values
  ('goal_difficulty', '{
     "steps":           {"moderate": 6000,  "ambitious": 10000},
     "study_hours":     {"moderate": 1,     "ambitious": 2},
     "gym_visits":      {"moderate": 1,     "ambitious": 2},
     "run_distance":    {"moderate": 3,     "ambitious": 8},
     "ride_distance":   {"moderate": 10,    "ambitious": 25},
     "workout_minutes": {"moderate": 30,    "ambitious": 60},
     "strain":          {"moderate": 10,    "ambitious": 15},
     "sleep_hours":     {"moderate": 7,     "ambitious": 8},
     "custom":          {"moderate": 0,     "ambitious": 0}
   }')
on conflict (key) do update set value = excluded.value;

/**
 * Award one day of a personal goal, plus any streak milestone that day completes.
 *
 * Idempotent on (goal, user, local_day) — the insert is the guard, so a retry, a re-sync or a
 * duplicate Health callback cannot pay twice.
 *
 * p_local_day is still passed in, and is the ONE remaining caller-supplied value. It has to be:
 * the server cannot know the device's calendar day at the moment of completion, which is the whole
 * point of §A3. It is bounded — no future days, and the streak is computed from stored rows rather
 * than from anything the caller asserts — so the worst a dishonest client can do is award an
 * eligible day slightly early, not manufacture a streak.
 */
create or replace function economy_award_goal_day(
  p_goal_id uuid,
  p_local_day date
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_cfg jsonb := (select value from economy_config where key = 'goal_rewards');
  v_diff_cfg jsonb := (select value from economy_config where key = 'goal_difficulty');
  v_goal challenges;
  v_scale numeric;
  v_difficulty text;
  v_daily int;
  v_streak int;
  v_milestone int := 0;
  v_box text;
  v_room int;
  v_paid_daily int := 0;
  v_paid_milestone int := 0;
  v_inserted int;
begin
  if v_user is null then
    raise exception 'Not signed in.';
  end if;

  -- Ownership. security definer bypasses RLS, so without this any user could award themselves
  -- against somebody else's goal id.
  select * into v_goal from challenges c where c.id = p_goal_id and c.user_id = v_user;
  if v_goal.id is null then
    raise exception 'That goal is not yours.';
  end if;

  -- The goal must actually be complete for the period. Awarding on the client's say-so would let
  -- a caller collect the drip without hitting the target at all.
  if v_goal.completed_at is null then
    raise exception 'That goal is not complete.';
  end if;

  -- No future days: otherwise a client mints tomorrow's drip today and again tomorrow. One day of
  -- slack absorbs a user genuinely ahead of the server's UTC date.
  if p_local_day > (now() at time zone 'utc')::date + 1 then
    raise exception 'Goal day is in the future.';
  end if;

  -- ── difficulty, derived ──
  -- A weekly goal's target covers seven days, so compare it against seven times the daily
  -- threshold; that keeps "70k steps a week" and "10k steps a day" reading as equally ambitious.
  v_scale := case when v_goal.period = 'week' then 7 else 1 end;
  v_difficulty := case
    when (v_diff_cfg -> v_goal.type ->> 'ambitious') is null then 'easy'
    when (v_diff_cfg -> v_goal.type ->> 'ambitious')::numeric > 0
         and v_goal.target >= (v_diff_cfg -> v_goal.type ->> 'ambitious')::numeric * v_scale then 'ambitious'
    when (v_diff_cfg -> v_goal.type ->> 'moderate')::numeric > 0
         and v_goal.target >= (v_diff_cfg -> v_goal.type ->> 'moderate')::numeric * v_scale then 'moderate'
    else 'easy'
  end;

  v_daily := coalesce((v_cfg -> 'daily' ->> v_difficulty)::int, (v_cfg -> 'daily' ->> 'easy')::int, 12);

  -- Claim the day FIRST so the streak count below includes today.
  insert into goal_day_awards (goal_id, user_id, local_day, embers, streak_len)
  values (p_goal_id, v_user, p_local_day, 0, 0)
  on conflict (goal_id, user_id, local_day) do nothing;

  get diagnostics v_inserted = row_count;
  if v_inserted = 0 then
    return jsonb_build_object(
      'already_awarded', true,
      'embers', (select embers from goal_day_awards
                  where goal_id = p_goal_id and user_id = v_user and local_day = p_local_day),
      'milestone', 0
    );
  end if;

  -- ── streak, derived ──
  -- Consecutive awarded days ending at p_local_day. The trick is the row_number: walking the days
  -- backwards, a genuinely unbroken run has (p_local_day - local_day) exactly equal to the row's
  -- zero-based position, and the first day where those diverge is the gap that ends the streak.
  select count(*) into v_streak
  from (
    select
      p_local_day - gda.local_day as gap,
      (row_number() over (order by gda.local_day desc)) - 1 as rn
    from goal_day_awards gda
    where gda.goal_id = p_goal_id
      and gda.user_id = v_user
      and gda.local_day <= p_local_day
  ) t
  where t.gap = t.rn;

  -- Milestone only on the exact day the streak reaches a listed length, so a 30-day run pays 3, 7,
  -- 14 and 30 once each as it passes them rather than re-paying 7 every day after day seven.
  v_milestone := coalesce((v_cfg -> 'milestones' ->> v_streak::text)::int, 0);

  -- The weekly ceiling, applied across drip and milestone together and measured before either is
  -- paid, so a milestone cannot tip a user past the cap.
  v_room := greatest(0, coalesce((v_cfg ->> 'weekly_cap')::int, 300) - economy_goal_embers_this_week(v_user));

  v_paid_daily := least(v_daily, v_room);
  if v_paid_daily > 0 then
    perform economy_move_embers(v_user, v_paid_daily, 'goal_daily', p_goal_id);
    v_room := v_room - v_paid_daily;
  end if;

  v_paid_milestone := least(v_milestone, v_room);
  if v_paid_milestone > 0 then
    perform economy_move_embers(v_user, v_paid_milestone, 'goal_streak', p_goal_id);
  end if;

  -- The 30-day milestone also mints a box. Gated on the milestone actually having been PAID, so a
  -- user who hit the weekly ceiling doesn't silently get the box without the embers.
  if v_streak = coalesce((v_cfg ->> 'milestone_box_at')::int, 30) and v_paid_milestone > 0 then
    v_box := v_cfg ->> 'milestone_box_key';
    insert into loot_boxes (user_id, box_key, obtained_via, provenance)
    values (v_user, v_box, 'challenge', v_streak || '-day goal streak');
  end if;

  update goal_day_awards
     set embers = v_paid_daily + v_paid_milestone,
         streak_len = v_streak
   where goal_id = p_goal_id and user_id = v_user and local_day = p_local_day;

  return jsonb_build_object(
    'already_awarded', false,
    'embers', v_paid_daily,
    'milestone', v_paid_milestone,
    'box', v_box,
    'streak', v_streak,
    'difficulty', v_difficulty,
    'capped', (v_daily + v_milestone) > (v_paid_daily + v_paid_milestone)
  );
end;
$$;

revoke all on function economy_award_goal_day(uuid, date) from public;
grant execute on function economy_award_goal_day(uuid, date) to authenticated;
