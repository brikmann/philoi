-- Philoi — core schema, RLS, and RPCs.
-- Run this whole file once in the Supabase SQL editor (or `supabase db push`
-- if you set up the CLI). Safe to re-run: every statement is idempotent.

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

create index if not exists check_ins_group_created_idx on check_ins (group_id, created_at desc);
create index if not exists check_ins_user_group_idx on check_ins (user_id, group_id, created_at desc);
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
create unique index if not exists check_ins_one_per_day
  on check_ins (group_id, user_id, ((created_at at time zone 'utc')::date));

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
create policy "groups: read if public" on groups for select using (is_public = true);

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

drop policy if exists "check_ins: read if member" on check_ins;
create policy "check_ins: read if member" on check_ins for select using (is_group_member(group_id));

drop policy if exists "check_ins: insert own if member" on check_ins;
create policy "check_ins: insert own if member" on check_ins for insert
  with check (user_id = auth.uid() and is_group_member(group_id));

drop policy if exists "reactions: read if member" on reactions;
create policy "reactions: read if member" on reactions for select using (
  exists (
    select 1 from check_ins
    where check_ins.id = reactions.check_in_id and is_group_member(check_ins.group_id)
  )
);

drop policy if exists "reactions: insert own if member" on reactions;
create policy "reactions: insert own if member" on reactions for insert with check (
  user_id = auth.uid()
  and exists (
    select 1 from check_ins
    where check_ins.id = reactions.check_in_id and is_group_member(check_ins.group_id)
  )
);

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

create or replace function create_group_with_owner(
  p_name text,
  p_emoji text,
  p_goal_type text,
  p_cadence text,
  p_is_public boolean default false
)
returns groups
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group groups;
begin
  insert into groups (name, emoji, owner_id, goal_type, cadence, is_public)
  values (p_name, coalesce(p_emoji, '🔥'), auth.uid(), p_goal_type, p_cadence, coalesce(p_is_public, false))
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

create or replace function join_public_group(p_group_id uuid)
returns groups
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group groups;
begin
  select * into v_group from groups where id = p_group_id and is_public = true;

  if v_group.id is null then
    raise exception 'That circle is not open for discovery.';
  end if;

  insert into group_members (group_id, user_id, role)
  values (v_group.id, auth.uid(), 'member')
  on conflict (group_id, user_id) do nothing;

  return v_group;
end;
$$;

