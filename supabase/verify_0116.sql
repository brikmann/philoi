-- Post-deploy verification for migration 0116.
--
-- SAFE TO RUN AGAINST PRODUCTION: everything happens inside a transaction that ends in ROLLBACK,
-- and the check-in is built as a ROW rather than inserted, so the five AFTER INSERT triggers on
-- check_ins never fire. Same shape as verify_0113_0114.sql.
--
--   npx supabase db query --linked -f supabase/verify_0116.sql
--
-- Expected output — any other value is a regression:
--
--   custom difficulty          | easy        <- the floor, by rule, not by threshold
--   custom embers paid         | 12
--   drip fired from the lock-in| yes         <- the whole point of the entry
--   award row streak           | 1
--   goal_daily ledger delta    | 12
--   second lock-in same day    | already_awarded
--   no double pay              | 12          <- still 12 after the second lock-in
--   steps 10k still ambitious  | ambitious   <- 0085's thresholds are untouched
--   other users touched        | 0

begin;

create temp table _out(step text, detail text);

do $$
declare
  v_user uuid;
  v_goal uuid;
  v_steps_goal uuid;
  v check_ins;
  v_award jsonb;
  v_day date;
  v_paid int;
  v_streak int;
begin
  select id into v_user from profiles limit 1;
  select user_local_date(coalesce(p.timezone, p.notification_prefs ->> 'timezone'))
    into v_day from profiles p where p.id = v_user;

  -- ── a time-counted custom goal, exactly as the create screen builds one ──
  insert into challenges (user_id, type, count_mode, label, target, unit, period, progress)
  values (v_user, 'custom', 'lockin_time', 'ZZ Drip Probe', 1, 'hours', 'week', 0)
  returning id into v_goal;

  select * into v from check_ins limit 1;
  v.id := gen_random_uuid();
  v.user_id := v_user;
  v.goal_detail := 'ZZ Drip Probe';
  v.duration_seconds := 5400;          -- 90 minutes, past the 1-hour target

  -- The credit is what fires the drip now — nothing here calls the award directly.
  perform credit_lockin_time_goals_for(v);

  select embers, streak_len into v_paid, v_streak
    from goal_day_awards where goal_id = v_goal and user_id = v_user and local_day = v_day;

  insert into _out values
    ('drip fired from the lock-in', case when v_paid is null then 'NO - REGRESSION' else 'yes' end),
    ('custom embers paid', coalesce(v_paid::text, 'null')),
    ('award row streak', coalesce(v_streak::text, 'null')),
    ('goal_daily ledger delta', coalesce((
      select sum(delta)::text from ember_ledger
      where user_id = v_user and reason = 'goal_daily' and ref_id = v_goal), 'null'));

  -- ── the difficulty rule itself, read straight off the award ──
  -- A SECOND goal, completed by hand, so the returned jsonb can be inspected. Same type, so this
  -- is the same tier decision the drip above made.
  insert into challenges (user_id, type, count_mode, label, target, unit, period, progress, completed_at)
  values (v_user, 'custom', 'manual', 'ZZ Tier Probe', 10, 'pages', 'week', 10, now())
  returning id into v_steps_goal;
  select economy_award_goal_day_for(v_steps_goal, v_user, v_day) into v_award;
  insert into _out values ('custom difficulty', v_award ->> 'difficulty');

  -- A built-in metric at an ambitious target must be unaffected by the new arm.
  insert into challenges (user_id, type, label, target, unit, period, progress, completed_at)
  values (v_user, 'steps', null, 10000, 'steps', 'day', 10000, now())
  returning id into v_steps_goal;
  select economy_award_goal_day_for(v_steps_goal, v_user, v_day) into v_award;
  insert into _out values ('steps 10k still ambitious', v_award ->> 'difficulty');

  -- ── a second lock-in the same day must not pay twice ──
  v.id := gen_random_uuid();
  v.duration_seconds := 3600;
  perform credit_lockin_time_goals_for(v);
  select economy_award_goal_day_for(v_goal, v_user, v_day) into v_award;
  select embers into v_paid from goal_day_awards
   where goal_id = v_goal and user_id = v_user and local_day = v_day;
  insert into _out values
    ('second lock-in same day', case when (v_award ->> 'already_awarded')::boolean
       then 'already_awarded' else 'PAID AGAIN - REGRESSION' end),
    ('no double pay', v_paid::text);

  insert into _out values ('other users touched', (
    select count(*)::text from goal_day_awards where user_id <> v_user and local_day = v_day
      and goal_id in (select id from challenges where label like 'ZZ %')
  ));
end $$;

select * from _out;

rollback;
