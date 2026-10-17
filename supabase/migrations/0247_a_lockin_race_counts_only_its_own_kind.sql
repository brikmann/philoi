-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- 0247 . A LOCK-IN RACE COUNTS ONLY ITS OWN KIND OF LOCK-IN.
--
-- ──────────────────── THE BUG ────────────────────
--
-- "Most gym time · 30 days", a duel made from Cindy's Q&A, scored EVERY lock-in. Measured on the
-- live duel (b0419ade) the day it was reported: the creator read 2h07m against an opponent's 9m,
-- and not one second of the creator's 2h07m was a gym session — it was study and deep work.
--
-- The cause is one lossy step. The Q&A knows the discipline (study, gym, ...), but
-- raceMetricOf() collapses every lock-in-shaped discipline to race_metric 'lockin_time', and the
-- row has nowhere else to put it. From there every scorer — challenge_metric_value (baselines and
-- settlement), social_challenge_score (the duel card and watch screen) — sums all qualifying
-- check-ins. The word "gym" survived only in public_name.
--
-- ──────────────────── THE FIX ────────────────────
--
-- 1. social_challenges.lockin_goal_type ('gym' | 'study' | null). Null is today's behaviour —
--    every lock-in — so nothing already settled moves. It is the check-in's own goal_type, the
--    column check_in_qualifies_for_challenge already reads to apply the gym photo/sets rule.
--
-- 2. Scoped overloads: challenge_metric_value(.., p_lockin_goal_type) and
--    social_challenge_score(.., p_lockin_goal_type). Different arity, NO defaults, so the existing
--    3- and 4-arg versions are untouched and no call can resolve ambiguously. A null scope or any
--    metric other than lockin_time hands straight back to the unscoped function.
--
-- 3. Every caller passes the row's scope. Baselines and live score MUST agree — a gym-only live
--    total minus an all-lock-ins baseline is a large negative, floored to 0 for everyone.
--
-- 4. The three create RPCs that can make a lockin_time race (duel, placement, pooled) take
--    p_lockin_goal_type, defaulted null so installed builds' calls still resolve.
--
-- 5. INSTALLED BUILDS. They cannot send the new argument and there is no OTA, so a BEFORE INSERT
--    trigger infers the scope from the name the Q&A writes ("Most gym time", "Most study hours",
--    "12 gym hours together") when exactly one of gym/study is named. An explicit argument always
--    wins; a name naming both, or neither, stays unscoped.
--
-- 6. Backfill: every not-yet-settled lockin_time race gets its scope inferred the same way, and
--    any baseline already taken is re-taken at starts_at under that scope. challenge_metric_value
--    is cumulative over created_at <= p_at, so re-taking it at starts_at is exact, not approximate.
--
-- ──────────────────── WHY THE CALLERS ARE PATCHED, NOT RESTATED ────────────────────
--
-- Eleven existing functions need one argument threaded into an existing call. Restating them from
-- a file is how sibling branches have silently reverted each other's bodies here before. Instead
-- each is rewritten FROM ITS LIVE DEFINITION (pg_get_functiondef) by exact substring, and every
-- substitution asserts it matched exactly the expected number of times — so if a body has drifted
-- from what this was written against, the migration fails rather than half-applying.
--
-- NOT COVERED: a collective goal counted in lock-ins (race_metric null, 0098) still counts every
-- lock-in. Hosted campfire challenges are unaffected — they score per-member goals by name (0162).
-- ════════════════════════════════════════════════════════════════════════════════════════════════

-- ──────────────────── 1. the column ────────────────────

alter table social_challenges add column if not exists lockin_goal_type text;

alter table social_challenges drop constraint if exists social_challenges_lockin_goal_type_check;
alter table social_challenges add constraint social_challenges_lockin_goal_type_check
  check (lockin_goal_type is null or (lockin_goal_type in ('gym', 'study') and race_metric = 'lockin_time'));

