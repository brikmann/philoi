-- §A3 — daily goals reset at the USER'S midnight, not UTC's.
--
-- 0072 made the reset real, but anchored it to one global boundary: roll_over_challenges() reads
-- `(now() at time zone 'UTC')::date` and the cron job fires once, at 00:10 UTC. So a user in
-- UTC+13 loses their day at 11am local, and a user in UTC-8 keeps yesterday's counter until 4pm.
-- The card even said "Resets at midnight UTC" out loud, which was at least honest, but it is not
-- what a daily goal should do.
--
-- Fixing it needs two things the schema did not have: somewhere to keep the user's zone, and a job
-- that runs often enough to catch each zone's midnight as it passes.
--
-- WEEKLY IS DELIBERATELY LEFT ON UTC. week_start() is a shared boundary that leaderboards, streak
-- decay and the pass period all key off; moving one consumer of it to per-user weeks would make
-- "this week" mean different windows in different parts of the app. The spec only asks for the
-- DAILY reset, and the weekly card copy continues to say UTC because that stays true.

-- ───────────────────────────── 1. where the zone lives ─────────────────────────────

-- IANA name ('America/Toronto'), written by the client from
-- Intl.DateTimeFormat().resolvedOptions().timeZone. Nullable: everyone predates this column, and
-- a null simply behaves exactly as today (UTC), so nothing breaks before the client fills it in.
--
-- A SECOND ZONE ALREADY EXISTED, inside notification_prefs -> 'timezone' — 0027 put it there for
-- quiet hours and lib/notification-prefs.ts writes it on every prefs save. This column does not
-- replace it; the rollover below reads `coalesce(timezone, notification_prefs ->> 'timezone')`.
-- That matters for two reasons: anyone who has ever saved notification prefs gets a correct local
-- reset immediately, before the client change that populates this column has even shipped, and
-- when the two disagree the dedicated column wins because it is refreshed on every profile load
-- rather than only when someone opens notification settings. Consolidating the two is worth doing
-- later, but not in the migration that is also changing when everybody's goals reset.
alter table profiles add column if not exists timezone text;

comment on column profiles.timezone is
  'IANA timezone written by the client; used to roll daily goals at the user''s own midnight. Null = UTC.';

-- ───────────────────────────── 2. a tz-safe local date ─────────────────────────────

/**
 * The caller's current local date, or UTC's if the zone is missing or unrecognised.
 *
 * The validation is the point. `now() at time zone 'Not/AZone'` RAISES, and this runs inside a
 * loop over every user — one bad string written by one client would abort the whole nightly
 * rollover for everybody. Checking against pg_timezone_names turns that into a silent per-user
 * fallback instead of a global outage.
 */
create or replace function user_local_date(p_tz text)
returns date
language plpgsql
-- STABLE, not IMMUTABLE: this reads now(), which is fixed within a transaction but not across
-- them. Declaring it immutable would let the planner constant-fold a date computed once and reuse
-- it indefinitely — on a function whose entire job is "what day is it for this user", that is the
-- worst possible thing to cache.
stable
set search_path = public
as $$
begin
  if p_tz is null or not exists (select 1 from pg_timezone_names where name = p_tz) then
    return (now() at time zone 'UTC')::date;
  end if;
  return (now() at time zone p_tz)::date;
end;
$$;

-- ───────────────────────────── 3. per-user rollover ─────────────────────────────

create or replace function roll_over_challenges()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_week_start date := (week_start() at time zone 'UTC')::date;
  v_rolled int := 0;
  r record;
  v_next date;
begin
  -- The daily arm now compares each challenge against ITS OWNER'S local date rather than one
  -- global one; the weekly arm is unchanged and still uses the shared UTC week boundary. Joining
  -- profiles here is what lets a single pass handle every zone, so the job stays one query no
  -- matter how many timezones the user base spans.
  for r in
    select c.*, user_local_date(coalesce(p.timezone, p.notification_prefs ->> 'timezone')) as owner_today
    from challenges c
    join profiles p on p.id = c.user_id
    -- coalesce: the dedicated column wins, but notification_prefs already carries a zone for
    -- quiet hours (0027), so users who never get the new client write still reset locally.
    where (c.period = 'day'  and c.period_start < user_local_date(coalesce(p.timezone, p.notification_prefs ->> 'timezone')))
       or (c.period = 'week' and c.period_start < v_week_start)
    -- Oldest first purely so a long-dormant challenge archives in a sensible order.
    order by c.period_start
    for update of c
  loop
    v_next := case when r.period = 'day' then r.owner_today else v_week_start end;

    -- A challenge dormant for three weeks closes as ONE archive row spanning [period_start, now),
    -- not three. That is the honest shape of the data: nothing reset during those weeks, so the
    -- progress on it genuinely accrued across the whole span and there is no way to attribute it
    -- to individual weeks after the fact.
    --
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
    -- stops a weekly challenge from paying out its grant again every single Sunday.
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

revoke all on function roll_over_challenges() from public;
revoke all on function roll_over_challenges() from authenticated;

-- ───────────────────────────── 4. run it often enough ─────────────────────────────
--
-- Every 15 minutes, not daily. Local midnights land at ~40 distinct UTC offsets, and several are
-- NOT whole hours — Nepal is +05:45, the Chatham Islands +12:45 — so even an hourly job would
-- roll those users up to 45 minutes late. A quarter-hour cadence bounds the error everywhere.
--
-- Cheap despite the frequency: the WHERE clause only matches challenges whose period_start is
-- genuinely behind their owner's current local date, so on all but one run per user per day it
-- matches nothing and the loop body never executes.
--
-- The old daily job is unscheduled by name first; leaving it would double-run the rollover at
-- 00:10 UTC, which is harmless (the second pass matches nothing) but misleading in cron.job.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'philoi-challenge-rollover') then
    perform cron.unschedule('philoi-challenge-rollover');
  end if;
end $$;

select cron.schedule(
  'philoi-challenge-rollover',
  '*/15 * * * *',
  $$select roll_over_challenges();$$
);
