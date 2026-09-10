-- The two-tap lock-in taxonomy (CODE_PROMPT, design-mocks/194-lockin-two-tap.html).
--
-- Six flat goal types collapse to TWO top-level categories and one sub-choice:
--
--   Studying  -> a course (the member's own), or "Custom" (reading, job apps, anything)
--   Fitness   -> cardio (distance ladder, Strava-auto) | strength (volume ladder, log sets)
--
-- Everything resolves to one of three relic-bearing disciplines: Study, Cardio, Strength.
-- Deep Work and Meditate are retired as selectable types AND as relic families.
--
-- ── WHY THIS IS PURELY ADDITIVE, AND WHY goal_type IS NOT REWRITTEN ─────────────────────────
--
-- Pilot members are carrying INSTALLED BUILDS, and OTA is closed while runtimeVersion is
-- sdkVersion — so a phone only picks up new client code when its owner installs a new APK. If
-- this migration rewrote check_ins.goal_type from 'gym' to 'fitness', every installed app would
-- immediately be reading a value its GoalType union does not contain, on rows it renders on the
-- profile, the activity detail and the campfire timeline. The schema would be right and every
-- phone in the pilot would be wrong until its owner happened to update.
--
-- So: new columns alongside, backfilled from the old one. `goal_type` keeps being written by the
-- new client (mapped back down) and keeps meaning exactly what it meant. Dropping it is a later
-- migration, once the old builds are gone — which is what "don't drop the old column in the same
-- migration if prod rows still read it" is asking for.
--
-- ── WHY THERE IS NO deep_work/meditate DATA REMAP ──────────────────────────────────────────
--
-- The prompt asks to remap those rows and warns to confirm counts first because there are real
-- pilot users. Confirmed, and the answer is that there are none:
--
--   check_ins.goal_type        study 141 · custom 46 · run 16 · gym 15
--   lock_in_sessions.goal_type study 139 · custom 46 · gym 15 · run 2
--   relic_progress.family      distance 5 · volume 5 · study 2
--
-- Nobody has ever locked in as deep_work or meditate, and nobody holds progress in either
-- ladder. The only rows carrying those values are the two CATALOG rows in relic_ladders, which
-- is a definition table, not member data. So this deletes two catalog rows and remaps no member
-- data at all. The backfill below is for the goal_type -> (category, activity) move, which is a
-- different thing entirely and does touch every row.

-- ── The member's courses ────────────────────────────────────────────────────────────────────
-- Tap 2 under Studying. A course is an ENTITY rather than the free text it is today, because
-- design-mocks/194 lists a code AND a title ("KP390 · Data Analysis & Statistics") and free text
-- cannot carry the second one.
--
-- It is per-member and self-serve: there is no course catalog to enroll against, no registrar
-- integration, and inventing one to satisfy a picker would be a far bigger feature than the one
-- being asked for. A member adds their own codes; "Custom" adds one with no code at all.
create table if not exists user_courses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles (id) on delete cascade,
  -- "KP390". Nullable, because "Custom" (reading, job apps, a side project) is a real course-less
  -- choice in the mock and must not be forced to invent a code.
  code text,
  -- "Data Analysis & Statistics", or for a custom entry the whole label ("Reading").
  title text not null check (length(btrim(title)) between 1 and 80),
  created_at timestamptz not null default now(),
  -- Soft-retire rather than delete: a past lock-in points at this row, and dropping the course a
  -- member finished last term must not orphan the sessions they did for it.
  archived_at timestamptz
);

create index if not exists user_courses_user_idx on user_courses (user_id) where archived_at is null;

-- One live row per (member, code) so the picker can't accumulate three KP390s. Partial, so an
-- archived course doesn't block re-adding the same code next term, and code-less "Custom"
-- entries (code is null) are never deduped against each other.
create unique index if not exists user_courses_user_code_live_idx
  on user_courses (user_id, upper(btrim(code)))
  where archived_at is null and code is not null;

alter table user_courses enable row level security;

drop policy if exists "own courses readable" on user_courses;
create policy "own courses readable" on user_courses
  for select using (user_id = auth.uid());

drop policy if exists "own courses insertable" on user_courses;
create policy "own courses insertable" on user_courses
  for insert with check (user_id = auth.uid());

