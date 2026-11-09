-- 0297 — Rooms: owners, moderators, code-gating, chat channels (ShareSpot ss1, SHARED §4, mock 384/375/380).
--
-- A Room IS a `groups` row (the campfire). Nothing is renamed in the schema; the app says "Room".
-- Everything here is ADDITIVE: new columns with defaults, one new table, new functions. No existing
-- function body is replaced, so installed builds keep calling exactly what they call today.
--
-- What already existed in prod (read live 2026-11-09) and is REUSED rather than re-invented:
--   · groups.join_code  — 6-char, unique, auto-generated. It is every campfire's invite code. It stays
--                          the room code; we do not add a second one.
--   · group_members.role — check (owner | admin | member). "Moderator" in the app == stored 'admin'.
--                          Adding a 'moderator' value would make every installed build treat mods as
--                          plain members (they test role = 'admin'), so the RPCs below accept
--                          'moderator' and store 'admin'. is_campfire_admin() already means owner|mod.
--   · groups.privacy    — open | gated (approve-to-join) | private (invite-only, hidden from non-members).
--   · messages RLS      — read/insert already require is_group_member(), so a code room's chat is
--                          members-only with no policy change.
--
-- THE LEAK THIS CLOSES BY CONSTRUCTION: groups.join_code is column-readable by anon/authenticated, and
-- "groups: read if public" exposes every open/gated row. A code-gated room whose row were readable
-- would hand its code to anyone with a select. So: join_policy = 'code' REQUIRES privacy = 'private'
-- (check constraint), which hides the row from non-members under the existing RLS. get_forest only
-- emits join_code for privacy = 'open'. Non-members learn about a code room only through
-- get_room_gate(), which never returns the code unless you are its owner or a moderator.
-- set_room_policy('code') also ROTATES the code, because the old one was publicly readable.

-- ── 1. Columns ────────────────────────────────────────────────────────────────────────────────────

alter table public.groups
  add column if not exists join_policy text not null default 'open';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'groups_join_policy_check') then
    alter table public.groups
      add constraint groups_join_policy_check check (join_policy in ('open', 'code'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'groups_code_policy_is_private') then
    alter table public.groups
      add constraint groups_code_policy_is_private check (join_policy = 'open' or privacy = 'private');
  end if;
end $$;

-- Discord-style channels (mock 380). A room's channel list; messages carry which one they're in.
alter table public.groups
  add column if not exists channels text[] not null default array['general']::text[];

alter table public.messages
  add column if not exists channel text not null default 'general';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'messages_channel_shape') then
    alter table public.messages
      add constraint messages_channel_shape check (channel ~ '^[a-z0-9][a-z0-9-]{0,23}$');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'groups_channels_shape') then
    alter table public.groups
      add constraint groups_channels_shape check (
        cardinality(channels) between 1 and 12 and 'general' = any(channels)
      );
  end if;
end $$;

create index if not exists messages_group_channel_created_idx
  on public.messages (group_id, channel, created_at desc);

-- An installed build inserts without `channel` (→ 'general'). A new build naming a channel the room
-- doesn't have lands in #general rather than failing the send.
create or replace function public.messages_channel_fallback()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if new.channel is null or new.channel = 'general' then
    new.channel := 'general';
    return new;
  end if;
  if not exists (select 1 from groups g where g.id = new.group_id and new.channel = any(g.channels)) then
    new.channel := 'general';
  end if;
  return new;
end;
$function$;

drop trigger if exists messages_channel_fallback on public.messages;
create trigger messages_channel_fallback
  before insert on public.messages
  for each row execute function public.messages_channel_fallback();

-- ── 2. Wrong-code attempts (rate limit) ───────────────────────────────────────────────────────────
-- 16^6 codes is guessable without a limit. 10 wrong tries per room per user per hour.