comment on column social_challenges.lockin_goal_type is
  '0247 -- which lock-ins a lockin_time race counts, matched against check_ins.goal_type. Null counts every qualifying lock-in (the pre-0247 behaviour).';

-- ──────────────────── 2. the scoped scorers ────────────────────

-- Cumulative, as the 3-arg version: baselines are a reading at the gun, scores a reading at the end.
create or replace function challenge_metric_value(p_metric text, p_user uuid, p_at timestamptz, p_lockin_goal_type text)
returns numeric
language sql
stable
security definer
set search_path = public
as $cmv$
  select case
    when p_metric = 'lockin_time' and p_lockin_goal_type is not null then coalesce((
      select sum(ci.duration_seconds)
      from check_ins ci
      where ci.user_id = p_user
        and ci.removed_at is null
        and ci.goal_type = p_lockin_goal_type
        and check_in_qualifies_for_challenge(ci.id)
        and ci.created_at <= p_at
    ), 0)
    else challenge_metric_value(p_metric, p_user, p_at)
  end;
$cmv$;

-- Windowed, as the 4-arg version — what the duel card and watch screen show.
create or replace function social_challenge_score(
  p_user_id uuid, p_metric text, p_starts_at timestamptz, p_ends_at timestamptz, p_lockin_goal_type text
)
returns numeric
language sql
stable
security definer
set search_path = public
as $scs$
  select case
    when p_metric = 'lockin_time' and p_lockin_goal_type is not null then (
      select coalesce(sum(ci.duration_seconds), 0)
      from check_ins ci
      where ci.user_id = p_user_id
        and ci.removed_at is null
        and ci.goal_type = p_lockin_goal_type
        and check_in_qualifies_for_challenge(ci.id)
        and ci.created_at >= p_starts_at
        and ci.created_at <= p_ends_at
    )
    else social_challenge_score(p_user_id, p_metric, p_starts_at, p_ends_at)
  end;
$scs$;

-- Internal: only ever called from security-definer functions, so nobody needs to call these.
revoke all on function challenge_metric_value(text, uuid, timestamptz, text) from public, anon, authenticated;
revoke all on function social_challenge_score(uuid, text, timestamptz, timestamptz, text) from public, anon, authenticated;

-- ──────────────────── 3. inferring the scope from the name (installed builds) ────────────────────

create or replace function infer_lockin_goal_type(p_name text)
returns text
language sql
immutable
as $infer$
  select case
    when p_name is null then null
    when (p_name ~* '\mgym\M') and not (p_name ~* '\mstud(y|ies|ying)\M') then 'gym'
    when (p_name ~* '\mstud(y|ies|ying)\M') and not (p_name ~* '\mgym\M') then 'study'
    else null
  end;
$infer$;

create or replace function social_challenges_infer_lockin_scope()
returns trigger
language plpgsql
set search_path = public
as $trg$
begin
  if new.race_metric = 'lockin_time' and new.lockin_goal_type is null then
    new.lockin_goal_type := infer_lockin_goal_type(new.public_name);
  end if;
  return new;
end;
$trg$;

drop trigger if exists social_challenges_infer_lockin_scope on social_challenges;
create trigger social_challenges_infer_lockin_scope
  before insert on social_challenges
  for each row execute function social_challenges_infer_lockin_scope();

-- ──────────────────── 4. threading the scope through the live callers ────────────────────

create or replace function pg_temp.patch(p_def text, p_find text, p_repl text, p_expect int, p_what text)
returns text
language plpgsql
as $patch$
declare
  v_n int := (length(p_def) - length(replace(p_def, p_find, ''))) / length(p_find);
begin
  if v_n <> p_expect then
    raise exception '0247: % expected % match(es) of [%], found % -- the live body has drifted',
      p_what, p_expect, p_find, v_n;
  end if;
  return replace(p_def, p_find, p_repl);
end;
$patch$;

do $callers$
declare
  d text;