drop policy if exists "own courses updatable" on user_courses;
create policy "own courses updatable" on user_courses
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ── The two-tier shape on the two session tables ────────────────────────────────────────────
-- `category` is the first tap, `activity` the second when category = 'fitness', `course_id` the
-- second when category = 'study'. Deliberately NOT enums: goal_type is text and the whole point
-- of this migration is to be reversible without a type-drop dance.
alter table check_ins add column if not exists category text;
alter table check_ins add column if not exists activity text;
alter table check_ins add column if not exists course_id uuid references user_courses (id) on delete set null;

alter table lock_in_sessions add column if not exists category text;
alter table lock_in_sessions add column if not exists activity text;
alter table lock_in_sessions add column if not exists course_id uuid references user_courses (id) on delete set null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'check_ins_category_shape') then
    alter table check_ins add constraint check_ins_category_shape check (
      category is null
      or (category = 'study' and activity is null)
      -- The pairing is the invariant worth enforcing: a 'fitness' row with no activity has no
      -- ladder to score against and would silently earn nothing.
      or (category = 'fitness' and activity in ('cardio', 'strength'))
    );
  end if;
  if not exists (select 1 from pg_constraint where conname = 'lock_in_sessions_category_shape') then
    alter table lock_in_sessions add constraint lock_in_sessions_category_shape check (
      category is null
      or (category = 'study' and activity is null)
      or (category = 'fitness' and activity in ('cardio', 'strength'))
    );
  end if;
end $$;

-- ── Backfill ────────────────────────────────────────────────────────────────────────────────
-- gym -> strength, run -> cardio, everything else -> study. "Everything else" is the spec's own
-- rule: reading, job apps and custom are not their own types any more, they are Studying →
-- Custom. social_media is in here for totality; it has no rows and is not offered anywhere.
update check_ins
set category = case when goal_type in ('gym', 'run') then 'fitness' else 'study' end,
    activity = case goal_type when 'gym' then 'strength' when 'run' then 'cardio' else null end
where category is null and goal_type is not null;

update lock_in_sessions
set category = case when goal_type in ('gym', 'run') then 'fitness' else 'study' end,
    activity = case goal_type when 'gym' then 'strength' when 'run' then 'cardio' else null end
where category is null and goal_type is not null;

-- ── Seed each member's courses from what they have already been typing ──────────────────────
-- goal_detail has been carrying course codes as free text all along ("BU127 final", "EC120"), so
-- the picker can open with the member's real courses already in it instead of an empty list they
-- have to populate before the feature does anything.
--
-- Conservative on purpose: only study rows, only short single-token-ish labels that look like a
-- code (letters then digits), uppercased and de-duplicated. A goal_detail of "Philoi" or
-- "BU127 final" is NOT a course code and is left alone rather than guessed at — a wrong course in
-- someone's picker is worse than an absent one, because they have to delete it.
insert into user_courses (user_id, code, title)
select distinct on (ci.user_id, upper(btrim(ci.goal_detail)))
  ci.user_id,
  upper(btrim(ci.goal_detail)),
  upper(btrim(ci.goal_detail))
from check_ins ci
where ci.goal_type = 'study'
  and ci.goal_detail is not null
  and btrim(ci.goal_detail) ~ '^[A-Za-z]{2,4}[0-9]{2,4}$'
on conflict do nothing;

-- Point historical study sessions at the course they named, where that course now exists.
update check_ins ci
set course_id = uc.id
from user_courses uc
where ci.course_id is null
  and ci.goal_type = 'study'
  and uc.user_id = ci.user_id
  and uc.code = upper(btrim(ci.goal_detail));

-- ── Three disciplines, not five ─────────────────────────────────────────────────────────────
-- THE single behavioural lever for the relic side. economy_evaluate_relics groups check-ins by
-- session_discipline(goal_type) and applies a ladder per group, so once this stops returning
-- deep_work/meditate those families stop being produced — no change to that function is needed,
-- and it is deliberately NOT restated here. It is 189 lines that several parallel branches touch,
-- and re-issuing it from an older base is how a sibling's amendment gets silently reverted.
--
-- Signature is unchanged (text -> text), so CREATE OR REPLACE is safe; a changed parameter or
-- return shape would need a DROP first.
create or replace function public.session_discipline(p_goal_type text)
returns text
language sql
immutable
as $$
  -- Everything that is not fitness is Studying now, including the types that used to be their own
  -- disciplines. job_applications and read were already folded in spirit; deep_work and meditate
  -- are folded here, which is what retires their ladders.
  select case
    when p_goal_type in ('gym', 'run') then null   -- scored by the volume/distance ladders instead
    when p_goal_type is null then null
    else 'study'
  end;