create table if not exists public.room_code_attempts (
  id bigint generated always as identity primary key,
  group_id uuid not null references public.groups(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  attempted_at timestamptz not null default now()
);
create index if not exists room_code_attempts_lookup_idx
  on public.room_code_attempts (user_id, group_id, attempted_at desc);
alter table public.room_code_attempts enable row level security;
revoke all on public.room_code_attempts from public, anon, authenticated;

-- ── 3. Helpers ────────────────────────────────────────────────────────────────────────────────────

create or replace function public.room_role_label(p_role text)
returns text
language sql
immutable
set search_path to 'public'
as $function$
  select case p_role when 'owner' then 'owner' when 'admin' then 'moderator' when 'member' then 'member' end;
$function$;

create or replace function public.new_room_code()
returns text
language plpgsql
volatile
set search_path to 'public'
as $function$
declare
  v_code text;
begin
  loop
    v_code := upper(substr(md5(random()::text || clock_timestamp()::text), 1, 6));
    exit when not exists (select 1 from groups g where g.join_code = v_code);
  end loop;
  return v_code;
end;
$function$;

create or replace function public.room_person_json(p_user_id uuid, p_role text)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $function$
  select jsonb_build_object(
    'user_id', p.id,
    'display_name', p.display_name,
    'handle', p.handle,
    'avatar_url', p.avatar_url,
    'role', room_role_label(p_role)
  )
  from profiles p where p.id = p_user_id;
$function$;

-- ── 4. get_room_gate — the gate screen (384) and the header role line (375) ──────────────────────
-- Readable by a non-member for: open/gated rooms, and code rooms (that's the point of the gate —
-- you see who runs it and can message them). A legacy invite-only private room (join_policy open,
-- privacy private) stays hidden: not_found, exactly like get_campfire_preview today.

create or replace function public.get_room_gate(p_room_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_me uuid := auth.uid();
  v_g groups;
  v_role text;
  v_is_admin boolean;
begin
  if v_me is null then
    raise exception 'Sign in first.';
  end if;

  select * into v_g from groups g where g.id = p_room_id;
  if v_g.id is null then
    return jsonb_build_object('status', 'not_found');
  end if;

  select gm.role into v_role from group_members gm where gm.group_id = v_g.id and gm.user_id = v_me;
  if v_g.owner_id = v_me then v_role := 'owner'; end if;
  v_is_admin := v_role in ('owner', 'admin');

  if v_role is null and v_g.privacy = 'private' and v_g.join_policy <> 'code' then
    return jsonb_build_object('status', 'not_found');
  end if;

  return jsonb_build_object(
    'status', 'ok',
    'room', jsonb_build_object(
      'id', v_g.id,
      'name', v_g.name,
      'emoji', v_g.emoji,
      'course_code', v_g.course_code,
      'school', v_g.school,
      'banner_item_id', v_g.banner_item_id,
      'privacy', v_g.privacy,
      'join_policy', v_g.join_policy,
      'channels', to_jsonb(v_g.channels),
      'standings_enabled', v_g.standings_enabled,
      'member_count', (select count(*) from group_members gm where gm.group_id = v_g.id)
    ),
    'my_role', room_role_label(v_role),
    'is_member', v_role is not null,
    'owner', room_person_json(v_g.owner_id, 'owner'),
    'moderators', coalesce((
      select jsonb_agg(room_person_json(gm.user_id, 'admin') order by gm.joined_at)
      from group_members gm
      where gm.group_id = v_g.id and gm.role = 'admin' and gm.user_id <> v_g.owner_id
    ), '[]'::jsonb),
    -- Only the people who hand the code out can see it.
    'code', case when v_is_admin then v_g.join_code end,
    'has_pending_request', exists (
      select 1 from group_join_requests r
      where r.group_id = v_g.id and r.user_id = v_me and r.status = 'pending'
    )
  );
end;
$function$;

-- ── 5. join_room ──────────────────────────────────────────────────────────────────────────────────
-- Returns {status, group_id}. status ∈ joined | already_member | requested | needs_code | wrong_code
--                                      | rate_limited | blocked | not_found

create or replace function public.join_room(p_room_id uuid, p_code text default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_me uuid := auth.uid();
  v_g groups;
  v_code text := nullif(upper(btrim(coalesce(p_code, ''))), '');
  v_wrong int;
begin
  if v_me is null then
    raise exception 'Sign in first.';
  end if;

  select * into v_g from groups g where g.id = p_room_id;
  if v_g.id is null then
    return jsonb_build_object('status', 'not_found', 'group_id', p_room_id);
  end if;

  if exists (select 1 from group_members gm where gm.group_id = v_g.id and gm.user_id = v_me) then
    return jsonb_build_object('status', 'already_member', 'group_id', v_g.id);
  end if;

  if not meets_campfire_gate(v_g.id, v_me) then
    return jsonb_build_object('status', 'blocked', 'group_id', v_g.id, 'min_join_tier', v_g.min_join_tier);
  end if;

  -- Code room, or a legacy invite-only private room: the code is the only way in.
  if v_g.join_policy = 'code' or v_g.privacy = 'private' then
    if v_code is null then
      return jsonb_build_object('status', 'needs_code', 'group_id', v_g.id);
    end if;

    select count(*) into v_wrong from room_code_attempts a
    where a.user_id = v_me and a.group_id = v_g.id and a.attempted_at > now() - interval '1 hour';
    if v_wrong >= 10 then
      return jsonb_build_object('status', 'rate_limited', 'group_id', v_g.id);
    end if;

    if v_code is distinct from v_g.join_code then
      insert into room_code_attempts (group_id, user_id) values (v_g.id, v_me);
      return jsonb_build_object('status', 'wrong_code', 'group_id', v_g.id);
    end if;

    insert into group_members (group_id, user_id, role) values (v_g.id, v_me, 'member')
    on conflict (group_id, user_id) do nothing;
    return jsonb_build_object('status', 'joined', 'group_id', v_g.id);
  end if;

  if v_g.privacy = 'gated' then
    perform request_to_join_group(v_g.id);
    return jsonb_build_object('status', 'requested', 'group_id', v_g.id);
  end if;

  -- open
  insert into group_members (group_id, user_id, role) values (v_g.id, v_me, 'member')
  on conflict (group_id, user_id) do nothing;
  return jsonb_build_object('status', 'joined', 'group_id', v_g.id);
end;
$function$;

-- ── 6. Owner / moderator management ───────────────────────────────────────────────────────────────

create or replace function public.rotate_room_code(p_room_id uuid)
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_code text;
begin
  if not is_campfire_admin(p_room_id, auth.uid()) then
    raise exception 'Only the owner or a moderator can change the room code.';
  end if;
  v_code := new_room_code();
  update groups g set join_code = v_code where g.id = p_room_id;
  if not found then
    raise exception 'Room not found.';
  end if;
  -- Old wrong guesses were against a code that no longer exists.
  delete from room_code_attempts a where a.group_id = p_room_id;
  return v_code;
end;
$function$;

-- 'code' → private + code-gated + fresh code. 'open' → anyone joins in one tap (and anyone waiting
-- on an old approve-to-join request is let in, the same as update_campfire_privacy('open') does).
create or replace function public.set_room_policy(p_room_id uuid, p_policy text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_code text;
  v_req_id uuid;
begin
  if p_policy not in ('open', 'code') then
    raise exception 'Join policy must be open or code.';
  end if;
  if not is_campfire_admin(p_room_id, auth.uid()) then
    raise exception 'Only the owner or a moderator can change who can join.';
  end if;
  if not exists (select 1 from groups g where g.id = p_room_id) then
    raise exception 'Room not found.';
  end if;

  if p_policy = 'code' then
    v_code := new_room_code();
    update groups g set join_policy = 'code', privacy = 'private', join_code = v_code where g.id = p_room_id;
    delete from room_code_attempts a where a.group_id = p_room_id;
  else
    update groups g set join_policy = 'open', privacy = 'open' where g.id = p_room_id
    returning g.join_code into v_code;
    for v_req_id in
      select r.id from group_join_requests r where r.group_id = p_room_id and r.status = 'pending'
    loop
      perform approve_join_request(v_req_id);
    end loop;
  end if;

  return jsonb_build_object('join_policy', p_policy, 'privacy', case p_policy when 'code' then 'private' else 'open' end, 'code', v_code);
end;
$function$;

-- Owner: promote/demote anyone but themselves. Moderator: may promote a member to moderator, but
-- may not demote another moderator (that's the owner's call). Accepts 'moderator' | 'admin' | 'member'.
create or replace function public.set_room_member_role(p_room_id uuid, p_user_id uuid, p_role text)
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_me uuid := auth.uid();
  v_owner uuid;
  v_my_role text;
  v_their_role text;
  v_target text := case lower(p_role) when 'moderator' then 'admin' when 'admin' then 'admin' when 'member' then 'member' end;
  v_name text;
begin
  if v_target is null then
    raise exception 'Role must be moderator or member.';
  end if;

  select g.owner_id, g.name into v_owner, v_name from groups g where g.id = p_room_id;
  if v_owner is null then
    raise exception 'Room not found.';
  end if;
  if p_user_id = v_owner then
    raise exception 'The owner''s role cannot be changed.';
  end if;

  v_my_role := case when v_owner = v_me then 'owner'
    else (select gm.role from group_members gm where gm.group_id = p_room_id and gm.user_id = v_me) end;
  if v_my_role is null or v_my_role not in ('owner', 'admin') then
    raise exception 'Only the owner or a moderator can change roles.';
  end if;

  select gm.role into v_their_role from group_members gm where gm.group_id = p_room_id and gm.user_id = p_user_id;
  if v_their_role is null then
    raise exception 'That person is not in this room.';
  end if;
  if v_my_role = 'admin' and v_their_role = 'admin' and v_target = 'member' then
    raise exception 'Only the owner can remove a moderator.';
  end if;

  update group_members gm set role = v_target where gm.group_id = p_room_id and gm.user_id = p_user_id;

  -- Reuses 0094's push type so installed builds route it.
  if v_target = 'admin' and v_their_role <> 'admin' then
    perform notify_push(
      array[p_user_id],
      v_name,
      'You''re now a moderator of ' || coalesce(v_name, 'this room') || '.',
      jsonb_build_object('type', 'campfire_admin_granted', 'group_id', p_room_id)
    );
  end if;

  return room_role_label(v_target);
end;
$function$;

-- Owner removes anyone (not themselves); a moderator removes members only.
create or replace function public.remove_room_member(p_room_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_me uuid := auth.uid();
  v_owner uuid;
  v_my_role text;
  v_their_role text;
begin
  select g.owner_id into v_owner from groups g where g.id = p_room_id;
  if v_owner is null then
    raise exception 'Room not found.';
  end if;
  if p_user_id = v_owner then
    raise exception 'The owner can''t be removed.';
  end if;
  if p_user_id = v_me then
    raise exception 'Use Leave room instead.';
  end if;

  v_my_role := case when v_owner = v_me then 'owner'
    else (select gm.role from group_members gm where gm.group_id = p_room_id and gm.user_id = v_me) end;
  if v_my_role is null or v_my_role not in ('owner', 'admin') then
    raise exception 'Only the owner or a moderator can remove people.';
  end if;

  select gm.role into v_their_role from group_members gm where gm.group_id = p_room_id and gm.user_id = p_user_id;
  if v_their_role is null then
    return;
  end if;
  if v_my_role = 'admin' and v_their_role <> 'member' then
    raise exception 'Only the owner can remove a moderator.';
  end if;

  delete from group_members gm where gm.group_id = p_room_id and gm.user_id = p_user_id;
end;
$function$;

-- Owner/mods edit the channel list. 'general' always stays; names are lowercased + slugged.
create or replace function public.set_room_channels(p_room_id uuid, p_channels text[])
returns text[]
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_clean text[];
begin
  if not is_campfire_admin(p_room_id, auth.uid()) then
    raise exception 'Only the owner or a moderator can edit channels.';
  end if;

  select array_agg(c order by ord) into v_clean from (
    select distinct on (c) c, ord from (
      select 'general'::text c, 0 ord
      union all
      select regexp_replace(lower(btrim(x, ' #')), '[^a-z0-9-]+', '-', 'g'), o
      from unnest(coalesce(p_channels, '{}')) with ordinality as t(x, o)
    ) s
    where c ~ '^[a-z0-9][a-z0-9-]{0,23}$'
    order by c, ord
  ) d;

  if cardinality(v_clean) > 12 then
    raise exception 'A room can have at most 12 channels.';
  end if;

  update groups g set channels = v_clean where g.id = p_room_id;
  return v_clean;
end;
$function$;

-- ── 6b. get_discoverable_rooms — Rooms browse (ss2, mock 355) ───────────────────────────────────
-- Open + gated rooms, PLUS code rooms (shown locked — the gate is the point). Never a legacy
-- invite-only private room, never join_code, never a room whose owner is blocked either way.

create or replace function public.get_discoverable_rooms(p_query text default null, p_limit int default 30)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_me uuid := auth.uid();
  v_q text := nullif(btrim(coalesce(p_query, '')), '');
begin
  if v_me is null then
    raise exception 'Sign in first.';
  end if;

  return coalesce((
    select jsonb_agg(r order by r->>'last_activity_at' desc nulls last, (r->>'member_count')::int desc)
    from (
      select jsonb_build_object(
        'id', g.id,
        'name', g.name,
        'emoji', g.emoji,
        'member_count', (select count(*) from group_members gm where gm.group_id = g.id),
        'online_count', (select count(*) from lock_in_sessions ls where ls.circle_id = g.id and ls.status = 'active'),
        'join_policy', g.join_policy,
        'privacy', g.privacy,
        'course_code', g.course_code,
        'school', g.school,
        'is_member', exists (select 1 from group_members gm where gm.group_id = g.id and gm.user_id = v_me),
        'last_activity_at', (select max(m.created_at) from messages m where m.group_id = g.id and m.deleted_at is null)
      ) r
      from groups g
      where (g.privacy in ('open', 'gated') or g.join_policy = 'code')
        and not is_blocked_either_way(g.owner_id)
        and (
          v_q is null
          or g.name ilike '%' || v_q || '%'
          or g.course_code ilike '%' || v_q || '%'
          or g.school ilike '%' || v_q || '%'
        )
      limit greatest(1, least(coalesce(p_limit, 30), 100))
    ) s
  ), '[]'::jsonb);
end;
$function$;

-- ── 7. Close the direct-insert bypass ─────────────────────────────────────────────────────────────
-- Prod's "group_members: insert self" was `with check (user_id = auth.uid())` — any signed-in user
-- could insert themselves into ANY group, private or code-gated, and as role 'owner' or 'admin'.
-- Every gate above would be decorative. No client build has ever inserted into group_members
-- directly (checked back to the initial commit, 04eeb94): every join goes through a SECURITY DEFINER
-- RPC (join_public_group, join_group_with_code, approve_join_request, join_forest, join_room…), and
-- those bypass RLS. So the policy narrows to the one case that's safe without an RPC: yourself, as a
-- plain member, into an open room. Same name, so nothing else that references it changes.

drop policy if exists "group_members: insert self" on public.group_members;
create policy "group_members: insert self" on public.group_members
  for insert
  with check (
    user_id = auth.uid()
    and role = 'member'
    and exists (
      select 1 from public.groups g
      where g.id = group_id and g.privacy = 'open' and g.join_policy = 'open'
    )
  );

-- ── 8. Grants ─────────────────────────────────────────────────────────────────────────────────────
-- `revoke … from public` alone leaves anon's default EXECUTE (see memory: revoking authenticated
-- leaves anon). Name anon explicitly.

revoke all on function public.get_room_gate(uuid) from public, anon;
revoke all on function public.join_room(uuid, text) from public, anon;
revoke all on function public.rotate_room_code(uuid) from public, anon;
revoke all on function public.set_room_policy(uuid, text) from public, anon;
revoke all on function public.set_room_member_role(uuid, uuid, text) from public, anon;
revoke all on function public.remove_room_member(uuid, uuid) from public, anon;
revoke all on function public.set_room_channels(uuid, text[]) from public, anon;
revoke all on function public.get_discoverable_rooms(text, int) from public, anon;
revoke all on function public.room_person_json(uuid, text) from public, anon, authenticated;
revoke all on function public.new_room_code() from public, anon, authenticated;
revoke all on function public.messages_channel_fallback() from public, anon, authenticated;

grant execute on function public.get_room_gate(uuid) to authenticated;
grant execute on function public.join_room(uuid, text) to authenticated;
grant execute on function public.rotate_room_code(uuid) to authenticated;
grant execute on function public.set_room_policy(uuid, text) to authenticated;
grant execute on function public.set_room_member_role(uuid, uuid, text) to authenticated;
grant execute on function public.remove_room_member(uuid, uuid) to authenticated;
grant execute on function public.set_room_channels(uuid, text[]) to authenticated;
grant execute on function public.get_discoverable_rooms(text, int) to authenticated;
