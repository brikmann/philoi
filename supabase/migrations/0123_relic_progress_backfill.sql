-- 0123 — one-time backfill of relic_progress, so the ladders arrive full rather than empty.
--
-- 0119 only feeds progress from a trigger. Without this, an existing user with 200 logged hours
-- and 60 km on Strava opens the Trophy Hall to five ladders reading 0 and stays there until their
-- next check-in — which is exactly the "relics can be earned but nothing feeds their progress"
-- complaint the whole batch exists to fix, just moved a day later.
--
-- SEPARATE FILE, not the tail of 0119, for two reasons. It is a DATA migration over every active
-- account while 0119 is DDL, and it is the one statement in the batch whose runtime scales with
-- the user table — keeping it apart means a slow backfill cannot leave the schema half-applied,
-- and it can be re-run on its own if it is ever interrupted.
--
-- RE-RUNNABLE. economy_evaluate_relics is idempotent end to end: economy_grant_relic returns
-- false for a relic already owned, and economy_apply_relic_ladder only notifies on a rung it has
-- not already recorded. Running this twice grants nothing twice and sends no second notification.
--
-- NO PUSH BLAST. Every relic that retroactively qualifies would otherwise fire a real Expo push
-- (notify_event -> notify_push_raw -> net.http_post), so deploying this would banner the whole
-- user base at once for progress they made months ago. `philoi.suppress_push` (added to
-- notify_event in 0120) skips the send while still writing every bell row, so the unlocks are
-- there to find in the Trophy Hall and the bell — they just do not interrupt anyone.
--
-- `set local` is transaction-scoped and the CLI wraps each migration in one, so this cannot
-- outlive the backfill. If this file is ever run by hand, run it inside BEGIN/COMMIT.
set local philoi.suppress_push = 'on';

do $$
declare
  v_user uuid;
  v_n int := 0;
begin
  -- Anyone with any activity at all. A user with no check-in and no session has nothing to
  -- evaluate, and walking the whole profiles table to prove that for every dormant signup is the
  -- expensive half of this.
  for v_user in
    select distinct user_id from (
      select user_id from check_ins
      union
      select user_id from lock_in_sessions
      union
      select user_id from workouts
    ) active
  loop
    -- One user failing must not abandon the rest. The most likely cause is a profile row deleted
    -- between the scan and the call, which is a no-op worth skipping rather than a reason to roll
    -- the whole backfill back.
    begin
      perform economy_evaluate_relics(v_user);
      v_n := v_n + 1;
    exception when others then
      raise warning 'relic backfill skipped user % — %', v_user, sqlerrm;
    end;
  end loop;

  raise notice 'relic_progress backfill: evaluated % users', v_n;
end;
$$;
