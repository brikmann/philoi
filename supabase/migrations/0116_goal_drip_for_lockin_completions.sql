-- 0116 — the goal-day drip fires for a goal completed BY A LOCK-IN, and `custom` says out loud
-- that it pays the floor.
--
-- Two coupled pieces, both from DECISION_reward_screen_and_goal_drip.md (app-sweep ledger #7).
--
-- ─────────────────────────── 1. custom goals pay the floor, explicitly ──────────────────────────
--
-- The decision: a custom goal is free-text, self-defined ("read 10 pages", "meditate") and
-- unverifiable, with no comparable unit to tier by — so it pays `easy`, 12/day. No
-- "custom goal: breathe -> 25/day".
--
-- WORTH BEING PRECISE ABOUT WHAT CHANGES HERE: nothing, behaviourally. The ledger entry read the
-- `{"moderate": 0, "ambitious": 0}` sentinel as falling through to *ambitious*, but 0085's CASE
-- guards both threshold arms with `> 0` for exactly this sentinel, so custom has always landed in
-- the final `else 'easy'`. Simulated against the live config at targets 1 and 10000 before writing
-- this: both resolve to `easy` today. The anti-cheese hole was never open.
--
-- It is still worth writing down. The current behaviour depends on a reader noticing that two
-- `> 0` guards exist *because* one type encodes "untierable" as zero. Anyone tuning
-- economy_config who gave custom non-zero thresholds — or who dropped the guards as dead weight —
-- would open the hole for real. The explicit arm below cannot be undone by a config edit.
--
-- ─────────────────────── 2. a lock-in-completed goal pays the same drip ─────────────────────────
--
-- log_challenge_progress reports just_completed and the client answers with economy_award_goal_day
-- (challenges.ts), so a hand-logged goal pays the drip. A time-counted goal completed by a LOCK-IN
-- never did: credit_lockin_time_goals returns a bare count and nothing downstream of it awards.
--
-- The decision doc proposes fixing that client-side — have credit_lockin_time_goals report
-- just_completed so the client's awardGoalDay fires. That cannot work any more, and 0113 is why:
-- crediting now happens in an AFTER INSERT trigger on check_ins, inside stop_lock_in_session's own
-- transaction. By the time the client's call arrives the goal is already credited, the idempotency
-- tag is already written, and the loop `continue`s — so the client would be told nothing was
-- credited and nothing completed, every single time. A correct answer, and a useless signal.
--
-- So the award moves server-side, next to the credit that triggers it and in the same transaction:
-- the drip lands whether or not the app is still in the foreground. That is the same property 0113
-- gave the credit itself, and it closes the same failure this entry exists for.
--
-- The one thing that argued for the client doing it is the local day: 0083 and 0085 both say
-- outright that the server cannot know the caller's calendar day. That is no longer true on this
-- path — 0084 added profiles.timezone and user_local_date(), and the nightly rollover already
-- decides THIS SAME USER's daily goal boundary with exactly that value. Using anything else here
-- would mean the drip and the rollover disagreed about what day it is for the same person.
--
-- economy_award_goal_day keeps its name, its signature and its auth.uid() ownership check; the work
-- moves into an _for variant taking the user explicitly — the same split 0113 used for the credit.

-- ───────────────────────── the award, per user rather than per session ─────────────────────────

/**
 * Award one day of a personal goal to a NAMED user, plus any streak milestone that day completes.
 *
 * 0085's body verbatim apart from three things: the user arrives as a parameter rather than from
 * auth.uid(), the difficulty CASE names `custom` explicitly, and the ownership check is against
 * p_user. Every guard 0085 added against a client minting its own rewards is still here and still
 * enforced — and this function is not reachable from PostgREST (see the revoke below), so the only
 * ways in are the RPC beneath it, which supplies auth.uid(), and the check_ins trigger, which
 * supplies the check-in row's own user_id.
 *
 * Idempotent on (goal, user, local_day) exactly as before.
 */
create or replace function economy_award_goal_day_for(
  p_goal_id uuid,
  p_user uuid,
  p_local_day date
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := p_user;
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

  -- The goal must actually be complete for the period. Awarding on the caller's say-so would let
  -- one collect the drip without hitting the target at all.
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
    -- Custom is free-text and self-defined, so its target compares to nothing: "read 10 pages" and
    -- "read 10 books" are both 10. It pays the floor by rule rather than by threshold (§1 above).
    when v_goal.type = 'custom' then 'easy'
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

-- Not reachable from the client: the RPC below is the only signed-in entry point, and deciding
-- WHICH user is being awarded is precisely the thing a client must not get to do.
revoke all on function economy_award_goal_day_for(uuid, uuid, date) from public;
revoke all on function economy_award_goal_day_for(uuid, uuid, date) from authenticated;

-- ───────────────────────────── the RPC, unchanged from outside ─────────────────────────────

-- Same name, same (uuid, date) signature, same contract and same return shape, so the shipped
-- client keeps working and `create or replace` is correct here. auth.uid() is resolved at this
-- level and nowhere below it.
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
begin
  if v_user is null then
    raise exception 'Not signed in.';
  end if;
  return economy_award_goal_day_for(p_goal_id, v_user, p_local_day);
end;
$$;

revoke all on function economy_award_goal_day(uuid, date) from public;
grant execute on function economy_award_goal_day(uuid, date) to authenticated;

-- ────────────────────── the credit fires the drip on the day it completes ──────────────────────

-- 0113's body, with the completion path wired to the award. The signature is unchanged
-- (check_ins -> int), so `create or replace` is right and the trigger 0113 installed keeps
-- pointing at it.
create or replace function credit_lockin_time_goals_for(p_check_in check_ins)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hours numeric;
  v_note text;
  v_goal challenges;
  v_credited int := 0;
  v_now_complete timestamptz;
  v_local_day date;
begin
  if p_check_in.duration_seconds is null or p_check_in.duration_seconds <= 0 then
    return 0;
  end if;
  if p_check_in.goal_detail is null or length(trim(p_check_in.goal_detail)) = 0 then
    return 0;
  end if;

  v_note := 'Locked in · ' || p_check_in.id::text;

  -- HOURS (0113 §1). 2dp because the goal card renders this straight and a 25-minute session
  -- should read as 0.42, not as a repeating decimal.
  v_hours := round(p_check_in.duration_seconds / 3600.0, 2);
  -- A session under ~18 seconds rounds to zero. Crediting 0 would still write a log row and so
  -- burn this check-in's idempotency tag for good, which matters because that tag is what a later
  -- retry checks — so bail before the insert rather than after it.
  if v_hours <= 0 then
    return 0;
  end if;

  for v_goal in
    select * from challenges
    where user_id = p_check_in.user_id
      and count_mode = 'lockin_time'
      and completed_at is null
      and lower(trim(label)) = lower(trim(p_check_in.goal_detail))
  loop
    if exists (
      select 1 from challenge_logs
      where challenge_id = v_goal.id and note = v_note
    ) then
      continue;
    end if;

    insert into challenge_logs (challenge_id, user_id, amount, note)
    values (v_goal.id, p_check_in.user_id, v_hours, v_note);

    -- Same shape as log_challenge_progress' update (0059), so a goal completed by a lock-in and
    -- one completed by a hand-logged entry land in identical state and both wake
    -- economy_on_challenge_completed exactly once.
    update challenges
    set progress = progress + v_hours,
        completed_at = case
          when completed_at is null and progress + v_hours >= target then now()
          else completed_at
        end
    where id = v_goal.id
    returning completed_at into v_now_complete;

    -- Parity with the hand-logged path, which reports just_completed and lets the client answer
    -- with economy_award_goal_day. The loop above only ever selects goals whose completed_at is
    -- null, so a non-null value here means THIS credit is what completed it — the same
    -- "just completed" edge, decided server-side.
    if v_now_complete is not null then
      -- The user's own calendar day, by the same rule the nightly rollover uses to decide when
      -- this user's daily goals turn over (0084). Anything else would let the drip and the
      -- rollover disagree about what day it is for the same person.
      select user_local_date(coalesce(p.timezone, p.notification_prefs ->> 'timezone'))
        into v_local_day
        from profiles p
       where p.id = p_check_in.user_id;

      -- Never throws into the check-in. The client-side award has always been best-effort for the
      -- same reason ("a goal that completed but failed to pay is a support ticket, not a reason to
      -- fail the progress write the user actually asked for" — challenges.ts), and here the stakes
      -- are higher: this runs inside the transaction that CREATES the check-in, so an exception
      -- would roll back the lock-in the user just finished. The award is idempotent per local day,
      -- so a later retry settles it.
      begin
        perform economy_award_goal_day_for(v_goal.id, p_check_in.user_id, v_local_day);
      exception when others then
        raise warning 'goal-day award failed for goal % (check-in %): %', v_goal.id, p_check_in.id, sqlerrm;
      end;
    end if;

    v_credited := v_credited + 1;
  end loop;

  return v_credited;
end;
$$;

revoke all on function credit_lockin_time_goals_for(check_ins) from public;
revoke all on function credit_lockin_time_goals_for(check_ins) from authenticated;
