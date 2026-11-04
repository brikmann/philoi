-- 0290 · PULSE · LOCKED IN RIGHT NOW (Phase 8.1, mock 334).
--
-- Home becomes Pulse and opens on co-presence: "23 locked in now — Maya · Studying · Jordan · Gym
-- +21". One count, a few faces, no rank.
--
-- 1 · people_of(uuid) — "your people", written once.
--     0288 inlined the set (accepted friends ∪ campfire-mates ∪ active forest-mates, minus you,
--     disabled, demo and blocked-either-way accounts). Pulse needs the same set, and the Chat hub's
--     active dots will too; a second copy is how two surfaces come to disagree about who your people
--     are. The set moves here verbatim and people_week_stats is restated on top of it — the same
--     output, which the apply probe checks row-for-row against the 0288 body for every profile.
--     It also carries each person's live-sharing switches, so callers don't re-join profiles for them.
--     Internal: no client grant.
--
-- 2 · get_people_active_now() — the client read, always for auth.uid().
--     "Active" = a lock_in_sessions row with status 'active' and not paused — exactly
--     forest_locked_in_now's rule (0274), so a forest's "N locked in" and Pulse never disagree about
--     what counts. Stale sessions are closed by the still-here check (0226), not filtered here.
--     Privacy, as get_friends_recent_effort (0281) does it:
--       • only people who share live status (show_live_status) are counted or shown;
--       • what they're doing is masked unless they share it (show_live_activity);
--       • it's reciprocal — if YOU hide your live status you see no one's, and out_you_hidden says so
--         the client can explain the empty strip instead of implying nobody is working.
--     out_sample is the newest few sessions; out_count is everyone.
--
-- Additive: one new helper, one new read, one body restated with an identical result.

begin;

create function public.people_of(p_user uuid)
returns table (uid uuid, shows_live boolean, shows_what boolean)
language sql
stable
security definer
set search_path = public
as $$
  with linked as (
    select case when fr.requester_id = p_user then fr.recipient_id else fr.requester_id end as uid
      from friend_requests fr
     where fr.status = 'accepted'
       and (fr.requester_id = p_user or fr.recipient_id = p_user)
    union
    select gm2.user_id
      from group_members gm
      join group_members gm2 on gm2.group_id = gm.group_id
     where gm.user_id = p_user
    union
    select fm2.user_id
      from forest_members fm
      join forests f on f.id = fm.forest_id and f.removed_at is null
      join forest_members fm2 on fm2.forest_id = fm.forest_id and fm2.status = 'active'
     where fm.user_id = p_user
       and fm.status = 'active'
  )
  select pr.id,
         coalesce(pr.show_live_status, true),
         coalesce(pr.show_live_activity, true)
    from linked l
    join profiles pr on pr.id = l.uid
   where l.uid <> p_user
     and not coalesce(pr.is_disabled, false)
     and not coalesce(pr.is_demo, false)
     and not exists (
       select 1 from blocked_users b
        where (b.blocker_id = p_user and b.blocked_id = pr.id)
           or (b.blocker_id = pr.id and b.blocked_id = p_user));
$$;

revoke all on function public.people_of(uuid) from public, anon, authenticated;

