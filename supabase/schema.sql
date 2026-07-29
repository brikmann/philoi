-- Philoi — core schema, RLS, and RPCs.
-- Run this whole file ONCE, on a FRESH/empty Supabase project, in the SQL editor (or via
-- `supabase db push`). The DDL is idempotent, so re-running against an EMPTY database is safe.
-- Do NOT re-run it against a database that already has real data: the goals-refactor and
-- lock-in-rebuild sections below are one-time historical data migrations — they temporarily
-- set check_ins.goal_id NOT NULL (then later drop it) and soft-remove duplicate same-day
-- rows, so replaying them against an evolved DB both fails (the goal_id backfill assertion)
-- and can mutate live data. To evolve an existing database, apply the incremental files in
-- supabase/migrations/ instead — that's what they're for.

create extension if not exists pgcrypto;

-- ───────────────────────────── tables ─────────────────────────────

-- profiles.is_pro / pro_until now mean "has an active paid Philoi membership"
-- (hard paywall after the trial window — see TRIAL_DAYS in src/lib/billing.ts),
-- not a cosmetic upsell tier.
create table if not exists profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  handle text unique,
  display_name text not null,
  avatar_url text,
  university text,
  is_pro boolean not null default false,
  pro_until timestamptz,
  -- Legal / store requirements: 18+ attestation + consent to Terms/Privacy.
  -- Null = user signed up before this gate existed (treat as needing consent).
  has_consented boolean not null default false,
  consented_at timestamptz,
  consent_version text,  -- policy version string, e.g. "2026-06-30"
  created_at timestamptz not null default now()
);

alter table profiles add column if not exists has_consented boolean not null default false;
alter table profiles add column if not exists consented_at timestamptz;
alter table profiles add column if not exists consent_version text;

-- Canonical universities (PHILOI_UI_SPEC.md §21 — "a real, searchable university picker, not
-- a free-text field... so campus leaderboards and class campfires group cleanly"). profiles.
-- university stays plain text (an FK migration would touch every university-scoped query) but
-- the onboarding picker always writes this table's canonical spelling; free text is still
-- allowed as a "not listed" fallback for schools not yet seeded here.
create table if not exists universities (
  id uuid primary key default gen_random_uuid(),
  name text not null unique
);

alter table universities enable row level security;

drop policy if exists "universities: read all" on universities;
create policy "universities: read all" on universities for select using (true);

insert into universities (name) values
  ('Wilfrid Laurier University'),
  ('University of Waterloo'),
  ('University of Toronto'),
  ('McMaster University'),
  ('Western University'),
  ('Queen''s University'),
  ('University of Guelph'),
  ('Toronto Metropolitan University'),
  ('York University'),
  ('University of Ottawa')
on conflict (name) do nothing;

create table if not exists groups (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  emoji text not null default '🔥',
  owner_id uuid not null references profiles (id) on delete cascade,
  join_code text not null unique default upper(substr(md5(random()::text), 1, 6)),
  goal_type text not null default 'custom' check (goal_type in ('gym', 'run', 'study', 'custom')),
  cadence text not null default '7x/week',
  is_public boolean not null default false,
  created_at timestamptz not null default now()
);

-- Additive columns for projects that already ran this file before university/is_public existed.
alter table profiles add column if not exists university text;
alter table groups add column if not exists is_public boolean not null default false;

-- Campfire privacy — a single 3-state enum (PHILOI_UI_SPEC.md §14), replacing the earlier
-- is_public boolean + a short-lived visibility column: open (in the valley, instant-join),
-- gated (in the valley, owner approves), private (hidden, code-only). A fresh install has no
-- pre-existing groups rows to backfill from is_public — migrations/0023_*.sql is what carried
-- the live database's existing rows across (is_public=true -> open, else -> private).
alter table groups add column if not exists privacy text not null default 'open'
  check (privacy in ('open', 'gated', 'private'));

alter table groups drop column if exists is_public;
alter table groups drop column if exists visibility;

-- A user's pending ask to join a gated campfire — the owner approves/denies (an approval
-- inbox UI is a follow-up; this migration only wires the request + owner notification).
create table if not exists group_join_requests (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references groups (id) on delete cascade,
  user_id uuid not null references profiles (id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'approved', 'denied')),
  created_at timestamptz not null default now()
);

create unique index if not exists group_join_requests_pending_unique
  on group_join_requests (group_id, user_id) where status = 'pending';

alter table group_join_requests enable row level security;

drop policy if exists "group_join_requests: read own or as owner" on group_join_requests;
create policy "group_join_requests: read own or as owner" on group_join_requests for select using (
  user_id = auth.uid() or exists (select 1 from groups where id = group_id and owner_id = auth.uid())
);

-- No insert/update policy for regular users — RPC-gated (request_to_join_group below), same
-- pattern as join_public_group/join_group_with_code.

-- Class-tagged campfires (PHILOI_UI_SPEC.md §14) — course_code/school metadata for a
-- "course study-hall" campfire, searchable/discoverable by course (see
-- get_discoverable_groups() below).
alter table groups add column if not exists course_code text;
alter table groups add column if not exists school text;
create index if not exists groups_course_school_idx on groups (course_code, school) where course_code is not null;

create table if not exists group_members (
  group_id uuid not null references groups (id) on delete cascade,
  user_id uuid not null references profiles (id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'member')),
  joined_at timestamptz not null default now(),
  current_streak integer not null default 0,
  longest_streak integer not null default 0,
  -- Personal target within the circle — e.g. "A in CHEM101" for a study group. Self-reported,
  -- set via set_my_goal_target() (not a direct column update — see RLS note below).
  goal_target text,
  primary key (group_id, user_id)
);

alter table group_members add column if not exists goal_target text;
-- "I can help with this class" (PHILOI_UI_SPEC.md §14) — self-declared, surfaced as a badge
-- in a class campfire's members list/leaderboard. Toggled via set_my_helper_flag() below, not
-- a direct column update — group_members has no general update policy (see chat_muted's note).
alter table group_members add column if not exists is_helper boolean not null default false;

create table if not exists check_ins (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references groups (id) on delete cascade,
  user_id uuid not null references profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  photo_url text not null,
  caption text,
  status text not null default 'on_time' check (status in ('on_time', 'late'))
);

create table if not exists reactions (
  id uuid primary key default gen_random_uuid(),
  check_in_id uuid not null references check_ins (id) on delete cascade,
  user_id uuid not null references profiles (id) on delete cascade,
  emoji text not null,
  created_at timestamptz not null default now(),
  unique (check_in_id, user_id, emoji)
);

create table if not exists invites (
  code text primary key default upper(substr(md5(random()::text), 1, 6)),
  inviter_id uuid not null references profiles (id) on delete cascade,
  group_id uuid references groups (id) on delete cascade,
  created_at timestamptz not null default now()
);

-- Traction analytics — see src/lib/analytics.ts track() and the analytics_* views below.
-- No read policy for normal users on purpose: query this via the SQL editor / table editor
-- (service role bypasses RLS), not from the client.
create table if not exists events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references profiles (id) on delete set null,
  -- No enum check — the event vocabulary is still settling (see AnalyticsEventName in
  -- src/types/database.ts for the current set); a DB check constraint just adds migration
  -- friction every time it changes. PostHog is the source of truth for analysis anyway.
  name text not null,
  properties jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table events drop constraint if exists events_name_check;

-- Guarded by column existence (not just "if not exists" on the index) — check_ins.group_id
-- is dropped by the goals-refactor section further down, so on a re-run against an
-- already-migrated database this column is gone and a bare CREATE INDEX would error out.
-- These two indexes are superseded by check_ins_goal_created_idx/check_ins_user_created_idx
-- in that section anyway, so skipping them post-migration is correct, not just safe.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'check_ins' and column_name = 'group_id'
  ) then
    execute 'create index if not exists check_ins_group_created_idx on check_ins (group_id, created_at desc)';
    execute 'create index if not exists check_ins_user_group_idx on check_ins (user_id, group_id, created_at desc)';
  end if;
end $$;

create index if not exists reactions_check_in_idx on reactions (check_in_id);
create index if not exists events_user_created_idx on events (user_id, created_at desc);
create index if not exists events_name_created_idx on events (name, created_at desc);

-- ───────────────────────── input validation ─────────────────────────
-- Client-side maxLength props (caption 140, group name 40, cadence 20) are UX guardrails,
-- not security — a raw REST call bypasses them entirely. These CHECK constraints are the
-- real backstop; bounds are generous relative to the UI limits so legitimate input never
-- hits them.

alter table check_ins drop constraint if exists check_ins_caption_length;
alter table check_ins add constraint check_ins_caption_length check (caption is null or char_length(caption) <= 280);

alter table groups drop constraint if exists groups_name_length;
alter table groups add constraint groups_name_length check (char_length(name) between 1 and 60);

-- Cadence is intentionally free text in the UI ("Or type a custom cadence"), not a closed
-- enum — e.g. study circles use "10 hrs/week" — so this only bounds length, not format.
alter table groups drop constraint if exists groups_cadence_length;
alter table groups add constraint groups_cadence_length check (char_length(cadence) <= 30);

alter table groups drop constraint if exists groups_emoji_length;
alter table groups add constraint groups_emoji_length check (char_length(emoji) <= 8);

-- Storage-layer backstop for photo uploads — matches the image/jpeg contentType check-ins.ts
-- always uploads with, and caps size well above what a quality:0.7 camera capture produces.
update storage.buckets
set file_size_limit = 8388608, -- 8 MB
    allowed_mime_types = array['image/jpeg']
where id = 'check-in-photos';

-- ───────────────────────── rate limiting ─────────────────────────
-- One check-in per user per group per UTC day — closes the obvious streak-farming exploit
-- (posting many check-ins back-to-back) and matches recompute_streak()'s existing
-- calendar-day semantics, so this isn't a new restriction, just an enforced one.
-- Guarded the same way as the indexes above — superseded by the goal_id-based version of
-- this same index name further down, so this is a no-op (not an error) post-migration.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'check_ins' and column_name = 'group_id'
  ) then
    execute 'create unique index if not exists check_ins_one_per_day
      on check_ins (group_id, user_id, ((created_at at time zone ''utc'')::date))';
  end if;
end $$;

-- At most one personal (non-group) invite code per user — closes the gap where the
-- "invites: insert own" RLS policy (with check: inviter_id = auth.uid()) would otherwise
-- let a client bypass ensure_personal_invite()'s dedup by inserting directly and
-- generating unlimited codes.
create unique index if not exists invites_one_personal_per_user
  on invites (inviter_id) where group_id is null;

-- ───────────────────────── helper: membership check ─────────────────────────

create or replace function is_group_member(p_group_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from group_members
    where group_id = p_group_id and user_id = auth.uid()
  );
$$;

-- ───────────────────────────── RLS ─────────────────────────────

alter table profiles enable row level security;
alter table groups enable row level security;
alter table group_members enable row level security;
alter table check_ins enable row level security;
alter table reactions enable row level security;
alter table invites enable row level security;
alter table events enable row level security;

drop policy if exists "profiles: read any" on profiles;
create policy "profiles: read any" on profiles for select using (true);

drop policy if exists "profiles: update own" on profiles;
create policy "profiles: update own" on profiles for update using (id = auth.uid());

drop policy if exists "profiles: insert own" on profiles;
create policy "profiles: insert own" on profiles for insert with check (id = auth.uid());

drop policy if exists "groups: read if member" on groups;
create policy "groups: read if member" on groups for select using (is_group_member(id));

drop policy if exists "groups: read if public" on groups;
create policy "groups: read if public" on groups for select using (privacy in ('open', 'gated'));

drop policy if exists "groups: insert as self" on groups;
create policy "groups: insert as self" on groups for insert with check (owner_id = auth.uid());

drop policy if exists "groups: owner can update" on groups;
create policy "groups: owner can update" on groups for update using (owner_id = auth.uid());

drop policy if exists "groups: owner can delete" on groups;
create policy "groups: owner can delete" on groups for delete using (owner_id = auth.uid());

drop policy if exists "group_members: read if member" on group_members;
create policy "group_members: read if member" on group_members for select using (is_group_member(group_id));

drop policy if exists "group_members: insert self" on group_members;
create policy "group_members: insert self" on group_members for insert with check (user_id = auth.uid());

-- Members can leave; owners must delete the whole circle instead (avoids an orphaned circle).
drop policy if exists "group_members: leave if not owner" on group_members;
create policy "group_members: leave if not owner" on group_members for delete using (
  user_id = auth.uid() and role <> 'owner'
);

-- Guarded by column existence — these four policies reference check_ins.group_id, which
-- the goals-refactor section drops further down. On a fresh database this runs fine (the
-- column exists until dropped later in this same pass); on a re-run against an
-- already-migrated database it's skipped, since the goals-refactor section redefines all
-- four of these policies without group_id anyway.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'check_ins' and column_name = 'group_id'
  ) then
    execute 'drop policy if exists "check_ins: read if member" on check_ins';
    execute 'create policy "check_ins: read if member" on check_ins for select using (is_group_member(group_id))';

    execute 'drop policy if exists "check_ins: insert own if member" on check_ins';
    execute 'create policy "check_ins: insert own if member" on check_ins for insert
      with check (user_id = auth.uid() and is_group_member(group_id))';

    execute 'drop policy if exists "reactions: read if member" on reactions';
    execute 'create policy "reactions: read if member" on reactions for select using (
      exists (
        select 1 from check_ins
        where check_ins.id = reactions.check_in_id and is_group_member(check_ins.group_id)
      )
    )';

    execute 'drop policy if exists "reactions: insert own if member" on reactions';
    execute 'create policy "reactions: insert own if member" on reactions for insert with check (
      user_id = auth.uid()
      and exists (
        select 1 from check_ins
        where check_ins.id = reactions.check_in_id and is_group_member(check_ins.group_id)
      )
    )';
  end if;
end $$;

drop policy if exists "reactions: delete own" on reactions;
create policy "reactions: delete own" on reactions for delete using (user_id = auth.uid());

drop policy if exists "invites: read own or for my groups" on invites;
create policy "invites: read own or for my groups" on invites for select using (
  inviter_id = auth.uid() or (group_id is not null and is_group_member(group_id))
);

drop policy if exists "invites: insert own" on invites;
create policy "invites: insert own" on invites for insert with check (inviter_id = auth.uid());

drop policy if exists "events: insert own" on events;
create policy "events: insert own" on events for insert with check (user_id = auth.uid());

-- ───────────────────────────── streak trigger ─────────────────────────────

create or replace function recompute_streak(p_group_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_dates date[];
  v_streak integer := 0;
  v_longest integer := 0;
  v_expected date := current_date;
  d date;
begin
  select array_agg(distinct (created_at at time zone 'utc')::date order by (created_at at time zone 'utc')::date desc)
  into v_dates
  from check_ins
  where group_id = p_group_id and user_id = p_user_id;

  if v_dates is null then
    update group_members set current_streak = 0 where group_id = p_group_id and user_id = p_user_id;
    return;
  end if;

  -- Current streak: consecutive days ending today or yesterday (today's check-in is optional
  -- until the day is over, so a missed "today" doesn't zero out yesterday's streak).
  if v_dates[1] = current_date or v_dates[1] = current_date - 1 then
    v_expected := v_dates[1];
    foreach d in array v_dates loop
      if d = v_expected then
        v_streak := v_streak + 1;
        v_expected := v_expected - 1;
      else
        exit;
      end if;
    end loop;
  end if;

  -- Longest streak: longest run of consecutive days anywhere in history.
  v_longest := 1;
  declare
    v_run integer := 1;
    i integer;
  begin
    for i in 2 .. array_length(v_dates, 1) loop
      if v_dates[i] = v_dates[i - 1] - 1 then
        v_run := v_run + 1;
      else
        v_run := 1;
      end if;
      if v_run > v_longest then
        v_longest := v_run;
      end if;
    end loop;
  end;

  update group_members
  set current_streak = v_streak,
      longest_streak = greatest(longest_streak, v_longest, v_streak)
  where group_id = p_group_id and user_id = p_user_id;
end;
$$;

create or replace function handle_check_in_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform recompute_streak(new.group_id, new.user_id);
  return new;
end;
$$;

drop trigger if exists on_check_in_insert on check_ins;
create trigger on_check_in_insert
  after insert on check_ins
  for each row execute function handle_check_in_insert();

-- ───────────────────────────── RPCs ─────────────────────────────

-- Signature changed repeatedly (course_code/school added for class campfires, then
-- is_public/visibility collapsed into one p_privacy param, PHILOI_UI_SPEC.md §14) — drop
-- first, same treatment every signature change in this file gets. Also drops stale overloads
-- left from before those parameters existed.
drop function if exists create_group_with_owner(text, text, text, text, boolean);
drop function if exists create_group_with_owner(text, text, text, text);
drop function if exists create_group_with_owner(text, text, text, text, boolean, text, text);
drop function if exists create_group_with_owner(text, text, text, text, boolean, text, text, text);
-- Current signature — must be dropped too so re-running this file is idempotent (the plain
-- `create function` below errors "already exists" otherwise).
drop function if exists create_group_with_owner(text, text, text, text, text, text, text);
create function create_group_with_owner(
  p_name text,
  p_emoji text,
  p_goal_type text,
  p_cadence text,
  p_course_code text default null,
  p_school text default null,
  p_privacy text default 'open'
)
returns groups
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group groups;
begin
  if p_privacy not in ('open', 'gated', 'private') then
    raise exception 'Invalid campfire privacy.';
  end if;

  insert into groups (name, emoji, owner_id, goal_type, cadence, course_code, school, privacy)
  values (p_name, coalesce(p_emoji, '🔥'), auth.uid(), p_goal_type, p_cadence, p_course_code, p_school, p_privacy)
  returning * into v_group;

  insert into group_members (group_id, user_id, role)
  values (v_group.id, auth.uid(), 'owner');

  insert into invites (code, inviter_id, group_id)
  values (v_group.join_code, auth.uid(), v_group.id);

  return v_group;
end;
$$;

create or replace function join_group_with_code(p_code text)
returns groups
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group groups;
begin
  select * into v_group from groups where join_code = upper(p_code);

  if v_group.id is null then
    raise exception 'No group found for that code.';
  end if;

  insert into group_members (group_id, user_id, role)
  values (v_group.id, auth.uid(), 'member')
  on conflict (group_id, user_id) do nothing;

  return v_group;
end;
$$;

-- Only 'open' circles are instant-join — 'gated' ones must go through
-- request_to_join_group instead (see below).
create or replace function join_public_group(p_group_id uuid)
returns groups
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group groups;
begin
  select * into v_group from groups where id = p_group_id and privacy = 'open';

  if v_group.id is null then
    raise exception 'That circle is not open for instant joining.';
  end if;

  insert into group_members (group_id, user_id, role)
  values (v_group.id, auth.uid(), 'member')
  on conflict (group_id, user_id) do nothing;

  return v_group;
end;
$$;

-- A user's ask to join a gated campfire — pings the owner, who approves/denies (approval
-- inbox UI is a follow-up; this just wires the request + notification).
create or replace function request_to_join_group(p_group_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group groups;
  v_requester_name text;
begin
  select * into v_group from groups where id = p_group_id and privacy = 'gated';
  if v_group.id is null then
    raise exception 'That campfire is not open to join requests.';
  end if;

  if is_group_member(p_group_id) then
    raise exception 'Already a member.';
  end if;

  insert into group_join_requests (group_id, user_id)
  values (p_group_id, auth.uid())
  on conflict (group_id, user_id) where status = 'pending' do nothing;

  select display_name into v_requester_name from profiles where id = auth.uid();
  perform notify_push(
    array[v_group.owner_id],
    v_group.name,
    coalesce(v_requester_name, 'Someone') || ' wants to join your campfire',
    jsonb_build_object('type', 'join_request', 'group_id', p_group_id)
  );
end;
$$;

-- Cold-start discovery: public circles the caller isn't already in yet,
-- ranked by same-university match first, then by goal type match, then recency.
-- p_search (added alongside the discoverable-search screen) does a name ILIKE match.
-- Appending a new parameter turns out NOT to be safe via plain CREATE OR REPLACE either —
-- Postgres treats a different parameter-type list as a distinct overload rather than
-- replacing the old one, so this drops the old 2-arg version explicitly first (same lesson
-- as get_my_ranks/stop_lock_in_session earlier this session, a different flavor of it).
drop function if exists get_discoverable_groups(text, int);
-- Signature changed again (course_code/school added to both the search predicate and the
-- return shape, for class-campfire discovery — PHILOI_UI_SPEC.md §14) — drop first.
drop function if exists get_discoverable_groups(text, int, text);

-- Return shape changed again (visibility -> privacy, campfire_level/has_pending_request
-- added, for the valley's privacy-aware preview sheet, §10) — same drop-first rule.
create function get_discoverable_groups(p_goal_type text default null, p_limit int default 20, p_search text default null)
returns table (
  id uuid,
  name text,
  emoji text,
  goal_type text,
  cadence text,
  member_count bigint,
  owner_university text,
  course_code text,
  school text,
  privacy text,
  campfire_level int,
  has_pending_request boolean
)
language sql
security definer
set search_path = public
stable
as $$
  select
    g.id,
    g.name,
    g.emoji,
    g.goal_type,
    g.cadence,
    (select count(*) from group_members gm2 where gm2.group_id = g.id) as member_count,
    owner.university as owner_university,
    g.course_code,
    g.school,
    g.privacy,
    campfire_level_for_xp(coalesce((select cl.xp from campfire_levels cl where cl.group_id = g.id), 0)) as campfire_level,
    exists (
      select 1 from group_join_requests r
      where r.group_id = g.id and r.user_id = auth.uid() and r.status = 'pending'
    ) as has_pending_request
  from groups g
  join profiles owner on owner.id = g.owner_id
  where g.privacy in ('open', 'gated')
    and not exists (
      select 1 from group_members gm
      where gm.group_id = g.id and gm.user_id = auth.uid()
    )
    and (p_goal_type is null or g.goal_type = p_goal_type)
    and (
      p_search is null
      or g.name ilike '%' || p_search || '%'
      or g.course_code ilike '%' || p_search || '%'
    )
  order by
    (owner.university is not null and owner.university = (select p.university from profiles p where p.id = auth.uid())) desc,
    g.created_at desc
  limit p_limit;
$$;

create or replace function ensure_personal_invite()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text;
begin
  select code into v_code from invites where inviter_id = auth.uid() and group_id is null limit 1;

  if v_code is null then
    -- ON CONFLICT DO NOTHING against invites_one_personal_per_user (see rate limiting
    -- section above) so two concurrent calls for the same user race safely instead of one
    -- of them throwing a unique-violation.
    insert into invites (inviter_id, group_id)
    values (auth.uid(), null)
    on conflict (inviter_id) where group_id is null do nothing
    returning code into v_code;

    if v_code is null then
      select code into v_code from invites where inviter_id = auth.uid() and group_id is null limit 1;
    end if;
  end if;

  return v_code;
end;
$$;

-- Personal target inside a circle (e.g. "A in CHEM101") — RPC-gated rather than a direct
-- "update own row" RLS policy, so members can't also use that policy to self-edit their streaks.
create or replace function set_my_goal_target(p_group_id uuid, p_goal_target text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update group_members
  set goal_target = nullif(trim(p_goal_target), '')
  where group_id = p_group_id and user_id = auth.uid();
end;
$$;

-- Deleting a group cascades to group_members/check_ins/reactions/invites for every member,
-- not just the owner's own rows — RLS on those tables only ever permits touching your own
-- row, so a plain client-side `delete from groups` gets blocked mid-cascade and the whole
-- transaction rolls back. Security definer bypasses that for this one owner-gated operation.
create or replace function delete_group(p_group_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from groups where id = p_group_id and owner_id = auth.uid()) then
    raise exception 'Only the owner can delete this circle.';
  end if;

  delete from groups where id = p_group_id;
end;
$$;

-- Bulk-deletes Storage objects via the Storage API (not by deleting storage.objects rows
-- directly — that only removes the metadata catalog entry, not the underlying blob in the
-- backing object store). Needs the project's service_role key in Supabase Vault under the
-- name 'service_role_key' — see the one-time setup note above delete_my_account().
create or replace function delete_storage_prefixes(p_bucket text, p_paths text[])
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_service_key text;
begin
  if p_paths is null or array_length(p_paths, 1) is null then
    return;
  end if;

  select decrypted_secret into v_service_key from vault.decrypted_secrets where name = 'service_role_key';
  if v_service_key is null then
    raise warning 'delete_storage_prefixes: service_role_key not found in Vault — skipping Storage cleanup for bucket %', p_bucket;
    return;
  end if;

  perform net.http_delete(
    url := 'https://coaqgcquzywadrghzbfj.supabase.co/storage/v1/object/' || p_bucket,
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || v_service_key,
      'apikey', v_service_key,
      'Content-Type', 'application/json'
    ),
    body := jsonb_build_object('prefixes', to_jsonb(p_paths))
  );
end;
$$;

-- Wipes everything tied to the caller's account: their circles (cascade), memberships,
-- check-ins, reactions, invites, events, Storage photos, and finally the profile row + auth
-- user. SECURITY DEFINER so the cascade can cross table-owner RLS boundaries (same reason as
-- delete_group). This is required by Google Play + Apple in-app account deletion policy.
--
-- One-time setup required for the Storage cleanup step to work: run this once in the SQL
-- editor with your project's service_role key (Project Settings -> API):
--   select vault.create_secret('<your service_role key>', 'service_role_key');
-- Without it, this function still deletes everything else — it just logs a warning and
-- leaves that user's Storage photos orphaned instead of failing the whole deletion.
create or replace function delete_my_account()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_photo_paths text[];
begin
  if v_user_id is null then
    raise exception 'Not authenticated.';
  end if;

  select coalesce(array_agg(name), '{}')
  into v_photo_paths
  from storage.objects
  where bucket_id = 'check-in-photos' and (storage.foldername(name))[2] = v_user_id::text;

  perform delete_storage_prefixes('check-in-photos', v_photo_paths);

  -- Delete circles the caller owns (cascades to group_members, check_ins, reactions, invites).
  delete from groups where owner_id = v_user_id;

  -- Remove memberships in circles owned by others (doesn't touch other members' data).
  delete from group_members where user_id = v_user_id;

  -- Remaining direct rows. Safe to hard-delete messages here even if one is under a pending
  -- report — snapshot_reported_content() already copied its body onto the report row at
  -- report-time, independent of this row's lifecycle (reported_message_id just goes null).
  delete from reactions where user_id = v_user_id;
  delete from check_ins where user_id = v_user_id;
  delete from messages where user_id = v_user_id;
  delete from invites where inviter_id = v_user_id;
  delete from events where user_id = v_user_id;
  delete from profiles where id = v_user_id;

  -- Remove the auth user last — this invalidates the JWT so no further requests succeed.
  delete from auth.users where id = v_user_id;
end;
$$;

-- get_group_leaderboard / get_weekly_recap / get_university_leaderboard were originally
-- defined here (LANGUAGE SQL, referencing check_ins.group_id / group_members.current_streak
-- / group_members.goal_target). All three are superseded by score-based redefinitions in
-- the goals-refactor section further down, and nothing in this file calls them by name in
-- between — so rather than keep a legacy copy alive just long enough to be immediately
-- replaced (and which errors out on a re-run once those columns are gone), they're omitted
-- here entirely. See supabase/migrations/0002_goals_refactor.sql for the final versions.

-- ───────────────────────────── storage ─────────────────────────────
-- Bucket layout: check-in-photos/{group_id}/{user_id}/{check_in_id}.jpg
-- so policies can read the group id straight out of the object path.

insert into storage.buckets (id, name, public)
values ('check-in-photos', 'check-in-photos', false)
on conflict (id) do nothing;

drop policy if exists "check-in-photos: read if member" on storage.objects;
create policy "check-in-photos: read if member" on storage.objects for select
  using (
    bucket_id = 'check-in-photos'
    and is_group_member(((storage.foldername(name))[1])::uuid)
  );

drop policy if exists "check-in-photos: upload own if member" on storage.objects;
create policy "check-in-photos: upload own if member" on storage.objects for insert
  with check (
    bucket_id = 'check-in-photos'
    and is_group_member(((storage.foldername(name))[1])::uuid)
    and (storage.foldername(name))[2] = auth.uid()::text
  );

-- Public (unlike check-in-photos) — avatars show up everywhere a profile does: feed,
-- leaderboards, other people's circles. Bucket layout: avatars/{user_id}.jpg — one file per
-- user, re-uploading overwrites via upsert rather than accumulating old versions.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 5242880, array['image/jpeg', 'image/png'])
on conflict (id) do update set
  public = true,
  file_size_limit = 5242880,
  allowed_mime_types = array['image/jpeg', 'image/png'];

drop policy if exists "avatars: read any" on storage.objects;
create policy "avatars: read any" on storage.objects for select using (bucket_id = 'avatars');

drop policy if exists "avatars: write own" on storage.objects;
create policy "avatars: write own" on storage.objects for insert
  with check (bucket_id = 'avatars' and (storage.filename(name)) = auth.uid()::text || '.jpg');

drop policy if exists "avatars: update own" on storage.objects;
create policy "avatars: update own" on storage.objects for update
  using (bucket_id = 'avatars' and (storage.filename(name)) = auth.uid()::text || '.jpg');

-- ───────────────────────────── moderation ─────────────────────────────
-- Required for Google Play + Apple social-app review. Every report is preserved;
-- hard-delete only happens after a human moderator reviews it (see Tier B spec).
-- Admins query this via the Supabase Table Editor (service role bypasses RLS).

create table if not exists moderation_reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid references profiles (id) on delete set null,
  reported_check_in_id uuid references check_ins (id) on delete set null,
  reported_user_id uuid references profiles (id) on delete set null,
  reason text not null,
  status text not null default 'pending' check (status in ('pending', 'reviewed', 'actioned', 'dismissed')),
  created_at timestamptz not null default now()
);

