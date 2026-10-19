-- 0245 — "Locked in now": live presence under anyone's name (mock 273).
--
-- ─────────────────────────────── WHY ───────────────────────────────
--
-- Three tiers of presence, highest wins on the client:
--   1. 🔥 Locked in (+ discipline)  — campus-public
--   2. 🟢 Online                     — campus-public, app foregrounded in the last 3 min
--   3. ⚪ Active <x ago>             — FRIENDS ONLY, and reciprocal
--
-- Nothing here widens RLS on lock_in_sessions or check_ins. get_presence is the only reader and it
-- returns four computed fields per user — two booleans, a discipline KEY and (friends only) a
-- timestamp. No goal_detail, no circle, no session timing, no university.
--
-- ── "Active" is the reaper's definition, restated ──
--
-- A session counts while status = 'active' and it is not paused. (Drafted against 0226's 20-min
-- last_confirmed_at window; 0250 cut the still-here check, so a lock-in runs until stopped and
-- last_confirmed_at is no longer a liveness signal — the window was dropped before this applied.)
-- Paused sessions are not "locked in now": a pause is the user saying they stepped away.
--
-- ── "Campus" means a VERIFIED campus, both sides ──
--
-- profiles.university is free text. Without the verification check, anyone could type a school
-- name and watch who is locked in there. The campus boards gate on university_email_verified for the
-- same reason (UNI_VERIFICATION_SPEC §4), so this matches them: an unverified account neither sees
-- nor is seen on the campus tier. Friends-only last-active is unaffected.
--
-- ── Reciprocal last-active ──
--
-- show_last_active off hides yours AND blanks everyone else's for you. Checked on the caller's row,
-- server-side, so a patched client cannot see while hidden.
--
-- ── The leaderboard ──
--
-- The boards call get_presence ONCE with every visible id, the same batching get_public_loadouts
-- already uses for gear. That is one request per board, not N, and it leaves the four leaderboard
-- RPCs (whose return shapes would need drop-and-recreate) untouched.
--
-- ── Old builds ──
--
-- Purely additive: three defaulted columns, one nullable column, two new functions. Installed
-- builds never call them.

-- ─────────────────────────── 0 · preconditions ───────────────────────────
do $guard$
begin
  if to_regprocedure('public.is_friend_of(uuid)') is null then
    raise exception '0245 needs is_friend_of(uuid) — see 0233';
  end if;
  if to_regprocedure('public.is_blocked_either_way(uuid)') is null then
    raise exception '0245 needs is_blocked_either_way(uuid) — see schema.sql';
  end if;
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'lock_in_sessions' and column_name = 'paused') then
    raise exception '0245 needs lock_in_sessions.paused — see 0218';
  end if;
end;
$guard$;

-- ─────────────────────────── 1 · columns ───────────────────────────
alter table profiles add column if not exists last_seen_at timestamptz;
alter table profiles add column if not exists show_live_status boolean not null default true;
alter table profiles add column if not exists show_live_activity boolean not null default true;
alter table profiles add column if not exists show_last_active boolean not null default true;

-- ─────────────────────────── 2 · heartbeat ───────────────────────────
-- Called on foreground and every ~60s while the app is active. Throttled to one write per 30s so a
-- double-fire (foreground + interval landing together) costs a no-op, not a row rewrite.
create or replace function touch_presence()
returns void
language sql
security definer
set search_path = public
volatile
as $$
  update profiles
     set last_seen_at = now()
   where id = auth.uid()
     and (last_seen_at is null or last_seen_at < now() - interval '30 seconds');
$$;

revoke execute on function touch_presence() from public, anon;
grant execute on function touch_presence() to authenticated;

-- ─────────────────────────── 3 · the read ───────────────────────────
-- Returns one row per requested id that exists (capped at 200 ids). Every field defaults to
-- "nothing to show"; a user who fails a check is indistinguishable from one who is simply offline.
--
-- discipline is a KEY, not a label: 'study' | 'deep_work' | 'strength' | 'cardio'. The client maps
-- it and renders a bare "Locked in" for any key it does not know, so a future category never shows
-- garbage on an old build.
drop function if exists get_presence(uuid[]);
create function get_presence(p_user_ids uuid[])
returns table (user_id uuid, locked_in boolean, discipline text, online boolean, last_active_at timestamptz)
language sql
security definer
set search_path = public
stable
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
           t.last_seen_at,
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

revoke execute on function get_presence(uuid[]) from public, anon;
grant execute on function get_presence(uuid[]) to authenticated;

comment on function get_presence(uuid[]) is
  '0245 — presence for a batch of users: locked_in/discipline/online (verified-campus, show_live_status), last_active_at (friends, reciprocal show_last_active). Never widen this to session detail.';

-- ─────────────────────────── 4 · postconditions ───────────────────────────
do $post$
begin
  if has_function_privilege('anon', 'public.get_presence(uuid[])', 'execute') then
    raise exception '0245: anon can execute get_presence';
  end if;
  if has_function_privilege('anon', 'public.touch_presence()', 'execute') then
    raise exception '0245: anon can execute touch_presence';
  end if;
  if not has_function_privilege('authenticated', 'public.get_presence(uuid[])', 'execute') then
    raise exception '0245: authenticated cannot execute get_presence';
  end if;
end;
$post$;
