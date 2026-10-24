-- 0262 — last_seen_at leaves profiles: "Active Xm ago" is friends-only for real, not just in the RPC.
--
-- 0245 put the heartbeat timestamp on profiles.last_seen_at and gated it in get_presence: the
-- last-active time goes only to friends, only when both sides have show_last_active on. But
-- profiles is readable by anyone — policy "profiles: read any" (using true) plus the table-level
-- SELECT grant to anon AND authenticated — so `select last_seen_at from profiles` handed every
-- user's last-seen time to any signed-in user, and to the anon key, bypassing the gate entirely.
-- Verified on prod 2026-10-24: has_column_privilege('anon', 'profiles', 'last_seen_at', 'select')
-- was true.
--
-- WHY A TABLE, NOT A COLUMN REVOKE. Postgres ignores a column-level REVOKE while a table-level
-- SELECT grant stands, and narrowing profiles to a per-column grant would make every installed
-- build's `select('*')` on profiles fail outright. So the timestamp moves to user_presence: RLS on,
-- no policies, no grants to anon/authenticated. Only the two SECURITY DEFINER functions touch it.
--
-- SIGNATURES UNCHANGED. touch_presence() and get_presence(uuid[]) keep their arguments, return
-- shapes and grants, so create-or-replace is safe and installed builds call them exactly as before.
-- No client code reads profiles.last_seen_at (only the generated type), so dropping it breaks no
-- query; the show_* preference booleans stay on profiles, where settings reads them.

-- ─────────────────────────── 1 · the table ───────────────────────────

create table if not exists public.user_presence (
  user_id      uuid primary key references public.profiles (id) on delete cascade,
  last_seen_at timestamptz not null
);

comment on table public.user_presence is
  'Heartbeat timestamps (0262, moved off profiles). Read only through get_presence, which gates last-active to friends.';

alter table public.user_presence enable row level security;
revoke all on public.user_presence from public, anon, authenticated;

insert into public.user_presence (user_id, last_seen_at)
select id, last_seen_at from public.profiles where last_seen_at is not null
on conflict (user_id) do update set last_seen_at = greatest(user_presence.last_seen_at, excluded.last_seen_at);

-- ─────────────────────────── 2 · heartbeat ───────────────────────────
-- Same 30s throttle as 0245: a double-fire costs a no-op, not a row rewrite.

create or replace function public.touch_presence()
returns void
language sql
security definer
set search_path = public
as $$
  insert into user_presence as up (user_id, last_seen_at)
  select auth.uid(), now()
   where auth.uid() is not null
  on conflict (user_id) do update
     set last_seen_at = excluded.last_seen_at
   where up.last_seen_at < now() - interval '30 seconds';
$$;

-- ─────────────────────────── 3 · presence read ───────────────────────────
-- The live 0245 body, with t.last_seen_at now read from user_presence. Gating is unchanged.

create or replace function public.get_presence(p_user_ids uuid[])
returns table(user_id uuid, locked_in boolean, discipline text, online boolean, last_active_at timestamp with time zone)
language sql
stable
security definer
set search_path = public
as $$
  with me as (
    select p.id,
           case when p.university_email_verified then lower(nullif(btrim(p.university), '')) end as campus,
           p.show_last_active
      from profiles p
     where p.id = auth.uid()
  ),
  req as (
    select distinct r.id from unnest(p_user_ids[1:200]) as r(id)
  ),
  base as (
    select t.id,
           t.show_live_status,
           t.show_live_activity,
           t.show_last_active,
           up.last_seen_at,
           (t.id = me.id) as is_me,
           (t.id <> me.id and is_blocked_either_way(t.id)) as blocked,
           (t.id = me.id
             or (me.campus is not null
                 and t.university_email_verified
                 and lower(nullif(btrim(t.university), '')) = me.campus)) as same_campus,
           me.show_last_active as my_show_last_active,
           s.category, s.activity, s.goal_type,
           (s.id is not null) as has_session
      from req
      join profiles t on t.id = req.id
      left join user_presence up on up.user_id = t.id
      cross join me
      left join lock_in_sessions s
        on s.user_id = t.id
       and s.status = 'active'
       and not s.paused
     where not coalesce(t.is_disabled, false)
  ),
  gated as (
    select b.*,
           (b.has_session and b.show_live_status and b.same_campus and not b.blocked) as is_locked_in
      from base b
  )
  select g.id,
         g.is_locked_in,
         case when g.is_locked_in and g.show_live_activity then
           case
             when g.category = 'study'     then 'study'
             when g.category = 'deep_work' then 'deep_work'
             when g.category = 'fitness' and g.activity = 'strength' then 'strength'
             when g.category = 'fitness' and g.activity = 'cardio'   then 'cardio'
             -- Pre-0182 sessions carry only goal_type.
             when g.category is null and g.goal_type = 'study' then 'study'
             when g.category is null and g.goal_type = 'gym'   then 'strength'
             when g.category is null and g.goal_type = 'run'   then 'cardio'
           end
         end,
         coalesce(not g.is_locked_in
           and g.show_live_status and g.same_campus and not g.blocked
           and g.last_seen_at > now() - interval '3 minutes', false),
         case when not g.is_me and not g.blocked
                   and g.show_last_active and g.my_show_last_active
                   and is_friend_of(g.id)
              then g.last_seen_at end
    from gated g;
$$;

-- ─────────────────────────── 4 · the column goes ───────────────────────────

alter table public.profiles drop column if exists last_seen_at;

-- ─────────────────────────── self-check ───────────────────────────

do $assert$
begin
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'profiles' and column_name = 'last_seen_at') then
    raise exception '0262: profiles.last_seen_at still exists';
  end if;
  -- The leak, both roles: neither can read the timestamp table at all.
  if has_table_privilege('anon', 'public.user_presence', 'select')
     or has_table_privilege('authenticated', 'public.user_presence', 'select') then
    raise exception '0262: user_presence is readable by a client role';
  end if;
  -- ...and the gated path still works for the role that should have it.
  if not has_function_privilege('authenticated', 'public.get_presence(uuid[])', 'execute')
     or not has_function_privilege('authenticated', 'public.touch_presence()', 'execute') then
    raise exception '0262: authenticated lost execute on the presence functions';
  end if;
  if has_function_privilege('anon', 'public.get_presence(uuid[])', 'execute')
     or has_function_privilege('anon', 'public.touch_presence()', 'execute') then
    raise exception '0262: anon can execute a presence function';
  end if;
  if (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname in ('get_presence', 'touch_presence')) <> 2 then
    raise exception '0262: expected exactly one get_presence and one touch_presence';
  end if;
end;
$assert$;
