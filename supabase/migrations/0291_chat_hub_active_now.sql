-- 0291 · CHAT HUB · WHO'S ACTIVE NOW (Phase 8.4, mock 337).
--
-- The Chat tab's rows get the green "active now" dot: a friend who's in a live lock-in, a campfire or
-- forest with someone in one. One read for the whole list, so the hub never fans out a call per row.
--
-- get_chat_live_now() → one row per conversation that has someone live right now:
--   ('dm',       <friend's user id>, 1)
--   ('campfire', <group id>,         <members live>)
--   ('forest',   <forest id>,        <members live>)
-- Conversations with nobody live are simply absent.
--
-- "Live" is Pulse's rule (0290) and forest_locked_in_now's (0274): a lock_in_sessions row with status
-- 'active' and not paused, from someone who shares live status (show_live_status), not disabled, not
-- blocked either way. You never count toward your own rooms. Reciprocal like every live surface
-- (get_friends_recent_effort, get_people_active_now): hide your own live status and this returns
-- nothing.
--
-- Rooms are the caller's own memberships only (group_members; forest_members status 'active', the
-- forest not removed), so it can't be used to probe a room you're not in.
--
-- Additive: one new read.

begin;

create function public.get_chat_live_now()
returns table (out_kind text, out_id uuid, out_live integer)
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

  if not coalesce((select p.show_live_status from profiles p where p.id = v_me), true) then
    return;
  end if;

  return query
  with live as (
    select distinct s.user_id as uid
      from lock_in_sessions s
      join profiles pr on pr.id = s.user_id
     where s.status = 'active'
       and not coalesce(s.paused, false)
       and s.user_id <> v_me
       and coalesce(pr.show_live_status, true)
       and not coalesce(pr.is_disabled, false)
       and not exists (
         select 1 from blocked_users b
          where (b.blocker_id = v_me and b.blocked_id = s.user_id)
             or (b.blocker_id = s.user_id and b.blocked_id = v_me))
  )
  select 'dm'::text, l.uid, 1
    from live l
   where exists (
     select 1 from friend_requests fr
      where fr.status = 'accepted'
        and ((fr.requester_id = v_me and fr.recipient_id = l.uid)
          or (fr.recipient_id = v_me and fr.requester_id = l.uid)))
  union all
  select 'campfire'::text, gm.group_id, count(*)::int
    from group_members gm
    join group_members gm2 on gm2.group_id = gm.group_id
    join live l on l.uid = gm2.user_id
   where gm.user_id = v_me
   group by gm.group_id
  union all
  select 'forest'::text, fm.forest_id, count(*)::int
    from forest_members fm
    join forests f on f.id = fm.forest_id and f.removed_at is null
    join forest_members fm2 on fm2.forest_id = fm.forest_id and fm2.status = 'active'
    join live l on l.uid = fm2.user_id
   where fm.user_id = v_me
     and fm.status = 'active'
   group by fm.forest_id;
end;
$$;

revoke all on function public.get_chat_live_now() from public, anon;
grant execute on function public.get_chat_live_now() to authenticated;

commit;
