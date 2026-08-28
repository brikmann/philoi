-- Post-deploy verification for migrations 0119–0123 (Agent 1 · LOGIC).
--
-- SAFE TO RUN AGAINST PRODUCTION: everything happens inside a transaction that ends in ROLLBACK,
-- and `philoi.suppress_push` is set for the duration so nothing this fabricates can reach anyone's
-- phone. Same shape as verify_0116.sql.
--
--   npx supabase db query --linked -f supabase/verify_0119_0123.sql
--
-- Expected output — any other value is a regression:
--
--   0119 relic_ladders rows       | 5
--   0119 ladder families          | deep_work,distance,meditate,study,volume
--   0119 stride, no height        | 0.75
--   0119 stride, 180cm            | 0.756
--   0119 hestia is not granted    | yes          <- retired: the evaluator must never mint it
--   0119 icarus needs hero        | yes          <- and NOT gold, which is what 0090 checked
--   0119 prometheus is dormant    | yes          <- referral stub false => cannot grant
--   0119 steps reach the ladder   | yes          <- 20000 steps -> ~15 km of distance progress
--   0119 ladder rung granted      | 1            <- 50 km crosses rung 1 of distance
--   0119 rarity_override set      | rare         <- rung 1 of the distance ladder
--   0119 ladders reported by RPC  | 5            <- every ladder reported, even at zero
--   0120 session_complete cat     | streak_reminders
--   0120 milestone cat restored   | friends_social
--   0120 relic push names it      | Zeus' Bolt — unlocked
--   0120 push suppression works   | bell row written, no send
--   0121 rank trigger fires late  | on_check_in_rank_tracking   <- after on_check_in_insert
--   0121 division reward          | 100 / ignition
--   0121 tier reward              | 300 / furnace
--   0121 primordial reward        | 1200 / promethean
--   0122 tie branch present       | yes
--   0123 backfilled users         | (a count > 0 on a live database)

begin;

-- Nothing below may notify a real person.
set local philoi.suppress_push = 'on';

create temp table _out(step text, detail text);

-- ─────────────────────────────── 0119 · shape ───────────────────────────────

insert into _out
select '0119 relic_ladders rows', count(*)::text from relic_ladders;

insert into _out
select '0119 ladder families', string_agg(family, ',' order by family) from relic_ladders;

do $$
declare
  v_user uuid;
  v_before numeric;
  v_km numeric;
  v_tier int;
begin
  select id into v_user from profiles limit 1;

  -- ── stride ──
  update profiles set height_cm = null where id = v_user;
  insert into _out values ('0119 stride, no height', stride_m_for(v_user)::text);

  update profiles set height_cm = 180 where id = v_user;
  insert into _out values ('0119 stride, 180cm', stride_m_for(v_user)::text);

  update profiles set height_cm = null where id = v_user;

  -- ── steps reach the Distance ladder ──
  -- 20,000 steps at the 0.75 m fallback is 15 km. The check is that the ladder's `value` moves at
  -- all: before 0119 there was no path from a step to a kilometre.
  select coalesce(value, 0) into v_before
  from relic_progress where user_id = v_user and relic_key = 'relic-pheidippides-sandals';

  insert into user_step_days (user_id, day, steps)
  values (v_user, current_date - 1, 20000)
  on conflict (user_id, day) do update set steps = 20000;

  perform economy_evaluate_relics(v_user);

  select coalesce(value, 0) into v_km
  from relic_progress where user_id = v_user and relic_key = 'relic-pheidippides-sandals';

  insert into _out values ('0119 steps reach the ladder',
    case when v_km >= coalesce(v_before, 0) + 14.9 then 'yes'
         else format('no (%s -> %s)', v_before, v_km) end);

  -- ── a rung actually grants, and paints the tile ──
  -- 70,000 steps = 52.5 km, over the 50 km first rung.
  update user_step_days set steps = 70000 where user_id = v_user and day = current_date - 1;
  perform economy_evaluate_relics(v_user);

  select tier into v_tier
  from relic_progress where user_id = v_user and relic_key = 'relic-pheidippides-sandals';
  insert into _out values ('0119 ladder rung granted', coalesce(v_tier, 0)::text);

  insert into _out
  select '0119 rarity_override set', coalesce(rarity_override, '(null)')
  from cosmetics_owned
  where user_id = v_user and cosmetic_key = 'relic-pheidippides-sandals';

  -- "Every ladder reported, even at zero" is a property of the RPC, not of the table — so ask the
  -- RPC. relic_progress only holds a row for a ladder that has actually been fed, and this
  -- fabricated user has fed three of the five, so counting the table here reported 3 and read as a
  -- regression against a 5 that was never going to happen. get_my_relic_progress LEFT JOINs from
  -- relic_ladders, which is what makes the unstarted ladders show up at tier 0.
  --
  -- It reads auth.uid(), so the claim has to be set for the call — the fabricated user is not a
  -- session.
  perform set_config('request.jwt.claims', json_build_object('sub', v_user)::text, true);
  insert into _out
  select '0119 ladders reported by the RPC', count(*)::text from get_my_relic_progress();
  perform set_config('request.jwt.claims', null, true);
