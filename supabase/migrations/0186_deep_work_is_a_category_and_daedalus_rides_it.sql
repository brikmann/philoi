-- 0186 — Deep Work is a lock-in category again, and Daedalus' Blueprint rides it.
--
-- ─────────────────────────────── WHY ───────────────────────────────
--
-- §4a-2 made Daedalus the Deep Work hours ladder. 0182 retired Deep Work (and Meditate) as both a
-- selectable type and a relic family, which left Daedalus in the catalog with no way to earn it —
-- PRELAUNCH_MUSTPASS §5 / #204.
--
-- Noah, 2026-09-14: Deep Work comes back as a THIRD top-level category beside Studying and Fitness.
-- Studying is material and problem practice; Deep Work is projects and assignments. A course lives
-- under both (user_courses has no category, so that holds by construction — the client just shows
-- the list under both taps). Oracle's Stillness stays retired.
--
-- ─────────────────────────────── THE SHAPE ───────────────────────────────
--
-- category = 'deep_work', activity null, course_id allowed (like study).
--
-- goal_type = 'custom'. NOT a new 'deep_work' GoalType, for one reason: installed builds cannot be
-- updated over the air, and they index GOAL_TYPE_META / GOAL_TYPE_GLYPH by goal_type with no
-- fallback. A friend's deep-work lock-in in their campfire feed has to carry a type those builds
-- know, and 'custom' is one (46 historical rows already carry it).
--
-- That choice is also what makes the relic routing need no restated evaluator: Studying always
-- writes goal_type 'study' (course or Custom row), and Deep Work always writes 'custom', so
-- session_discipline(goal_type) alone separates Socrates from Daedalus. economy_evaluate_relics
-- (0168) groups hours by exactly that and is left untouched — and it is evaluated on the check-in
-- INSERT, before the session stamps category onto the row, so a category-based rule would have
-- credited the wrong ladder first and tier is a high-water mark.
--
-- Consequences worth stating:
--   · study_hours goals (0068) count goal_type 'study' only, so Deep Work hours do not fill a
--     "10h study" goal. That is the separation Noah asked for.
--   · Legacy flat 'custom' / 'job_applications' rows (old-build Custom tile — on prod almost all
--     labelled "Philoi", i.e. building this app) become Deep Work: category backfilled, hours to
--     Daedalus. 'read' stays Study (§4a-2 "reading counts as study").
--   · Socrates' Scroll's stored value was never raised by those rows (0182 rerouted them to study
--     without a re-evaluation), so moving them costs no one a displayed hour. No rung is revoked
--     either way — economy_apply_relic_ladder keeps greatest(tier).
--   · Presence (0184): the live "locked in with you" count folds Deep Work into the study room.
--     There are three rooms (study / gym / fitness) and a fourth would need a new broadcast field
--     every installed build ignores; lockin_pair_of is the one place that maps it.
--
-- ─────────────────────────────── RESTATEMENTS, AND THE GUARD ───────────────────────────────
--
-- Restated whole: start_lock_in_session, check_in_fill_category (0182), session_discipline (0182),
-- lockin_pair_of (0184). All shared with sibling branches, so the first block refuses to run unless
-- the live bodies are the ones this file was written against. economy_evaluate_relics is not
-- restated, but its body is what this routing relies on, so it is guarded too. Signatures are
-- unchanged: CREATE OR REPLACE keeps every ACL, and nothing is re-granted.

do $guard$
declare
  r record;
begin
  for r in
    select * from (values
      ('economy_evaluate_relics', '750b8f453aa8fbf8e4bec08e2fda80c1'),
      ('start_lock_in_session',   '2e5f80d95d63df1efcf3f6a07b0cc12d'),
      ('session_discipline',      'b803e53e433ccf1fd3ac9a1c78186d2d'),
      ('check_in_fill_category',  '4ce4a2a70c67f3d33b490529edf8c131'),
      ('lockin_pair_of',          '97f950b3c07d05c059b6257bdead1732')
    ) as t(fn, want)
  loop
    if (select md5(p.prosrc) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = r.fn) is distinct from r.want then
      raise exception '0186: % has drifted from the body this migration restates — re-base before applying', r.fn;
    end if;
  end loop;
end
$guard$;

-- ── 1 · the category is legal ────────────────────────────────────────────────────────────────
alter table check_ins drop constraint if exists check_ins_category_shape;
alter table check_ins add constraint check_ins_category_shape check (
  category is null
  or (category in ('study', 'deep_work') and activity is null)
  -- A 'fitness' row with no activity has no ladder to score against and would silently earn nothing.
  or (category = 'fitness' and activity in ('cardio', 'strength'))
);

alter table lock_in_sessions drop constraint if exists lock_in_sessions_category_shape;
alter table lock_in_sessions add constraint lock_in_sessions_category_shape check (
  category is null
  or (category in ('study', 'deep_work') and activity is null)
  or (category = 'fitness' and activity in ('cardio', 'strength'))
);

