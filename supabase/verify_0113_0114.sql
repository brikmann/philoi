-- Post-deploy verification for migrations 0113 + 0114.
--
-- SAFE TO RUN AGAINST PRODUCTION: everything happens inside a transaction that ends in ROLLBACK,
-- and the check-in is built as a ROW rather than inserted, so the four other AFTER INSERT triggers
-- on check_ins never fire. This is exactly how both migrations were verified before they shipped.
--
--   npx supabase db query --linked -f supabase/verify_0113_0114.sql
--
-- Expected output — any other value is a regression:
--
--   grant_reward challenge_win   | {"box": "ignition", "band": "casual", ..., "embers": 20}
--   grant_reward season_reward   | {"box": "hephaestus", "band": "elite", "badge": "season-elite-S1", ...}
--   goals credited               | 1
--   progress                     | 1.50      <- 90 minutes as HOURS, not 90
--   log amount                   | 1.50
--   completed before target      | null
--   2nd call credited            | 0         <- idempotent per check-in
--   progress after retry         | 1.50
--   progress past target         | 10.50
--   completed past target        | set
--   other users touched          | 0
--
-- BEFORE the migrations are applied this script is also the repro: it stops at the very first
-- grant_reward call with
--
--   ERROR: 42883: function economy_move_embers(uuid, integer, text, uuid) does not exist
--
-- which is precisely the bug 0114 fixes. Run it once before deploying and once after.

begin;

create temp table _out(step text, detail text);

do $$
declare
  v_user uuid;
  v_goal uuid;
  v check_ins;
  v_reward jsonb;
  v_n int;
  v_progress numeric;
  v_amount numeric;
  v_done timestamptz;
begin
  select id into v_user from profiles limit 1;

  -- ── 0114: the reward path that has never once paid ──
  select grant_reward(v_user, 'friend_h2h', 1.0, 7, 1, 0.0, true, null) into v_reward;
  insert into _out values ('grant_reward challenge_win', v_reward::text);
  select grant_reward(v_user, 'season', 1.0, 90, 50, 0.02, true, null) into v_reward;
  insert into _out values ('grant_reward season_reward', v_reward::text);

  -- ── 0113: a time-counted custom goal, built exactly as the create screen builds one ──
  insert into challenges (user_id, type, count_mode, label, target, unit, period, progress)
  values (v_user, 'custom', 'lockin_time', 'ZZ Sweep Probe', 10, 'hours', 'week', 0)
  returning id into v_goal;

  select * into v from check_ins limit 1;
  v.id := gen_random_uuid();
  v.user_id := v_user;
  v.goal_detail := 'zz sweep probe';   -- different case on purpose: the match is case-insensitive
  v.duration_seconds := 5400;          -- 90 minutes

  select credit_lockin_time_goals_for(v) into v_n;
  select progress, completed_at into v_progress, v_done from challenges where id = v_goal;
  select amount into v_amount from challenge_logs where challenge_id = v_goal;
  insert into _out values
    ('goals credited', v_n::text),
    ('progress', v_progress::text),
    ('log amount', v_amount::text),
    ('completed before target', coalesce(v_done::text, 'null'));

  select credit_lockin_time_goals_for(v) into v_n;
  select progress into v_progress from challenges where id = v_goal;
  insert into _out values
    ('2nd call credited', v_n::text),
    ('progress after retry', v_progress::text);

  v.id := gen_random_uuid();
  v.duration_seconds := 32400;         -- 9 hours, crossing the 10-hour target
  perform credit_lockin_time_goals_for(v);
  select progress, completed_at into v_progress, v_done from challenges where id = v_goal;
  insert into _out values
    ('progress past target', v_progress::text),
    ('completed past target', case when v_done is null then 'NULL - REGRESSION' else 'set' end);

  insert into _out values ('other users touched', (
    select count(*)::text from challenge_logs cl
    join challenges c on c.id = cl.challenge_id
    where cl.note like 'Locked in · %' and c.user_id <> v_user
  ));
end $$;

select * from _out;

rollback;