$$;

-- ── Retire the two dead ladders ─────────────────────────────────────────────────────────────
-- Safe as an outright delete precisely because the counts above show no relic_progress rows in
-- either family. If that had not held, this would have had to be an archive flag instead — a
-- member's earned relic must never vanish because a category was reorganised.
delete from relic_progress where family in ('deep_work', 'meditate');
delete from relic_ladders where family in ('deep_work', 'meditate');

-- ── Writing the new shape, without restating anybody's function ─────────────────────────────
--
-- The obvious move is to edit stop_lock_in_session to insert the three new columns. It is ~100
-- lines covering the gym log, PR detection, photo fan-out and the workout roll-up, several
-- branches are editing it right now, and re-issuing it from the copy I read a minute ago is
-- precisely how a sibling's amendment gets silently reverted. So it is left completely alone.
--
-- Two triggers do the same job with no restatement, and they cover insert paths this prompt never
-- mentions — the Strava sync and plain photo check-ins both write check_ins directly.

-- 1 · Anything landing in check_ins gets its category derived, whatever wrote it.
create or replace function check_in_fill_category()
returns trigger
language plpgsql
as $$
begin
  if new.category is null and new.goal_type is not null then
    new.category := case when new.goal_type in ('gym', 'run') then 'fitness' else 'study' end;
    new.activity := case new.goal_type when 'gym' then 'strength' when 'run' then 'cardio' else null end;
  end if;
  return new;
end;
$$;

drop trigger if exists check_in_fill_category_trg on check_ins;
create trigger check_in_fill_category_trg
  before insert on check_ins
  for each row execute function check_in_fill_category();

-- 2 · When a session closes, its own two-tier choice wins over the derivation above — the session
-- is where the member actually picked, and it is the only thing that knows WHICH COURSE.
--
-- Hung on the update that sets ended_check_in_id rather than on the insert, because at insert time
-- the check-in does not yet know which session produced it; stop_lock_in_session sets that link
-- immediately afterwards, in the same transaction.
create or replace function lock_in_session_stamp_check_in()
returns trigger
language plpgsql
as $$
begin
  if new.ended_check_in_id is not null and old.ended_check_in_id is distinct from new.ended_check_in_id then
    update check_ins
    set category = coalesce(new.category, category),
        activity = case when new.category is not null then new.activity else activity end,
        course_id = coalesce(new.course_id, course_id)
    where id = new.ended_check_in_id;
  end if;
  return new;
end;
$$;

drop trigger if exists lock_in_session_stamp_check_in_trg on lock_in_sessions;
create trigger lock_in_session_stamp_check_in_trg
  after update on lock_in_sessions
  for each row execute function lock_in_session_stamp_check_in();

-- ── Starting a session with the two-tier choice ─────────────────────────────────────────────
--
-- DROP first, not CREATE OR REPLACE. Postgres treats the parameter list as part of the identity,
-- so replacing a function while appending parameters creates a SECOND overload and leaves the old
-- one live — and then which one runs depends on how the caller happens to bind its arguments.
--
-- The new parameters are all optional and appended, so a currently-installed build calling
-- (p_goal_type, p_goal_detail, p_circle_id) still resolves and still works. That matters more than
-- usual here: those builds are in the pilot's hands and cannot be updated over the air.
drop function if exists start_lock_in_session(text, text, uuid);
drop function if exists start_lock_in_session(text, text, uuid, text, text, uuid);
create function start_lock_in_session(
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
      else 'study'
    end;
  else
    v_goal_type := coalesce(p_goal_type, 'study');
    v_category := case when v_goal_type in ('gym', 'run') then 'fitness' else 'study' end;
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
    case when v_category = 'study' then p_course_id else null end
  )
  returning * into v_session;

  return v_session;
end;
$$;
