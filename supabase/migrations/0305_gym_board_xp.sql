-- 0305 — Gym Spark v2 fixes §3: The Board is XP-first.
--
-- 0301's get_gym_board ranked by finished-lock-in COUNT and returned `sessions`. It now ranks by XP
-- and returns `xp` in that column's place:
--   · 'week' = XP earned this week: sum(check_ins.xp_earned) since week_start() — the same sum
--     ladder_week_xp() uses (every non-removed check-in, any source).
--   · 'all'  = lifetime XP: live_rank_xp(uid) — the number the app shows as your XP / climb (0230:
--     rank is a lifetime climb; live_rank_xp == universal_score + ladder offset).
-- rank is now row_number() (xp desc, display_name, uid): one 🥇 / 🥈 / 🥉, never a pile of tied
-- firsts. Everyone with ≥ 1 XP in the window is listed, plus the caller always (0 if none).
-- week_streak is unchanged (consecutive weeks with a finished lock-in, from gym_board_sessions).
--
-- The return shape changes (sessions → xp), so drop first (CREATE OR REPLACE can't change OUT
-- columns). Safe: get_gym_board is only called by GYM_SPARK builds, and none has shipped.
-- gym_board_sessions stays (streaks use it); gym_board_metric (session count) is no longer read
-- by the board and is left in place, unused, rather than dropped.

drop function if exists public.get_gym_board(text);

create function public.get_gym_board(p_window text)
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
  v_me uuid := auth.uid();
begin
  if v_me is null then
    raise exception 'Not signed in.' using errcode = '42501';
  end if;
  if p_window not in ('week', 'all') then
    raise exception 'Unknown gym board window: %', p_window using errcode = '22023';
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

revoke all on function public.get_gym_board(text) from public, anon, authenticated;
grant execute on function public.get_gym_board(text) to authenticated, service_role;
