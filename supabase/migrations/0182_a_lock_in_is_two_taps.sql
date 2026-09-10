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
