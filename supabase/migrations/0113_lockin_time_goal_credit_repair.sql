-- 0113 — the time-counted custom goal actually gets its time, and gets it in the right unit.
--
-- 0061 built `count_mode = 'lockin_time'`: a custom goal whose progress comes from finished
-- lock-ins whose detail matches the goal's name. Two things were wrong with it, and together they
-- are why the feature reads as "credit never lands."
--
--   1. WRONG UNIT, BY A FACTOR OF 60. The create screen forces `unit = 'hours'` for this mode and
--      says so out loud ("Time is always measured in hours here" — src/app/challenge/create.tsx),
--      so the target the user types is a number of HOURS. The function credited
--      `duration_seconds / 60.0` — MINUTES. A "10 hours" goal was therefore satisfied by ten
--      minutes of lock-in, and a 45-minute session drew "45 / 10 hours" on the card. Every
--      time-counted goal in the build was 60x too easy and displayed nonsense on the way there.
--
--   2. IT ONLY EVER RAN FROM THE CLIENT, ONCE, UNAWAITED. 0061's own header promises the credit
--      is fired "right after a lock-in ends, and again on the Challenges tab, so a backgrounded
--      app can't silently lose the credit." The second call was never written — there is exactly
--      one caller in the app (src/app/lock-in/index.tsx), it is fire-and-forget
--      (`creditLockInTimeGoals(checkIn.id).catch(() => {})`), and it runs after several awaits on
--      the stop path. Background the app on the done screen, lose network for a moment, or kill
--      it before that promise settles, and the minutes are gone for good: nothing ever retries.
--
-- Fixed by moving the credit onto the check-in itself. The work moves into a row-level helper
-- that takes the check-in rather than reading auth.uid(), an AFTER INSERT trigger on check_ins
-- calls it so the credit lands in the same transaction that creates the check-in, and the
-- existing RPC stays exactly where it is — same name, same signature, same ownership check — so
-- the shipped client keeps working and its call simply becomes a no-op retry.
--
-- SIGNATURES ARE UNCHANGED (uuid -> int), so `create or replace` is safe here; this migration
-- deliberately does not drop the RPC, because a build in the wild still calls it.

-- ───────────────────────────── 1. the work, per check-in row ─────────────────────────────

/**
 * Credit one finished check-in to every active time-counted custom goal it matches.
 *
 * Keyed off the ROW's user_id, not auth.uid(): this has to be callable from a trigger, where the
 * JWT claim may be absent (a cron sweep, an admin backfill) even though the row plainly says who
 * it belongs to. The public RPC below is what enforces "you may only credit your own check-in".
 *
 * Idempotent per (goal, check-in) via the note tag, so the trigger and a client retry can both
 * run and the second one does nothing.
 */
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
begin
  if p_check_in.duration_seconds is null or p_check_in.duration_seconds <= 0 then
    return 0;
  end if;
  if p_check_in.goal_detail is null or length(trim(p_check_in.goal_detail)) = 0 then
    return 0;
  end if;

  v_note := 'Locked in · ' || p_check_in.id::text;

  -- HOURS (see §1 of the header). 2dp because the goal card renders this straight and a 25-minute
  -- session should read as 0.42, not as a repeating decimal.
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
    where id = v_goal.id;

    v_credited := v_credited + 1;
  end loop;

  return v_credited;
end;
$$;

revoke all on function credit_lockin_time_goals_for(check_ins) from public;
revoke all on function credit_lockin_time_goals_for(check_ins) from authenticated;

-- ───────────────────────────── 2. the RPC, unchanged from outside ─────────────────────────────

-- Kept so the shipped client's call still resolves. It now delegates, and because the trigger has
-- almost always already done the work by the time the client gets here, it returns 0 — which the
-- client ignores anyway. The ownership check stays: this is the one entry point a user can aim.
create or replace function credit_lockin_time_goals(p_check_in_id uuid)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_check_in check_ins;
begin
  select * into v_check_in from check_ins where id = p_check_in_id and user_id = auth.uid();
  if v_check_in.id is null then
    raise exception 'Check-in not found.';
  end if;
  return credit_lockin_time_goals_for(v_check_in);
end;
$$;

-- ───────────────────────────── 3. fire it off the check-in ─────────────────────────────

create or replace function credit_lockin_time_goals_on_check_in()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform credit_lockin_time_goals_for(new);
  return null;
end;
$$;

-- AFTER INSERT is sufficient and correct: stop_lock_in_session (0037) writes goal_detail and
-- duration_seconds in the SAME insert statement that creates the row, so both are already
-- populated here — there is no later update to wait for.
drop trigger if exists on_check_in_credit_lockin_time_goals on check_ins;
create trigger on_check_in_credit_lockin_time_goals
  after insert on check_ins
  for each row execute function credit_lockin_time_goals_on_check_in();

-- ───────────────────────────── 4. no backfill needed ─────────────────────────────
--
-- Deliberately none. `select count(*) from challenges where count_mode = 'lockin_time'` is 0 on
-- the linked project, so there is no minute-denominated progress anywhere to convert and no
-- historical check-in that should have credited a goal that existed at the time. If that stops
-- being true before this ships, the conversion is `progress = progress / 60` for those rows plus
-- the matching `challenge_logs.amount` — but writing it now would be a no-op guarding nothing.
