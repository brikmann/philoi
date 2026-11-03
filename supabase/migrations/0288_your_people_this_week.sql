-- 0288 · YOUR PEOPLE, THIS WEEK (connection-first, mocks 331 + 332).
--
-- Home and the lock-in done screen lead with the collective: "your people logged 5,042 hrs this
-- week", a +delta, and the faces of who's locked in today. One number, no ranking.
--
-- "Your people" = everyone you're connected to, DE-DUPLICATED:
--   • accepted friends (friend_requests, either direction),
--   • everyone in a campfire you're in (group_members),
--   • everyone in a forest you're in (forest_members, both active; the forest not removed),
-- minus you, minus disabled and demo accounts, minus anyone either side has blocked. A friend who is
-- also in two of your campfires is counted once — the UNION is the de-dup.
--
-- Hours are counted exactly the way get_my_week_vs_last (0281) counts yours: check_ins with a
-- positive duration, not removed, source 'manual' (synced tracker imports have their own surfaces),
-- bucketed on the shared Sunday 00:00 UTC week_start() — so "your week" and "your people's week"
-- can never disagree about where the week begins. The delta is against last week UP TO THE SAME
-- POINT, like the ipsative card: never a deficit, the client only draws it when positive.
--
-- "Locked in today" is the caller's LOCAL day (profiles.timezone), counting a check-in today or a
-- live session right now — the live half only for people who share live status.
--
-- Two functions:
--   people_week_stats(uuid)   — internal; the session-complete push (0289) calls it for the
--                               session's owner. No client grant.
--   get_people_week_hours()   — the client read, always for auth.uid(). Never takes a user id, so
--                               nobody can read somebody else's circle.
--
-- Additive: two new functions, no table changes.

create function public.people_week_stats(p_user uuid)
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
  linked as (
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
  ),
  people as (
    select pr.id as uid, pr.display_name, pr.handle, pr.avatar_url,
           coalesce(pr.show_live_status, true) as shows_live
      from linked l
      join profiles pr on pr.id = l.uid
     where l.uid <> p_user
       and not coalesce(pr.is_disabled, false)
       and not coalesce(pr.is_demo, false)
       and not exists (
         select 1 from blocked_users b
          where (b.blocker_id = p_user and b.blocked_id = pr.id)
             or (b.blocker_id = pr.id and b.blocked_id = p_user))
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

create function public.get_people_week_hours()
returns table (
  out_this_week_seconds      bigint,
  out_last_week_to_date_secs bigint,
  out_people                 integer,
  out_active_today           integer,
  out_faces                  jsonb
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
begin
  if v_me is null then
    raise exception 'not authenticated';
  end if;
  return query select * from people_week_stats(v_me);
end;
$$;

revoke all on function public.get_people_week_hours() from public, anon;
grant execute on function public.get_people_week_hours() to authenticated;
