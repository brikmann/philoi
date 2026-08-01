-- Punchlist 2, §0: "Campfire active streak doesn't load right (shows a stale '1 day streak';
-- sometimes doesn't update after days away)." recompute_user_streak() is only ever called
-- reactively — on a NEW check-in (handle_check_in_insert trigger) or from dev-tools. Nobody
-- ever calls it for someone who just goes quiet, so profiles.current_streak sits at whatever it
-- was after their last lock-in until (if ever) their next one recomputes it — a real cached-stale
-- value, not just a display bug. Fixed with a nightly sweep, same shape as the existing
-- philoi-streak-risk-check cron job, that re-runs the EXACT SAME algorithm proactively for
-- everyone with a nonzero streak, so a missed day decays it to 0 without waiting on a check-in.
create or replace function recompute_all_streaks()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
begin
  for r in select id from profiles where current_streak > 0 loop
    perform recompute_user_streak(r.id);
  end loop;
end;
$$;

-- 00:05 UTC daily — shortly after the UTC day rolls over, so "missed yesterday entirely"
-- is unambiguous by the time this runs. Re-running this file re-schedules idempotently.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'philoi-daily-streak-decay') then
    perform cron.unschedule('philoi-daily-streak-decay');
  end if;
end $$;

select cron.schedule(
  'philoi-daily-streak-decay',
  '5 0 * * *',
  $$select recompute_all_streaks();$$
);