-- Cold-start discovery: public circles the caller isn't already in yet,
-- ranked by same-university match first, then by goal type match, then recency.
create or replace function get_discoverable_groups(p_goal_type text default null, p_limit int default 20)
returns table (
  id uuid,
  name text,
  emoji text,
  goal_type text,
  cadence text,
  member_count bigint,
  owner_university text
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
    owner.university as owner_university
  from groups g
  join profiles owner on owner.id = g.owner_id
  where g.is_public = true
    and not exists (
      select 1 from group_members gm
      where gm.group_id = g.id and gm.user_id = auth.uid()
    )
    and (p_goal_type is null or g.goal_type = p_goal_type)
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

-- Dropped first: CREATE OR REPLACE can't change an existing function's RETURNS TABLE columns
-- (this file originally shipped get_group_leaderboard without goal_target).
drop function if exists get_group_leaderboard(uuid);

create function get_group_leaderboard(p_group_id uuid)
returns table (
  user_id uuid,
  handle text,
  display_name text,
  avatar_url text,
  is_pro boolean,
  current_streak integer,
  goal_target text,
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
    gm.current_streak,
    gm.goal_target,
    coalesce((
      select count(*) from check_ins ci
      where ci.group_id = p_group_id
        and ci.user_id = gm.user_id
        and ci.created_at >= date_trunc('week', now())
    ), 0) as check_ins_this_week
  from group_members gm
  join profiles p on p.id = gm.user_id
  where gm.group_id = p_group_id and is_group_member(p_group_id)
  order by gm.current_streak desc, check_ins_this_week desc, p.display_name asc;
$$;

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
    count(ci.id) as check_ins_this_week
  from group_members gm
  join groups g on g.id = gm.group_id
  left join check_ins ci on ci.group_id = gm.group_id
    and ci.user_id = p_user_id
    and ci.created_at >= date_trunc('week', now())
  where gm.user_id = p_user_id and p_user_id = auth.uid()
  group by g.id, g.name;
$$;

-- School-wide leaderboard: ranks every member.university match by their single best
-- active streak across any circle (not summed — joining lots of circles shouldn't itself
-- improve rank), tie-broken by total check-ins this week across all their circles.
create or replace function get_university_leaderboard(p_university text, p_limit int default 50)
returns table (
  user_id uuid,
  handle text,
  display_name text,
  avatar_url text,
  is_pro boolean,
  best_streak integer,
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
    coalesce((select max(gm.current_streak) from group_members gm where gm.user_id = p.id), 0) as best_streak,
    coalesce((
      select count(*) from check_ins ci
      where ci.user_id = p.id and ci.created_at >= date_trunc('week', now())
    ), 0) as check_ins_this_week
  from profiles p
  where p.university = p_university
  order by best_streak desc, check_ins_this_week desc, p.display_name asc
  limit p_limit;
$$;

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

-- ───────────────────────────── analytics views ─────────────────────────────
-- Query these from the Supabase SQL editor (service role bypasses RLS) — there's
-- no in-app dashboard for these on purpose. This is what decides when/how to charge.

create or replace view analytics_daily_signups as
select date_trunc('day', created_at)::date as day, count(*) as signups
from profiles
group by 1
order by 1;

create or replace view analytics_event_counts as
select name, date_trunc('day', created_at)::date as day, count(*) as count
from events
group by 1, 2
order by 2 desc, 1;

-- Per-signup-day-cohort D1/D7 retention. "Active" = fired any event on that calendar day.
create or replace view analytics_retention as
with signups as (
  select id as user_id, date_trunc('day', created_at)::date as signup_day
  from profiles
),
activity as (
  select user_id, date_trunc('day', created_at)::date as active_day
  from events
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
  (select count(*) from profiles) as total_signups,
  (select count(*) from events where name = 'invite_sent') as invites_sent,
  (select count(*) from events where name = 'invite_accepted') as invites_accepted,
  round(
    (select count(*) from events where name = 'invite_accepted')::numeric
    / greatest((select count(*) from profiles), 1),
    3
  ) as viral_coefficient;

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
  where t.user_id = any(p_user_ids);

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
  insert into groups (name, emoji, owner_id, goal_type, cadence, is_public)
  values ('Dev Test Circle', '🧪', auth.uid(), 'gym', '7x/week', false)
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

-- Clears the caller's own check-ins in one circle (or all circles if p_group_id is null) and
-- recomputes streaks, so onboarding/empty-state flows can be re-tested without a fresh account.
create or replace function dev_reset_my_checkins(p_group_id uuid default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
begin
  for r in
    select distinct group_id from check_ins
    where user_id = auth.uid() and (p_group_id is null or group_id = p_group_id)
  loop
    delete from check_ins where user_id = auth.uid() and group_id = r.group_id;
    perform recompute_streak(r.group_id, auth.uid());
  end loop;
end;
$$;

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
  type text not null check (type in ('steps', 'gym_visits', 'study_hours', 'custom')),
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
-- check_ins, so the one-check-in-per-day unique index and photo_url-not-null invariant on
-- check_ins stay untouched. The group screen's Feed tab merges this in alongside check-ins
-- client-side, ordered by created_at.
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

-- Per-user rank + streak snapshot across every circle they're in, for the global Leaderboards
-- tab's "My Circles" view — one round trip instead of N calls to get_group_leaderboard(),
-- ranked by the same rule (current_streak desc, check_ins_this_week desc) that
-- get_group_leaderboard() uses.
create or replace function get_my_circle_ranks()
returns table (
  group_id uuid,
  group_name text,
  group_emoji text,
  my_rank bigint,
  member_count bigint,
  current_streak integer,
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
      gm.current_streak,
      coalesce((
        select count(*) from check_ins ci
        where ci.group_id = gm.group_id and ci.user_id = gm.user_id and ci.created_at >= date_trunc('week', now())
      ), 0) as check_ins_this_week
    from group_members gm
    where is_group_member(gm.group_id)
  ),
  ranked as (
    select
      w.*,
      rank() over (partition by w.group_id order by w.current_streak desc, w.check_ins_this_week desc) as rnk,
      count(*) over (partition by w.group_id) as member_count
    from weekly w
  )
  select
    g.id as group_id,
    g.name as group_name,
    g.emoji as group_emoji,
    r.rnk as my_rank,
    r.member_count,
    r.current_streak,
    r.check_ins_this_week
  from ranked r
  join groups g on g.id = r.group_id
  where r.user_id = auth.uid()
  order by g.name;
$$;