-- Restated from the live 0288 body (prosrc md5 b709ca1720ee1f54a47e9fe99d53ddc6): only the
-- `linked` + `people` CTEs change, to read people_of(). Same signature, same columns.
create or replace function public.people_week_stats(p_user uuid)
returns table (
  out_this_week_seconds      bigint,
  out_last_week_to_date_secs bigint,
  out_people                 integer,
  out_active_today           integer,
  out_faces                  jsonb
)
language sql
stable
security definer
set search_path = public
as $$
  with bounds as (
    select week_start() as ws,
           week_start() - interval '7 days' as prev_ws,
           now() - week_start() as into_week,
           (date_trunc('day', now() at time zone coalesce(nullif(me.timezone, ''), 'UTC'))
              at time zone coalesce(nullif(me.timezone, ''), 'UTC')) as day_start
      from profiles me
     where me.id = p_user
  ),
  people as (
    select pr.id as uid, pr.display_name, pr.handle, pr.avatar_url, po.shows_live
      from people_of(p_user) po
      join profiles pr on pr.id = po.uid
  ),
  effort as (
    select ci.user_id, ci.created_at, ci.duration_seconds
      from check_ins ci
      join people pe on pe.uid = ci.user_id
      cross join bounds bd
     where ci.removed_at is null
       and ci.duration_seconds > 0
       and coalesce(ci.source, 'manual') = 'manual'
       and ci.created_at >= bd.prev_ws
  ),
  today as (
    select e.user_id as uid, max(e.created_at) as at
      from effort e cross join bounds bd
     where e.created_at >= bd.day_start
     group by e.user_id
    union all
    select s.user_id, s.started_at
      from lock_in_sessions s
      join people pe on pe.uid = s.user_id and pe.shows_live
     where s.status = 'active'
  ),
  active as (
    select t.uid, max(t.at) as at from today t group by t.uid
  )
  select
    coalesce((select sum(e.duration_seconds) from effort e cross join bounds bd
               where e.created_at >= bd.ws), 0)::bigint,
    coalesce((select sum(e.duration_seconds) from effort e cross join bounds bd
               where e.created_at < bd.ws and e.created_at < bd.prev_ws + bd.into_week), 0)::bigint,
    (select count(*) from people)::int,
    (select count(*) from active)::int,
    coalesce((
      select jsonb_agg(jsonb_build_object(
               'user_id', f.uid,
               'name', coalesce(nullif(trim(f.display_name), ''), f.handle, 'Friend'),
               'avatar_url', f.avatar_url) order by f.at desc)
        from (select a.uid, a.at, pe.display_name, pe.handle, pe.avatar_url
                from active a join people pe on pe.uid = a.uid
               order by a.at desc
               limit 5) f
    ), '[]'::jsonb);
$$;

revoke all on function public.people_week_stats(uuid) from public, anon, authenticated;

create function public.get_people_active_now()
returns table (
  out_count      integer,
  out_you_hidden boolean,
  out_sample     jsonb
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_me     uuid := auth.uid();
  v_hidden boolean;
begin
  if v_me is null then
    raise exception 'not authenticated';
  end if;

  v_hidden := not coalesce((select p.show_live_status from profiles p where p.id = v_me), true);
  if v_hidden then
    return query select 0, true, '[]'::jsonb;
    return;
  end if;

  return query
  with live as (
    -- One row per person: a second device's session doesn't count them twice.
    select distinct on (s.user_id)
           s.user_id, s.started_at,
           case when po.shows_what then s.goal_type end as goal_type,
           case when po.shows_what then s.category end as category,
           case when po.shows_what then s.activity end as activity
      from people_of(v_me) po
      join lock_in_sessions s on s.user_id = po.uid
     where po.shows_live
       and s.status = 'active'
       and not coalesce(s.paused, false)
     order by s.user_id, s.started_at desc
  )
  select
    (select count(*) from live)::int,
    false,
    coalesce((
      select jsonb_agg(jsonb_build_object(
               'user_id', x.user_id,
               'name', coalesce(nullif(trim(x.display_name), ''), x.handle, 'Friend'),
               'avatar_url', x.avatar_url,
               'goal_type', x.goal_type,
               'category', x.category,
               'activity', x.activity,
               'started_at', x.started_at) order by x.started_at desc)
        from (select l.*, pr.display_name, pr.handle, pr.avatar_url
                from live l join profiles pr on pr.id = l.user_id
               order by l.started_at desc
               limit 5) x
    ), '[]'::jsonb);
end;
$$;

revoke all on function public.get_people_active_now() from public, anon;
grant execute on function public.get_people_active_now() to authenticated;

commit;