begin
  -- Settlement, pooled totals, completion, the measured collective board: all go through here.
  d := pg_get_functiondef('public.challenge_racer_score(uuid,uuid)'::regprocedure);
  d := pg_temp.patch(d,
    'challenge_metric_value(c.race_metric, p_user, coalesce(c.ends_at, now()))',
    'challenge_metric_value(c.race_metric, p_user, coalesce(c.ends_at, now()), c.lockin_goal_type)',
    1, 'challenge_racer_score');
  execute d;

  -- The duel's baselines, at the gun.
  d := pg_get_functiondef('public.respond_to_h2h_challenge(uuid,boolean)'::regprocedure);
  d := pg_temp.patch(d,
    'challenge_metric_value(v_challenge.race_metric, p.user_id, v_challenge.starts_at)',
    'challenge_metric_value(v_challenge.race_metric, p.user_id, v_challenge.starts_at, v_challenge.lockin_goal_type)',
    1, 'respond_to_h2h_challenge');
  execute d;

  d := pg_get_functiondef('public.start_challenge(uuid)'::regprocedure);
  d := pg_temp.patch(d,
    'challenge_metric_value(v_c.race_metric, p.user_id, now())',
    'challenge_metric_value(v_c.race_metric, p.user_id, now(), v_c.lockin_goal_type)',
    1, 'start_challenge');
  execute d;

  d := pg_get_functiondef('public.start_due_challenges()'::regprocedure);
  d := pg_temp.patch(d,
    'challenge_metric_value(r.race_metric, p.user_id, now())',
    'challenge_metric_value(r.race_metric, p.user_id, now(), r.lockin_goal_type)',
    1, 'start_due_challenges');
  execute d;

  -- The placement board.
  d := pg_get_functiondef('public.get_group_challenge_watch(uuid)'::regprocedure);
  d := pg_temp.patch(d,
    'least(now(), coalesce(v_challenge.ends_at, now()))) - f.baseline',
    'least(now(), coalesce(v_challenge.ends_at, now())), v_challenge.lockin_goal_type) - f.baseline',
    1, 'get_group_challenge_watch');
  execute d;

  -- The duel's watch screen and its card.
  d := pg_get_functiondef('public.get_challenge_watch(uuid)'::regprocedure);
  d := pg_temp.patch(d,
    'v_challenge.race_metric, v_challenge.starts_at, v_challenge.ends_at)',
    'v_challenge.race_metric, v_challenge.starts_at, v_challenge.ends_at, v_challenge.lockin_goal_type)',
    2, 'get_challenge_watch');
  execute d;

  d := pg_get_functiondef('public.get_my_social_challenges()'::regprocedure);
  d := pg_temp.patch(d,
    'sc.race_metric, sc.starts_at, sc.ends_at)',
    'sc.race_metric, sc.starts_at, sc.ends_at, sc.lockin_goal_type)',
    2, 'get_my_social_challenges');
  execute d;

  -- The two roster-less fallbacks. Unreachable for a duel made after 0153, patched anyway so no
  -- path anywhere scores a scoped race unscoped.
  d := pg_get_functiondef('public.finalize_social_challenges()'::regprocedure);
  d := pg_temp.patch(d,
    'r.race_metric, r.starts_at, r.ends_at)',
    'r.race_metric, r.starts_at, r.ends_at, r.lockin_goal_type)',
    2, 'finalize_social_challenges');
  execute d;

  d := pg_get_functiondef('public.economy_on_social_challenge_closed()'::regprocedure);
  d := pg_temp.patch(d,
    'new.race_metric, new.starts_at, new.ends_at)',
    'new.race_metric, new.starts_at, new.ends_at, new.lockin_goal_type)',
    2, 'economy_on_social_challenge_closed');
  execute d;
end;
$callers$;

-- ──────────────────── 5. the create RPCs take the scope ────────────────────
--
-- New trailing parameter, defaulted, so a named call without it still resolves. The signature
-- changes, so the old one is DROPPED — otherwise both overloads stay resolvable and the old body
-- keeps serving. Baselines read v_challenge.lockin_goal_type, i.e. after the trigger has had its
-- say, so an inferred scope is baselined exactly like an explicit one.

