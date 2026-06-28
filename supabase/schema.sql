-- Philoi — core schema, RLS, and RPCs.
-- Run this whole file once in the Supabase SQL editor (or `supabase db push`
-- if you set up the CLI). Safe to re-run: every statement is idempotent.

create extension if not exists pgcrypto;

-- ───────────────────────────── tables ─────────────────────────────

create table if not exists profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  handle text unique,
  display_name text not null,
  avatar_url text,
  is_pro boolean not null default false,
  pro_until timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists groups (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  emoji text not null default '🔥',
  owner_id uuid not null references profiles (id) on delete cascade,
  join_code text not null unique default upper(substr(md5(random()::text), 1, 6)),
  goal_type text not null default 'custom' check (goal_type in ('gym', 'run', 'study', 'custom')),
  cadence text not null default '7x/week',
  created_at timestamptz not null default now()
);

create table if not exists group_members (
  group_id uuid not null references groups (id) on delete cascade,
  user_id uuid not null references profiles (id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'member')),
  joined_at timestamptz not null default now(),
  current_streak integer not null default 0,
  longest_streak integer not null default 0,
  primary key (group_id, user_id)
);

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

create index if not exists check_ins_group_created_idx on check_ins (group_id, created_at desc);
create index if not exists check_ins_user_group_idx on check_ins (user_id, group_id, created_at desc);
create index if not exists reactions_check_in_idx on reactions (check_in_id);

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

drop policy if exists "profiles: read any" on profiles;
create policy "profiles: read any" on profiles for select using (true);

drop policy if exists "profiles: update own" on profiles;
create policy "profiles: update own" on profiles for update using (id = auth.uid());

drop policy if exists "profiles: insert own" on profiles;
create policy "profiles: insert own" on profiles for insert with check (id = auth.uid());

drop policy if exists "groups: read if member" on groups;
create policy "groups: read if member" on groups for select using (is_group_member(id));

drop policy if exists "groups: insert as self" on groups;
create policy "groups: insert as self" on groups for insert with check (owner_id = auth.uid());

drop policy if exists "groups: owner can update" on groups;
create policy "groups: owner can update" on groups for update using (owner_id = auth.uid());

drop policy if exists "group_members: read if member" on group_members;
create policy "group_members: read if member" on group_members for select using (is_group_member(group_id));

drop policy if exists "group_members: insert self" on group_members;
create policy "group_members: insert self" on group_members for insert with check (user_id = auth.uid());

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
  p_cadence text
)
returns groups
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group groups;
begin
  insert into groups (name, emoji, owner_id, goal_type, cadence)
  values (p_name, coalesce(p_emoji, '🔥'), auth.uid(), p_goal_type, p_cadence)
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
    insert into invites (inviter_id, group_id) values (auth.uid(), null) returning code into v_code;
  end if;

  return v_code;
end;
$$;

create or replace function get_group_leaderboard(p_group_id uuid)
returns table (
  user_id uuid,
  handle text,
  display_name text,
  avatar_url text,
  is_pro boolean,
  current_streak integer,
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
