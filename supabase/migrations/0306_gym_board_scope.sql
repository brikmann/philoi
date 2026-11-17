-- 0306 — The Board gets a scope: Everyone (as 0305) or My Uni.
--
-- get_gym_board(p_window, p_scope default 'everyone'):
--   · 'everyone' — exactly 0305's board (XP-first, unique row_number rank).
--   · 'uni'      — the same board limited to people whose profiles.university matches the
--                  caller's (trimmed, case-insensitive). The caller is always on it.
-- The Fitness pill is NOT this function: it reads the existing per-exercise boards
-- (get_metric_leaderboard with an 'ex:' metric, est 1RM).
--
-- A parameter is added, so drop the one-arg version first (CREATE OR REPLACE would leave two
-- overloads). The default keeps every existing get_gym_board({p_window}) call working unchanged.
-- Only GYM_SPARK builds call it, and none has shipped.

drop function if exists public.get_gym_board(text);

create function public.get_gym_board(p_window text, p_scope text default 'everyone')
returns table (
  rank integer, user_id uuid, display_name text, handle text, avatar_url text,
  xp integer, week_streak integer, is_me boolean
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_me  uuid := auth.uid();
  v_uni text := (select nullif(btrim(pr.university), '') from profiles pr where pr.id = auth.uid());
begin
  if v_me is null then
    raise exception 'Not signed in.' using errcode = '42501';
  end if;
  if p_window not in ('week', 'all') then
    raise exception 'Unknown gym board window: %', p_window using errcode = '22023';
  end if;
  if coalesce(p_scope, 'everyone') not in ('everyone', 'uni') then
    raise exception 'Unknown gym board scope: %', p_scope using errcode = '22023';
  end if;

  return query
  with metric as (
    select w.uid, w.value
      from (
        select ci.user_id as uid, round(sum(ci.xp_earned))::integer as value
          from check_ins ci
         where p_window = 'week'
           and ci.removed_at is null
           and ci.created_at >= week_start(now())
         group by ci.user_id
      ) w
    union all
    select a.uid, round(live_rank_xp(a.uid))::integer
      from (
        select distinct ci.user_id as uid from check_ins ci where p_window = 'all' and ci.removed_at is null
        union
        select b.user_id from bonus_xp_awards b where p_window = 'all'
      ) a
  ),
  people as (
    select x.uid, coalesce(max(x.value), 0) as value
      from (select mt.uid, mt.value from metric mt where mt.value >= 1
            union all
            select v_me, 0) x
     group by x.uid
  ),
  visible as (
    select pe.uid, pe.value, pr.display_name, pr.handle, pr.avatar_url
      from people pe
      join profiles pr on pr.id = pe.uid
     where pe.uid = v_me
        or (not pr.is_disabled
            and not pr.is_demo
            -- 'uni': only people at the caller's university (case/space-insensitive). A caller with
            -- no university set sees just their own row rather than everyone.
            and (coalesce(p_scope, 'everyone') = 'everyone'
                 or (v_uni is not null and lower(btrim(pr.university)) = lower(v_uni)))
            and not exists (
              select 1 from blocked_users bu
               where (bu.blocker_id = v_me and bu.blocked_id = pe.uid)
                  or (bu.blocker_id = pe.uid and bu.blocked_id = v_me)))
  ),
  weeks as (
    select distinct s.user_id as uid, week_start(s.at) as wk
      from gym_board_sessions(null) s
     where s.user_id in (select v.uid from visible v)
  ),
  anchored as (
    select w.uid, w.wk,
           row_number() over (partition by w.uid order by w.wk desc) - 1 as n,
           case when max(w.wk) over (partition by w.uid) >= week_start(now())
                then week_start(now())
                else week_start(now()) - interval '168 hours' end as anchor
      from weeks w
  ),
  streaks as (
    select an.uid, count(*)::integer as streak
      from anchored an
     where an.wk = an.anchor - an.n * interval '168 hours'
     group by an.uid
  )
  select
    (row_number() over (order by v.value desc, v.display_name, v.uid))::integer,
    v.uid,
    v.display_name,
    v.handle,
    v.avatar_url,
    v.value::integer,
    coalesce(st.streak, 0),
    v.uid = v_me
  from visible v
  left join streaks st on st.uid = v.uid
  order by v.value desc, v.display_name, v.uid;
end;
$$;

revoke all on function public.get_gym_board(text, text) from public, anon, authenticated;
grant execute on function public.get_gym_board(text, text) to authenticated, service_role;