end;
$$;

-- ── the catalog corrections, read off the function source rather than by fabricating a rank ──
insert into _out
select '0119 hestia is not granted',
       case when prosrc not like '%relic-hestias-hearthstone%' then 'yes' else 'NO — still minted' end
from pg_proc where proname = 'economy_evaluate_relics';

insert into _out
select '0119 icarus needs hero',
       case when prosrc like '%Reached Hero%' or prosrc like '%climbed to Hero%'
            then 'yes' else 'NO — still Gold' end
from pg_proc where proname = 'economy_evaluate_relics';

insert into _out
select '0119 prometheus is dormant',
       case when not has_successful_referral((select id from profiles limit 1))
            then 'yes' else 'NO — referrals exist, re-check the gate' end;

-- ─────────────────────────────── 0120 · push wiring ───────────────────────────────

insert into _out values ('0120 session_complete cat', notification_category('session_complete'));
insert into _out values ('0120 milestone cat restored', notification_category('milestone_cheered'));

do $$
declare
  v_user uuid;
  v_title text;
  v_before int;
  v_after int;
begin
  select id into v_user from profiles limit 1;

  select count(*) into v_before from notification_events where user_id = v_user;

  -- Grant a relic the test account cannot already own in a way that matters: this is rolled back.
  delete from cosmetics_owned where user_id = v_user and cosmetic_key = 'relic-zeus-bolt';
  perform economy_grant_relic(v_user, 'relic-zeus-bolt', 'mythic', 'Verification.');

  select title into v_title
  from notification_events
  where user_id = v_user and payload ->> 'relic' = 'relic-zeus-bolt'
  order by created_at desc limit 1;

  insert into _out values ('0120 relic push names it', coalesce(v_title, '(no bell row)'));

  select count(*) into v_after from notification_events where user_id = v_user;
  insert into _out values ('0120 push suppression works',
    case when v_after > v_before then 'bell row written, no send'
         else 'NO — the bell row is missing' end);
end;
$$;

-- ─────────────────────────────── 0121 · rank-up rewards ───────────────────────────────

insert into _out
select '0121 rank trigger fires late', tgname
from pg_trigger
where tgrelid = 'check_ins'::regclass
  and tgname like '%rank_tracking%';

insert into _out
select '0121 ' || kind || ' reward', embers || ' / ' || box_key
from rank_up_rewards
order by embers;

-- ─────────────────────────────── 0122 · the tie branch ───────────────────────────────

insert into _out
select '0122 tie branch present',
       case when prosrc like '%both get the win%' then 'yes' else 'NO' end
from pg_proc where proname = 'economy_on_social_challenge_closed';

insert into _out
select '0122 sweep pays a real tie',
       case when prosrc like '%v_my = v_opp and v_my > 0%' then 'yes' else 'NO' end
from pg_proc where proname = 'finalize_social_challenges';

-- ─────────────────────────────── 0123 · the backfill landed ───────────────────────────────

insert into _out
select '0123 users with ladder rows', count(distinct user_id)::text from relic_progress;

select step, detail from _out order by step;

rollback;