-- ── 2 · the ladder ───────────────────────────────────────────────────────────────────────────
-- §4a-2's Hours ladder, unchanged: 10 / 25 / 50 / 100 h, capping at Legendary. The Crown of
-- Olympus counts relic_ladders, so it now needs all four.
insert into relic_ladders (family, relic_key, unit, thresholds, rarities) values
  ('deep_work', 'relic-daedalus-blueprint', 'h', array[10,25,50,100],
                                                 array['uncommon','rare','epic','legendary'])
on conflict (family) do update set
  relic_key  = excluded.relic_key,
  unit       = excluded.unit,
  thresholds = excluded.thresholds,
  rarities   = excluded.rarities;

-- ── 3 · goal_type → relic family ─────────────────────────────────────────────────────────────
create or replace function public.session_discipline(p_goal_type text)
returns text
language sql
immutable
as $$
  -- 0186: two hours ladders. Studying writes goal_type 'study' and is Socrates' Scroll; Deep Work
  -- writes 'custom' and is Daedalus' Blueprint. job_applications / deep_work are legacy flat types
  -- for the same making-things work. meditate has no ladder (Oracle's Stillness is retired), and
  -- social_media was never a discipline.
  select case
    when p_goal_type in ('gym', 'run') then null   -- scored by the volume/distance ladders instead
    when p_goal_type is null then null
    when p_goal_type in ('study', 'read') then 'study'
    when p_goal_type in ('custom', 'job_applications', 'deep_work') then 'deep_work'
    else null
  end;
$$;

-- ── 4 · starting a session ───────────────────────────────────────────────────────────────────
-- 0182's body. Changes: 'deep_work' as a category (goal_type 'custom', course allowed), and the
-- old-shape derivation files 'custom' / 'job_applications' under Deep Work.
create or replace function start_lock_in_session(
  p_goal_type text default null,
  p_goal_detail text default null,
  p_circle_id uuid default null,
  p_category text default null,
  p_activity text default null,
  p_course_id uuid default null
)
returns lock_in_sessions
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_session lock_in_sessions;
  v_last_check_in timestamptz;
  v_category text;
  v_activity text;
  v_goal_type text;
  v_course_title text;
begin
  if p_circle_id is not null and not is_group_member(p_circle_id) then
    raise exception 'Not a member of that campfire.';
  end if;

  if exists (select 1 from lock_in_sessions where user_id = auth.uid() and status = 'active') then
    raise exception 'You''re already locked in — stop that session first.';
  end if;

  select max(created_at) into v_last_check_in
  from check_ins
  where user_id = auth.uid() and duration_seconds is not null and removed_at is null;

  if v_last_check_in is not null and v_last_check_in > now() - interval '3 minutes' then
    raise exception 'Take a short breather before your next lock-in.';
  end if;

  -- ONE source of truth, whichever half the caller speaks. A new build sends the two-tier choice
  -- and the flat goal_type is derived for it; an old build sends goal_type and the two-tier shape
  -- is derived instead. Deriving rather than trusting both is what stops a row existing that says
  -- 'fitness'/'cardio' in one column and 'study' in another.
  if p_category is not null then
    v_category := p_category;
    v_activity := case when p_category = 'fitness' then p_activity else null end;
    v_goal_type := case
      when p_category = 'fitness' and p_activity = 'strength' then 'gym'
      when p_category = 'fitness' and p_activity = 'cardio' then 'run'
      -- 0186: a type every installed build can render. See the header.
      when p_category = 'deep_work' then 'custom'
      else 'study'
    end;
  else
    v_goal_type := coalesce(p_goal_type, 'study');
    v_category := case
      when v_goal_type in ('gym', 'run') then 'fitness'
      when v_goal_type in ('custom', 'job_applications', 'deep_work') then 'deep_work'
      else 'study'
    end;
    v_activity := case v_goal_type when 'gym' then 'strength' when 'run' then 'cardio' else null end;
  end if;

  if v_category = 'fitness' and v_activity is null then
    raise exception 'Pick cardio or strength.';
  end if;

  -- A course id is only honoured if it is the caller's own and still live. Not a nicety: the id
  -- comes off the wire, and without this a member could stamp their session with someone else's
  -- course row and read its title straight back out of the response.
  if p_course_id is not null then
    select uc.title into v_course_title
    from user_courses uc
    where uc.id = p_course_id and uc.user_id = auth.uid() and uc.archived_at is null;

    if v_course_title is null then
      raise exception 'That course is not available.';
    end if;
  end if;

  insert into lock_in_sessions (user_id, goal_type, goal_detail, circle_id, category, activity, course_id)
  values (
    auth.uid(),
    v_goal_type,
    -- The course title doubles as the detail so every existing reader — the timeline, the profile, the
    -- activity screen, the time-goal matcher — keeps showing what the member picked without any
    -- of them learning about courses.
    coalesce(p_goal_detail, v_course_title),
    p_circle_id,
    v_category,
    v_activity,
    -- 0186: one course list serves Studying and Deep Work alike.
    case when v_category in ('study', 'deep_work') then p_course_id else null end
  )
  returning * into v_session;

  return v_session;
end;
$$;

-- ── 5 · a check-in written without a session derives the same way ────────────────────────────
create or replace function check_in_fill_category()
returns trigger
language plpgsql
as $$
begin
  if new.category is null and new.goal_type is not null then
    new.category := case
      when new.goal_type in ('gym', 'run') then 'fitness'
      when new.goal_type in ('custom', 'job_applications', 'deep_work') then 'deep_work'
      else 'study'
    end;
    new.activity := case new.goal_type when 'gym' then 'strength' when 'run' then 'cardio' else null end;
  end if;
  return new;
end;
$$;

-- ── 6 · presence folds Deep Work into the study room ─────────────────────────────────────────
-- 0184's body, with deep_work mapped to study before anything else reads it. Without this a
-- deep-work session lands in the 'fitness' key (the case falls through) and is counted nowhere.
create or replace function lockin_pair_of(p_category text, p_activity text, p_goal_type text)
returns table (category text, activity text)
language sql
immutable
as $$
  select
    coalesce(case when p_category = 'deep_work' then 'study' else p_category end,
      case when p_goal_type in ('gym', 'run') then 'fitness' else 'study' end),
    case
      when coalesce(case when p_category = 'deep_work' then 'study' else p_category end,
                    case when p_goal_type in ('gym', 'run') then 'fitness' else 'study' end) <> 'fitness'
        then null
      else coalesce(p_activity, case when p_goal_type = 'run' then 'cardio' else 'strength' end)
    end;
$$;

-- ── 7 · backfill: legacy Custom rows are Deep Work ───────────────────────────────────────────
update check_ins
set category = 'deep_work', activity = null
where goal_type in ('custom', 'job_applications', 'deep_work')
  and category is distinct from 'deep_work';

update lock_in_sessions
set category = 'deep_work', activity = null
where goal_type in ('custom', 'job_applications', 'deep_work')
  and category is distinct from 'deep_work';

-- ── 8 · re-evaluate the members whose hours moved ladder ─────────────────────────────────────
-- Only accounts with durationed Deep-Work-family check-ins. Without this their Daedalus reads 0 h
-- until their next lock-in.
--
-- NO PUSH BLAST and no reveal owed for hours logged weeks ago: philoi.suppress_push routes 0179's
-- retro branch, which skips the send AND spends both reveal budgets. `set local` is transaction-
-- scoped — run inside BEGIN/COMMIT if this file is ever applied by hand.
set local philoi.suppress_push = 'on';

do $$
declare
  v_user uuid;
  v_n int := 0;
begin
  for v_user in
    select distinct ci.user_id
    from check_ins ci
    where ci.removed_at is null
      and ci.duration_seconds is not null
      and session_discipline(ci.goal_type) = 'deep_work'
  loop
    begin
      perform economy_evaluate_relics(v_user);
      v_n := v_n + 1;
    exception when others then
      raise warning '0186 re-evaluation skipped user % — %', v_user, sqlerrm;
    end;
  end loop;
  raise notice '0186 deep-work re-evaluation: % users', v_n;
end;
$$;

-- ── 9 · assertions ───────────────────────────────────────────────────────────────────────────
do $assert$
begin
  if (select count(*) from relic_ladders) <> 4
     or not exists (select 1 from relic_ladders where family = 'deep_work' and relic_key = 'relic-daedalus-blueprint') then
    raise exception '0186 assert: relic_ladders is not the four live ladders';
  end if;

  if session_discipline('study') is distinct from 'study'
     or session_discipline('read') is distinct from 'study'
     or session_discipline('custom') is distinct from 'deep_work'
     or session_discipline('job_applications') is distinct from 'deep_work'
     or session_discipline('meditate') is not null
     or session_discipline('run') is not null
     or session_discipline('gym') is not null then
    raise exception '0186 assert: session_discipline routing is wrong';
  end if;

  if (select l.category from lockin_pair_of('deep_work', null, 'custom') l) is distinct from 'study' then
    raise exception '0186 assert: presence does not fold deep_work into study';
  end if;

  if exists (select 1 from check_ins where goal_type in ('custom', 'job_applications') and category <> 'deep_work') then
    raise exception '0186 assert: a legacy custom check-in was left outside deep_work';
  end if;

  if (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname in ('start_lock_in_session', 'session_discipline', 'check_in_fill_category', 'lockin_pair_of')) <> 4 then
    raise exception '0186 assert: an overload appeared';
  end if;

  if has_function_privilege('authenticated', 'public.economy_evaluate_relics(uuid)', 'execute') then
    raise exception '0186 assert: economy_evaluate_relics is callable by authenticated (0132 undone)';
  end if;
end
$assert$;
