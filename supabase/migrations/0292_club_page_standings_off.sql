-- 0292 · THE CLUB PAGE · STANDINGS OFF BY DEFAULT + "TOGETHER THIS WEEK" (Phase 8.2, mock 335).
--
-- The club page is the demo you show a club ("it's competition" → "oh — this is for us"): a crest, the
-- members, one collective number, and a badge that says the leaderboard is off because the club chose
-- it. Two rooms carry a club: a campfire (groups) and a forest (forests). Both get the same switch.
--
-- 1 · groups.standings_enabled, forests.standings_enabled — boolean not null default false.
--     False means the room's page shows no leaderboard and no rank anywhere (the client gates the
--     campfire's 🏆 panel on it) and draws "Leaderboard off — this club's choice". A club admin can
--     turn it on, which only exposes the opt-in standings view INSIDE the club — never the global
--     board. Every existing room starts off: that is the point of the default.
--
-- 2 · get_group_week_hours(p_group_id, p_kind) — the collective, scoped to one room. Phase 3's
--     counting (0288 people_week_stats): check_ins with a positive duration, not removed, source
--     'manual', bucketed on the shared Sunday 00:00 UTC week_start(), delta against last week up to
--     the same point. Everyone in the room counts once, you included — it's the club's week, not
--     yours. Disabled and demo accounts don't. No per-member breakdown: nobody is ranked in it.
--       • Hours only for a MEMBER (campfire: group_members; forest: forest_members 'active').
--       • The standings flag for anyone who can see the room (a campfire member; anyone
--         can_read_forest lets in — an open forest's visitors see the badge, which is the pitch).
--       • Nobody else gets a row.
--
-- 3 · set_room_standings(p_kind, p_id, p_enabled) — the switch. Campfire: is_campfire_admin (0094's
--     role, not owner_id). Forest: is_forest_owner. Anyone else is refused.
--
-- Additive: two columns with defaults, two new functions. Grants server-side; authenticated only.

begin;

alter table public.groups  add column standings_enabled boolean not null default false;
alter table public.forests add column standings_enabled boolean not null default false;

create function public.get_group_week_hours(p_group_id uuid, p_kind text default 'campfire')
returns table (
  out_is_member              boolean,
  out_standings_enabled      boolean,
  out_this_week_seconds      bigint,
  out_last_week_to_date_secs bigint,
  out_members                integer
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_me        uuid := auth.uid();
  v_member    boolean;
  v_standings boolean;
begin
  if v_me is null then
    raise exception 'not authenticated';
  end if;

  if p_kind = 'campfire' then
    select g.standings_enabled into v_standings from groups g where g.id = p_group_id;
    if not found then return; end if;
    v_member := exists (select 1 from group_members gm where gm.group_id = p_group_id and gm.user_id = v_me);
    if not v_member then return; end if;
  elsif p_kind = 'forest' then
    select f.standings_enabled into v_standings from forests f where f.id = p_group_id and f.removed_at is null;
    if not found then return; end if;
    v_member := exists (select 1 from forest_members fm
                         where fm.forest_id = p_group_id and fm.user_id = v_me and fm.status = 'active');
    if not v_member and not can_read_forest(p_group_id, v_me) then return; end if;
  else
    raise exception 'unknown room kind %', p_kind;
  end if;

  if not v_member then
    return query select false, v_standings, null::bigint, null::bigint, null::int;
    return;
  end if;

  return query
  with members as (
    select pr.id as uid
      from (select gm.user_id as uid from group_members gm
             where p_kind = 'campfire' and gm.group_id = p_group_id
            union
            select fm.user_id from forest_members fm
             where p_kind = 'forest' and fm.forest_id = p_group_id and fm.status = 'active') m
      join profiles pr on pr.id = m.uid
     where not coalesce(pr.is_disabled, false)
       and not coalesce(pr.is_demo, false)
  ),
  bounds as (
    select week_start() as ws,
           week_start() - interval '7 days' as prev_ws,
           now() - week_start() as into_week
  ),
  effort as (
    select ci.created_at, ci.duration_seconds
      from check_ins ci
      join members mb on mb.uid = ci.user_id
      cross join bounds bd
     where ci.removed_at is null
       and ci.duration_seconds > 0
       and coalesce(ci.source, 'manual') = 'manual'
       and ci.created_at >= bd.prev_ws
  )
  select
    true,
    v_standings,
    coalesce((select sum(e.duration_seconds) from effort e cross join bounds bd
               where e.created_at >= bd.ws), 0)::bigint,
    coalesce((select sum(e.duration_seconds) from effort e cross join bounds bd
               where e.created_at < bd.ws and e.created_at < bd.prev_ws + bd.into_week), 0)::bigint,
    (select count(*) from members)::int;
end;
$$;

revoke all on function public.get_group_week_hours(uuid, text) from public, anon;
grant execute on function public.get_group_week_hours(uuid, text) to authenticated;

create function public.set_room_standings(p_kind text, p_id uuid, p_enabled boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
begin
  if v_me is null then
    raise exception 'not authenticated';
  end if;

  if p_kind = 'campfire' then
    if not is_campfire_admin(p_id, v_me) then
      raise exception 'only a campfire admin can change its standings' using errcode = '42501';
    end if;
    update groups set standings_enabled = coalesce(p_enabled, false) where id = p_id;
  elsif p_kind = 'forest' then
    if not is_forest_owner(p_id, v_me) then
      raise exception 'only the forest''s owner can change its standings' using errcode = '42501';
    end if;
    update forests set standings_enabled = coalesce(p_enabled, false) where id = p_id and removed_at is null;
  else
    raise exception 'unknown room kind %', p_kind;
  end if;
end;
$$;

revoke all on function public.set_room_standings(text, uuid, boolean) from public, anon;
grant execute on function public.set_room_standings(text, uuid, boolean) to authenticated;

commit;
