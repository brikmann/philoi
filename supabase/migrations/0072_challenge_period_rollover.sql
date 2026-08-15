-- Task #89: "challenges not resetting."
--
-- The diagnosis was not the week helper and not the deploy — NOTHING in this schema ever reset a
-- challenge. `period_start` was written once by the column default at insert and never updated
-- again: no cron job, no RPC, no Edge Function, no client path. `progress` was never zeroed either.
-- schema.sql said so out loud ("a challenge is a single-instance goal, not an auto-resetting
-- recurring one"), but the UI has been rendering "Resets Monday" / "Resets at midnight" and a
-- Daily/Weekly cadence chip the whole time. This migration makes the schema tell the truth the UI
-- was already telling.
--
-- The rest of the system was ALREADY built for this and just never got the signal. Every delta sync
-- — syncStepsFromDevice, the Strava/Whoop functions, sync_challenge_from_lock_ins — windows BOTH
-- its source total AND its already-contributed sum by `>= period_start`. Advancing period_start is
-- therefore the entire reset: the source window narrows to the new period, the already-synced
-- window narrows with it, and the next delta is computed like-for-like against the new period. That
-- is also why challenge_logs is NOT deleted below — the ledger stays whole, and old rows simply
-- fall out of the window.

-- NOTE: no explicit begin/commit — `supabase db push` already runs each
-- migration inside a transaction AND records schema_migrations in that same
-- transaction. An explicit commit; here would close the transaction early and
-- strand the migration record, which the CLI reports as a schema_migrations
-- insert failure rather than as the real cause.



-- ───────────────────────────────── the archive ─────────────────────────────────
--
-- A reset that just zeroed progress would silently destroy the record of every week the user
-- actually hit their goal, which for a recurring goal IS the interesting history. Each period is
-- closed into a row here before the counter goes back to zero.

create table if not exists challenge_periods (
  id uuid primary key default gen_random_uuid(),
  challenge_id uuid not null references challenges (id) on delete cascade,
  user_id uuid not null references profiles (id) on delete cascade,
  -- The window that just closed: [period_start, period_end).
  period_start date not null,
  period_end date not null,
  period text not null check (period in ('day', 'week')),
  -- Snapshotted rather than joined back to `challenges`: the target and unit are editable, and a
  -- history row must keep the target that was actually in force when it was earned.
  target numeric not null,
  progress numeric not null,
  unit text not null,
  completed_at timestamptz,
  archived_at timestamptz not null default now(),
  -- One archive row per challenge per period, so a double-fired cron closes the period once.
  unique (challenge_id, period_start)
);

create index if not exists challenge_periods_user_idx on challenge_periods (user_id, period_start desc);
create index if not exists challenge_periods_challenge_idx on challenge_periods (challenge_id, period_start desc);

alter table challenge_periods enable row level security;

-- Read-own only, matching `challenges` itself after 0059 unbound goals from campfires. Nothing is
-- granted insert/update/delete: rows are written exclusively by the security-definer function
-- below, so a client cannot forge a period it never completed.
drop policy if exists "challenge_periods: read own" on challenge_periods;
create policy "challenge_periods: read own" on challenge_periods
  for select using (user_id = auth.uid());


-- ───────────────────────────────── the rollover ─────────────────────────────────

/**
 * Closes every challenge period that has ended and opens the next one. Returns how many rolled.
 *
 * Boundaries, both UTC and both shared with the rest of the app:
 *   period = 'day'   → the UTC calendar day
 *   period = 'week'  → week_start() from 0071 — Sunday 00:00 UTC
 *
 * Idempotent by construction. The driving predicate is `period_start < <current boundary>`, so a
 * challenge already sitting on the current period is not selected at all; running this twice in a
 * row rolls nothing the second time, and the unique (challenge_id, period_start) on the archive is
 * the backstop if two runs ever overlap.
 *
 * Deliberately NOT a trigger and not called from the client: a reset is time-driven, and letting a
 * client ask for one would let a user roll a period they were about to lose.
 */
create or replace function roll_over_challenges()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_day_start date := (now() at time zone 'UTC')::date;
  v_week_start date := (week_start() at time zone 'UTC')::date;
  v_rolled int := 0;
  r record;
  v_next date;
begin
  for r in
    select * from challenges
    where (period = 'day'  and period_start < v_day_start)
       or (period = 'week' and period_start < v_week_start)
    -- Oldest first purely so a long-dormant challenge archives in a sensible order.
    order by period_start
    for update
  loop
    v_next := case when r.period = 'day' then v_day_start else v_week_start end;

    -- A challenge dormant for three weeks closes as ONE archive row spanning [period_start, now),
    -- not three. That is the honest shape of the data: nothing reset during those weeks, so the
    -- progress on it genuinely accrued across the whole span and there is no way to attribute it
    -- to individual weeks after the fact. Fabricating two empty rows to make the history look
    -- tidy would invent periods that never existed as periods.
    --
    -- FIRST RUN AFTER DEPLOY: every challenge in the table predates any rollover, so each one
    -- archives its since-creation total and resets to 0. That is the intended correction — those
    -- counters have been accumulating since the day they were created — but it IS a visible,
    -- one-time reset of live progress for existing users.

    -- An untouched period is not worth a history row — a user who never opened the app would
    -- otherwise accrue one empty archive row per day forever. The reset below still runs, because
    -- period_start must advance regardless for the sync windows to be correct.
    if r.progress > 0 or r.completed_at is not null then
      insert into challenge_periods (
        challenge_id, user_id, period_start, period_end, period,
        target, progress, unit, completed_at
      )
      values (
        r.id, r.user_id, r.period_start, v_next, r.period,
        r.target, r.progress, r.unit, r.completed_at
      )
      on conflict (challenge_id, period_start) do nothing;
    end if;

    -- Clearing completed_at does NOT re-fire the reward. economy_on_challenge_completed() returns
    -- early when `new.completed_at is null`, so this update is invisible to it — which is what
    -- stops a weekly challenge from paying out its friend_h2h grant again every single Sunday.
    update challenges
    set progress = 0,
        completed_at = null,
        period_start = v_next
    where id = r.id;

    v_rolled := v_rolled + 1;
  end loop;

  return v_rolled;
end;
$$;

comment on function roll_over_challenges() is
  'Closes ended challenge periods into challenge_periods and reopens them at the current UTC day/Sunday boundary. Cron-driven; see task #89.';

-- Service-role only. `authenticated` is deliberately not granted execute — see the note above about
-- a user rolling away a period they are about to fail.
revoke all on function roll_over_challenges() from public;
revoke all on function roll_over_challenges() from authenticated;


-- ───────────────────────────────── the schedule ─────────────────────────────────
--
-- 00:10 UTC daily, ten minutes after the day boundary and behind philoi-daily-streak-decay at
-- 00:05 so the streak sweep reads the day's challenges before they roll. A daily cadence covers
-- weeklies too: on six days of seven `period_start < week_start()` is false for them and only the
-- dailies move; on Sunday both do. Re-running this file re-schedules idempotently, same shape as
-- the existing philoi-daily-streak-decay job.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'philoi-challenge-rollover') then
    perform cron.unschedule('philoi-challenge-rollover');
  end if;
end $$;

select cron.schedule(
  'philoi-challenge-rollover',
  '10 0 * * *',
  $$select roll_over_challenges();$$
);