create table if not exists blocked_users (
  blocker_id uuid not null references profiles (id) on delete cascade,
  blocked_id uuid not null references profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id)
);

alter table moderation_reports enable row level security;
alter table blocked_users enable row level security;

-- Authenticated users can file a report; only service role can read/update.
drop policy if exists "moderation_reports: insert own" on moderation_reports;
create policy "moderation_reports: insert own" on moderation_reports
  for insert with check (reporter_id = auth.uid());

-- Block: only see your own block list.
drop policy if exists "blocked_users: manage own" on blocked_users;
create policy "blocked_users: manage own" on blocked_users
  for all using (blocker_id = auth.uid());

-- ───────────────────────────── messaging (Phase 7, Tier B) ─────────────────────────────
-- Circle-scoped chat only — no DMs, no cross-circle visibility. Encryption in transit (TLS)
-- and at rest is provided by the Supabase/Postgres infrastructure itself, not app code; this
-- is explicitly NOT end-to-end encrypted per spec, since reports/moderation need to read
-- message content. Client-side, this stays behind the CHAT_ENABLED flag
-- (src/constants/feature-flags.ts) until the Tier-B acceptance checklist has actually been
-- walked through by a human — a schema existing here doesn't mean it's safe to ship.

create table if not exists messages (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references groups (id) on delete cascade,
  user_id uuid not null references profiles (id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now(),
  -- Soft delete only (see delete_my_message() below) — a hard delete here would destroy
  -- evidence for any pending report on this message, which is exactly what the snapshot
  -- trigger further down exists to prevent, but soft-delete is the belt-and-suspenders half.
  deleted_at timestamptz
);

alter table messages drop constraint if exists messages_body_length;
alter table messages add constraint messages_body_length check (char_length(body) between 1 and 2000);

create index if not exists messages_group_created_idx on messages (group_id, created_at desc);

alter table messages enable row level security;

drop policy if exists "messages: read if member" on messages;
create policy "messages: read if member" on messages for select using (is_group_member(group_id));

drop policy if exists "messages: insert own if member" on messages;
create policy "messages: insert own if member" on messages for insert
  with check (user_id = auth.uid() and is_group_member(group_id));

-- Required for subscribeToMessages() (src/lib/api/messages.ts) to receive postgres_changes
-- events at all — RLS above still governs who can actually read them. No "if not exists"
-- form for ALTER PUBLICATION ... ADD TABLE, so guard manually for idempotency.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'messages'
  ) then
    alter publication supabase_realtime add table messages;
  end if;
end $$;