do $creates$
declare
  d text;
begin
  -- the duel
  d := pg_get_functiondef('public.create_h2h_challenge(uuid,text,integer,uuid,integer,text,timestamptz,timestamptz,numeric,text)'::regprocedure);
  d := pg_temp.patch(d,
    'p_course_code text DEFAULT NULL::text)',
    'p_course_code text DEFAULT NULL::text, p_lockin_goal_type text DEFAULT NULL::text)',
    1, 'create_h2h_challenge header');
  d := pg_temp.patch(d,
    'shape, starts_on, ends_on, grade_target, course_code)',
    'shape, starts_on, ends_on, grade_target, course_code, lockin_goal_type)',
    1, 'create_h2h_challenge columns');
  d := pg_temp.patch(d,
    'p_grade_target, nullif(btrim(coalesce(p_course_code, '''')), ''''))',
    'p_grade_target, nullif(btrim(coalesce(p_course_code, '''')), ''''), p_lockin_goal_type)',
    1, 'create_h2h_challenge values');
  drop function public.create_h2h_challenge(uuid,text,integer,uuid,integer,text,timestamptz,timestamptz,numeric,text);
  execute d;

  -- the placement race
  d := pg_get_functiondef('public.create_placement_challenge(uuid,text,integer,integer,text,timestamptz,timestamptz,numeric,text,text)'::regprocedure);
  d := pg_temp.patch(d,
    'p_tier text DEFAULT NULL::text)',
    'p_tier text DEFAULT NULL::text, p_lockin_goal_type text DEFAULT NULL::text)',
    1, 'create_placement_challenge header');
  d := pg_temp.patch(d,
    'public_name, starts_on, ends_on, grade_target, course_code',
    'public_name, starts_on, ends_on, grade_target, course_code, lockin_goal_type',
    1, 'create_placement_challenge columns');
  d := pg_temp.patch(d,
    'p_grade_target, nullif(btrim(coalesce(p_course_code, '''')), '''')',
    'p_grade_target, nullif(btrim(coalesce(p_course_code, '''')), ''''), p_lockin_goal_type',
    1, 'create_placement_challenge values');
  d := pg_temp.patch(d,
    'challenge_metric_value(p_race_metric, gm.user_id, now())',
    'challenge_metric_value(p_race_metric, gm.user_id, now(), v_challenge.lockin_goal_type)',
    1, 'create_placement_challenge baseline');
  drop function public.create_placement_challenge(uuid,text,integer,integer,text,timestamptz,timestamptz,numeric,text,text);
  execute d;

  -- the pooled total
  d := pg_get_functiondef('public.create_pooled_challenge(uuid,text,numeric,integer,text,boolean,text,timestamptz,timestamptz,integer)'::regprocedure);
  d := pg_temp.patch(d,
    'p_payout_xp integer DEFAULT 300)',
    'p_payout_xp integer DEFAULT 300, p_lockin_goal_type text DEFAULT NULL::text)',
    1, 'create_pooled_challenge header');
  d := pg_temp.patch(d,
    'starts_on, ends_on, pooled, reward_top_contributor',
    'starts_on, ends_on, pooled, reward_top_contributor, lockin_goal_type',
    1, 'create_pooled_challenge columns');
  d := pg_temp.patch(d,
    'p_starts_on, p_ends_on, true, coalesce(p_reward_top_contributor, false)',
    'p_starts_on, p_ends_on, true, coalesce(p_reward_top_contributor, false), p_lockin_goal_type',
    1, 'create_pooled_challenge values');
  d := pg_temp.patch(d,
    'challenge_metric_value(p_race_metric, gm.user_id, now())',
    'challenge_metric_value(p_race_metric, gm.user_id, now(), v_challenge.lockin_goal_type)',
    1, 'create_pooled_challenge baseline');
  drop function public.create_pooled_challenge(uuid,text,numeric,integer,text,boolean,text,timestamptz,timestamptz,integer);
  execute d;
