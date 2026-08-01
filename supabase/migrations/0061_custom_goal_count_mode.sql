-- How a CUSTOM goal is measured (design-mocks/74).
--
-- "Custom" used to mean one thing: a number you type in. Mock 74 splits it in two, because the
-- two custom goals people actually describe are different shapes:
--   • "read 5 hours a week"  → time, accrued by locking in on that activity (like Study or Gym)
--   • "120 pages a week"     → a count, in the user's own unit, entered by hand
-- Neither can ever auto-track from a device — custom has no device metric — so the setup flow
-- offers no Connect row at all rather than a dead one.

alter table challenges
  add column if not exists count_mode text not null default 'manual'
  check (count_mode in ('manual', 'lockin_time'));

comment on column challenges.count_mode is
  'manual = a number the user logs. lockin_time = minutes accrue from lock-ins whose goal detail matches this goal''s label. Only meaningful for type = ''custom''; every built-in metric has its own source.';

-- The label is what a lock-in's free-text detail is matched against, so a time-counted custom
-- goal without one could never be credited.
alter table challenges drop constraint if exists challenges_lockin_time_needs_label;
alter table challenges add constraint challenges_lockin_time_needs_label
  check (count_mode <> 'lockin_time' or (label is not null and length(trim(label)) > 0));

-- ───────────────────────── credit a finished lock-in ─────────────────────────

-- Called once a lock-in has been stopped and turned into a check-in. Adds its minutes to every
-- ACTIVE time-counted custom goal of the caller's whose label matches the session's detail
-- (case-insensitive), going through log_challenge_progress' sibling path — a challenge_logs row
-- plus a progress bump — so the goal card, the completion check and the history all behave
-- exactly as they do for a hand-logged entry.
--
-- Idempotent per check-in: the log row is tagged with the check-in id, and a second call for the
-- same check-in finds that tag and does nothing. The client fires this right after a lock-in
-- ends, and again on the Challenges tab, so a backgrounded app can't silently lose the credit.
create or replace function credit_lockin_time_goals(p_check_in_id uuid)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_check_in check_ins;
  v_minutes numeric;
  v_note text;
  v_goal challenges;
  v_credited int := 0;
begin
  select * into v_check_in from check_ins where id = p_check_in_id and user_id = auth.uid();
  if v_check_in.id is null then
    raise exception 'Check-in not found.';
  end if;
  if v_check_in.duration_seconds is null or v_check_in.duration_seconds <= 0 then
    return 0;
  end if;
  if v_check_in.goal_detail is null or length(trim(v_check_in.goal_detail)) = 0 then
    return 0;
  end if;

  v_note := 'Locked in · ' || p_check_in_id::text;
  v_minutes := round(v_check_in.duration_seconds / 60.0, 2);
  if v_minutes <= 0 then
    return 0;
  end if;

  for v_goal in
    select * from challenges
    where user_id = auth.uid()
      and count_mode = 'lockin_time'
      and completed_at is null
      and lower(trim(label)) = lower(trim(v_check_in.goal_detail))
  loop
    -- Already credited this exact check-in to this exact goal? then leave it alone.
    if exists (
      select 1 from challenge_logs
      where challenge_id = v_goal.id and note = v_note
    ) then
      continue;
    end if;

    insert into challenge_logs (challenge_id, user_id, amount, note)
    values (v_goal.id, auth.uid(), v_minutes, v_note);

    update challenges
    set progress = progress + v_minutes,
        completed_at = case
          when completed_at is null and progress + v_minutes >= target then now()
          else completed_at
        end
    where id = v_goal.id;

    v_credited := v_credited + 1;
  end loop;

  return v_credited;
end;
$$;