-- No direct UPDATE/DELETE policy — soft-deleting your own message goes through this RPC
-- instead of a raw update, so a client can't rewrite `body` on someone else's message by
-- crafting a matching-id update.
create or replace function delete_my_message(p_message_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update messages
  set deleted_at = now()
  where id = p_message_id and user_id = auth.uid();
end;
$$;

-- Extends the existing report flow to cover messages, and captures a point-in-time snapshot
-- of whatever's being reported (message body, or check-in caption/photo path) directly on
-- the report row. Retention carve-out: without this, deleting the account/message later
-- (delete_my_account, delete_my_message) would silently wipe the evidence a pending report
-- depends on — the FKs below are all `on delete set null` for exactly that reason, and the
-- snapshot is what actually survives that.
alter table moderation_reports add column if not exists reported_message_id uuid references messages (id) on delete set null;
alter table moderation_reports add column if not exists reported_content_snapshot jsonb;

create or replace function snapshot_reported_content()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.reported_message_id is not null then
    select jsonb_build_object('type', 'message', 'body', body, 'user_id', user_id, 'created_at', created_at)
    into new.reported_content_snapshot
    from messages where id = new.reported_message_id;
  elsif new.reported_check_in_id is not null then
    select jsonb_build_object('type', 'check_in', 'caption', caption, 'photo_url', photo_url, 'user_id', user_id, 'created_at', created_at)
    into new.reported_content_snapshot
    from check_ins where id = new.reported_check_in_id;
  end if;
  return new;
end;
$$;

drop trigger if exists on_moderation_report_insert on moderation_reports;
create trigger on_moderation_report_insert
  before insert on moderation_reports
  for each row execute function snapshot_reported_content();

-- Audit log for moderator actions taken on a report (remove content / disable account /
-- report to authorities / dismiss). No RLS policies at all = default-deny for every client
-- role; only the service role (which bypasses RLS) can read or write it, same as
-- moderation_reports. Filled in manually by whoever reviews reports via the Table Editor —
-- there's no in-app admin UI, matching how moderation_reports itself is already handled.
create table if not exists moderation_actions (
  id uuid primary key default gen_random_uuid(),
  report_id uuid references moderation_reports (id) on delete set null,
  action_type text not null check (action_type in ('removed_content', 'disabled_account', 'reported_to_authorities', 'dismissed')),
  target_user_id uuid references profiles (id) on delete set null,
  notes text,
  created_at timestamptz not null default now()
);

alter table moderation_actions enable row level security;

-- ───────────────────────── chat safety (philoi_chat_safety_build.md) ─────────────────────────
-- Closes the gap between the Phase-7 chat build above and the chat-safety acceptance checklist:
-- server-enforced (not just client-filtered) blocking, a real disabled-account gate, rate
-- limiting, and richer moderation-report targeting. CHAT_ENABLED stays false
-- (src/constants/feature-flags.ts) until every check in that spec passes.

alter table profiles add column if not exists is_disabled boolean not null default false;
alter table profiles add column if not exists disabled_at timestamptz;

-- Trusted-human moderator flag, checked by is_admin() below. The admin/ Next.js dashboard
-- (philoi_moderation_dashboard_build.md) already queries this column directly in its
-- middleware.ts/require-admin.ts — it predates this column existing, so adding it here is what
-- makes that app's auth gate actually work rather than fail safe-closed for everyone.
alter table profiles add column if not exists is_admin boolean not null default false;

-- Seed/QA accounts (e.g. Playwright runs, manual smoke-test signups) — excluded alongside
-- is_admin from every analytics_* view so the beta metrics measure real users only, not
-- the founder or test harnesses poking the app. Set manually; nothing in the app sets this.
alter table profiles add column if not exists is_test boolean not null default false;

-- Same SECURITY DEFINER pattern as is_group_member — profiles' own "read any" SELECT policy
-- (using true) means this doesn't strictly need it to avoid recursion, but every other
-- permission-check helper in this file follows this shape, so this does too for consistency.
create or replace function is_admin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select coalesce((select is_admin from profiles where id = auth.uid()), false);
$$;

-- Soft-delete tombstone for check-ins, same reasoning as messages.deleted_at above — a CSAE
-- report can target a check-in's photo (reported_check_in_id), and that content needs to be
-- removable without a hard delete destroying the report's evidence. fetchFeed()
-- (src/lib/api/check-ins.ts) already filters on this column client-side.
alter table check_ins add column if not exists removed_at timestamptz;

-- "profiles: update own" (above) has no separate WITH CHECK, so its USING clause alone governs
-- updates — without this trigger a signed-in user could clear their own is_disabled flag with a
-- plain `update profiles set is_disabled = false`. Two legitimate callers need to bypass this:
-- an is_admin() user acting through the admin dashboard's own session, and the service_role key
-- (admin/src/lib/supabase/admin.ts's suspend route — real enforcement is Supabase Auth's own
-- banned_until via the Auth Admin API, this column is the fast client-side signal so the mobile
-- app doesn't need its own Auth check).
create or replace function lock_profile_moderation_fields()
returns trigger
language plpgsql
as $$
begin
  if not (is_admin() or current_user = 'service_role') and (
    new.is_disabled is distinct from old.is_disabled or new.disabled_at is distinct from old.disabled_at
  ) then
    new.is_disabled := old.is_disabled;
    new.disabled_at := old.disabled_at;
  end if;
  return new;
end;
$$;

drop trigger if exists on_profile_update_lock_moderation on profiles;
create trigger on_profile_update_lock_moderation
  before update on profiles
  for each row execute function lock_profile_moderation_fields();

-- Referenced from the messages SELECT policy below. Must be SECURITY DEFINER (same reason as
-- is_group_member above): blocked_users' own RLS ("manage own", blocker_id = auth.uid()) would
-- otherwise hide the "sender blocked me" direction from a plain invoker-rights query, since that
-- row's blocker_id isn't the viewer.
create or replace function is_blocked_either_way(p_other_user_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from blocked_users
    where (blocker_id = auth.uid() and blocked_id = p_other_user_id)
       or (blocker_id = p_other_user_id and blocked_id = auth.uid())
  );
$$;

-- Server-enforced blocking (was client-side `.not('user_id','in',...)` in fetchMessages) — a
-- direct API or Realtime call bypassed that. Moving it into the SELECT policy also covers
-- Realtime: postgres_changes subscriptions re-evaluate the table's SELECT policy per subscriber,
-- so a blocked sender's INSERT never reaches the blocker's live feed either. Mutual (hides in
-- both directions), per spec: "the blocked user can't see/interact with the blocker going
-- forward," not just blocker→blocked.
drop policy if exists "messages: read if member" on messages;
create policy "messages: read if member" on messages for select using (
  is_group_member(group_id) and not is_blocked_either_way(user_id)
);

-- Disabled-account gate on insert — defense in depth alongside the client-side redirect to
-- account-disabled.tsx (see auth-context.tsx's needsAccountDisabled).
drop policy if exists "messages: insert own if member" on messages;
create policy "messages: insert own if member" on messages for insert
  with check (
    user_id = auth.uid()
    and is_group_member(group_id)
    and not exists (select 1 from profiles where id = auth.uid() and is_disabled)
  );

create index if not exists messages_user_created_idx on messages (user_id, created_at desc);

-- Anti-spam rate limit: 8 messages / 10s per sender. Generous enough for a real fast typer,
-- tight enough to stop a scripted flood — adjust the two constants below if that balance is off
-- in practice. SECURITY DEFINER so the count is accurate regardless of the caller's own RLS view
-- (sendMessage() in src/lib/api/messages.ts inserts directly as `authenticated`, not through a
-- definer RPC).
create or replace function enforce_message_rate_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_recent_count integer;
begin
  select count(*) into v_recent_count
  from messages
  where user_id = new.user_id and created_at > now() - interval '10 seconds';

  if v_recent_count >= 8 then
    raise exception 'You are sending messages too fast — slow down.';
  end if;

  return new;
end;
$$;

drop trigger if exists on_message_insert_rate_limit on messages;
create trigger on_message_insert_rate_limit
  before insert on messages
  for each row execute function enforce_message_rate_limit();

-- Strips control/null characters and trims. RN's <Text> never executes the body, so this isn't
-- an XSS vector on the mobile client — this is defense in depth for any future web-based
-- moderation view that might render message bodies less carefully than <Text> does.
create or replace function sanitize_message_body()
returns trigger
language plpgsql
as $$
begin
  new.body := btrim(regexp_replace(new.body, '[\x00-\x08\x0B\x0C\x0E-\x1F]', '', 'g'));
  if new.body = '' then
    raise exception 'Message cannot be empty.';
  end if;
  return new;
end;
$$;

drop trigger if exists on_message_insert_sanitize on messages;
create trigger on_message_insert_sanitize
  before insert on messages
  for each row execute function sanitize_message_body();

-- Anti-abuse: cap circle creation at 10/24h per owner. Each new circle mints a fresh join_code,
-- so unlike personal invites (already capped to 1/user via invites_one_personal_per_user above)
-- this was the actual uncapped way to mass-generate shareable invite links.
create or replace function enforce_group_creation_rate_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_recent_count integer;
begin
  select count(*) into v_recent_count
  from groups
  where owner_id = new.owner_id and created_at > now() - interval '24 hours';

  if v_recent_count >= 10 then
    raise exception 'Too many circles created recently — try again tomorrow.';
  end if;

  return new;
end;
$$;

drop trigger if exists on_group_insert_rate_limit on groups;
create trigger on_group_insert_rate_limit
  before insert on groups
  for each row execute function enforce_group_creation_rate_limit();

-- Report the circle itself (not just a message/check-in/user within it), plus admin filtering
-- context. Follows the existing per-target-column pattern (reported_check_in_id etc.) rather
-- than a generic target_type/target_id pair, to match how this table already reads.
alter table moderation_reports add column if not exists reported_group_id uuid references groups (id) on delete set null;
alter table moderation_reports add column if not exists circle_id uuid references groups (id) on delete set null;
alter table moderation_reports add column if not exists note text;

-- Locks `reason` to exactly what report.tsx's REASONS array sends, so nothing else can be
-- inserted directly against the table.
alter table moderation_reports drop constraint if exists moderation_reports_reason_check;
alter table moderation_reports add constraint moderation_reports_reason_check check (
  reason in (
    'Spam or misleading',
    'Harassment or bullying',
    'Inappropriate or offensive content',
    'Child safety / CSAE',
    'Other'
  )
);

-- Extends the existing snapshot trigger: fills circle_id from whichever target was reported (so
-- an admin can filter/sort by circle without joining three different tables), and snapshots the
-- circle's own name/owner when reported_group_id is what's being reported.
create or replace function snapshot_reported_content()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.reported_message_id is not null then
    select jsonb_build_object('type', 'message', 'body', body, 'user_id', user_id, 'created_at', created_at),
           group_id
    into new.reported_content_snapshot, new.circle_id
    from messages where id = new.reported_message_id;
  elsif new.reported_check_in_id is not null then
    select jsonb_build_object('type', 'check_in', 'caption', caption, 'photo_url', photo_url, 'user_id', user_id, 'created_at', created_at),
           group_id
    into new.reported_content_snapshot, new.circle_id
    from check_ins where id = new.reported_check_in_id;
  elsif new.reported_group_id is not null then
    select jsonb_build_object('type', 'circle', 'name', name, 'owner_id', owner_id, 'created_at', created_at)
    into new.reported_content_snapshot
    from groups where id = new.reported_group_id;
    new.circle_id := coalesce(new.circle_id, new.reported_group_id);
  end if;
  return new;
end;
$$;

-- Cheap "CSAE first" ordering for a future admin queue — philoi_moderation_dashboard_build.md
-- owns the actual UI, this just makes `order by (reason = 'Child safety / CSAE') desc, ...` fast.
create index if not exists moderation_reports_queue_idx
  on moderation_reports ((reason = 'Child safety / CSAE'), status, created_at desc);

-- Matches admin/src/lib/types.ts's ActionType exactly (that dashboard is the only thing that
-- will ever write this column, via its own is_admin()-checked RLS policies — see
-- supabase/migrations/0001_admin_dashboard.sql, which also grants admins read/write access to
-- this table, messages, check_ins, and moderation_reports; this file just defines the shape).
alter table moderation_actions drop constraint if exists moderation_actions_action_type_check;
alter table moderation_actions add constraint moderation_actions_action_type_check check (
  action_type in ('removed_content', 'warned', 'disabled_account', 'reported_to_authorities', 'dismissed')
);

-- ───────────────────────────── analytics views ─────────────────────────────
-- Query these from the Supabase SQL editor (service role bypasses RLS) — there's
-- no in-app dashboard for these on purpose. This is what decides when/how to charge.

-- Every view below excludes profiles.is_admin / is_test so the beta metrics measure real
-- users only, not the founder or test/QA accounts poking the app (P0-2 in
-- admin/DASHBOARD_FIXES.md).

create or replace view analytics_daily_signups as
select date_trunc('day', created_at)::date as day, count(*) as signups
from profiles
where not is_admin and not is_test and not is_demo
group by 1
order by 1;

create or replace view analytics_event_counts as
select e.name, date_trunc('day', e.created_at)::date as day, count(*) as count
from events e
left join profiles p on p.id = e.user_id
where e.user_id is null or (not p.is_admin and not p.is_test and not p.is_demo)
group by 1, 2
order by 2 desc, 1;

-- Per-signup-day-cohort D1/D7 retention. "Active" = fired any event on that calendar day.
create or replace view analytics_retention as
with signups as (
  select id as user_id, date_trunc('day', created_at)::date as signup_day
  from profiles
  where not is_admin and not is_test and not is_demo
),
activity as (
  select e.user_id, date_trunc('day', e.created_at)::date as active_day
  from events e
  join profiles p on p.id = e.user_id
  where not p.is_admin and not p.is_test and not p.is_demo
  group by 1, 2
)
select
  s.signup_day,
  count(distinct s.user_id) as cohort_size,
  count(distinct a1.user_id) as d1_active,
  count(distinct a7.user_id) as d7_active,
  round(100.0 * count(distinct a1.user_id) / greatest(count(distinct s.user_id), 1), 1) as d1_retention_pct,
  round(100.0 * count(distinct a7.user_id) / greatest(count(distinct s.user_id), 1), 1) as d7_retention_pct
from signups s
left join activity a1 on a1.user_id = s.user_id and a1.active_day = s.signup_day + 1
left join activity a7 on a7.user_id = s.user_id and a7.active_day = s.signup_day + 7
group by s.signup_day
order by s.signup_day;

-- invites_accepted per signup — the "would they actually pull friends in" signal.
create or replace view analytics_viral_coefficient as
select
  (select count(*) from profiles where not is_admin and not is_test and not is_demo) as total_signups,
  (select count(*) from events e join profiles p on p.id = e.user_id
     where e.name = 'invite_sent' and not p.is_admin and not p.is_test and not p.is_demo) as invites_sent,
  (select count(*) from events e join profiles p on p.id = e.user_id
     where e.name = 'invite_accepted' and not p.is_admin and not p.is_test and not p.is_demo) as invites_accepted,
  round(
    (select count(*) from events e join profiles p on p.id = e.user_id
       where e.name = 'invite_accepted' and not p.is_admin and not p.is_test and not p.is_demo)::numeric
    / greatest((select count(*) from profiles where not is_admin and not is_test and not is_demo), 1),
    3
  ) as viral_coefficient;

create or replace view analytics_daily_active_users as
select date_trunc('day', e.created_at)::date as day, count(distinct e.user_id) as dau
from events e
join profiles p on p.id = e.user_id
where e.user_id is not null and not p.is_admin and not p.is_test and not p.is_demo
group by 1
order by 1;

create or replace view analytics_weekly_active_users as
select date_trunc('week', e.created_at)::date as week, count(distinct e.user_id) as wau
from events e
join profiles p on p.id = e.user_id
where e.user_id is not null and not p.is_admin and not p.is_test and not p.is_demo
group by 1
order by 1;

-- Per-campus adoption — signups and check-in activity, grouped by profiles.university.
-- Added for the initial beta cohort (UofT / UW / Laurier), where campus is the natural
-- unit to watch since invites fan out through in-person friend groups on one campus.
create or replace view analytics_by_university as
select
  coalesce(p.university, 'Unspecified') as university,
  count(distinct p.id) as signups,
  count(distinct ci.id) filter (where ci.created_at > now() - interval '7 days' and ci.removed_at is null) as check_ins_7d,
  count(distinct e.user_id) filter (where e.created_at > now() - interval '7 days') as active_7d
from profiles p
left join check_ins ci on ci.user_id = p.id
left join events e on e.user_id = p.id
where not p.is_admin and not p.is_test and not p.is_demo
group by 1
order by signups desc;

-- Signup → joined/created a circle → set a goal → first check-in. The "where do people
-- stall" view — highest-value thing to watch in a small beta. Step 1 counts from profiles
-- (matches total_signups elsewhere) rather than the signed_up event, so it isn't
-- undercounted if that event ever fails to fire client-side.
create or replace view analytics_activation_funnel as
with base as (
  select id as user_id from profiles where not is_admin and not is_test and not is_demo
),
joined_circle as (
  select distinct e.user_id
  from events e
  join base b on b.user_id = e.user_id
  where e.name in ('circle_joined', 'circle_created')
),
set_goal as (
  select distinct e.user_id
  from events e
  join base b on b.user_id = e.user_id
  where e.name = 'goal_created'
),
checked_in as (
  select distinct e.user_id
  from events e
  join base b on b.user_id = e.user_id
  where e.name = 'first_check_in'
)
select 1 as step_order, 'Signed up' as step, count(*) as users from base
union all
select 2, 'Joined/created a circle', count(*) from joined_circle
union all
select 3, 'Set a goal', count(*) from set_goal
union all
select 4, 'First check-in', count(*) from checked_in
order by step_order;

-- Per-user last-active roster, for catching the core beta group going quiet without
-- clicking into each user individually. "Active" = an event OR a (non-removed) check-in,
-- whichever is more recent — sorted stalest-first (nulls, i.e. never active, sort first).
create or replace view analytics_user_last_active as
select
  p.id as user_id,
  p.display_name,
  p.handle,
  p.university,
  greatest(max(e.created_at), max(ci.created_at)) as last_active_at
from profiles p
left join events e on e.user_id = p.id
left join check_ins ci on ci.user_id = p.id and ci.removed_at is null
where not p.is_admin and not p.is_test and not p.is_demo
group by p.id, p.display_name, p.handle, p.university
order by last_active_at asc nulls first;

-- ───────────────────────────── push notifications ─────────────────────────────
-- Server-sent (not local-timer) pushes for: a circle-mate checked in, someone reacted to
-- your check-in, and a nightly sweep for streaks about to lapse. Needs the pg_net and
-- pg_cron extensions enabled on this project (Supabase dashboard -> Database -> Extensions
-- if the `create extension` lines below fail for permission reasons).

create extension if not exists pg_net;
create extension if not exists pg_cron;

create table if not exists push_tokens (
  user_id uuid not null references profiles (id) on delete cascade,
  token text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, token)
);

alter table push_tokens enable row level security;

drop policy if exists "push_tokens: manage own" on push_tokens;
create policy "push_tokens: manage own" on push_tokens for all using (user_id = auth.uid());

-- Fire-and-forget push send to every registered device for the given users via Expo's push
-- API. No response handling/token cleanup yet — dead tokens just no-op on Expo's end.
-- p_channel_id routes to the matching Android notification channel (see
-- src/lib/notifications.ts) — "accountability" (check-ins/reactions/streaks, high priority)
-- vs "messages" (chat), so chat volume can never bury the accountability signal.
--
-- Dropped first: CREATE OR REPLACE doesn't replace a function whose parameter list changed
-- (adding p_channel_id here) — it silently creates a second overload instead, and every
-- 4-arg call site then fails with "function notify_push(uuid[], text, text, jsonb) is not
-- unique" because Postgres can't tell the two overloads apart.
drop function if exists notify_push(uuid[], text, text, jsonb);

-- Quiet hours (§19) — true when the recipient is inside their configured overnight window,
-- evaluated in their own timezone. Config lives in notification_prefs (quiet_enabled /
-- quiet_start / quiet_end / timezone); the window may wrap midnight. notify_push() uses this
-- to drop categorized pushes while a recipient is quiet.
create or replace function is_in_quiet_hours(p_prefs jsonb)
returns boolean
language sql
stable
set search_path = public
as $$
  select case
    when not coalesce((p_prefs->>'quiet_enabled')::boolean, false) then false
    when (p_prefs->>'quiet_start') is null or (p_prefs->>'quiet_end') is null then false
    else (
      select case
        when qs = qe then false
        when qs < qe then hr >= qs and hr < qe
        else hr >= qs or hr < qe
      end
      from (
        select
          extract(hour from (now() at time zone coalesce(nullif(p_prefs->>'timezone', ''), 'UTC')))::int as hr,
          (p_prefs->>'quiet_start')::int as qs,
          (p_prefs->>'quiet_end')::int as qe
      ) t
    )
  end;
$$;

create or replace function notify_push(
  p_user_ids uuid[],
  p_title text,
  p_body text,
  p_data jsonb default '{}'::jsonb,
  p_channel_id text default 'accountability'
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_messages jsonb;
  -- Map this push's data->>'type' to a notification-prefs category (§19). A null category
  -- (unmapped type — join_request, join_request_approved, test) is transactional/system and
  -- never suppressed.
  v_pref_key text := case p_data->>'type'
    when 'check_in' then 'campfire_lockins'
    when 'reaction' then 'reactions'
    when 'message' then 'messages'
    when 'chat_batch' then 'messages'
    when 'mention' then 'messages'
    when 'lockin_still_here' then 'campfire_cold'
    when 'streak_risk' then 'streak_risk'
    when 'challenge_invite' then 'challenges'
    when 'challenge_completed' then 'challenges'
    else null
  end;
begin
  select coalesce(jsonb_agg(jsonb_build_object(
    'to', t.token,
    'title', p_title,
    'body', p_body,
    'data', p_data,
    'sound', 'default',
    'channelId', p_channel_id
  )), '[]'::jsonb)
  into v_messages
  from push_tokens t
  join profiles p on p.id = t.user_id
  where t.user_id = any(p_user_ids)
    -- Drop recipients who muted this category. Missing master/category key coalesces to true,
    -- so an untouched (default '{}') prefs blob keeps every push.
    and (
      v_pref_key is null
      or (
        coalesce((p.notification_prefs->>'master')::boolean, true)
        and coalesce((p.notification_prefs->>v_pref_key)::boolean, true)
        and not is_in_quiet_hours(p.notification_prefs)
      )
    );

  if jsonb_array_length(v_messages) = 0 then
    return;
  end if;

  perform net.http_post(
    url := 'https://exp.host/--/api/v2/push/send',
    headers := '{"Content-Type": "application/json", "Accept": "application/json"}'::jsonb,
    body := v_messages
  );
end;
$$;

-- "Friend checked in" — notify every other member of the circle.
create or replace function notify_group_of_check_in()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group_name text;
  v_poster_name text;
  v_recipient_ids uuid[];
begin
  select name into v_group_name from groups where id = new.group_id;
  select display_name into v_poster_name from profiles where id = new.user_id;

  select coalesce(array_agg(user_id), '{}')
  into v_recipient_ids
  from group_members
  where group_id = new.group_id and user_id <> new.user_id;

  if array_length(v_recipient_ids, 1) > 0 then
    perform notify_push(
      v_recipient_ids,
      v_group_name,
      coalesce(v_poster_name, 'Someone') || ' just checked in 🔥',
      jsonb_build_object('type', 'check_in', 'group_id', new.group_id)
    );
  end if;

  return new;
end;
$$;

drop trigger if exists on_check_in_notify on check_ins;
create trigger on_check_in_notify
  after insert on check_ins
  for each row execute function notify_group_of_check_in();

-- "Someone reacted to your check-in" — notify the check-in's owner only, and only if
-- someone else reacted (reacting to your own check-in shouldn't page you).
create or replace function notify_reaction()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner_id uuid;
  v_reactor_name text;
begin
  select user_id into v_owner_id from check_ins where id = new.check_in_id;
  if v_owner_id is null or v_owner_id = new.user_id then
    return new;
  end if;

  select display_name into v_reactor_name from profiles where id = new.user_id;

  perform notify_push(
    array[v_owner_id],
    'New reaction',
    coalesce(v_reactor_name, 'Someone') || ' reacted ' || new.emoji || ' to your check-in',
    jsonb_build_object('type', 'reaction', 'check_in_id', new.check_in_id)
  );

  return new;
end;
$$;

drop trigger if exists on_reaction_notify on reactions;
create trigger on_reaction_notify
  after insert on reactions
  for each row execute function notify_reaction();

-- "Your streak is about to break" — nightly sweep for members with an active streak in a
-- circle who haven't checked in to it yet today (UTC day).
create or replace function notify_streaks_at_risk()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
begin
  for r in
    select gm.user_id, g.id as group_id, g.name as group_name, gm.current_streak
    from group_members gm
    join groups g on g.id = gm.group_id
    where gm.current_streak > 0
      and not exists (
        select 1 from check_ins ci
        where ci.group_id = gm.group_id
          and ci.user_id = gm.user_id
          and (ci.created_at at time zone 'utc')::date = current_date
      )
  loop
    perform notify_push(
      array[r.user_id],
      r.group_name,
      'Your ' || r.current_streak || '-day streak breaks at midnight — lock in 🔥',
      jsonb_build_object('type', 'streak_risk', 'group_id', r.group_id)
    );
  end loop;
end;
$$;

-- 8pm UTC daily. Re-running this file re-schedules idempotently instead of erroring on a
-- duplicate job name.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'philoi-streak-risk-check') then
    perform cron.unschedule('philoi-streak-risk-check');
  end if;
end $$;

select cron.schedule(
  'philoi-streak-risk-check',
  '0 20 * * *',
  $$select notify_streaks_at_risk();$$
);

-- ───────────────────────────── chat notifications ─────────────────────────────
-- @mentions/replies always notify immediately (handled by the trigger below); general
-- messages are batched into one push per group every 5 minutes instead of one push per
-- message. Both respect group_members.chat_muted and profiles.show_message_previews.

alter table group_members add column if not exists chat_muted boolean not null default false;
alter table profiles add column if not exists show_message_previews boolean not null default false;

-- "Who can see my photos" (PHILOI_UI_SPEC.md §6/§16 settings) — gates lock-in photo
-- visibility beyond a member's own campfires (public/discoverable campfire feeds).
-- Three states (§19): 'everyone', 'campfires' (default), and 'private' — "Just me", a private
-- journal nobody else sees. get_user_lock_in_photos() and the around-campfire feed both gate
-- on 'everyone'/'campfires' explicitly, so 'private' falls through to "shown to no one but the
-- owner" with no extra branch.
alter table profiles add column if not exists photo_visibility text not null default 'campfires';
alter table profiles drop constraint if exists profiles_photo_visibility_check;
alter table profiles
  add constraint profiles_photo_visibility_check
  check (photo_visibility in ('everyone', 'campfires', 'private'));

-- Notification preferences (§19 grouped toggles) — per-category on/off + master switch, as
-- jsonb. Empty '{}' = all on (readers coalesce a missing key to true). notify_push() filters
-- recipients on these; see its definition above and set_my_notification_prefs() below.
alter table profiles add column if not exists notification_prefs jsonb not null default '{}'::jsonb;

-- RPC-gated (not a direct "update own row" policy) for the same reason set_chat_muted() is.
create or replace function set_my_photo_visibility(p_visibility text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_visibility not in ('everyone', 'campfires', 'private') then
    raise exception 'Invalid photo visibility.';
  end if;

  update profiles
  set photo_visibility = p_visibility
  where id = auth.uid();
end;
$$;

create or replace function set_my_notification_prefs(p_prefs jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update profiles
  set notification_prefs = coalesce(p_prefs, '{}'::jsonb)
  where id = auth.uid();
end;
$$;

-- Daily flame meter (design-mocks/26, PHILOI_UI_SPEC.md §5) — the "Today's fire" progress
-- bar's own settings, distinct from the forever rank track.
alter table profiles add column if not exists daily_goal_mode text not null default 'auto'
  check (daily_goal_mode in ('auto', 'manual'));
alter table profiles add column if not exists daily_goal_manual_target int check (daily_goal_manual_target >= 1);
-- Opt-in, default off (§5/§19) — gates whether completing the meter can post a card to the
-- user's campfires at all.
alter table profiles add column if not exists publish_flame_completion boolean not null default false;
-- Soft-currency hook (MONETIZATION.md's phase-2 "embers" cosmetics shop) — no shop/spend UI
-- yet, this just reserves the earning side so completion has somewhere real to deposit into.
alter table profiles add column if not exists embers integer not null default 0;

create or replace function set_daily_goal_mode(p_mode text, p_manual_target int default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_mode not in ('auto', 'manual') then
    raise exception 'Invalid daily goal mode.';
  end if;
  if p_mode = 'manual' and coalesce(p_manual_target, 0) < 1 then
    raise exception 'Manual daily target must be at least 1.';
  end if;

  update profiles
  set daily_goal_mode = p_mode,
      daily_goal_manual_target = case when p_mode = 'manual' then p_manual_target else daily_goal_manual_target end
  where id = auth.uid();
end;
$$;

create or replace function set_publish_flame_completion(p_enabled boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update profiles set publish_flame_completion = p_enabled where id = auth.uid();
end;
$$;

-- RPC-gated (not a direct "update own row" policy) for the same reason set_my_goal_target()
-- is — group_members has no general update policy, so members can't use one to touch
-- current_streak/longest_streak.
create or replace function set_chat_muted(p_group_id uuid, p_muted boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update group_members
  set chat_muted = p_muted
  where group_id = p_group_id and user_id = auth.uid();
end;
$$;

-- "I can help with this class" (PHILOI_UI_SPEC.md §14) — same RPC-gated pattern as
-- set_chat_muted() just above.
create or replace function set_my_helper_flag(p_group_id uuid, p_is_helper boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update group_members
  set is_helper = p_is_helper
  where group_id = p_group_id and user_id = auth.uid();
end;
$$;

-- Immediate push for @handle mentions / direct replies — resolves each mention against
-- profiles.handle scoped to members of the same circle (so "@sam" in one circle can't
-- accidentally notify an unrelated "sam" elsewhere), skips muted recipients and the author.
create or replace function notify_message_mentions()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group_name text;
  v_sender_name text;
  v_handles text[];
  v_recipient_ids uuid[];
begin
  select array_agg(lower(m[1])) into v_handles
  from regexp_matches(new.body, '@([a-z0-9_]{3,20})', 'gi') as m;

  if v_handles is null then
    return new;
  end if;

  select name into v_group_name from groups where id = new.group_id;
  select display_name into v_sender_name from profiles where id = new.user_id;

  select coalesce(array_agg(distinct p.id), '{}')
  into v_recipient_ids
  from profiles p
  join group_members gm on gm.user_id = p.id and gm.group_id = new.group_id
  where lower(p.handle) = any(v_handles)
    and p.id <> new.user_id
    and gm.chat_muted = false;

  if array_length(v_recipient_ids, 1) > 0 then
    perform notify_push(
      v_recipient_ids,
      v_group_name,
      coalesce(v_sender_name, 'Someone') || ' mentioned you',
      jsonb_build_object('type', 'mention', 'group_id', new.group_id),
      'messages'
    );
  end if;

  return new;
end;
$$;

drop trigger if exists on_message_mention on messages;
create trigger on_message_mention
  after insert on messages
  for each row execute function notify_message_mentions();

-- Tracks the last time each member was sent a batched "N new messages" push per circle, so
-- the 5-minute sweep only counts what's actually new since then.
create table if not exists message_notify_state (
  group_id uuid not null references groups (id) on delete cascade,
  user_id uuid not null references profiles (id) on delete cascade,
  last_notified_at timestamptz not null default now(),
  primary key (group_id, user_id)
);

alter table message_notify_state enable row level security;
-- No client policies — this is bookkeeping for notify_message_batches() only, never read or
-- written directly by the app.

-- Every 5 minutes: for each (circle, member) with unseen messages from other people since
-- their last batch, send one push — "3 new messages in [Circle]" by default, or the last
-- message's actual body if the member opted into lock-screen previews. Lock-screen privacy:
-- title never includes body content unless show_message_previews is on.
create or replace function notify_message_batches()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  v_body text;
begin
  for r in
    select
      gm.group_id,
      gm.user_id,
      g.name as group_name,
      p.show_message_previews,
      coalesce(mns.last_notified_at, gm.joined_at) as since,
      count(m.id) as new_count,
      (array_agg(m.body order by m.created_at desc))[1] as latest_body
    from group_members gm
    join groups g on g.id = gm.group_id
    join profiles p on p.id = gm.user_id
    left join message_notify_state mns on mns.group_id = gm.group_id and mns.user_id = gm.user_id
    join messages m on m.group_id = gm.group_id
      and m.user_id <> gm.user_id
      and m.deleted_at is null
      and m.created_at > coalesce(mns.last_notified_at, gm.joined_at)
    where gm.chat_muted = false
    group by gm.group_id, gm.user_id, g.name, p.show_message_previews, mns.last_notified_at, gm.joined_at
  loop
    v_body := case
      when r.new_count = 1 and r.show_message_previews then r.latest_body
      when r.new_count = 1 then 'New message'
      else r.new_count || ' new messages'
    end;

    perform notify_push(
      array[r.user_id],
      r.group_name,
      v_body,
      jsonb_build_object('type', 'chat_batch', 'group_id', r.group_id),
      'messages'
    );

    insert into message_notify_state (group_id, user_id, last_notified_at)
    values (r.group_id, r.user_id, now())
    on conflict (group_id, user_id) do update set last_notified_at = excluded.last_notified_at;
  end loop;
end;
$$;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'philoi-chat-batch-notify') then
    perform cron.unschedule('philoi-chat-batch-notify');
  end if;
end $$;

select cron.schedule(
  'philoi-chat-batch-notify',
  '*/5 * * * *',
  $$select notify_message_batches();$$
);

-- ───────────────────────────── dev tools (dev builds only) ─────────────────────────────
-- Client gates all of these behind __DEV__ (src/components/dev-tools.tsx) — they're callable
-- by any authenticated user at the DB layer, same trust level as every other RPC here, but
-- dev_simulate_friend_checkin is restricted to profiles.is_demo accounts specifically so it
-- can't be used to fake a check-in as a real person.

alter table profiles add column if not exists is_demo boolean not null default false;

create or replace function send_test_notification()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform notify_push(
    array[auth.uid()],
    'Test notification',
    'If you see this, push is wired up correctly.',
    jsonb_build_object('type', 'test'),
    'accountability'
  );
end;
$$;

-- Creates a demo circle owned by the caller, populated with up to 3 existing is_demo members
-- (from scripts/seed-demo-circles.js — profiles.id has a hard FK to auth.users, so this RPC
-- can't fabricate brand-new fake accounts inline; it borrows real ones that already exist)
-- plus a few backdated check-ins per member, so feed/leaderboard/streaks render populated
-- without needing real friends. If no is_demo profiles exist yet, still creates the (empty)
-- circle and raises a notice telling you to run the seed script first.
create or replace function dev_seed_my_demo_circle()
returns groups
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group groups;
  v_fake_id uuid;
  v_day integer;
  v_found boolean := false;
begin
  insert into groups (name, emoji, owner_id, goal_type, cadence, privacy)
  values ('Dev Test Circle', '🧪', auth.uid(), 'gym', '7x/week', 'private')
  returning * into v_group;

  insert into group_members (group_id, user_id, role)
  values (v_group.id, auth.uid(), 'owner');

  for v_fake_id in select id from profiles where is_demo = true limit 3 loop
    v_found := true;
    insert into group_members (group_id, user_id, role)
    values (v_group.id, v_fake_id, 'member')
    on conflict (group_id, user_id) do nothing;

    for v_day in 0..2 loop
      insert into check_ins (group_id, user_id, photo_url, status, created_at)
      values (
        v_group.id, v_fake_id, 'dev-tools/placeholder.jpg', 'on_time',
        now() - (v_day || ' days')::interval
      );
    end loop;
  end loop;

  if not v_found then
    raise notice 'No is_demo profiles exist yet — run `npm run seed:demo` (scripts/seed-demo-circles.js), then call dev_seed_my_demo_circle() again to actually populate members.';
  end if;

  return v_group;
end;
$$;

-- Inserts a check-in as a fake friend, triggering the real check-in notification path to
-- everyone else in the circle (including the real caller) — this is the one that actually
-- exercises the friend-checked-in -> push flow with a single physical device.
create or replace function dev_simulate_friend_checkin(p_group_id uuid, p_fake_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_group_member(p_group_id) then
    raise exception 'Not a member of that circle.';
  end if;

  if not exists (
    select 1 from profiles where id = p_fake_user_id and is_demo = true
  ) then
    raise exception 'dev_simulate_friend_checkin only works with is_demo profiles.';
  end if;

  if not exists (
    select 1 from group_members where group_id = p_group_id and user_id = p_fake_user_id
  ) then
    insert into group_members (group_id, user_id, role) values (p_group_id, p_fake_user_id, 'member');
  end if;

  insert into check_ins (group_id, user_id, photo_url, status)
  values (p_group_id, p_fake_user_id, 'dev-tools/placeholder.jpg', 'on_time');
end;
$$;

-- dev_reset_my_checkins was originally defined here, taking p_group_id — superseded by a
-- goal-scoped redefinition (p_goal_id) in the goals-refactor section further down. Omitted
-- here rather than kept alive briefly: CREATE OR REPLACE can't rename a function's
-- parameter (a different restriction than the RETURNS TABLE one noted elsewhere in this
-- file), so on a re-run against an already-migrated database — where the goal-scoped
-- version already exists — this legacy copy would fail with "cannot change name of input
-- parameter", the same way the leaderboard functions above failed on column existence.

-- ───────────────────────────── admin dashboard ─────────────────────────────
-- Backs the separate admin/ Next.js dashboard. is_admin, is_admin(), is_disabled/
-- disabled_at, check_ins.removed_at, the generated moderation_reports.category, and the
-- moderation_actions action_type constraint are already defined above (chat-safety
-- block) — this section only adds what that block explicitly leaves to this one:
-- admin-read policies on the tables the dashboard browses, a transactional
-- report-resolution RPC, a dedicated audit log, and analytics views the existing ones
-- don't cover (distinct-user DAU/WAU, top circles by activity). See
-- supabase/migrations/0001_admin_dashboard.sql for the reviewable snapshot of this
-- change.

-- Upsert, not a plain update: nothing in this file auto-creates a profiles row on
-- signup (that only happens client-side, via the mobile app's onboarding flow — see
-- "profiles: insert own" above) — a founder who only ever signed into the admin/
-- dashboard directly, never the mobile app, has no profiles row for a plain UPDATE to
-- flip is_admin on, so it silently no-ops and they land on /not-authorized. Re-run
-- this after either founder's first sign-in if their profiles row didn't exist yet
-- when this last ran.
insert into profiles (id, display_name, is_admin)
select
  u.id,
  coalesce(u.raw_user_meta_data ->> 'full_name', split_part(u.email, '@', 1)),
  true
from auth.users u
where u.email in ('spikeythedoge1@gmail.com', 'noahbrikman@gmail.com')
on conflict (id) do update set is_admin = true;

-- Admin read access via is_admin(), so the dashboard's day-to-day reads run under the
-- signed-in admin's own session + RLS rather than the service-role key.
drop policy if exists "moderation_reports: admin read" on moderation_reports;
create policy "moderation_reports: admin read" on moderation_reports for select using (is_admin());

drop policy if exists "moderation_reports: admin update" on moderation_reports;
create policy "moderation_reports: admin update" on moderation_reports for update using (is_admin());

drop policy if exists "moderation_actions: admin read" on moderation_actions;
create policy "moderation_actions: admin read" on moderation_actions for select using (is_admin());

drop policy if exists "moderation_actions: admin insert" on moderation_actions;
create policy "moderation_actions: admin insert" on moderation_actions for insert with check (is_admin());

drop policy if exists "groups: admin read" on groups;
create policy "groups: admin read" on groups for select using (is_admin());

drop policy if exists "check_ins: admin read" on check_ins;
create policy "check_ins: admin read" on check_ins for select using (is_admin());

drop policy if exists "messages: admin read" on messages;
create policy "messages: admin read" on messages for select using (is_admin());

drop policy if exists "group_members: admin read" on group_members;
create policy "group_members: admin read" on group_members for select using (is_admin());

drop policy if exists "events: admin read" on events;
create policy "events: admin read" on events for select using (is_admin());

-- Actually disables a user's account — the function account-disabled.tsx and
-- lock_profile_moderation_fields() already reference in their comments as the thing
-- allowed to set is_disabled/disabled_at. Kept separate from admin_resolve_report so it
-- can be called with just a user id if a future flow needs to disable an account outside
-- the report queue. No Auth Admin API / service-role key involved: is_disabled is
-- already enforced via RLS (see "messages: insert own if member") and via the mobile
-- client's Stack.Protected redirect to account-disabled.tsx.
create or replace function admin_disable_account(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_admin() then
    raise exception 'Not authorized.';
  end if;

  update profiles set is_disabled = true, disabled_at = now() where id = p_user_id;
end;
$$;

-- Resolve a report: soft-delete the reported content (if any) or disable the reported
-- user, log the action, and flip the report's status — all in one SECURITY DEFINER call
-- so an action can't half-apply.
create or replace function admin_resolve_report(
  p_report_id uuid,
  p_action_type text,
  p_notes text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_report moderation_reports;
begin
  if not is_admin() then
    raise exception 'Not authorized.';
  end if;

  if p_action_type not in ('removed_content', 'disabled_account', 'reported_to_authorities', 'dismissed', 'warned') then
    raise exception 'Unknown action_type: %', p_action_type;
  end if;

  select * into v_report from moderation_reports where id = p_report_id;
  if v_report.id is null then
    raise exception 'Report not found.';
  end if;

  if p_action_type = 'removed_content' then
    if v_report.reported_message_id is not null then
      update messages set deleted_at = now() where id = v_report.reported_message_id and deleted_at is null;
    elsif v_report.reported_check_in_id is not null then
      update check_ins set removed_at = now() where id = v_report.reported_check_in_id and removed_at is null;
    end if;
  elsif p_action_type = 'disabled_account' then
    if v_report.reported_user_id is null then
      raise exception 'This report has no target user to disable.';
    end if;
    perform admin_disable_account(v_report.reported_user_id);
  end if;

  insert into moderation_actions (report_id, action_type, target_user_id, notes)
  values (p_report_id, p_action_type, v_report.reported_user_id, p_notes);

  update moderation_reports
  set status = case when p_action_type = 'dismissed' then 'dismissed' else 'actioned' end
  where id = p_report_id;
end;
$$;

-- Dedicated audit log — separate from moderation_actions (whose action_type check
-- constraint is scoped to report-resolution outcomes) since content *views* and logins
-- don't fit that shape. Every admin content view and action lands here.
create table if not exists admin_audit (
  id uuid primary key default gen_random_uuid(),
  admin_id uuid references profiles (id) on delete set null,
  event_type text not null,
  target_type text,
  target_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists admin_audit_created_idx on admin_audit (created_at desc);
create index if not exists admin_audit_admin_idx on admin_audit (admin_id, created_at desc);

alter table admin_audit enable row level security;

drop policy if exists "admin_audit: admin insert" on admin_audit;
create policy "admin_audit: admin insert" on admin_audit for insert with check (is_admin() and admin_id = auth.uid());

drop policy if exists "admin_audit: admin read" on admin_audit;
create policy "admin_audit: admin read" on admin_audit for select using (is_admin());

-- analytics_daily_active_users/analytics_weekly_active_users are defined once, above
-- (~line 1152) — a stray unfiltered redefinition used to live here and, because
-- `create or replace view` is order-dependent, silently won over the filtered ones
-- (dropping the is_admin/is_test/is_demo exclusion in production without anything
-- erroring). Removed; don't re-add a second definition of either view.

-- Admin storage read — the moderation queue and content browser need to render check-in
-- photos for reports/circles an admin isn't necessarily a member of; the existing
-- "check-in-photos: read if member" policy alone won't cover that.
drop policy if exists "check-in-photos: admin read" on storage.objects;
create policy "check-in-photos: admin read" on storage.objects for select
  using (bucket_id = 'check-in-photos' and is_admin());

-- analytics_top_circles was originally defined here, joining check_ins directly via
-- ci.group_id — superseded by a redefinition (joining through group_members instead) in
-- the goals-refactor section further down, and nothing in this file queries the view by
-- name in between. Omitted here for the same reason as the leaderboard functions above:
-- views are validated against the catalog at CREATE time, so a legacy copy referencing
-- check_ins.group_id would error out on a re-run once that column is gone.

-- ───────────────────────────── challenges ─────────────────────────────
-- Quantified personal goals (steps / gym visits / study hours / custom) that go beyond the
-- binary "checked in or not". Kept social by design — a challenge can attach to a circle so
-- progress is visible to friends and feeds a leaderboard; a private solo tracker would be a
-- commodity feature, the peer-visibility is what's differentiated here. v1 logging is manual
-- (no Apple Health / Google Fit sync) and a challenge is a single-instance goal, not an
-- auto-resetting recurring one — completing it is permanent (period/period_start are for
-- display + this-week leaderboard scoping, not a cron-driven rollover).

create table if not exists challenges (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles (id) on delete cascade,
  circle_id uuid references groups (id) on delete cascade,
  -- run_distance/ride_distance added by migration 0035 (Strava) — first-class since Strava sync
  -- needs to know which activity type (Run vs Ride) and unit (km) to reduce to, unlike a
  -- freeform 'custom' unit string.
  type text not null check (type in ('steps', 'gym_visits', 'study_hours', 'custom', 'run_distance', 'ride_distance')),
  label text,
  target numeric not null check (target > 0),
  unit text not null,
  period text not null default 'week' check (period in ('day', 'week')),
  progress numeric not null default 0 check (progress >= 0),
  visibility text not null default 'circle' check (visibility in ('circle', 'private')),
  period_start date not null default date_trunc('week', now())::date,
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists challenges_user_idx on challenges (user_id);
create index if not exists challenges_circle_idx on challenges (circle_id) where circle_id is not null;

alter table challenges enable row level security;

drop policy if exists "challenges: read own" on challenges;
create policy "challenges: read own" on challenges for select using (user_id = auth.uid());

drop policy if exists "challenges: read circle if visible" on challenges;
create policy "challenges: read circle if visible" on challenges for select using (
  visibility = 'circle' and circle_id is not null and is_group_member(circle_id)
);

drop policy if exists "challenges: insert own" on challenges;
create policy "challenges: insert own" on challenges for insert with check (
  user_id = auth.uid() and (circle_id is null or is_group_member(circle_id))
);

drop policy if exists "challenges: update own" on challenges;
create policy "challenges: update own" on challenges for update using (user_id = auth.uid());

drop policy if exists "challenges: delete own" on challenges;
create policy "challenges: delete own" on challenges for delete using (user_id = auth.uid());

create table if not exists challenge_logs (
  id uuid primary key default gen_random_uuid(),
  challenge_id uuid not null references challenges (id) on delete cascade,
  user_id uuid not null references profiles (id) on delete cascade,
  amount numeric not null check (amount > 0),
  note text,
  created_at timestamptz not null default now()
);

create index if not exists challenge_logs_challenge_idx on challenge_logs (challenge_id, created_at desc);

alter table challenge_logs enable row level security;

drop policy if exists "challenge_logs: read own" on challenge_logs;
create policy "challenge_logs: read own" on challenge_logs for select using (user_id = auth.uid());

drop policy if exists "challenge_logs: read circle if visible" on challenge_logs;
create policy "challenge_logs: read circle if visible" on challenge_logs for select using (
  exists (
    select 1 from challenges c
    where c.id = challenge_logs.challenge_id
      and c.visibility = 'circle'
      and c.circle_id is not null
      and is_group_member(c.circle_id)
  )
);

-- Logging always goes through log_challenge_progress() (security definer) below, which
-- validates ownership and updates challenges.progress in the same transaction — there's no
-- direct insert policy for regular users, so client code can't fabricate progress on a
-- challenge_logs row without also owning the parent challenge (server-trusted totals).

-- Circle-visible feed of challenge completions — a dedicated table rather than reusing
-- check_ins, so the one-check-in-per-day unique index stays untouched (photo_url is no
-- longer a not-null invariant as of the lock-in sessions section further down — see
-- check_ins_photo_or_duration). The group screen's Feed tab merges this in alongside
-- check-ins client-side, ordered by created_at.
create table if not exists challenge_feed_events (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references groups (id) on delete cascade,
  user_id uuid not null references profiles (id) on delete cascade,
  challenge_id uuid not null references challenges (id) on delete cascade,
  challenge_type text not null,
  challenge_label text,
  target numeric not null,
  unit text not null,
  created_at timestamptz not null default now()
);

create index if not exists challenge_feed_events_group_idx on challenge_feed_events (group_id, created_at desc);

alter table challenge_feed_events enable row level security;

drop policy if exists "challenge_feed_events: read if member" on challenge_feed_events;
create policy "challenge_feed_events: read if member" on challenge_feed_events for select using (
  is_group_member(group_id)
);

-- Inserted only by log_challenge_progress() (security definer) on completion — no direct
-- insert policy for regular users.

drop function if exists log_challenge_progress(uuid, numeric, text);

create or replace function log_challenge_progress(p_challenge_id uuid, p_amount numeric, p_note text default null)
returns table (
  id uuid,
  user_id uuid,
  circle_id uuid,
  type text,
  label text,
  target numeric,
  unit text,
  period text,
  progress numeric,
  visibility text,
  period_start date,
  completed_at timestamptz,
  created_at timestamptz,
  just_completed boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_challenge challenges;
  v_was_complete boolean;
  v_group_name text;
  v_poster_name text;
  v_recipient_ids uuid[];
begin
  select * into v_challenge from challenges where challenges.id = p_challenge_id and challenges.user_id = auth.uid();
  if v_challenge.id is null then
    raise exception 'Challenge not found.';
  end if;

  insert into challenge_logs (challenge_id, user_id, amount, note)
  values (p_challenge_id, auth.uid(), p_amount, p_note);

  v_was_complete := v_challenge.completed_at is not null;

  update challenges
  set progress = challenges.progress + p_amount,
      completed_at = case
        when challenges.completed_at is null and challenges.progress + p_amount >= challenges.target then now()
        else challenges.completed_at
      end
  where challenges.id = p_challenge_id
  returning * into v_challenge;

  if not v_was_complete and v_challenge.completed_at is not null and v_challenge.circle_id is not null and v_challenge.visibility = 'circle' then
    insert into challenge_feed_events (group_id, user_id, challenge_id, challenge_type, challenge_label, target, unit)
    values (v_challenge.circle_id, auth.uid(), v_challenge.id, v_challenge.type, v_challenge.label, v_challenge.target, v_challenge.unit);

    select name into v_group_name from groups where groups.id = v_challenge.circle_id;
    select display_name into v_poster_name from profiles where profiles.id = auth.uid();

    select coalesce(array_agg(gm.user_id), '{}')
    into v_recipient_ids
    from group_members gm
    where gm.group_id = v_challenge.circle_id and gm.user_id <> auth.uid();

    if array_length(v_recipient_ids, 1) > 0 then
      perform notify_push(
        v_recipient_ids,
        v_group_name,
        coalesce(v_poster_name, 'Someone') || ' just hit their ' || coalesce(v_challenge.label, v_challenge.type) || ' challenge 🎯',
        jsonb_build_object('type', 'challenge_completed', 'group_id', v_challenge.circle_id)
      );
    end if;
  end if;

  return query select
    v_challenge.id, v_challenge.user_id, v_challenge.circle_id, v_challenge.type, v_challenge.label,
    v_challenge.target, v_challenge.unit, v_challenge.period, v_challenge.progress, v_challenge.visibility,
    v_challenge.period_start, v_challenge.completed_at, v_challenge.created_at,
    (not v_was_complete and v_challenge.completed_at is not null);
end;
$$;

-- Per-challenge-type leaderboard within a circle (comparing steps vs study hours wouldn't
-- rank sensibly, so callers scope by circle_id + type — mirrors get_group_leaderboard's shape).
create or replace function get_challenge_leaderboard(p_circle_id uuid, p_type text)
returns table (
  user_id uuid,
  handle text,
  display_name text,
  avatar_url text,
  is_pro boolean,
  progress numeric,
  target numeric,
  unit text,
  completed_at timestamptz
)
language sql
security definer
set search_path = public
stable
as $$
  select
    c.user_id,
    p.handle,
    p.display_name,
    p.avatar_url,
    p.is_pro,
    c.progress,
    c.target,
    c.unit,
    c.completed_at
  from challenges c
  join profiles p on p.id = c.user_id
  where c.circle_id = p_circle_id
    and c.type = p_type
    and c.visibility = 'circle'
    and is_group_member(p_circle_id)
  order by c.progress desc, c.completed_at asc nulls last;
$$;

-- get_my_circle_ranks was originally defined here (LANGUAGE SQL, referencing
-- check_ins.group_id and group_members.current_streak) — superseded by a score-based
-- redefinition in the goals-refactor section further down, omitted here for the same
-- reason as the leaderboard functions and analytics_top_circles above.

-- ───────────────────────────── social challenges ─────────────────────────────
-- Head-to-head, group ("all or nothing"), and solo (announced) challenges between campfire
-- members (PHILOI_UI_SPEC.md — design-mocks/12 & 13). A separate table from challenges/
-- challenge_logs above — those are a self-tracked personal habit tracker (manually logged
-- amounts against a private target); these are invite/accept, multi-party, and score
-- themselves live off real check_ins data (xp_earned / duration_seconds), not a manual log.

-- Solo (announced) mode was removed — a solo goal the campfire can see is already covered by
-- the lock-in flow's own "with the campfire" toggle (PHILOI_UI_SPEC.md §12), so a separate
-- solo-challenge concept was redundant. Only h2h and group remain.
create table if not exists social_challenges (
  id uuid primary key default gen_random_uuid(),
  -- Nullable (PHILOI_UI_SPEC.md §16, migration 0032) — an h2h challenge is friend-to-friend and
  -- doesn't require a shared campfire; null circle_id means nobody's watching. Group challenges
  -- always pass one (validated in create_group_challenge).
  circle_id uuid references groups (id) on delete cascade,
  created_by uuid not null references profiles (id) on delete cascade,
  mode text not null check (mode in ('h2h', 'group')),
  -- h2h only
  opponent_id uuid references profiles (id) on delete cascade,
  race_metric text check (race_metric in ('xp', 'lockin_time')),
  -- group only: lock-ins required per member during the window ("all or nothing")
  target_count int check (target_count > 0),
  window_hours int not null check (window_hours > 0),
  -- null until an h2h invite is accepted; set immediately for group (no invite step)
  starts_at timestamptz,
  ends_at timestamptz,
  status text not null default 'pending' check (status in ('pending', 'active', 'completed', 'declined', 'expired')),
  winner_id uuid references profiles (id), -- h2h only, set by finalize_social_challenges()
  payout_xp int not null check (payout_xp > 0),
  created_at timestamptz not null default now(),
  check ((mode = 'h2h') = (opponent_id is not null)),
  check ((mode = 'group') = (target_count is not null)),
  check ((mode != 'h2h') or (race_metric is not null))
);

create index if not exists social_challenges_circle_idx on social_challenges (circle_id);
create index if not exists social_challenges_opponent_idx on social_challenges (opponent_id) where opponent_id is not null;

alter table social_challenges enable row level security;

drop policy if exists "social_challenges: read if circle member" on social_challenges;
create policy "social_challenges: read if circle member" on social_challenges for select using (
  is_group_member(circle_id) or created_by = auth.uid() or opponent_id = auth.uid()
);

-- A one-off ledger for XP that didn't come from a lock-in — challenge payouts today, maybe
-- other bonus/reward sources later. universal_score() (below) sums this in alongside the
-- normal check_ins-derived domain scores, so a challenge win shows up in rank/leaderboards
-- exactly like earned XP, not as a separate hidden number.
create table if not exists bonus_xp_awards (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles (id) on delete cascade,
  amount numeric not null check (amount > 0),
  reason text not null,
  challenge_id uuid references social_challenges (id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists bonus_xp_awards_user_idx on bonus_xp_awards (user_id);

alter table bonus_xp_awards enable row level security;

drop policy if exists "bonus_xp_awards: read own" on bonus_xp_awards;
create policy "bonus_xp_awards: read own" on bonus_xp_awards for select using (user_id = auth.uid());

-- Quality floor on what counts toward a CHALLENGE's score (migration 0033) — real bonus XP is
-- the highest-stakes reward in the app, so it's the thing most worth guarding against farming.
-- A blanket 20-minute floor (generalizing the reward rules' own gym example) plus, specifically
-- for gym, proof of real work (a photo or a logged set — check_in_workout_sets/check_in_photos
-- are both defined later in this file; forward-referencing them here is safe, same as every
-- other function in this script that reads a table not yet created at this point in the replay
-- — Postgres doesn't validate a function body's object references until first call).
create or replace function check_in_qualifies_for_challenge(p_check_in_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select
    ci.duration_seconds is not null
    and ci.duration_seconds >= 1200
    and (
      ci.goal_type != 'gym'
      or exists (select 1 from check_in_photos where check_in_id = ci.id)
      or exists (select 1 from check_in_workout_sets where check_in_id = ci.id)
    )
  from check_ins ci
  where ci.id = p_check_in_id;
$$;

-- Live-scores an h2h side or a group member's progress over a challenge's window — shared by
-- get_my_social_challenges() and finalize_social_challenges() so the two never disagree.
create or replace function social_challenge_score(p_user_id uuid, p_metric text, p_starts_at timestamptz, p_ends_at timestamptz)
returns numeric
language sql
security definer
set search_path = public
stable
as $$
  select coalesce(sum(case when p_metric = 'lockin_time' then ci.duration_seconds else ci.xp_earned end), 0)
  from check_ins ci
  where ci.user_id = p_user_id
    and ci.removed_at is null
    and check_in_qualifies_for_challenge(ci.id)
    and ci.created_at >= p_starts_at
    and ci.created_at <= p_ends_at;
$$;

-- Friend-to-friend, opponent-first, campfire-optional (PHILOI_UI_SPEC.md §16, migration
-- 0032 — this used to require a shared campfire and validate the opponent was a member of it;
-- now it's gated on the real friend graph, and a passed circle_id only needs the CALLER in it
-- (a watching campfire, not a hosting one).
create or replace function create_h2h_challenge(
  p_opponent_id uuid,
  p_race_metric text,
  p_window_hours int,
  p_circle_id uuid default null,
  p_payout_xp int default 200
)
returns social_challenges
language plpgsql
security definer
set search_path = public
as $$
declare
  v_challenge social_challenges;
begin
  if p_opponent_id = auth.uid() then
    raise exception 'Pick someone else to challenge.';
  end if;

  if not exists (
    select 1 from friend_requests
    where status = 'accepted'
      and ((requester_id = auth.uid() and recipient_id = p_opponent_id)
        or (requester_id = p_opponent_id and recipient_id = auth.uid()))
  ) then
    raise exception 'You can only challenge a friend.';
  end if;

  if p_circle_id is not null and not is_group_member(p_circle_id) then
    raise exception 'Not a member of that campfire.';
  end if;

  insert into social_challenges (circle_id, created_by, mode, opponent_id, race_metric, window_hours, payout_xp, status)
  values (p_circle_id, auth.uid(), 'h2h', p_opponent_id, p_race_metric, p_window_hours, p_payout_xp, 'pending')
  returning * into v_challenge;

  perform notify_push(
    array[p_opponent_id],
    'You''ve been challenged',
    (select display_name from profiles where id = auth.uid()) || ' challenged you to a head-to-head.',
    jsonb_build_object('type', 'challenge_invite', 'challenge_id', v_challenge.id),
    'accountability'
  );

  return v_challenge;
end;
$$;

create or replace function create_group_challenge(
  p_circle_id uuid,
  p_target_count int,
  p_window_hours int,
  p_payout_xp int default 300
)
returns social_challenges
language plpgsql
security definer
set search_path = public
as $$
declare
  v_challenge social_challenges;
begin
  if not is_group_member(p_circle_id) then
    raise exception 'Not a member of that campfire.';
  end if;

  insert into social_challenges (circle_id, created_by, mode, target_count, window_hours, payout_xp, status, starts_at, ends_at)
  values (p_circle_id, auth.uid(), 'group', p_target_count, p_window_hours, p_payout_xp, 'active', now(), now() + make_interval(hours => p_window_hours))
  returning * into v_challenge;

  return v_challenge;
end;
$$;

create or replace function respond_to_h2h_challenge(p_challenge_id uuid, p_accept boolean)
returns social_challenges
language plpgsql
security definer
set search_path = public
as $$
declare
  v_challenge social_challenges;
begin
  select * into v_challenge from social_challenges
  where id = p_challenge_id and opponent_id = auth.uid() and status = 'pending';

  if v_challenge.id is null then
    raise exception 'Challenge not found or already answered.';
  end if;

  if p_accept then
    update social_challenges
    set status = 'active', starts_at = now(), ends_at = now() + make_interval(hours => window_hours)
    where id = p_challenge_id
    returning * into v_challenge;
  else
    update social_challenges set status = 'declined' where id = p_challenge_id returning * into v_challenge;
  end if;

  return v_challenge;
end;
$$;

-- Percentile placement multiplier (migration 0034, reward-design rules — "PLACEMENT
-- MULTIPLIER (group challenges)"). A group challenge stays "all or nothing" as the completion
-- gate, but once it succeeds each member's SHARE of payout_xp scales with how they placed among
-- the group by verified XP total, instead of everyone getting the identical flat amount. Best
-- tier a participant qualifies for among percentile tiers (scale to any board size) and
-- absolute-rank caps (only when that rank is a STRICTER cut than the top-10% line — otherwise a
-- small campfire's "top 10" is meaningless and this correctly degrades to percentile tiers alone).
create or replace function placement_multiplier(p_rank int, p_total int)
returns numeric
language sql
security definer
set search_path = public
immutable
as $$
  select greatest(
    case
      when p_rank <= ceil(p_total * 0.10) then 1.5
      when p_rank <= ceil(p_total * 0.25) then 1.3
      when p_rank <= ceil(p_total * 0.50) then 1.1
      else 1.0
    end,
    case when p_rank = 1 and p_total > 10 then 3.0 end,
    case when p_rank <= 2 and p_total > 20 then 2.5 end,
    case when p_rank <= 3 and p_total > 30 then 2.3 end,
    case when p_rank <= 10 and p_total > 100 then 2.0 end
  );
$$;

-- Cron sweep (same shape as notify_stale_lock_ins()) — closes out challenges whose window has
-- passed: h2h awards the higher scorer (no award on an exact tie), group awards everyone only
-- if every member hit target_count ("all or nothing", ranked payout via placement_multiplier
-- once it does — migration 0034), solo that was never manually completed just expires with no
-- payout.
create or replace function finalize_social_challenges()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  v_my numeric;
  v_opp numeric;
  v_member_count int;
  v_completed_count int;
begin
  for r in select * from social_challenges where status = 'active' and ends_at <= now() loop
    if r.mode = 'h2h' then
      v_my := social_challenge_score(r.created_by, r.race_metric, r.starts_at, r.ends_at);
      v_opp := social_challenge_score(r.opponent_id, r.race_metric, r.starts_at, r.ends_at);
      update social_challenges
      set status = 'completed', winner_id = case when v_my > v_opp then r.created_by when v_opp > v_my then r.opponent_id else null end
      where id = r.id;
      if v_my != v_opp then
        insert into bonus_xp_awards (user_id, amount, reason, challenge_id)
        values (case when v_my > v_opp then r.created_by else r.opponent_id end, r.payout_xp, 'challenge_h2h_winner', r.id);
      end if;
    else
      select count(*) into v_member_count from group_members where group_id = r.circle_id;
      select count(*) into v_completed_count
      from group_members gm
      where gm.group_id = r.circle_id
        and (
          select count(*) from check_ins ci
          where ci.user_id = gm.user_id and ci.removed_at is null
            and ci.created_at >= r.starts_at and ci.created_at <= r.ends_at
            and check_in_qualifies_for_challenge(ci.id)
        ) >= r.target_count;

      if v_completed_count >= v_member_count and v_member_count > 0 then
        update social_challenges set status = 'completed' where id = r.id;
        insert into bonus_xp_awards (user_id, amount, reason, challenge_id)
        select
          ranked.user_id,
          round(r.payout_xp * placement_multiplier(ranked.placement, v_member_count)),
          'challenge_group_completion',
          r.id
        from (
          select
            gm.user_id,
            rank() over (order by social_challenge_score(gm.user_id, 'xp', r.starts_at, r.ends_at) desc) as placement
          from group_members gm
          where gm.group_id = r.circle_id
        ) ranked;
      else
        update social_challenges set status = 'expired' where id = r.id;
      end if;
    end if;
  end loop;
end;
$$;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'philoi-finalize-social-challenges') then
    perform cron.unschedule('philoi-finalize-social-challenges');
  end if;
end $$;

select cron.schedule(
  'philoi-finalize-social-challenges',
  '*/10 * * * *',
  $$select finalize_social_challenges();$$
);

-- The Challenges tab's feed (design-mocks/12) — everything the caller can see: pending h2h
-- invites addressed to them, their own/opponent's active or completed h2h, and every group
-- challenge in circles they're a member of. Live-scores h2h/group progress via
-- social_challenge_score() rather than a stored, potentially-stale number. Return shape
-- narrowed (goal_label dropped along with the solo mode) — drop first.
drop function if exists get_my_social_challenges();

create function get_my_social_challenges()
returns table (
  id uuid,
  circle_id uuid,
  circle_name text,
  circle_emoji text,
  created_by uuid,
  created_by_name text,
  mode text,
  opponent_id uuid,
  opponent_name text,
  race_metric text,
  my_score numeric,
  opponent_score numeric,
  target_count int,
  member_count int,
  completed_count int,
  window_hours int,
  starts_at timestamptz,
  ends_at timestamptz,
  status text,
  winner_id uuid,
  payout_xp int,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public
stable
as $$
begin
  return query
  select
    sc.id,
    sc.circle_id,
    g.name as circle_name,
    g.emoji as circle_emoji,
    sc.created_by,
    creator.display_name as created_by_name,
    sc.mode,
    sc.opponent_id,
    opp.display_name as opponent_name,
    sc.race_metric,
    case when sc.mode = 'h2h' and sc.status != 'pending'
      then social_challenge_score(
        case when auth.uid() = sc.opponent_id then sc.opponent_id else sc.created_by end,
        sc.race_metric, sc.starts_at, sc.ends_at)
      else null end as my_score,
    case when sc.mode = 'h2h' and sc.status != 'pending'
      then social_challenge_score(
        case when auth.uid() = sc.opponent_id then sc.created_by else sc.opponent_id end,
        sc.race_metric, sc.starts_at, sc.ends_at)
      else null end as opponent_score,
    sc.target_count,
    case when sc.mode = 'group' then (select count(*)::int from group_members where group_id = sc.circle_id) else null end as member_count,
    case when sc.mode = 'group' then (
      select count(*)::int from group_members gm
      where gm.group_id = sc.circle_id
        and (
          select count(*) from check_ins ci
          where ci.user_id = gm.user_id and ci.removed_at is null
            and ci.created_at >= sc.starts_at and ci.created_at <= coalesce(sc.ends_at, now())
            and check_in_qualifies_for_challenge(ci.id)
        ) >= sc.target_count
    ) else null end as completed_count,
    sc.window_hours,
    sc.starts_at,
    sc.ends_at,
    sc.status,
    sc.winner_id,
    sc.payout_xp,
    sc.created_at
  from social_challenges sc
  -- left join: an h2h challenge with nobody watching has a null circle_id — an inner join here
  -- would silently drop it out of the result set entirely (migration 0032).
  left join groups g on g.id = sc.circle_id
  join profiles creator on creator.id = sc.created_by
  left join profiles opp on opp.id = sc.opponent_id
  where (is_group_member(sc.circle_id) or sc.created_by = auth.uid() or sc.opponent_id = auth.uid())
    and sc.status != 'declined'
  order by
    (sc.status = 'pending' and sc.opponent_id = auth.uid()) desc,
    sc.created_at desc;
end;
$$;

-- ───────────────────────────── goals refactor ─────────────────────────────
-- Moves goals from circle-level (groups.goal_type/cadence, group_members.current_streak)
-- to user-level (a new `goals` table). Circles keep goal_type/cadence purely as a
-- discovery "theme" tag with zero functional link to goals — they no longer own streaks,
-- and a check-in fans out to every circle its owner belongs to instead of one. See
-- supabase/migrations/0002_goals_refactor.sql for the reviewable snapshot of this change.

-- _migrations marker table — this backfill is a genuine one-time data migration, not an
-- idempotent "create if not exists" statement like everything else in this file. Guarding
-- on "is `goals` empty" would silently no-op (and permanently orphan streak history) the
-- moment a user creates a brand-new goal before this has run against a given environment —
-- a real risk given DB migration and app rollout aren't atomic. An explicit marker makes
-- the guard correct regardless of ordering.
create table if not exists _migrations (
  name text primary key,
  applied_at timestamptz not null default now()
);

create table if not exists goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles (id) on delete cascade,
  type text not null check (type in ('gym', 'run', 'study', 'social_media', 'custom')),
  label text,
  cadence text not null default '7x/week',
  current_streak integer not null default 0,
  longest_streak integer not null default 0,
  -- Soft-archive only, matching the deleted_at/removed_at convention used for
  -- messages/check-ins elsewhere in this file — a hard delete would orphan the
  -- check_ins that reference this goal (see the `on delete restrict` FK below).
  archived_at timestamptz,
  created_at timestamptz not null default now()
);

-- At most one active goal per built-in type per user; unlimited simultaneous `custom`
-- goals since "custom" is a bucket, not an identity (two custom goals can legitimately be
-- unrelated activities, distinguished by label).
create unique index if not exists goals_one_active_per_type
  on goals (user_id, type) where archived_at is null and type <> 'custom';

-- job_applications/read join the real lock-in picker (PHILOI_UI_SPEC.md §12);
-- social_media stays a legal historical value but isn't offered in the new picker.
alter table goals drop constraint if exists goals_type_check;
alter table goals add constraint goals_type_check
  check (type in ('gym', 'run', 'study', 'social_media', 'custom', 'job_applications', 'read'));

alter table goals enable row level security;

drop policy if exists "goals: read own" on goals;
create policy "goals: read own" on goals for select using (user_id = auth.uid());

drop policy if exists "goals: insert own" on goals;
create policy "goals: insert own" on goals for insert with check (user_id = auth.uid());

drop policy if exists "goals: update own" on goals;
create policy "goals: update own" on goals for update using (user_id = auth.uid());

-- No delete policy — archive via archived_at instead. A hard delete would orphan any
-- check_ins.goal_id referencing this row; the FK is `on delete restrict` as a backstop.

-- is_circle_mate_of mirrors is_group_member/is_blocked_either_way's SECURITY DEFINER
-- pattern for house-style consistency and to insulate this helper from any future change
-- to group_members' own RLS (group_members is currently symmetric among co-members under
-- plain invoker rights, so this isn't closing a visibility hole today the way
-- is_blocked_either_way does — it's future-proofing plus avoiding double RLS expansion
-- when this is evaluated per-row inside check_ins/reactions/storage policies).
create or replace function is_circle_mate_of(p_other_user_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from group_members gm1
    join group_members gm2 on gm1.group_id = gm2.group_id
    where gm1.user_id = auth.uid() and gm2.user_id = p_other_user_id
  );
$$;

-- check_ins: add goal columns (nullable for now — set NOT NULL only after the backfill
-- below has run and been verified). goal_type/goal_label are denormalized snapshots of
-- the goal at insert time (same pattern as moderation's snapshot_reported_content()) so
-- rendering a circle-mate's feed item never needs a cross-user read of their goals row.
alter table check_ins add column if not exists goal_id uuid references goals (id) on delete restrict;
alter table check_ins add column if not exists goal_type text;
alter table check_ins add column if not exists goal_label text;

create or replace function snapshot_check_in_goal()
returns trigger
language plpgsql
as $$
begin
  if new.goal_id is not null then
    select type, label into new.goal_type, new.goal_label from goals where id = new.goal_id;
  end if;
  return new;
end;
$$;

-- Superseded below (see "core lock-in loop rebuild") once goal_type/goal_detail arrive
-- directly on the INSERT instead of being derived from a goals join — trigger dropped,
-- function left defined-but-unreferenced.
drop trigger if exists on_check_in_insert_snapshot_goal on check_ins;
create trigger on_check_in_insert_snapshot_goal
  before insert on check_ins
  for each row execute function snapshot_check_in_goal();

-- Backfill: merge each user's same-theme circle-memberships into one goal, recomputing
-- the streak from the UNION of check-in dates across the merged circles (not max() of the
-- individual streaks — max() undercounts real activity whenever a user alternated which
-- circle they logged a given day's check-in into; union is the only approach that credits
-- consecutive days correctly regardless of which circle carried which day). Custom-themed
-- circles are NOT merged with each other — "custom" has no shared identity to key a merge
-- on, so each becomes its own goal (see goals_one_active_per_type's exemption above).
create or replace function _backfill_goals_from_circles()
returns void
language plpgsql
as $$
declare
  r record;
  v_goal_id uuid;
  v_label text;
  v_cadence text;
  v_dates date[];
  v_streak integer;
  v_longest integer;
  v_expected date;
  v_run integer;
  d date;
  i integer;
begin
  -- Built-in types: one merged goal per (user_id, goal_type). Driven off check_ins itself
  -- (joined to groups, which every check_ins row still references thanks to the
  -- on-delete-cascade FK) rather than current group_members rows — a user who checked in
  -- and later left that circle has no group_members row anymore, but their check_ins rows
  -- still exist and must still be backfilled.
  for r in
    select ci.user_id, g.goal_type, array_agg(distinct g.id) as source_group_ids
    from check_ins ci
    join groups g on g.id = ci.group_id
    where g.goal_type <> 'custom'
    group by ci.user_id, g.goal_type
  loop
    -- Best-effort label: only recoverable if the user is still a member somewhere (goal_target
    -- lived on group_members, which is gone once they leave — that history isn't recoverable).
    select gm2.goal_target into v_label
    from group_members gm2
    where gm2.user_id = r.user_id and gm2.group_id = any (r.source_group_ids) and gm2.goal_target is not null
    order by gm2.joined_at asc limit 1;

    select g2.cadence into v_cadence
    from groups g2
    where g2.id = any (r.source_group_ids)
    order by g2.created_at asc limit 1;

    insert into goals (user_id, type, label, cadence)
    values (r.user_id, r.goal_type, v_label, coalesce(v_cadence, '7x/week'))
    returning id into v_goal_id;

    update check_ins
    set goal_id = v_goal_id
    where user_id = r.user_id and group_id = any (r.source_group_ids);

    update check_ins set goal_type = r.goal_type, goal_label = v_label where goal_id = v_goal_id;

    -- Recompute streak fresh from the merged date set (not greatest()-guarded — that
    -- guard only makes sense for incremental single-row updates, not a from-scratch
    -- backfill over a merged history).
    select array_agg(distinct (created_at at time zone 'utc')::date order by (created_at at time zone 'utc')::date desc)
    into v_dates
    from check_ins where goal_id = v_goal_id;

    v_streak := 0;
    v_longest := 0;
    if v_dates is not null then
      if v_dates[1] = current_date or v_dates[1] = current_date - 1 then
        v_expected := v_dates[1];
        foreach d in array v_dates loop
          if d = v_expected then
            v_streak := v_streak + 1;
            v_expected := v_expected - 1;
          else
            exit;
          end if;
        end loop;
      end if;

      v_longest := 1;
      v_run := 1;
      for i in 2 .. array_length(v_dates, 1) loop
        if v_dates[i] = v_dates[i - 1] - 1 then
          v_run := v_run + 1;
        else
          v_run := 1;
        end if;
        if v_run > v_longest then
          v_longest := v_run;
        end if;
      end loop;
      v_longest := greatest(v_longest, v_streak);
    end if;

    update goals set current_streak = v_streak, longest_streak = v_longest where id = v_goal_id;
  end loop;

  -- Custom-themed circles: one goal per (user_id, circle) — no merging. Same fix as
  -- above: driven off check_ins, not current group_members, so a since-departed member's
  -- check-ins still get a goal. goal_target is a best-effort left join (null if they left).
  for r in
    select distinct
      ci.user_id,
      g.id as group_id,
      g.name as group_name,
      (
        select gm2.goal_target from group_members gm2
        where gm2.group_id = g.id and gm2.user_id = ci.user_id
      ) as goal_target
    from check_ins ci
    join groups g on g.id = ci.group_id
    where g.goal_type = 'custom'
  loop
    v_label := coalesce(r.goal_target, r.group_name);

    insert into goals (user_id, type, label, cadence)
    select r.user_id, 'custom', v_label, g3.cadence from groups g3 where g3.id = r.group_id
    returning id into v_goal_id;

    update check_ins
    set goal_id = v_goal_id, goal_type = 'custom', goal_label = v_label
    where user_id = r.user_id and group_id = r.group_id;

    select array_agg(distinct (created_at at time zone 'utc')::date order by (created_at at time zone 'utc')::date desc)
    into v_dates
    from check_ins where goal_id = v_goal_id;

    v_streak := 0;
    v_longest := 0;
    if v_dates is not null then
      if v_dates[1] = current_date or v_dates[1] = current_date - 1 then
        v_expected := v_dates[1];
        foreach d in array v_dates loop
          if d = v_expected then
            v_streak := v_streak + 1;
            v_expected := v_expected - 1;
          else
            exit;
          end if;
        end loop;
      end if;

      v_longest := 1;
      v_run := 1;
      for i in 2 .. array_length(v_dates, 1) loop
        if v_dates[i] = v_dates[i - 1] - 1 then
          v_run := v_run + 1;
        else
          v_run := 1;
        end if;
        if v_run > v_longest then
          v_longest := v_run;
        end if;
      end loop;
      v_longest := greatest(v_longest, v_streak);
    end if;

    update goals set current_streak = v_streak, longest_streak = v_longest where id = v_goal_id;
  end loop;

  -- Catch-all: any check_ins still unassigned at this point reference a group_id that no
  -- longer joins to a row in groups (e.g. a circle deleted before check_ins.group_id had
  -- today's on-delete-cascade FK, leaving a dangling reference) — there's no goal_type/label
  -- left to recover for these, so bucket them into one fallback custom goal per user rather
  -- than leaving them unbackfilled and failing the hard-stop assertion below.
  for r in
    select distinct user_id from check_ins where goal_id is null
  loop
    insert into goals (user_id, type, label)
    values (r.user_id, 'custom', 'Legacy check-ins')
    returning id into v_goal_id;

    update check_ins
    set goal_id = v_goal_id, goal_type = 'custom', goal_label = 'Legacy check-ins'
    where user_id = r.user_id and goal_id is null;

    select array_agg(distinct (created_at at time zone 'utc')::date order by (created_at at time zone 'utc')::date desc)
    into v_dates
    from check_ins where goal_id = v_goal_id;

    v_streak := 0;
    v_longest := 0;
    if v_dates is not null then
      if v_dates[1] = current_date or v_dates[1] = current_date - 1 then
        v_expected := v_dates[1];
        foreach d in array v_dates loop
          if d = v_expected then
            v_streak := v_streak + 1;
            v_expected := v_expected - 1;
          else
            exit;
          end if;
        end loop;
      end if;

      v_longest := 1;
      v_run := 1;
      for i in 2 .. array_length(v_dates, 1) loop
        if v_dates[i] = v_dates[i - 1] - 1 then
          v_run := v_run + 1;
        else
          v_run := 1;
        end if;
        if v_run > v_longest then
          v_longest := v_run;
        end if;
      end loop;
      v_longest := greatest(v_longest, v_streak);
    end if;

    update goals set current_streak = v_streak, longest_streak = v_longest where id = v_goal_id;
  end loop;
end;
$$;

do $$
begin
  if not exists (select 1 from _migrations where name = 'goals_backfill_v1') then
    perform _backfill_goals_from_circles();
    insert into _migrations (name) values ('goals_backfill_v1');
  end if;
end $$;

drop function if exists _backfill_goals_from_circles();

-- Hard-stop rather than silently proceeding — every check_ins row must have a goal_id
-- before the NOT NULL constraint and the new unique index below.
do $$
declare
  v_orphans integer;
begin
  select count(*) into v_orphans from check_ins where goal_id is null;
  if v_orphans > 0 then
    raise exception 'goals_backfill_v1: % check_ins rows have no goal_id — aborting before DDL', v_orphans;
  end if;
end $$;

-- Under the old per-circle model, checking in the same day to two different circles that
-- share a theme (e.g. two separate "gym" circles) produced two legitimate rows (different
-- group_id). After merging same-theme circles into one goal, those rows now collide on
-- the same (goal_id, user_id, day) and would violate the new per-goal uniqueness index
-- below. Soft-remove (never delete — this is real photo content) every row but the
-- earliest per colliding day; naturally a no-op on every re-run once resolved once, and a
-- no-op on a fresh project with no legacy check-ins.
with duplicates as (
  select id,
    row_number() over (
      partition by goal_id, user_id, ((created_at at time zone 'utc')::date)
      order by created_at asc
    ) as rn
  from check_ins
  where removed_at is null
)
update check_ins
set removed_at = now()
where id in (select id from duplicates where rn > 1);

-- Finalize check_ins: goal_id required, drop group_id, replace the daily-uniqueness index
-- (was per-circle, now per-goal).
alter table check_ins alter column goal_id set not null;
alter table check_ins alter column goal_type set not null;

-- check_ins_one_per_day dropped for good below (see "core lock-in loop rebuild") — "lock in
-- as often as you want, no cap" directly contradicts a one-per-goal-per-day unique index.

drop index if exists check_ins_group_created_idx;
drop index if exists check_ins_user_group_idx;
create index if not exists check_ins_goal_created_idx on check_ins (goal_id, created_at desc);
create index if not exists check_ins_user_created_idx on check_ins (user_id, created_at desc);

drop policy if exists "check_ins: read if member" on check_ins;
drop policy if exists "check_ins: admin read" on check_ins;
drop policy if exists "check_ins: read if circle-mate" on check_ins;
create policy "check_ins: read if circle-mate" on check_ins for select using (
  user_id = auth.uid() or is_circle_mate_of(user_id) or is_admin()
);

-- Superseded below (see "core lock-in loop rebuild") once goal_id goes nullable — a lock-in
-- session may have no persisted goal to own at all.
drop policy if exists "check_ins: insert own if member" on check_ins;
drop policy if exists "check_ins: insert own if goal owned" on check_ins;
create policy "check_ins: insert own if goal owned" on check_ins for insert with check (
  user_id = auth.uid()
  and exists (select 1 from goals where id = goal_id and user_id = auth.uid() and archived_at is null)
);

-- Note: check_ins.group_id itself isn't dropped here yet — analytics_top_circles (view)
-- and both reactions policies immediately below still reference it, and Postgres tracks
-- those as hard dependencies (unlike a function body, which isn't dependency-checked
-- until it runs). It's dropped at the very end of this section, once every dependent
-- view/policy has been redefined without it.

-- reactions RLS fix — check_ins.group_id is gone, so "read/insert if member" becomes "if
-- you're the check-in's owner or a circle-mate of theirs" (reactions were already keyed
-- by check_in_id, not group_id, so no table change is needed here).
drop policy if exists "reactions: read if member" on reactions;
create policy "reactions: read if member" on reactions for select using (
  exists (
    select 1 from check_ins
    where check_ins.id = reactions.check_in_id
      and (check_ins.user_id = auth.uid() or is_circle_mate_of(check_ins.user_id))
  )
);

drop policy if exists "reactions: insert own if member" on reactions;
create policy "reactions: insert own if member" on reactions for insert with check (
  user_id = auth.uid()
  and exists (
    select 1 from check_ins
    where check_ins.id = reactions.check_in_id
      and (check_ins.user_id = auth.uid() or is_circle_mate_of(check_ins.user_id))
  )
);

-- storage: check-in-photos moves from {group_id}/{user_id}/{file} to {user_id}/{file} — a
-- photo isn't scoped to one circle anymore.
drop policy if exists "check-in-photos: read if member" on storage.objects;
create policy "check-in-photos: read if member" on storage.objects for select
  using (
    bucket_id = 'check-in-photos'
    and (
      ((storage.foldername(name))[1])::uuid = auth.uid()
      or is_circle_mate_of(((storage.foldername(name))[1])::uuid)
    )
  );

drop policy if exists "check-in-photos: upload own if member" on storage.objects;
drop policy if exists "check-in-photos: upload own" on storage.objects;
create policy "check-in-photos: upload own" on storage.objects for insert
  with check (
    bucket_id = 'check-in-photos'
    and ((storage.foldername(name))[1])::uuid = auth.uid()
  );

drop policy if exists "check-in-photos: admin read" on storage.objects;
create policy "check-in-photos: admin read" on storage.objects for select
  using (bucket_id = 'check-in-photos' and is_admin());

-- recompute_streak -> recompute_goal_streak: same consecutive-day algorithm, now scoped
-- to a goal (which already implies a user) instead of (group, user).
create or replace function recompute_goal_streak(p_goal_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_dates date[];
  v_streak integer := 0;
  v_longest integer := 0;
  v_expected date := current_date;
  d date;
begin
  select array_agg(distinct (created_at at time zone 'utc')::date order by (created_at at time zone 'utc')::date desc)
  into v_dates
  from check_ins
  where goal_id = p_goal_id;

  if v_dates is null then
    update goals set current_streak = 0 where id = p_goal_id;
    return;
  end if;

  if v_dates[1] = current_date or v_dates[1] = current_date - 1 then
    v_expected := v_dates[1];
    foreach d in array v_dates loop
      if d = v_expected then
        v_streak := v_streak + 1;
        v_expected := v_expected - 1;
      else
        exit;
      end if;
    end loop;
  end if;

  v_longest := 1;
  declare
    v_run integer := 1;
    i integer;
  begin
    for i in 2 .. array_length(v_dates, 1) loop
      if v_dates[i] = v_dates[i - 1] - 1 then
        v_run := v_run + 1;
      else
        v_run := 1;
      end if;
      if v_run > v_longest then
        v_longest := v_run;
      end if;
    end loop;
  end;

  update goals
  set current_streak = v_streak,
      longest_streak = greatest(longest_streak, v_longest, v_streak)
  where id = p_goal_id;
end;
$$;

-- Core lock-in loop rebuild (PHILOI_UI_SPEC.md §12): goals stop being a persisted per-user
-- list you check into — you pick a TYPE + optional detail each time you lock in. Streak
-- moves from per-goal (goals.current_streak) to per-USER ("locked in at all that day",
-- regardless of goal_type) — recompute_goal_streak() above stays defined but is no longer
-- called by the live check-in path once its last dev-tools callers are reworked below.
alter table profiles add column if not exists current_streak integer not null default 0;
alter table profiles add column if not exists longest_streak integer not null default 0;

create or replace function recompute_user_streak(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_dates date[];
  v_streak integer := 0;
  v_longest integer := 0;
  v_expected date := current_date;
  d date;
begin
  -- A day only counts toward streak if it has a check-in that isn't a timed lock-in at all (an
  -- old/plain photo check-in) or cleared the 60s anti-farming floor (migration 0033) — otherwise
  -- a burst of 1-second lock-ins could farm a streak with zero real effort.
  select array_agg(distinct (created_at at time zone 'utc')::date order by (created_at at time zone 'utc')::date desc)
  into v_dates
  from check_ins
  where user_id = p_user_id and removed_at is null
    and (duration_seconds is null or duration_seconds >= 60);

  if v_dates is null then
    update profiles set current_streak = 0 where id = p_user_id;
    return;
  end if;

  if v_dates[1] = current_date or v_dates[1] = current_date - 1 then
    v_expected := v_dates[1];
    foreach d in array v_dates loop
      if d = v_expected then
        v_streak := v_streak + 1;
        v_expected := v_expected - 1;
      else
        exit;
      end if;
    end loop;
  end if;

  v_longest := 1;
  declare
    v_run integer := 1;
    i integer;
  begin
    for i in 2 .. array_length(v_dates, 1) loop
      if v_dates[i] = v_dates[i - 1] - 1 then
        v_run := v_run + 1;
      else
        v_run := 1;
      end if;
      if v_run > v_longest then
        v_longest := v_run;
      end if;
    end loop;
  end;

  update profiles
  set current_streak = v_streak,
      longest_streak = greatest(longest_streak, v_longest, v_streak)
  where id = p_user_id;
end;
$$;

-- Backfill every existing user's new per-user streak once, from their existing check_ins
-- history (deliberately NOT derived from goals.current_streak — the per-goal figures don't
-- combine into "locked in that day at all" without recomputing from raw dates). Naturally
-- idempotent — safe to re-run on every deploy.
do $$
declare
  r record;
begin
  for r in select distinct user_id from check_ins where removed_at is null loop
    perform recompute_user_streak(r.user_id);
  end loop;
end $$;

-- xp_earned is computed here (after recompute_user_streak, not in a BEFORE trigger) because
-- the streak bonus term needs the POST-check-in streak value. See "lock-in sessions" section
-- below for the check_ins.duration_seconds/xp_earned columns this reads/writes.
-- Anti-farming floor (migration 0033): a session under 60s ("the 5-second session") still gets
-- its check-in row so the journal/flame meter don't lie about what happened, but earns 0 XP —
-- a hard floor, not just a rounding artifact.
create or replace function handle_check_in_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_streak integer;
begin
  perform recompute_user_streak(new.user_id);

  select current_streak into v_streak from profiles where id = new.user_id;

  update check_ins
  set xp_earned = case
    when new.duration_seconds is not null and new.duration_seconds < 60 then 0
    when new.duration_seconds is not null then round(new.duration_seconds * 250.0 / 3600) + coalesce(v_streak, 0) * 5  -- 250 XP/hour locked in — placeholder, tune once there's usage data
    else 100 + coalesce(v_streak, 0) * 5  -- flat XP for a photo check-in — keeps photo check-ins meaningfully worth doing, not obsoleted by lock-in
  end
  where id = new.id;

  return new;
end;
$$;

-- snapshot_reported_content: the check-in branch selected check_ins.group_id into
-- new.circle_id — that column is gone, and a reported check-in no longer has one circle
-- to attribute it to anyway (it fans out to every circle its owner belongs to). Leave
-- circle_id as whatever the reporter explicitly supplied (report.tsx's circleId param);
-- snapshot the goal instead.
create or replace function snapshot_reported_content()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.reported_message_id is not null then
    select jsonb_build_object('type', 'message', 'body', body, 'user_id', user_id, 'created_at', created_at),
           group_id
    into new.reported_content_snapshot, new.circle_id
    from messages where id = new.reported_message_id;
  elsif new.reported_check_in_id is not null then
    select jsonb_build_object(
             'type', 'check_in', 'caption', caption, 'photo_url', photo_url, 'user_id', user_id,
             'created_at', created_at, 'goal_type', goal_type, 'goal_label', goal_label, 'goal_detail', goal_detail
           )
    into new.reported_content_snapshot
    from check_ins where id = new.reported_check_in_id;
  elsif new.reported_group_id is not null then
    select jsonb_build_object('type', 'circle', 'name', name, 'owner_id', owner_id, 'created_at', created_at)
    into new.reported_content_snapshot
    from groups where id = new.reported_group_id;
    new.circle_id := coalesce(new.circle_id, new.reported_group_id);
  end if;
  return new;
end;
$$;

-- notify_group_of_check_in: recipients become every circle-mate of the poster (no single
-- group_id to key off anymore); body references the goal instead of a circle.
create or replace function notify_group_of_check_in()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_poster_name text;
  v_recipient_ids uuid[];
begin
  select display_name into v_poster_name from profiles where id = new.user_id;

  select coalesce(array_agg(distinct gm2.user_id), '{}')
  into v_recipient_ids
  from group_members gm1
  join group_members gm2 on gm1.group_id = gm2.group_id
  where gm1.user_id = new.user_id and gm2.user_id <> new.user_id;

  if array_length(v_recipient_ids, 1) > 0 then
    perform notify_push(
      v_recipient_ids,
      coalesce(new.goal_detail, new.goal_label, initcap(new.goal_type)),
      coalesce(v_poster_name, 'Someone') || ' just checked in 🔥',
      jsonb_build_object('type', 'check_in', 'goal_type', new.goal_type)
    );
  end if;

  return new;
end;
$$;

-- notify_streaks_at_risk: streak is per-user now ("locked in at all that day"), so this
-- iterates profiles directly instead of goals.
create or replace function notify_streaks_at_risk()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
begin
  for r in
    select id as user_id, current_streak
    from profiles
    where current_streak > 0
      and not exists (
        select 1 from check_ins ci
        where ci.user_id = profiles.id
          and ci.removed_at is null
          and (ci.created_at at time zone 'utc')::date = current_date
      )
  loop
    perform notify_push(
      array[r.user_id],
      'Streak at risk',
      'Your ' || r.current_streak || '-day streak breaks at midnight — lock in 🔥',
      jsonb_build_object('type', 'streak_risk')
    );
  end loop;
end;
$$;

-- get_weekly_recap: drop the group_id filter — every circle a user's in now correctly
-- shows the same per-user weekly check-in count (a view over the same real activity, not
-- a separate copy — see the "one goal = one streak, counted once" rule).
create or replace function get_weekly_recap(p_user_id uuid)
returns table (
  group_id uuid,
  group_name text,
  check_ins_this_week bigint
)
language sql
security definer
set search_path = public
stable
as $$
  select
    g.id as group_id,
    g.name as group_name,
    (
      select count(*) from check_ins ci
      where ci.user_id = p_user_id and ci.created_at >= date_trunc('week', now())
    ) as check_ins_this_week
  from group_members gm
  join groups g on g.id = gm.group_id
  where gm.user_id = p_user_id and p_user_id = auth.uid();
$$;

-- analytics_top_circles now lives further down, after check_in_circles is defined (it
-- joins through that table) — views are validated against the catalog at CREATE time, so
-- it can't be defined here where check_in_circles doesn't exist yet on a fresh install.

-- ───────────────────────────── lock-in sessions: XP ledger ─────────────────────────────
-- Moved ahead of "scoring backbone" below: domain_score is `language sql`, validated
-- against the catalog at CREATE time (unlike plpgsql), so the columns it reads must exist
-- textually before its definition, not just before it's ever called.
--
-- photo_url goes nullable because a lock-in session's proof is logged time, not
-- necessarily a photo ("photo optional" per the lock-in spec) — the check constraint below
-- keeps every check-in provable one way or the other. This supersedes the
-- "photo_url-not-null invariant on check_ins" comment above challenge_feed_events (which
-- predates lock-in sessions and is now stale).
alter table check_ins alter column photo_url drop not null;
alter table check_ins add column if not exists duration_seconds integer;
alter table check_ins add column if not exists xp_earned numeric not null default 0;
alter table check_ins drop constraint if exists check_ins_photo_or_duration;
alter table check_ins add constraint check_ins_photo_or_duration
  check (photo_url is not null or duration_seconds is not null);

-- scoring backbone — XP ledger, not a live recomputation. check_ins.xp_earned is set once
-- per row (see handle_check_in_insert() above) and never touched again, so summing it here
-- is a real cumulative total — this replaced an earlier version that recomputed live from
-- current streak/longest_streak/a rolling 30-day count, which fluctuated with current goal
-- state rather than accumulating. Deliberately NOT scoped to `archived_at is null` (unlike
-- most other goals-table consumers in this file) — XP earned stays earned even after the
-- goal that earned it is later archived/retired.
-- check_ins.goal_type is denormalized on every row (no goals join needed, and no longer
-- possible for a lock-in-created row, which may have no goal_id at all).
create or replace function domain_score(p_user_id uuid, p_type text)
returns numeric
language sql
security definer
set search_path = public
stable
as $$
  select coalesce(sum(ci.xp_earned), 0)
  from check_ins ci
  where ci.user_id = p_user_id and ci.goal_type = p_type and ci.removed_at is null;
$$;

-- Folds bonus_xp_awards in alongside the normal check_ins-derived domain scores (see the
-- social-challenges section above) so a challenge payout ripples into rank/leaderboards/
-- campfire level exactly like earned XP, not as a separate hidden number.
create or replace function universal_score(p_user_id uuid)
returns numeric
language sql
security definer
set search_path = public
stable
as $$
  select
    coalesce((select sum(domain_score(p_user_id, t.type)) from (select distinct goal_type as type from check_ins where user_id = p_user_id) t), 0)
    + coalesce((select sum(amount) from bonus_xp_awards where user_id = p_user_id), 0);
$$;

-- ───────────────────────── Daily flame meter (design-mocks/26, PHILOI_UI_SPEC.md §5) ─────────────────────────
-- "Today" is a client-supplied local calendar date + local day-start/day-end timestamps (same
-- pattern as fetchMyTodayLockInCount) — the server has no way to know the caller's timezone
-- otherwise.
create table if not exists daily_fire (
  user_id uuid not null references profiles (id) on delete cascade,
  day date not null,
  -- The smoothing state carried day-to-day (§5: "smoothed off the average") — kept as its
  -- own column distinct from goal_xp so tomorrow's computation can read yesterday's *lock-in*
  -- target directly, independent of whatever XP-per-lock-in conversion was used that day.
  goal_lockins numeric not null,
  goal_xp numeric not null,
  progress_xp numeric not null default 0,
  completed boolean not null default false,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (user_id, day)
);

alter table daily_fire enable row level security;

drop policy if exists "daily_fire: read own" on daily_fire;
create policy "daily_fire: read own" on daily_fire for select using (user_id = auth.uid());

-- No insert/update policy for regular users — RPC-gated (get_or_create_daily_fire below).

-- The opt-in "I completed my fire today" card (§5: "like a lock-in") — a separate minimal
-- events model rather than reusing check_ins, since check_ins rows are assumed elsewhere to
-- be real lock-ins/photo-check-ins (lock-in counts, the profile photo grid, streaks all filter
-- on it) — a synthetic non-lock-in row there would quietly corrupt those.
create table if not exists flame_completion_posts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles (id) on delete cascade,
  day date not null,
  created_at timestamptz not null default now(),
  unique (user_id, day)
);

create table if not exists flame_completion_circles (
  post_id uuid not null references flame_completion_posts (id) on delete cascade,
  circle_id uuid not null references groups (id) on delete cascade,
  posted_at timestamptz not null default now(),
  primary key (post_id, circle_id)
);

create index if not exists flame_completion_circles_circle_idx on flame_completion_circles (circle_id, posted_at desc);

alter table flame_completion_posts enable row level security;
alter table flame_completion_circles enable row level security;

drop policy if exists "flame_completion_posts: read if circle-mate" on flame_completion_posts;
create policy "flame_completion_posts: read if circle-mate" on flame_completion_posts for select using (
  user_id = auth.uid() or is_circle_mate_of(user_id) or is_admin()
);

drop policy if exists "flame_completion_circles: read if member" on flame_completion_circles;
create policy "flame_completion_circles: read if member" on flame_completion_circles for select using (
  is_group_member(circle_id)
);

-- The daily flame meter's read+create+recompute RPC. Called on every home-screen focus and
-- right after a lock-in stops. Recomputes progress_xp fresh from check_ins every call (no
-- incremental trigger-maintained counter) so it's self-healing and can't drift; only ever
-- awards the completion bonus once per day (checked via the row's own `completed` flag before
-- flipping it).
--
-- Adaptive goal algorithm (all constants below are tunable placeholders, same "adjust once
-- there's usage data" status as the rank/campfire-level curves elsewhere in this file):
--   floor 1, cap 5 lock-ins/day-equivalent · +15% stretch once 3 completed days run in a row ·
--   smoothed 30% new / 70% yesterday's target so one big or zero day doesn't whipsaw it ·
--   new accounts (<7 days old) get a flat 1 for their first week · XP target = lock-in target
--   x the user's own recent average XP-per-lock-in (falls back to 50 with no history yet).
-- The rolling 14-day average bucket-by-day uses UTC day boundaries (an approximation — this
-- schema has no stored user timezone) while TODAY's own progress uses the caller-supplied
-- local day-start/day-end exactly, which is the boundary that actually matters for "did my
-- meter fill today."
create or replace function get_or_create_daily_fire(p_day date, p_day_start timestamptz, p_day_end timestamptz)
returns table (
  day date,
  goal_xp numeric,
  progress_xp numeric,
  completed boolean,
  just_completed boolean,
  bonus_xp numeric,
  bonus_embers int
)
language plpgsql
security definer
set search_path = public
as $$
declare
  c_floor constant numeric := 1;
  c_cap constant numeric := 5;
  c_stretch_streak constant int := 3;
  c_stretch_factor constant numeric := 1.15;
  c_smoothing_alpha constant numeric := 0.3;
  c_new_user_days constant int := 7;
  c_default_xp_per_lockin constant numeric := 50;
  -- Roughly one real lock-in's worth (a genuine session commonly earns ~90-200+ XP) — the
  -- daily goal must never read as achievable by something less than a real session (Dispatch
  -- review: a manual-mode user with a corrupted rolling average ended up with goal_xp = 20).
  c_min_goal_xp constant numeric := 90;
  c_completion_bonus_xp constant numeric := 50;
  c_completion_bonus_embers constant int := 5;

  v_row daily_fire;
  v_mode text;
  v_manual_target int;
  v_account_created_at timestamptz;
  v_avg_xp_per_lockin numeric;
  v_avg14 numeric;
  v_prev_goal numeric;
  v_streak int;
  v_raw_lockins numeric;
  v_goal_lockins numeric;
  v_goal_xp numeric;
  v_progress numeric;
  v_just_completed boolean := false;
  v_bonus_xp numeric := 0;
  v_bonus_embers int := 0;
begin
  -- Every bare reference to `day`/`completed` below must be qualified against the daily_fire
  -- alias (df) — this function's own RETURNS TABLE(day date, ..., completed boolean, ...)
  -- implicitly declares day/completed as PL/pgSQL variables in scope here, which collide with
  -- daily_fire's own day/completed columns and raise "column reference is ambiguous" the
  -- instant an unqualified one is parsed (caught live: PGRST/42702 on the very first select).
  select * into v_row from daily_fire df where df.user_id = auth.uid() and df.day = p_day;

  if v_row.day is null then
    select daily_goal_mode, daily_goal_manual_target, created_at
    into v_mode, v_manual_target, v_account_created_at
    from profiles where id = auth.uid();

    select coalesce(avg(xp_earned), c_default_xp_per_lockin) into v_avg_xp_per_lockin
    from (
      select xp_earned from check_ins
      where user_id = auth.uid() and duration_seconds is not null and removed_at is null
      order by created_at desc limit 30
    ) recent;

    -- Never let a thin or corrupted history drag the per-lockin average below the no-history
    -- default — this is the input to the goal_xp calc below, not a guarantee on its own.
    v_avg_xp_per_lockin := greatest(v_avg_xp_per_lockin, c_default_xp_per_lockin);

    if v_mode = 'manual' then
      v_goal_lockins := greatest(1, coalesce(v_manual_target, 1));
    elsif v_account_created_at > p_day_start - (c_new_user_days || ' days')::interval then
      v_goal_lockins := c_floor;
    else
      select coalesce(count(*)::numeric, 0) / 14.0 into v_avg14
      from check_ins
      where user_id = auth.uid()
        and duration_seconds is not null and removed_at is null
        and created_at >= p_day_start - interval '14 days'
        and created_at < p_day_start;

      select df.goal_lockins into v_prev_goal from daily_fire df
      where df.user_id = auth.uid() and df.day = p_day - 1;

      with recursive streak_days as (
        select (p_day - 1) as d
        where exists (
          select 1 from daily_fire df where df.user_id = auth.uid() and df.day = p_day - 1 and df.completed = true
        )
        union all
        select streak_days.d - 1 from streak_days
        where exists (
          select 1 from daily_fire df where df.user_id = auth.uid() and df.day = streak_days.d - 1 and df.completed = true
        )
      )
      select count(*) into v_streak from streak_days;

      v_raw_lockins := greatest(c_floor, coalesce(v_avg14, c_floor));
      if v_streak >= c_stretch_streak then
        v_raw_lockins := v_raw_lockins * c_stretch_factor;
      end if;
      v_raw_lockins := least(c_cap, v_raw_lockins);

      if v_prev_goal is not null then
        v_goal_lockins := c_smoothing_alpha * v_raw_lockins + (1 - c_smoothing_alpha) * v_prev_goal;
      else
        v_goal_lockins := v_raw_lockins;
      end if;
    end if;

    -- Hard floor: whatever the mode/history produced, the goal is never below one real session.
    v_goal_xp := greatest(round(v_goal_lockins * v_avg_xp_per_lockin), c_min_goal_xp);

    insert into daily_fire (user_id, day, goal_lockins, goal_xp, progress_xp, completed)
    values (auth.uid(), p_day, v_goal_lockins, v_goal_xp, 0, false)
    returning * into v_row;
  end if;

  select coalesce(sum(xp_earned), 0) into v_progress
  from check_ins
  where user_id = auth.uid() and duration_seconds is not null and removed_at is null
    and created_at >= p_day_start and created_at < p_day_end;

  if v_progress >= v_row.goal_xp and not v_row.completed then
    v_just_completed := true;
    v_bonus_xp := c_completion_bonus_xp;
    v_bonus_embers := c_completion_bonus_embers;

    insert into bonus_xp_awards (user_id, amount, reason)
    values (auth.uid(), v_bonus_xp, 'daily_fire:' || p_day);

    update profiles set embers = embers + v_bonus_embers where id = auth.uid();
  end if;

  update daily_fire df
  set progress_xp = v_progress,
      completed = df.completed or (v_progress >= v_row.goal_xp),
      completed_at = case when v_just_completed then now() else df.completed_at end
  where df.user_id = auth.uid() and df.day = p_day
  returning * into v_row;

  return query select v_row.day, v_row.goal_xp, v_row.progress_xp, v_row.completed, v_just_completed, v_bonus_xp, v_bonus_embers;
end;
$$;

-- The opt-in publish action itself — the Settings toggle only gates whether the client even
-- offers the "Share" tap; this still re-verifies completion server-side rather than trusting
-- the client.
create or replace function publish_flame_completion(p_day date)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_completed boolean;
  v_post_id uuid;
begin
  select completed into v_completed from daily_fire where user_id = auth.uid() and day = p_day;
  if not coalesce(v_completed, false) then
    raise exception 'Today''s fire is not complete yet.';
  end if;

  insert into flame_completion_posts (user_id, day)
  values (auth.uid(), p_day)
  on conflict (user_id, day) do update set user_id = excluded.user_id
  returning id into v_post_id;

  insert into flame_completion_circles (post_id, circle_id)
  select v_post_id, gm.group_id from group_members gm where gm.user_id = auth.uid()
  on conflict do nothing;
end;
$$;

-- Bronze/Silver/Gold/Platinum/Diamond x I/II/III. Table-driven (not inline CASE thresholds
-- like the original version) so retuning the curve later is an UPDATE on this table, not a
-- function edit — same "starting point for a beta, expect to retune" caveat as before,
-- just easier to act on. Geometric growth (step(i) = round(200 * 1.3^i)) — cheap early
-- ranks, steep late ones (Bronze III->II costs 200 XP; the Gold I->Diamond III span costs
-- ~10,000).
create table if not exists rank_thresholds (
  rank_index int primary key,
  tier text not null,
  division int not null,
  cumulative_xp_required numeric not null
);

insert into rank_thresholds (rank_index, tier, division, cumulative_xp_required) values
  (0, 'bronze', 3, 0),
  (1, 'bronze', 2, 200),
  (2, 'bronze', 1, 460),
  (3, 'silver', 3, 798),
  (4, 'silver', 2, 1237),
  (5, 'silver', 1, 1808),
  (6, 'gold', 3, 2551),
  (7, 'gold', 2, 3516),
  (8, 'gold', 1, 4771),
  (9, 'platinum', 3, 6402),
  (10, 'platinum', 2, 8523),
  (11, 'platinum', 1, 11280),
  (12, 'diamond', 3, 14864),
  (13, 'diamond', 2, 19524),
  (14, 'diamond', 1, 25582),
  -- Infernal (PHILOI_UI_SPEC.md §11; renamed from "Legend" — migration 0030) — the apex above
  -- Diamond, singular/no divisions (division stored as 1 purely so ordinal arithmetic elsewhere
  -- still orders it above Diamond I). Continues the same curve one more step:
  -- step(14) = round(200*1.3^14) = 7875, +25582 = 33457.
  (15, 'infernal', 1, 33457)
on conflict (rank_index) do update set
  tier = excluded.tier, division = excluded.division, cumulative_xp_required = excluded.cumulative_xp_required;

create or replace function rank_tier_for_score(p_score numeric)
returns table (tier text, division int)
language sql
stable
as $$
  select rt.tier, rt.division
  from rank_thresholds rt
  where rt.cumulative_xp_required <= p_score
  order by rt.cumulative_xp_required desc
  limit 1;
$$;

-- xp_into_tier/xp_for_next_tier let the client always render "current / needed toward
-- next rank" without a second round trip. At max rank (Diamond I, rank_index 14) there's
-- no next row — xp_for_next_tier comes back 0, which the client treats as "maxed out."
-- Profile screen's stat row (design-mocks/15) — total lock-in count + total hours, simple
-- aggregates over the caller's own check_ins not worth a client-side full-table fetch.
create or replace function get_my_lockin_stats()
returns table (lockin_count bigint, total_seconds numeric)
language sql
security definer
set search_path = public
stable
as $$
  select
    count(*) as lockin_count,
    coalesce(sum(duration_seconds), 0) as total_seconds
  from check_ins
  where user_id = auth.uid() and duration_seconds is not null and removed_at is null;
$$;

-- Same, for viewing someone ELSE's profile (design-mocks/15) — stats/streak aren't
-- privacy-gated, same as leaderboards already exposing XP/streak for everyone.
create or replace function get_user_lockin_stats(p_user_id uuid)
returns table (lockin_count bigint, total_seconds numeric)
language sql
security definer
set search_path = public
stable
as $$
  select
    count(*) as lockin_count,
    coalesce(sum(duration_seconds), 0) as total_seconds
  from check_ins
  where user_id = p_user_id and duration_seconds is not null and removed_at is null;
$$;

-- Return shape gained two columns vs. the 0002 version (scope, goal_type, score, tier,
-- division only) — Postgres can't CREATE OR REPLACE across an OUT-parameter change, so drop first.
drop function if exists get_my_ranks();
create or replace function get_my_ranks()
returns table (
  scope text,
  goal_type text,
  score numeric,
  tier text,
  division int,
  xp_into_tier numeric,
  xp_for_next_tier numeric
)
language sql
security definer
set search_path = public
stable
as $$
  with ranked as (
    select 'universal'::text as scope, null::text as goal_type, s.score
    from (select universal_score(auth.uid()) as score) s
    union all
    select 'domain', g.type, domain_score(auth.uid(), g.type)
    from (select distinct goal_type as type from check_ins where user_id = auth.uid()) g
  )
  select
    r.scope,
    r.goal_type,
    r.score,
    t.tier,
    t.division,
    r.score - lo.cumulative_xp_required as xp_into_tier,
    coalesce(hi.cumulative_xp_required, lo.cumulative_xp_required) - lo.cumulative_xp_required as xp_for_next_tier
  from ranked r
  cross join lateral rank_tier_for_score(r.score) t
  join rank_thresholds lo on lo.tier = t.tier and lo.division = t.division
  left join rank_thresholds hi on hi.rank_index = lo.rank_index + 1
  order by r.scope desc, r.goal_type;
$$;

-- Mirrors get_my_ranks()'s universal branch only, for an arbitrary user — the profile
-- screen (design-mocks/15) shows one overall rank hexagon, not a per-domain breakdown.
create or replace function get_user_rank(p_user_id uuid)
returns table (
  score numeric,
  tier text,
  division int,
  xp_into_tier numeric,
  xp_for_next_tier numeric
)
language sql
security definer
set search_path = public
stable
as $$
  select
    s.score,
    t.tier,
    t.division,
    s.score - lo.cumulative_xp_required as xp_into_tier,
    coalesce(hi.cumulative_xp_required, lo.cumulative_xp_required) - lo.cumulative_xp_required as xp_for_next_tier
  from (select universal_score(p_user_id) as score) s
  cross join lateral rank_tier_for_score(s.score) t
  join rank_thresholds lo on lo.tier = t.tier and lo.division = t.division
  left join rank_thresholds hi on hi.rank_index = lo.rank_index + 1;
$$;

-- The profile photo grid, privacy-aware (§19): your own is always full access; someone
-- else's respects their photo_visibility — 'everyone' shows to anyone, 'campfires' only to
-- a circle-mate, otherwise nothing. Security definer + its own check because check_ins' RLS
-- ("read if circle-mate") has no path for a true stranger to read a row at all, regardless
-- of photo_visibility — 'everyone' needs this bypass to actually mean "anyone."
create or replace function get_user_lock_in_photos(p_user_id uuid, p_limit int default 6)
returns table (id uuid, goal_type text, goal_detail text, duration_seconds int, photo_url text)
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_visibility text;
  v_allowed boolean;
begin
  if p_user_id = auth.uid() then
    v_allowed := true;
  else
    select photo_visibility into v_visibility from profiles where id = p_user_id;
    v_allowed := v_visibility = 'everyone' or (v_visibility = 'campfires' and is_circle_mate_of(p_user_id));
  end if;

  if not v_allowed then
    return;
  end if;

  return query
  select ci.id, ci.goal_type, ci.goal_detail, ci.duration_seconds, ci.photo_url
  from check_ins ci
  where ci.user_id = p_user_id and ci.duration_seconds is not null and ci.removed_at is null
  order by ci.created_at desc
  limit p_limit;
end;
$$;

-- leaderboard RPCs re-ranked by universal_score — a circle has no single shared goal
-- anymore, so ranking by one goal's streak doesn't make sense; universal_score is the
-- domain-agnostic "how consistent is this person" signal the product doc asks for.
drop function if exists get_group_leaderboard(uuid);

create function get_group_leaderboard(p_group_id uuid)
returns table (
  user_id uuid,
  handle text,
  display_name text,
  avatar_url text,
  is_pro boolean,
  score numeric,
  tier text,
  division int,
  check_ins_this_week bigint
)
language sql
security definer
set search_path = public
stable
as $$
  select
    gm.user_id,
    p.handle,
    p.display_name,
    p.avatar_url,
    p.is_pro,
    s.score,
    t.tier,
    t.division,
    coalesce((
      select count(*) from check_ins ci
      where ci.user_id = gm.user_id and ci.created_at >= date_trunc('week', now())
    ), 0) as check_ins_this_week
  from group_members gm
  join profiles p on p.id = gm.user_id
  cross join lateral (select universal_score(gm.user_id) as score) s
  cross join lateral rank_tier_for_score(s.score) t
  where gm.group_id = p_group_id and is_group_member(p_group_id)
  order by s.score desc, check_ins_this_week desc, p.display_name asc;
$$;

-- Dropped first: CREATE OR REPLACE can't change an existing function's RETURNS TABLE columns
-- (this function originally returned best_streak instead of score/tier/division).
drop function if exists get_university_leaderboard(text, int);

create function get_university_leaderboard(p_university text, p_limit int default 50)
returns table (
  user_id uuid,
  handle text,
  display_name text,
  avatar_url text,
  is_pro boolean,
  score numeric,
  tier text,
  division int,
  check_ins_this_week bigint
)
language sql
security definer
set search_path = public
stable
as $$
  select
    p.id as user_id,
    p.handle,
    p.display_name,
    p.avatar_url,
    p.is_pro,
    s.score,
    t.tier,
    t.division,
    coalesce((
      select count(*) from check_ins ci
      where ci.user_id = p.id and ci.created_at >= date_trunc('week', now())
    ), 0) as check_ins_this_week
  from profiles p
  cross join lateral (select universal_score(p.id) as score) s
  cross join lateral rank_tier_for_score(s.score) t
  where p.university = p_university
  order by s.score desc, check_ins_this_week desc, p.display_name asc
  limit p_limit;
$$;

-- The Leaderboard tab's "Campfires" pool (PHILOI_UI_SPEC.md §15) — "rank people, not
-- campfires": everyone who shares ANY circle with the caller, deduped by user (someone in two
-- of your campfires shows once), ranked by each person's own universal XP. Distinct from
-- get_my_circle_ranks() just below (kept as-is — that one is "my rank inside each separate
-- circle," used by that circle's own header/detail leaderboard, not this cross-campfire tab).
create or replace function get_my_cross_circle_people()
returns table (
  user_id uuid,
  display_name text,
  handle text,
  avatar_url text,
  is_pro boolean,
  score numeric,
  tier text,
  division int,
  current_streak int
)
language sql
security definer
set search_path = public
stable
as $$
  with mates as (
    select distinct gm2.user_id
    from group_members gm1
    join group_members gm2 on gm2.group_id = gm1.group_id
    where gm1.user_id = auth.uid()
  )
  select
    p.id as user_id,
    p.display_name,
    p.handle,
    p.avatar_url,
    p.is_pro,
    universal_score(p.id) as score,
    t.tier,
    t.division,
    p.current_streak
  from mates m
  join profiles p on p.id = m.user_id
  cross join lateral rank_tier_for_score(universal_score(p.id)) t
  order by score desc;
$$;

-- "Vs. unis" (design-mocks/11) — campus-vs-campus total XP, summed across every member at
-- that university who's on Philoi (not scoped to the caller's own circles).
create or replace function get_university_totals(p_limit int default 20)
returns table (university text, total_xp numeric, member_count bigint)
language sql
security definer
set search_path = public
stable
as $$
  select
    p.university,
    sum(universal_score(p.id)) as total_xp,
    count(*) as member_count
  from profiles p
  where p.university is not null and p.is_demo = false
  group by p.university
  order by total_xp desc
  limit p_limit;
$$;

-- Dropped first: CREATE OR REPLACE can't change an existing function's RETURNS TABLE columns
-- (this function originally returned current_streak instead of score/tier/division).
drop function if exists get_my_circle_ranks();

create function get_my_circle_ranks()
returns table (
  group_id uuid,
  group_name text,
  group_emoji text,
  my_rank bigint,
  member_count bigint,
  score numeric,
  tier text,
  division int,
  check_ins_this_week bigint
)
language sql
security definer
set search_path = public
stable
as $$
  with weekly as (
    select
      gm.group_id,
      gm.user_id,
      (select universal_score(gm.user_id)) as score,
      coalesce((
        select count(*) from check_ins ci
        where ci.user_id = gm.user_id and ci.created_at >= date_trunc('week', now())
      ), 0) as check_ins_this_week
    from group_members gm
    where is_group_member(gm.group_id)
  ),
  ranked as (
    select
      w.*,
      rank() over (partition by w.group_id order by w.score desc, w.check_ins_this_week desc) as rnk,
      count(*) over (partition by w.group_id) as member_count
    from weekly w
  )
  select
    g.id as group_id,
    g.name as group_name,
    g.emoji as group_emoji,
    r.rnk as my_rank,
    r.member_count,
    r.score,
    t.tier,
    t.division,
    r.check_ins_this_week
  from ranked r
  join groups g on g.id = r.group_id
  cross join lateral rank_tier_for_score(r.score) t
  where r.user_id = auth.uid()
  order by g.name;
$$;

-- Living-flame signature mechanic (UI_REDESIGN_SPEC.md) — each Campfire's flame is meant to
-- be a LIVE gauge of the group's activity, not decoration: roars when members are showing up
-- today, dies down when nobody has. Blended from two signals — what fraction of the group
-- checked in today (immediate, volatile) and the group's average current streak (slower-
-- moving, rewards consistency) — so a single no-show day dims the flame without snuffing it
-- outright if the group's streaks are healthy.
create or replace function get_my_campfire_heat()
returns table (group_id uuid, heat numeric)
language sql
security definer
set search_path = public
stable
as $$
  select
    gm.group_id,
    least(
      1.0,
      (coalesce(today.today_count, 0)::numeric / greatest(mem.member_count, 1)) * 0.7
      + least(coalesce(streak.avg_streak, 0) / 14.0, 1.0) * 0.3
    ) as heat
  from group_members gm
  join (
    select group_id, count(*) as member_count from group_members group by group_id
  ) mem on mem.group_id = gm.group_id
  left join (
    select gm2.group_id, count(distinct gm2.user_id) as today_count
    from group_members gm2
    join check_ins ci on ci.user_id = gm2.user_id
    where (ci.created_at at time zone 'utc')::date = current_date and ci.removed_at is null
    group by gm2.group_id
  ) today on today.group_id = gm.group_id
  left join (
    select gm3.group_id, avg(p.current_streak) as avg_streak
    from group_members gm3
    join profiles p on p.id = gm3.user_id
    group by gm3.group_id
  ) streak on streak.group_id = gm.group_id
  where gm.user_id = auth.uid();
$$;

-- dev tools: rework to target a demo goal instead of inserting bare check_ins rows
-- against a group_id.
create or replace function dev_seed_my_demo_circle()
returns groups
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group groups;
  v_fake_id uuid;
  v_goal_id uuid;
  v_day integer;
  v_found boolean := false;
begin
  insert into groups (name, emoji, owner_id, goal_type, cadence, privacy)
  values ('Dev Test Circle', '🧪', auth.uid(), 'gym', '7x/week', 'private')
  returning * into v_group;

  insert into group_members (group_id, user_id, role)
  values (v_group.id, auth.uid(), 'owner');

  for v_fake_id in select id from profiles where is_demo = true limit 3 loop
    v_found := true;
    insert into group_members (group_id, user_id, role)
    values (v_group.id, v_fake_id, 'member')
    on conflict (group_id, user_id) do nothing;

    insert into goals (user_id, type, label)
    values (v_fake_id, 'gym', 'Gym')
    on conflict (user_id, type) where archived_at is null and type <> 'custom' do nothing;

    select id into v_goal_id from goals where user_id = v_fake_id and type = 'gym' and archived_at is null;

    for v_day in 0..2 loop
      insert into check_ins (goal_id, user_id, photo_url, status, created_at)
      values (
        v_goal_id, v_fake_id, 'dev-tools/placeholder.jpg', 'on_time',
        now() - (v_day || ' days')::interval
      );
    end loop;

    perform recompute_goal_streak(v_goal_id);
  end loop;

  if not v_found then
    raise notice 'No is_demo profiles exist yet — run `npm run seed:demo` (scripts/seed-demo-circles.js), then call dev_seed_my_demo_circle() again to actually populate members.';
  end if;

  return v_group;
end;
$$;

drop function if exists dev_simulate_friend_checkin(uuid, uuid);

create or replace function dev_simulate_friend_checkin(p_group_id uuid, p_fake_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_group_member(p_group_id) then
    raise exception 'Not a member of that circle.';
  end if;

  if not exists (
    select 1 from profiles where id = p_fake_user_id and is_demo = true
  ) then
    raise exception 'dev_simulate_friend_checkin only works with is_demo profiles.';
  end if;

  if not exists (
    select 1 from group_members where group_id = p_group_id and user_id = p_fake_user_id
  ) then
    insert into group_members (group_id, user_id, role) values (p_group_id, p_fake_user_id, 'member');
  end if;

  insert into check_ins (user_id, goal_type, photo_url, status)
  values (p_fake_user_id, 'gym', 'dev-tools/placeholder.jpg', 'on_time');

  perform recompute_user_streak(p_fake_user_id);
end;
$$;

-- Signature changed (a persisted goal_id -> a plain goal_type filter) — drop first.
drop function if exists dev_reset_my_checkins(uuid);
drop function if exists dev_reset_my_checkins(text);

create function dev_reset_my_checkins(p_goal_type text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from check_ins
  where user_id = auth.uid() and (p_goal_type is null or goal_type = p_goal_type);

  perform recompute_user_streak(auth.uid());
end;
$$;

-- delete_my_account: Storage path parsing must match the new {user_id}/{file} layout (was
-- {group_id}/{user_id}/{file}, foldername[2]) — otherwise account deletion silently stops
-- finding (and deleting) anyone's check-in photos from Storage.
create or replace function delete_my_account()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_photo_paths text[];
begin
  if v_user_id is null then
    raise exception 'Not authenticated.';
  end if;

  select coalesce(array_agg(name), '{}')
  into v_photo_paths
  from storage.objects
  where bucket_id = 'check-in-photos' and (storage.foldername(name))[1] = v_user_id::text;

  perform delete_storage_prefixes('check-in-photos', v_photo_paths);

  delete from groups where owner_id = v_user_id;
  delete from group_members where user_id = v_user_id;
  delete from reactions where user_id = v_user_id;
  delete from check_ins where user_id = v_user_id;
  delete from goals where user_id = v_user_id;
  delete from messages where user_id = v_user_id;
  delete from invites where inviter_id = v_user_id;
  delete from events where user_id = v_user_id;
  delete from profiles where id = v_user_id;

  delete from auth.users where id = v_user_id;
end;
$$;

-- Now safe to drop — analytics_top_circles and both reactions policies were redefined
-- without referencing it earlier in this section.
alter table check_ins drop column if exists group_id;

-- retire group_members.goal_target — superseded by goals.label.
drop function if exists set_my_goal_target(uuid, text);
alter table group_members drop column if exists goal_target;
alter table group_members drop column if exists current_streak;
alter table group_members drop column if exists longest_streak;

-- ───────────────────────────── point-in-time circle fan-out ─────────────────────────────
-- Bug: a circle's feed was computed live as "every check-in by any CURRENT member," so
-- creating or joining a circle instantly surfaced every existing member's entire check-in
-- history instead of just what happens after you joined. Fix: snapshot which circles a user
-- was actually in at the moment they checked in, and scope each circle's feed to that
-- snapshot instead of live membership overlap. Global visibility (leaderboards, streaks,
-- "is this circle-mate active") is untouched — is_circle_mate_of() and the base check_ins
-- RLS policy stay as-is; only a specific circle's FEED query changes (client-side, see
-- fetchFeed() in src/lib/api/check-ins.ts).

create table if not exists check_in_circles (
  check_in_id uuid not null references check_ins (id) on delete cascade,
  circle_id uuid not null references groups (id) on delete cascade,
  posted_at timestamptz not null default now(),
  primary key (check_in_id, circle_id)
);

create index if not exists check_in_circles_circle_idx on check_in_circles (circle_id, posted_at desc);

alter table check_in_circles enable row level security;

drop policy if exists "check_in_circles: read if member" on check_in_circles;
create policy "check_in_circles: read if member" on check_in_circles for select using (
  is_group_member(circle_id)
);

-- No insert/update/delete policy for regular users — populated only by the trigger below
-- (security definer), same server-trusted-write pattern as challenge_feed_events.

-- A lock-in's intended circle (null = not posted anywhere — either a solo session, or a
-- campfire session whose "Post to the campfire" choice (PHILOI_UI_SPEC.md §13's done screen)
-- hasn't happened yet). Nullable, unlike the dropped legacy group_id above — a lock-in's
-- circle is a deliberate, deferred choice, not a required column at insert time.
alter table check_ins add column if not exists circle_id uuid references groups (id) on delete set null;

create or replace function snapshot_check_in_circles()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.duration_seconds is not null then
    -- Lock-ins: respect circle_id exactly. It's left null at stop time (see
    -- stop_lock_in_session) until the user explicitly posts via post_check_in_to_circle —
    -- this branch mainly guards against a future insert path setting it directly.
    if new.circle_id is not null then
      insert into check_in_circles (check_in_id, circle_id) values (new.id, new.circle_id)
      on conflict do nothing;
    end if;
  else
    -- Legacy/photo-only check-ins (pre-lock-in-rebuild, dev-tools) — unchanged, broadcast to
    -- every circle the user belongs to.
    insert into check_in_circles (check_in_id, circle_id)
    select new.id, gm.group_id
    from group_members gm
    where gm.user_id = new.user_id;
  end if;
  return new;
end;
$$;

drop trigger if exists on_check_in_insert_snapshot_circles on check_ins;
create trigger on_check_in_insert_snapshot_circles
  after insert on check_ins
  for each row execute function snapshot_check_in_circles();

-- ───────────────────────────── campfire level (PHILOI_UI_SPEC.md §11) ─────────────────────────────
-- A persistent shared XP/level counter per circle, fed by every member's lock-ins. Distinct
-- from get_my_campfire_heat()'s 0-1 ephemeral "activity" gauge (that one drives the
-- living-flame animation's intensity; this one is a permanent, ever-growing counter).
create table if not exists campfire_levels (
  group_id uuid primary key references groups (id) on delete cascade,
  xp numeric not null default 0,
  updated_at timestamptz not null default now()
);

alter table campfire_levels enable row level security;

drop policy if exists "campfire_levels: read if member" on campfire_levels;
create policy "campfire_levels: read if member" on campfire_levels for select using (
  is_group_member(group_id)
);

-- No insert/update/delete policy for regular users — only written by the trigger below.

-- Hooks off check_in_circles, not check_ins directly — check_in_circles already knows
-- exactly which circles a check-in fanned out to, and by the time THIS trigger fires,
-- check_ins.xp_earned is guaranteed already finalized: on_check_in_insert (sets xp_earned)
-- and on_check_in_insert_snapshot_circles (populates check_in_circles) are both `after
-- insert on check_ins`, and Postgres fires same-timing triggers in trigger-NAME alphabetical
-- order — "on_check_in_insert" sorts before "on_check_in_insert_snapshot_circles" (strict
-- prefix). If either trigger is ever renamed, re-verify this ordering assumption still holds.
create or replace function accrue_campfire_xp()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_duration integer;
  v_xp numeric;
begin
  select duration_seconds, xp_earned into v_duration, v_xp
  from check_ins where id = new.check_in_id;

  -- Lock-ins only (per spec: "each lock-in feeds the campfire's shared level"), not old
  -- plain photo check-ins.
  if v_duration is null then
    return new;
  end if;

  insert into campfire_levels (group_id, xp)
  values (new.circle_id, v_xp)
  on conflict (group_id) do update
    set xp = campfire_levels.xp + excluded.xp, updated_at = now();

  return new;
end;
$$;

drop trigger if exists on_check_in_circles_insert_accrue_xp on check_in_circles;
create trigger on_check_in_circles_insert_accrue_xp
  after insert on check_in_circles
  for each row execute function accrue_campfire_xp();

-- Level-from-XP as a closed-form formula, not a seeded threshold table — campfire XP pools
-- many members and can run well past personal rank's 15 steps. Cumulative-XP-for-level
-- curve: xp_for_level(L) = 500 * L^1.6 — placeholder constants, same "tune once there's
-- usage data" status as the original XP-per-hour/rank-threshold curves.
create or replace function campfire_level_for_xp(p_xp numeric)
returns int
language sql
immutable
as $$
  select greatest(1, floor(power(greatest(p_xp, 0) / 500.0, 1.0 / 1.6))::int + 1);
$$;

create or replace function get_campfire_level(p_group_id uuid)
returns table (group_id uuid, xp numeric, level int, xp_into_level numeric, xp_for_next_level numeric)
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_xp numeric;
  v_level int;
  v_level_floor numeric;
  v_level_ceil numeric;
begin
  if not is_group_member(p_group_id) then
    raise exception 'Not a member of that campfire.';
  end if;

  select coalesce(cl.xp, 0) into v_xp from campfire_levels cl where cl.group_id = p_group_id;
  v_xp := coalesce(v_xp, 0);
  v_level := campfire_level_for_xp(v_xp);
  v_level_floor := 500 * power(v_level - 1, 1.6);
  v_level_ceil := 500 * power(v_level, 1.6);

  return query select p_group_id, v_xp, v_level, v_xp - v_level_floor, v_level_ceil - v_level_floor;
end;
$$;

-- Discovery preview sheet (PHILOI_UI_SPEC.md §10: "tap a fire -> preview sheet, never an
-- instant join"). Unlike get_campfire_level() above, this must also work for NON-members
-- previewing an open/gated campfire before joining, so it's gated on privacy rather than
-- membership (falling back to membership so a caller can still preview their own private
-- "My fires" circles from the valley).
-- Return shape changed (is_public/visibility -> privacy) — drop first.
drop function if exists get_campfire_preview(uuid);
create function get_campfire_preview(p_group_id uuid)
returns table (
  group_id uuid,
  name text,
  emoji text,
  privacy text,
  is_member boolean,
  member_count bigint,
  active_lock_in_count bigint,
  campfire_level int,
  member_names text[],
  recent_photo_urls text[],
  has_pending_request boolean
)
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_group groups;
  v_is_member boolean;
begin
  select * into v_group from groups where id = p_group_id;
  if v_group.id is null then
    raise exception 'Campfire not found.';
  end if;

  v_is_member := is_group_member(p_group_id);
  if not v_is_member and v_group.privacy = 'private' then
    raise exception 'That campfire is private.';
  end if;

  return query
  select
    v_group.id,
    v_group.name,
    v_group.emoji,
    v_group.privacy,
    v_is_member,
    (select count(*) from group_members gm where gm.group_id = v_group.id),
    (select count(*) from lock_in_sessions ls where ls.circle_id = v_group.id and ls.status = 'active'),
    campfire_level_for_xp(coalesce((select cl.xp from campfire_levels cl where cl.group_id = v_group.id), 0)),
    (select coalesce(array_agg(p.display_name), '{}') from (
      select gm.user_id from group_members gm where gm.group_id = v_group.id limit 6
    ) m join profiles p on p.id = m.user_id),
    (select coalesce(array_agg(ci.photo_url), '{}') from (
      select cic.check_in_id, cic.posted_at from check_in_circles cic where cic.circle_id = v_group.id
      order by cic.posted_at desc limit 4
    ) recent
    join check_ins ci on ci.id = recent.check_in_id
    join profiles poster on poster.id = ci.user_id
    where ci.photo_url is not null and (v_is_member or poster.photo_visibility = 'everyone')),
    exists (
      select 1 from group_join_requests r
      where r.group_id = v_group.id and r.user_id = auth.uid() and r.status = 'pending'
    );
end;
$$;

-- Join-request approve/deny (PHILOI_UI_SPEC.md §14) — each checks ownership itself so it's
-- safe to call directly (no separate "internal" helper needed); approve_all/update_privacy's
-- auto-approve-on-open both just loop calling approve_join_request().
create or replace function approve_join_request(p_request_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_req group_join_requests;
  v_owner_id uuid;
  v_group_name text;
begin
  select * into v_req from group_join_requests where id = p_request_id and status = 'pending';
  if v_req.id is null then
    return; -- already handled or gone — approve_all's loop snapshot can race a single approve/deny
  end if;

  select owner_id, name into v_owner_id, v_group_name from groups where id = v_req.group_id;
  if v_owner_id is distinct from auth.uid() then
    raise exception 'Only the owner can approve join requests.';
  end if;

  insert into group_members (group_id, user_id, role)
  values (v_req.group_id, v_req.user_id, 'member')
  on conflict (group_id, user_id) do nothing;

  update group_join_requests set status = 'approved' where id = v_req.id;

  perform notify_push(
    array[v_req.user_id],
    v_group_name,
    'You''re in 🔥 ' || coalesce(v_group_name, 'the campfire'),
    jsonb_build_object('type', 'join_request_approved', 'group_id', v_req.group_id)
  );
end;
$$;

create or replace function deny_join_request(p_request_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group_id uuid;
  v_owner_id uuid;
begin
  select r.group_id, g.owner_id into v_group_id, v_owner_id
  from group_join_requests r join groups g on g.id = r.group_id
  where r.id = p_request_id and r.status = 'pending';

  if v_group_id is null then
    return;
  end if;
  if v_owner_id is distinct from auth.uid() then
    raise exception 'Only the owner can deny join requests.';
  end if;

  update group_join_requests set status = 'denied' where id = p_request_id;
end;
$$;

create or replace function approve_all_join_requests(p_group_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner_id uuid;
  v_req_id uuid;
begin
  select owner_id into v_owner_id from groups where id = p_group_id;
  if v_owner_id is distinct from auth.uid() then
    raise exception 'Only the owner can approve join requests.';
  end if;

  for v_req_id in select id from group_join_requests where group_id = p_group_id and status = 'pending' loop
    perform approve_join_request(v_req_id);
  end loop;
end;
$$;

-- Owner-only requests list for mock 22 — context line surfaces the requester's school + one
-- other circle they share with the viewing owner (a real, queryable signal); "mutual friends"
-- from the mock has no backing data (no friend-graph exists in this schema) and is
-- deliberately left out rather than fabricated.
create or replace function list_join_requests(p_group_id uuid)
returns table (
  id uuid,
  user_id uuid,
  display_name text,
  handle text,
  university text,
  shared_circle_name text,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_owner_id uuid;
begin
  select owner_id into v_owner_id from groups where id = p_group_id;
  if v_owner_id is null then
    raise exception 'Campfire not found.';
  end if;
  if v_owner_id is distinct from auth.uid() then
    raise exception 'Only the owner can view join requests.';
  end if;

  return query
  select
    r.id,
    r.user_id,
    p.display_name,
    p.handle,
    p.university,
    (
      select g2.name from group_members gm1
      join group_members gm2 on gm1.group_id = gm2.group_id
      join groups g2 on g2.id = gm1.group_id
      where gm1.user_id = r.user_id and gm2.user_id = auth.uid() and gm1.group_id <> p_group_id
      limit 1
    ) as shared_circle_name,
    r.created_at
  from group_join_requests r
  join profiles p on p.id = r.user_id
  where r.group_id = p_group_id and r.status = 'pending'
  order by r.created_at asc;
end;
$$;

-- Privacy is changeable any time, owner-only (PHILOI_UI_SPEC.md §14's transitions: -> Open
-- auto-approves pending requests; -> Private just removes it from the valley query above
-- (existing members + code untouched); -> Gated starts collecting, no side effect needed here).
create or replace function update_campfire_privacy(p_group_id uuid, p_privacy text)
returns groups
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner_id uuid;
  v_group groups;
  v_req_id uuid;
begin
  if p_privacy not in ('open', 'gated', 'private') then
    raise exception 'Invalid campfire privacy.';
  end if;

  select owner_id into v_owner_id from groups where id = p_group_id;
  if v_owner_id is distinct from auth.uid() then
    raise exception 'Only the owner can change campfire privacy.';
  end if;

  update groups set privacy = p_privacy where id = p_group_id returning * into v_group;

  if p_privacy = 'open' then
    for v_req_id in select id from group_join_requests where group_id = p_group_id and status = 'pending' loop
      perform approve_join_request(v_req_id);
    end loop;
  end if;

  return v_group;
end;
$$;

-- Backfill existing check-ins using CURRENT membership as a best-effort stand-in for "were
-- they a member at post time" (exact historical join-vs-post ordering isn't recoverable) —
-- this preserves what's already correctly visible today without perpetuating the bug going
-- forward, since every check-in from here on gets a real point-in-time snapshot via the
-- trigger above.
do $$
begin
  if not exists (select 1 from _migrations where name = 'check_in_circles_backfill_v1') then
    insert into check_in_circles (check_in_id, circle_id, posted_at)
    select ci.id, gm.group_id, ci.created_at
    from check_ins ci
    join group_members gm on gm.user_id = ci.user_id
    on conflict (check_in_id, circle_id) do nothing;
    insert into _migrations (name) values ('check_in_circles_backfill_v1');
  end if;
end $$;

-- analytics_top_circles: check-ins and members each aggregated in their own subquery,
-- then left-joined to groups. (A previous version joined check_ins to group_members on
-- user_id alone, with no per-circle scoping on either side — every member's entire
-- check-in history, across every circle they're in, got attributed to each circle they
-- belonged to, inflating check_ins_7d/check_ins_total by roughly member_count.) Check-ins
-- no longer carry a group_id directly (goals refactor — a check-in belongs to a personal
-- goal); circle attribution goes through check_in_circles, the same point-in-time fan-out
-- table the circle Feed tab reads from — which is why this view has to live down here,
-- after check_in_circles exists. Also excludes admin/test/demo accounts (profiles.is_admin /
-- is_test / is_demo) from both check-ins and membership counts, same as every other analytics_*
-- view — this is what decides whether the beta is self-sustaining without the founder
-- poking it.
create or replace view analytics_top_circles as
with ci_agg as (
  select
    cic.circle_id as group_id,
    count(*) filter (where ci.created_at >= now() - interval '7 days' and ci.removed_at is null) as check_ins_7d,
    count(*) filter (where ci.removed_at is null) as check_ins_total
  from check_in_circles cic
  join check_ins ci on ci.id = cic.check_in_id
  join profiles p on p.id = ci.user_id
  where not p.is_admin and not p.is_test and not p.is_demo
  group by cic.circle_id
),
mem_agg as (
  select gm.group_id, count(distinct gm.user_id) as member_count
  from group_members gm
  join profiles p on p.id = gm.user_id
  where not p.is_admin and not p.is_test and not p.is_demo
  group by gm.group_id
)
select
  g.id as group_id,
  g.name,
  g.emoji,
  coalesce(ci_agg.check_ins_7d, 0) as check_ins_7d,
  coalesce(ci_agg.check_ins_total, 0) as check_ins_total,
  coalesce(mem_agg.member_count, 0) as member_count
from groups g
left join ci_agg on ci_agg.group_id = g.id
left join mem_agg on mem_agg.group_id = g.id
order by check_ins_7d desc;

-- ───────────────────────────── challenge progress must reach the circle ─────────────────────────────
-- Bug: log_challenge_progress() only wrote a challenge_feed_events row on the one log call
-- that crossed the target — every incremental log before that updated challenges.progress
-- (which the leaderboard already reads live) but never showed up in the circle's feed at
-- all. Every log should post now, not just the one that finishes it.

alter table challenge_feed_events add column if not exists amount numeric;
alter table challenge_feed_events add column if not exists progress numeric;
alter table challenge_feed_events add column if not exists is_completion boolean not null default false;

create or replace function log_challenge_progress(p_challenge_id uuid, p_amount numeric, p_note text default null)
returns table (
  id uuid,
  user_id uuid,
  circle_id uuid,
  type text,
  label text,
  target numeric,
  unit text,
  period text,
  progress numeric,
  visibility text,
  period_start date,
  completed_at timestamptz,
  created_at timestamptz,
  just_completed boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_challenge challenges;
  v_was_complete boolean;
  v_group_name text;
  v_poster_name text;
  v_recipient_ids uuid[];
begin
  select * into v_challenge from challenges where challenges.id = p_challenge_id and challenges.user_id = auth.uid();
  if v_challenge.id is null then
    raise exception 'Challenge not found.';
  end if;

  insert into challenge_logs (challenge_id, user_id, amount, note)
  values (p_challenge_id, auth.uid(), p_amount, p_note);

  v_was_complete := v_challenge.completed_at is not null;

  update challenges
  set progress = challenges.progress + p_amount,
      completed_at = case
        when challenges.completed_at is null and challenges.progress + p_amount >= challenges.target then now()
        else challenges.completed_at
      end
  where challenges.id = p_challenge_id
  returning * into v_challenge;

  if v_challenge.circle_id is not null and v_challenge.visibility = 'circle' then
    insert into challenge_feed_events
      (group_id, user_id, challenge_id, challenge_type, challenge_label, target, unit, amount, progress, is_completion)
    values (
      v_challenge.circle_id, auth.uid(), v_challenge.id, v_challenge.type, v_challenge.label, v_challenge.target, v_challenge.unit,
      p_amount, v_challenge.progress, (not v_was_complete and v_challenge.completed_at is not null)
    );

    if not v_was_complete and v_challenge.completed_at is not null then
      select name into v_group_name from groups where groups.id = v_challenge.circle_id;
      select display_name into v_poster_name from profiles where profiles.id = auth.uid();

      select coalesce(array_agg(gm.user_id), '{}')
      into v_recipient_ids
      from group_members gm
      where gm.group_id = v_challenge.circle_id and gm.user_id <> auth.uid();

      if array_length(v_recipient_ids, 1) > 0 then
        perform notify_push(
          v_recipient_ids,
          v_group_name,
          coalesce(v_poster_name, 'Someone') || ' just hit their ' || coalesce(v_challenge.label, v_challenge.type) || ' challenge 🎯',
          jsonb_build_object('type', 'challenge_completed', 'group_id', v_challenge.circle_id)
        );
      end if;
    end if;
  end if;

  return query select
    v_challenge.id, v_challenge.user_id, v_challenge.circle_id, v_challenge.type, v_challenge.label,
    v_challenge.target, v_challenge.unit, v_challenge.period, v_challenge.progress, v_challenge.visibility,
    v_challenge.period_start, v_challenge.completed_at, v_challenge.created_at,
    (not v_was_complete and v_challenge.completed_at is not null);
end;
$$;

-- ───────────────────────────── lock-in sessions ─────────────────────────────
-- Core-loop pivot: timed "lock in" sessions (one-tap start/stop, solo or with friends,
-- photo optional) alongside the original photo check-ins, not replacing them. This table
-- only holds the IN-PROGRESS phase — once a session is stopped, stop_lock_in_session()
-- below converts it into an ordinary check_ins row (duration_seconds set instead of/beside
-- a photo), which means streak recompute, circle fan-out (check_in_circles), the
-- one-per-day dedup, feed rendering, and RLS are all inherited from the existing check-in
-- pipeline for free — nothing new to build for the "posted" side, only the "active" side.
create table if not exists lock_in_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles (id) on delete cascade,
  goal_id uuid not null references goals (id) on delete cascade,
  started_at timestamptz not null default now(),
  last_confirmed_at timestamptz not null default now(),
  reminder_sent_at timestamptz,
  status text not null default 'active' check (status in ('active', 'completed', 'abandoned')),
  ended_check_in_id uuid references check_ins (id) on delete set null,
  created_at timestamptz not null default now()
);

-- At most one active session per user — start_lock_in_session() relies on this to reject a
-- second concurrent start with a friendly error rather than silently orphaning the first.
create unique index if not exists lock_in_sessions_one_active_per_user
  on lock_in_sessions (user_id) where status = 'active';

create index if not exists lock_in_sessions_active_idx
  on lock_in_sessions (status, last_confirmed_at) where status = 'active';

-- ───────────────────────────── core lock-in loop rebuild (PHILOI_UI_SPEC.md §12) ─────────
-- Goals stop being a persisted per-user record you check into — you pick a TYPE + optional
-- detail EACH TIME you lock in, no cadence, no once-a-day cap. check_ins/lock_in_sessions
-- decouple from `goals`: goal_id goes nullable everywhere and a plain goal_type/goal_detail
-- pair carries what a check-in or session is "for" going forward (goal_id/goal_label stay
-- populated only for old, pre-rebuild rows).
alter table check_ins alter column goal_id drop not null;
alter table check_ins add column if not exists goal_detail text;

-- "Lock in as often as you want" directly contradicts a one-per-goal-per-day unique index —
-- drop it outright, do not recreate in any form.
drop index if exists check_ins_one_per_day;

drop policy if exists "check_ins: insert own if goal owned" on check_ins;
create policy "check_ins: insert own if goal owned" on check_ins for insert with check (
  user_id = auth.uid()
  and (goal_id is null or exists (select 1 from goals where id = goal_id and user_id = auth.uid() and archived_at is null))
);

alter table lock_in_sessions alter column goal_id drop not null;
alter table lock_in_sessions add column if not exists goal_type text;
alter table lock_in_sessions add column if not exists goal_detail text;
-- solo-vs-campfire flag: null = solo, set = the one campfire this session is attached to.
-- on delete set null (not cascade) — a deleted circle detaches an in-progress session to
-- solo rather than destroying it.
alter table lock_in_sessions add column if not exists circle_id uuid references groups (id) on delete set null;

-- Backfill goal_type for any still-active/historical session rows before constraining NOT NULL.
update lock_in_sessions ls
set goal_type = g.type, goal_detail = g.label
from goals g
where ls.goal_id = g.id and ls.goal_type is null;

alter table lock_in_sessions alter column goal_type set not null;

alter table lock_in_sessions enable row level security;

-- Same "own rows + circle-mates' rows" shape as check_ins' "read if circle-mate" policy —
-- this is what powers the ambient "who's locked in right now" presence with zero new
-- authorization logic, just the existing is_circle_mate_of() helper.
drop policy if exists "lock_in_sessions: read if circle-mate" on lock_in_sessions;
create policy "lock_in_sessions: read if circle-mate" on lock_in_sessions for select using (
  user_id = auth.uid() or is_circle_mate_of(user_id)
);

-- No insert/update/delete policy for regular users — every write goes through the
-- security-definer RPCs below, same server-trusted-write pattern as challenge_logs.

-- Signature changed (a persisted goal_id -> a plain goal_type/detail/circle) — drop first,
-- same treatment every signature change in this file gets.
drop function if exists start_lock_in_session(uuid);
drop function if exists start_lock_in_session(text, text, uuid);
create function start_lock_in_session(
  p_goal_type text,
  p_goal_detail text default null,
  p_circle_id uuid default null
)
returns lock_in_sessions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session lock_in_sessions;
  v_last_check_in timestamptz;
begin
  if p_circle_id is not null and not is_group_member(p_circle_id) then
    raise exception 'Not a member of that campfire.';
  end if;

  if exists (select 1 from lock_in_sessions where user_id = auth.uid() and status = 'active') then
    raise exception 'You''re already locked in — stop that session first.';
  end if;

  -- No rapid stop/start stacking (migration 0033) — the unique index above already blocks a
  -- second CONCURRENT session; this closes the gap it leaves open (starting a fresh one the
  -- instant the last one ended). Placeholder window, same as the anti-farming floors elsewhere.
  select max(created_at) into v_last_check_in
  from check_ins
  where user_id = auth.uid() and duration_seconds is not null and removed_at is null;

  if v_last_check_in is not null and v_last_check_in > now() - interval '3 minutes' then
    raise exception 'Take a short breather before your next lock-in.';
  end if;

  insert into lock_in_sessions (user_id, goal_type, goal_detail, circle_id)
  values (auth.uid(), p_goal_type, p_goal_detail, p_circle_id)
  returning * into v_session;

  return v_session;
end;
$$;

-- Manual-only heartbeat — per spec, there's no auto-confirm on app foreground, the user has
-- to actually tap "still here" in response to notify_stale_lock_ins()'s reminder. Clears
-- reminder_sent_at so a renewed session gets a fresh reminder after another hour, not an
-- immediate second one.
create or replace function confirm_lock_in_session(p_session_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update lock_in_sessions
  set last_confirmed_at = now(), reminder_sent_at = null
  where id = p_session_id and user_id = auth.uid() and status = 'active';
end;
$$;

-- Photos during lock-in sessions — several photos can be captured mid-session (bounced
-- around on the client while active, purely local — never synced to other users), uploaded
-- as a batch and attached to the resulting check_ins row only when the session is stopped.
-- One session still equals exactly one feed post — check_in_circles' fan-out is untouched —
-- it just carries a gallery instead of a single photo.
create table if not exists check_in_photos (
  id uuid primary key default gen_random_uuid(),
  check_in_id uuid not null references check_ins (id) on delete cascade,
  photo_url text not null,
  position int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists check_in_photos_check_in_idx on check_in_photos (check_in_id, position);

alter table check_in_photos enable row level security;

-- Same "own rows + circle-mates' rows" shape as check_ins itself — joins back to check_ins
-- to reuse is_circle_mate_of() rather than duplicating visibility logic on a table that has
-- no user_id of its own.
drop policy if exists "check_in_photos: read if circle-mate" on check_in_photos;
create policy "check_in_photos: read if circle-mate" on check_in_photos for select using (
  exists (
    select 1 from check_ins ci
    where ci.id = check_in_photos.check_in_id
      and (ci.user_id = auth.uid() or is_circle_mate_of(ci.user_id) or is_admin())
  )
);

-- No insert/update/delete policy for regular users — rows are only ever written inside
-- stop_lock_in_session() (security definer), same trusted-write pattern as check_ins/
-- lock_in_sessions/check_in_circles themselves. No Storage-bucket policy change is needed
-- either: check-in-photos' existing upload/read policies and delete_my_account()'s cleanup
-- query all key off (storage.foldername(name))[1] = auth.uid(), so the deeper per-photo path
-- (userId/checkInId/index.jpg) used here is already covered.

-- Gym's proof-of-effort (migration 0033, reward-design rules) — same shape/pattern as
-- check_in_photos: entries are captured locally while a gym lock-in is active, then written as
-- a batch when the session stops. A gym lock-in that's meant to count for something (a
-- challenge) needs logged work, not just a running clock — see check_in_qualifies_for_challenge.
create table if not exists check_in_workout_sets (
  id uuid primary key default gen_random_uuid(),
  check_in_id uuid not null references check_ins (id) on delete cascade,
  exercise text not null,
  sets int not null check (sets > 0),
  reps int not null check (reps > 0),
  weight numeric check (weight >= 0),
  position int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists check_in_workout_sets_check_in_idx on check_in_workout_sets (check_in_id, position);

alter table check_in_workout_sets enable row level security;

drop policy if exists "check_in_workout_sets: read if circle-mate" on check_in_workout_sets;
create policy "check_in_workout_sets: read if circle-mate" on check_in_workout_sets for select using (
  exists (
    select 1 from check_ins ci
    where ci.id = check_in_workout_sets.check_in_id
      and (ci.user_id = auth.uid() or is_circle_mate_of(ci.user_id) or is_admin())
  )
);
-- No insert/update/delete policy for regular users — written only inside
-- stop_lock_in_session() (security definer), same trusted-write pattern as check_in_photos.

-- Converts an active session into a check_ins row (duration_seconds set, photos/caption
-- optional) — this insert fires the existing on_check_in_insert trigger
-- (handle_check_in_insert -> recompute_goal_streak + xp_earned) and
-- on_check_in_insert_snapshot_circles trigger (circle fan-out) automatically.
-- Parameter list changed (one photo -> an ordered array, then again to add workout sets in
-- migration 0033) vs. the original version, so this gets the defensive drop-first treatment
-- that get_my_ranks() taught us to use for any signature change, not just a bare CREATE OR REPLACE.
drop function if exists stop_lock_in_session(uuid, text, text);
drop function if exists stop_lock_in_session(uuid, text[], text);

create or replace function stop_lock_in_session(
  p_session_id uuid,
  p_photo_urls text[] default null,   -- ordered Storage paths; null/empty = no photos
  p_caption text default null,
  p_workout_sets jsonb default null   -- [{exercise, sets, reps, weight?}], gym lock-ins only
)
returns check_ins
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session lock_in_sessions;
  v_check_in check_ins;
  v_first_photo text;
  i int;
begin
  select * into v_session from lock_in_sessions
  where id = p_session_id and user_id = auth.uid() and status = 'active';

  if v_session.id is null then
    raise exception 'Session not found or already stopped.';
  end if;

  -- check_ins.photo_url keeps the FIRST photo for back-compat with anything still reading
  -- it directly (e.g. admin/moderation photo previews) — the full ordered set always also
  -- lands in check_in_photos below, which is the single source of truth for the feed gallery.
  v_first_photo := case when p_photo_urls is not null and array_length(p_photo_urls, 1) > 0
    then p_photo_urls[1] else null end;

  insert into check_ins (goal_id, goal_type, goal_detail, user_id, photo_url, caption, duration_seconds, status)
  values (
    null, v_session.goal_type, v_session.goal_detail, auth.uid(), v_first_photo, p_caption,
    greatest(extract(epoch from now() - v_session.started_at)::integer, 1),
    'on_time'
  )
  returning * into v_check_in;

  if p_photo_urls is not null then
    for i in 1 .. array_length(p_photo_urls, 1) loop
      insert into check_in_photos (check_in_id, photo_url, position)
      values (v_check_in.id, p_photo_urls[i], i - 1);
    end loop;
  end if;

  if p_workout_sets is not null and jsonb_array_length(p_workout_sets) > 0 then
    for i in 0 .. jsonb_array_length(p_workout_sets) - 1 loop
      insert into check_in_workout_sets (check_in_id, exercise, sets, reps, weight, position)
      values (
        v_check_in.id,
        p_workout_sets -> i ->> 'exercise',
        (p_workout_sets -> i ->> 'sets')::int,
        (p_workout_sets -> i ->> 'reps')::int,
        (p_workout_sets -> i ->> 'weight')::numeric,
        i
      );
    end loop;
  end if;

  update lock_in_sessions
  set status = 'completed', ended_check_in_id = v_check_in.id
  where id = v_session.id;

  -- handle_check_in_insert() is an AFTER INSERT trigger, so the INSERT's RETURNING clause
  -- above captured the row as it was BEFORE that trigger's xp_earned UPDATE ran — re-fetch
  -- to hand the client the real computed value instead of the pre-trigger default 0.
  select * into v_check_in from check_ins where id = v_check_in.id;

  return v_check_in;
end;
$$;

-- Explicit "Post to the campfire" action (PHILOI_UI_SPEC.md §13's done screen) — writes the
-- already-computed lock-in event (duration/XP/photos already on the row from stop_lock_in_
-- session) into one specific circle's chain. Not a trigger: the user decides this AFTER
-- seeing the recap, not automatically at Stop time. "Keep this one private" just never calls
-- this — circle_id stays null forever.
create or replace function post_check_in_to_circle(p_check_in_id uuid, p_circle_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_group_member(p_circle_id) then
    raise exception 'Not a member of that circle.';
  end if;

  update check_ins
  set circle_id = p_circle_id
  where id = p_check_in_id and user_id = auth.uid() and circle_id is null;

  if not found then
    raise exception 'Check-in not found, not yours, or already posted.';
  end if;

  insert into check_in_circles (check_in_id, circle_id)
  values (p_check_in_id, p_circle_id)
  on conflict do nothing;
end;
$$;

-- Anti-cheese sweep — cron-only (not a trigger), same shape as notify_streaks_at_risk().
-- Two-stage: (1) an active session gone quiet for an hour gets a push asking if the user's
-- still there; (2) if they don't respond within a further grace window, the session
-- auto-finalizes crediting only time up to the LAST CONFIRMATION, not the full elapsed
-- time — this is what actually stops "left the timer running overnight" from farming XP,
-- not the notification itself (which is just the prompt).
create or replace function notify_stale_lock_ins()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  v_check_in check_ins;
begin
  -- Stage 1: send the "still here?" reminder once per staleness episode.
  for r in
    select id, user_id from lock_in_sessions
    where status = 'active'
      and reminder_sent_at is null
      and last_confirmed_at < now() - interval '1 hour'
  loop
    perform notify_push(
      array[r.user_id],
      'Still locked in?',
      'Your session''s been going a while — tap to keep it going.',
      jsonb_build_object('type', 'lockin_still_here', 'session_id', r.id),
      'accountability'
    );
    update lock_in_sessions set reminder_sent_at = now() where id = r.id;
  end loop;

  -- Stage 2: no response to the reminder within the grace window -> auto-finalize, capped
  -- at last_confirmed_at (before the unconfirmed dead time started).
  for r in
    select * from lock_in_sessions
    where status = 'active'
      and reminder_sent_at is not null
      and reminder_sent_at < now() - interval '20 minutes'
  loop
    insert into check_ins (goal_id, goal_type, goal_detail, user_id, photo_url, duration_seconds, status)
    values (
      null, r.goal_type, r.goal_detail, r.user_id, null,
      greatest(extract(epoch from r.last_confirmed_at - r.started_at)::integer, 1),
      'on_time'
    )
    returning * into v_check_in;

    update lock_in_sessions
    set status = 'abandoned', ended_check_in_id = v_check_in.id
    where id = r.id;
  end loop;
end;
$$;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'philoi-lockin-liveness-check') then
    perform cron.unschedule('philoi-lockin-liveness-check');
  end if;
end $$;

select cron.schedule(
  'philoi-lockin-liveness-check',
  '*/5 * * * *',
  $$select notify_stale_lock_ins();$$
);

-- ============================================================================
-- Friend graph (PHILOI_UI_SPEC.md §4b/§16, design-mocks/21/34/35) — a friend is an explicit
-- mutual add (send -> accept/decline), NOT campfire co-membership. One row per pair: a pending
-- request and an accepted friendship are the same row, just a different `status` — accepting
-- flips it in place instead of inserting a second row. The unique index is built on the pair
-- regardless of direction (least/greatest), so an A->B and a B->A row can never coexist.
-- ============================================================================
create table if not exists friend_requests (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null references profiles(id) on delete cascade,
  recipient_id uuid not null references profiles(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted')),
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  constraint friend_requests_no_self check (requester_id <> recipient_id)
);

create unique index if not exists friend_requests_pair_idx on friend_requests (
  least(requester_id, recipient_id), greatest(requester_id, recipient_id)
);
create index if not exists friend_requests_recipient_idx on friend_requests (recipient_id, status);
create index if not exists friend_requests_requester_idx on friend_requests (requester_id, status);

alter table friend_requests enable row level security;

drop policy if exists "friend_requests: read own" on friend_requests;
create policy "friend_requests: read own" on friend_requests for select using (
  auth.uid() = requester_id or auth.uid() = recipient_id
);

-- Search by @handle or display name (design-mocks/35) — reports each result's current
-- relationship state so the client renders the exact right button (Add / Requested / Accept /
-- Friends) per the state machine, without a second round-trip per row.
create or replace function search_people(p_query text, p_limit int default 20)
returns table (
  user_id uuid,
  display_name text,
  handle text,
  university text,
  avatar_url text,
  relationship text, -- 'none' | 'requested' | 'incoming' | 'friends'
  mutual_circle_name text
)
language sql
security definer
set search_path = public
stable
as $$
  with matches as (
    select p.id, p.display_name, p.handle, p.university, p.avatar_url
    from profiles p
    where p.id <> auth.uid()
      and not p.is_demo and not p.is_disabled
      and (p.handle ilike '%' || p_query || '%' or p.display_name ilike '%' || p_query || '%')
    order by
      (p.handle = p_query) desc,
      (p.handle ilike p_query || '%') desc,
      p.display_name asc
    limit p_limit
  ),
  rel as (
    select fr.requester_id, fr.recipient_id, fr.status
    from friend_requests fr
    where fr.requester_id = auth.uid() or fr.recipient_id = auth.uid()
  )
  select
    m.id,
    m.display_name,
    m.handle,
    m.university,
    m.avatar_url,
    case
      when r.status = 'accepted' then 'friends'
      when r.status = 'pending' and r.requester_id = auth.uid() then 'requested'
      when r.status = 'pending' and r.recipient_id = auth.uid() then 'incoming'
      else 'none'
    end as relationship,
    (
      select g.name from group_members gm1
      join group_members gm2 on gm2.group_id = gm1.group_id and gm2.user_id = m.id
      join groups g on g.id = gm1.group_id
      where gm1.user_id = auth.uid()
      limit 1
    ) as mutual_circle_name
  from matches m
  left join rel r on (r.requester_id = auth.uid() and r.recipient_id = m.id)
                   or (r.recipient_id = auth.uid() and r.requester_id = m.id)
  order by m.display_name;
$$;

-- "Suggested · from your campfires" (design-mocks/35) — people who share a campfire with you and
-- aren't already friends/pending.
create or replace function suggested_people(p_limit int default 10)
returns table (
  user_id uuid,
  display_name text,
  handle text,
  avatar_url text,
  mutual_circle_name text
)
language sql
security definer
set search_path = public
stable
as $$
  select distinct on (p.id)
    p.id,
    p.display_name,
    p.handle,
    p.avatar_url,
    g.name
  from group_members gm1
  join group_members gm2 on gm2.group_id = gm1.group_id and gm2.user_id <> auth.uid()
  join groups g on g.id = gm1.group_id
  join profiles p on p.id = gm2.user_id and not p.is_demo and not p.is_disabled
  where gm1.user_id = auth.uid()
    and not exists (
      select 1 from friend_requests fr
      where (fr.requester_id = auth.uid() and fr.recipient_id = p.id)
         or (fr.recipient_id = auth.uid() and fr.requester_id = p.id)
    )
  order by p.id
  limit p_limit;
$$;

create or replace function send_friend_request(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_user_id = auth.uid() then
    raise exception 'You can''t friend yourself.';
  end if;
  if exists (
    select 1 from friend_requests
    where (requester_id = auth.uid() and recipient_id = p_user_id)
       or (requester_id = p_user_id and recipient_id = auth.uid())
  ) then
    raise exception 'A request already exists between you two.';
  end if;

  insert into friend_requests (requester_id, recipient_id, status)
  values (auth.uid(), p_user_id, 'pending');
end;
$$;

-- Accept or decline an INCOMING request. Declining deletes the row outright — back to 'none'.
create or replace function respond_friend_request(p_user_id uuid, p_accept boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_accept then
    update friend_requests
    set status = 'accepted', responded_at = now()
    where requester_id = p_user_id and recipient_id = auth.uid() and status = 'pending';
  else
    delete from friend_requests
    where requester_id = p_user_id and recipient_id = auth.uid() and status = 'pending';
  end if;

  if not found then
    raise exception 'No pending request from that person.';
  end if;
end;
$$;

-- Cancel an OUTGOING request you sent (requested -> none).
create or replace function cancel_friend_request(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from friend_requests
  where requester_id = auth.uid() and recipient_id = p_user_id and status = 'pending';

  if not found then
    raise exception 'No pending request to that person.';
  end if;
end;
$$;

create or replace function get_pending_friend_requests()
returns table (
  request_user_id uuid,
  display_name text,
  handle text,
  avatar_url text,
  direction text, -- 'incoming' | 'sent'
  mutual_count int,
  mutual_circle_name text
)
language sql
security definer
set search_path = public
stable
as $$
  with my_friends as (
    select case when requester_id = auth.uid() then recipient_id else requester_id end as uid
    from friend_requests
    where status = 'accepted' and (requester_id = auth.uid() or recipient_id = auth.uid())
  ),
  pending as (
    select
      case when recipient_id = auth.uid() then requester_id else recipient_id end as uid,
      case when recipient_id = auth.uid() then 'incoming' else 'sent' end as direction,
      created_at
    from friend_requests
    where status = 'pending' and (requester_id = auth.uid() or recipient_id = auth.uid())
  )
  select
    pending.uid as request_user_id,
    p.display_name,
    p.handle,
    p.avatar_url,
    pending.direction,
    (
      select count(*)::int
      from friend_requests fr2
      join my_friends mf
        on mf.uid = case when fr2.requester_id = pending.uid then fr2.recipient_id else fr2.requester_id end
      where fr2.status = 'accepted' and (fr2.requester_id = pending.uid or fr2.recipient_id = pending.uid)
    ) as mutual_count,
    (
      select g.name from group_members gm1
      join group_members gm2 on gm2.group_id = gm1.group_id and gm2.user_id = pending.uid
      join groups g on g.id = gm1.group_id
      where gm1.user_id = auth.uid()
      limit 1
    ) as mutual_circle_name
  from pending
  join profiles p on p.id = pending.uid
  order by pending.created_at desc;
$$;

-- Everyone you're actually (mutually) friends with — sourced from accepted friendships, not
-- campfire co-membership. shared_circle_id/name are nullable: two real friends may share no
-- campfire at all (§16's H2H reconciliation — friend-to-friend, no campfire required).
create or replace function get_my_friends()
returns table (
  friend_id uuid,
  display_name text,
  avatar_url text,
  tier text,
  division int,
  current_streak int,
  last_lockin_at timestamptz,
  shared_circle_id uuid,
  shared_circle_name text
)
language sql
security definer
set search_path = public
stable
as $$
  with fr as (
    select case when requester_id = auth.uid() then recipient_id else requester_id end as uid
    from friend_requests
    where status = 'accepted' and (requester_id = auth.uid() or recipient_id = auth.uid())
  )
  select
    p.id as friend_id,
    p.display_name,
    p.avatar_url,
    r.tier,
    r.division,
    p.current_streak,
    (
      select max(ci.created_at)
      from check_ins ci
      where ci.user_id = p.id and ci.duration_seconds > 0 and ci.removed_at is null
    ) as last_lockin_at,
    shared.circle_id as shared_circle_id,
    shared.circle_name as shared_circle_name
  from fr
  join profiles p on p.id = fr.uid
  cross join lateral rank_tier_for_score(universal_score(p.id)) r
  left join lateral (
    select g.id as circle_id, g.name as circle_name
    from group_members gm1
    join group_members gm2 on gm2.group_id = gm1.group_id and gm2.user_id = p.id
    join groups g on g.id = gm1.group_id
    where gm1.user_id = auth.uid()
    limit 1
  ) shared on true
  order by p.display_name;
$$;

-- One-tap "nudge to lock in" (design-mocks/21) — fires a push only; tapping it deep-links into
-- the lock-in goal picker (handled app-side by the 'lock_in_nudge' type). Gated to real friends.
create or replace function nudge_to_lock_in(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sender text;
begin
  if p_user_id = auth.uid() then
    raise exception 'You can''t nudge yourself.';
  end if;
  if not exists (
    select 1 from friend_requests
    where status = 'accepted'
      and ((requester_id = auth.uid() and recipient_id = p_user_id)
        or (requester_id = p_user_id and recipient_id = auth.uid()))
  ) then
    raise exception 'You can only nudge friends.';
  end if;

  select display_name into v_sender from profiles where id = auth.uid();

  perform notify_push(
    array[p_user_id],
    'Lock in?',
    coalesce(v_sender, 'A friend') || ' pinged you to lock in 🔥',
    jsonb_build_object('type', 'lock_in_nudge', 'from_user_id', auth.uid()),
    'accountability'
  );
end;
$$;

-- ============================================================================
-- Strava integration (PHILOI_UI_SPEC.md §17, migration 0035) — cross-platform, OAuth-based.
-- The client secret never reaches the app: strava_connections is written ONLY by the
-- strava-oauth-exchange and strava-sync Supabase Edge Functions (service role), which are the
-- only things that ever see a Strava access/refresh token. The client only ever calls those two
-- functions and reads back get_my_strava_connection_status() — never the raw table.
-- ============================================================================

-- No RLS policies at all — deliberately. Every read/write goes through the Edge Functions
-- (service role, bypasses RLS) or the two RPCs below; the client never queries this table
-- directly, so there's no policy shape that would ever need to allow it a raw token.
create table if not exists strava_connections (
  user_id uuid primary key references profiles (id) on delete cascade,
  athlete_id bigint not null,
  access_token text not null,
  refresh_token text not null,
  expires_at timestamptz not null,
  connected_at timestamptz not null default now()
);

alter table strava_connections enable row level security;

-- Safe to expose to the owner: connected state + athlete id, never the tokens themselves.
create or replace function get_my_strava_connection_status()
returns table (connected boolean, athlete_id bigint)
language sql
security definer
set search_path = public
stable
as $$
  select
    exists (select 1 from strava_connections where user_id = auth.uid()) as connected,
    (select sc.athlete_id from strava_connections sc where sc.user_id = auth.uid()) as athlete_id;
$$;

-- Client-triggered disconnect — clears Philoi's own record only. This can't revoke the token on
-- Strava's side; that's the athlete's own Strava account settings (My Apps), same caveat as the
-- HealthKit/Health Connect "Disconnect" actions.
create or replace function disconnect_my_strava()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from strava_connections where user_id = auth.uid();
end;
$$;