end;
$creates$;

-- The recreated functions get Supabase's default grants. Put back exactly what each had before:
-- the duel was open to public/anon/authenticated; placement had no PUBLIC; pooled had neither
-- PUBLIC nor anon.
revoke all on function create_placement_challenge(uuid,text,integer,integer,text,timestamptz,timestamptz,numeric,text,text,text) from public;
grant execute on function create_placement_challenge(uuid,text,integer,integer,text,timestamptz,timestamptz,numeric,text,text,text) to anon, authenticated, service_role;
revoke all on function create_pooled_challenge(uuid,text,numeric,integer,text,boolean,text,timestamptz,timestamptz,integer,text) from public, anon;
grant execute on function create_pooled_challenge(uuid,text,numeric,integer,text,boolean,text,timestamptz,timestamptz,integer,text) to authenticated, service_role;
grant execute on function create_h2h_challenge(uuid,text,integer,uuid,integer,text,timestamptz,timestamptz,numeric,text,text) to anon, authenticated, service_role;

-- ──────────────────── 6. backfill the races still running ────────────────────

update social_challenges sc
   set lockin_goal_type = infer_lockin_goal_type(sc.public_name)
 where sc.race_metric = 'lockin_time'
   and sc.lockin_goal_type is null
   and not challenge_is_settled(sc.status)
   and infer_lockin_goal_type(sc.public_name) is not null;

-- Re-take every baseline already taken, at the gun, under the new scope. A race that has not
-- started (pending duel, draft) has no baseline yet and will take a scoped one when it does.
update challenge_participants p
   set baseline = challenge_metric_value(sc.race_metric, p.user_id, sc.starts_at, sc.lockin_goal_type)
  from social_challenges sc
 where sc.id = p.challenge_id
   and sc.lockin_goal_type is not null
   and sc.starts_at is not null
   and not challenge_is_settled(sc.status);

-- ──────────────────── 7. verify ────────────────────

do $verify$
declare
  v_bad text;
begin
  -- Every caller now carries the scope, and the old unscoped call shapes are gone from them.
  select string_agg(p.proname, ', ') into v_bad
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname in ('challenge_racer_score', 'respond_to_h2h_challenge', 'start_challenge',
                      'start_due_challenges', 'get_group_challenge_watch', 'get_challenge_watch',
                      'get_my_social_challenges', 'finalize_social_challenges',
                      'economy_on_social_challenge_closed', 'create_h2h_challenge',
                      'create_placement_challenge', 'create_pooled_challenge')
    and p.prosrc !~ 'lockin_goal_type';
  if v_bad is not null then
    raise exception '0247: still unscoped: %', v_bad;
  end if;

  -- One create function each, not two overloads.
  select string_agg(proname || ' x' || n, ', ') into v_bad from (
    select proname, count(*) n from pg_proc
    where proname in ('create_h2h_challenge', 'create_placement_challenge', 'create_pooled_challenge')
    group by proname having count(*) <> 1
  ) x;
  if v_bad is not null then
    raise exception '0247: overloads left behind: %', v_bad;
  end if;

  -- The inference both ways, and its refusals.
  if infer_lockin_goal_type('Most gym time · 30 days') is distinct from 'gym'
     or infer_lockin_goal_type('Most study hours · 2 weeks') is distinct from 'study'
     or infer_lockin_goal_type('Gym vs study') is not null
     or infer_lockin_goal_type('Most lock-in time') is not null
     or infer_lockin_goal_type('Gymnastics') is not null then
    raise exception '0247: infer_lockin_goal_type is wrong';
  end if;

  if has_function_privilege('anon', 'challenge_metric_value(text,uuid,timestamptz,text)', 'execute')
     or has_function_privilege('authenticated', 'social_challenge_score(uuid,text,timestamptz,timestamptz,text)', 'execute') then
    raise exception '0247: the scoped scorers must not be client-callable';
  end if;
end;
$verify$;
