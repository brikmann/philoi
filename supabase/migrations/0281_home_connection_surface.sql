-- HOME AS A CONNECTION SURFACE (mock 318). Three read RPCs, no writes, no schema change.
--
-- Home stops being a feed (that moved to the Social tab) and becomes "you + your people":
--
--   1. get_my_week_vs_last()       — you against your OWN last week, never against anyone else.
--                                    Locked-in time this week vs last (both the full week and
--                                    last week up to this same moment, so a Tuesday isn't judged
--                                    against a whole Sunday-to-Saturday), current streak vs best,
--                                    and whether your rank moved since the week opened.
--   2. get_my_backers_this_week()  — the friends who cheered you this week: lock-in cheers (0270)
--                                    plus cheers on your Agora posts and milestones. One row per
--                                    friend, their latest cheer, newest first.
--   3. get_friends_recent_effort() — a short, reverse-chronological "your people right now" strip:
--                                    each friend's latest real effort (live session, lock-in, PR,
--                                    or a short text post) from the last 7 days. Never ranked.
--
-- Rules shared by all three:
--   * Week = week_start() (0071, Sunday 00:00 UTC) — the same boundary as every weekly reset and
--     src/lib/time/week.ts. Nothing here rolls its own week math.
--   * "Locked in" = check_ins with a duration whose source is 'manual' (a real lock-in). Strava
--     syncs are effort but not lock-in time; they'd inflate the one number the user steers by.
--     Duration lives in check_ins, never in lock_in_sessions timestamps (lock_in_sessions'
--     last_confirmed_at == started_at on most rows).
--   * Friends = accepted friend_requests. Blocks either way, disabled accounts and strangers are
--     dropped. Post cheers can come from non-friends on a campus post; those are NOT counted —
--     this card is about your people.
--   * Live presence respects show_live_status in both directions (0270's rule: hiding yours hides
--     theirs from you) and show_live_activity hides WHAT, not THAT. An unposted lock-in is masked
--     the same way; a post the friend chose to share is shown as shared.
--   * Posts are surfaced only when can_see_agora() says the caller may see them, and campfire /
--     forest room posts (0277) are left out entirely: they're stored visibility = 'public' with the
--     room as their audience, so can_see_agora would wave them through (0280 adds
--     can_see_agora_post for the room-aware gate; Home doesn't need room posts at all).
--   * Lock-in MESSAGE text is never read here: 0270 threads are live-only with no history by design.
--
-- Rank: universal_score() = sum(check_ins.xp_earned, removed_at null) + sum(bonus_xp_awards). The
-- score at the week's start is that minus what was earned since week_start(), so "climbed" is a
-- rank_index comparison without a snapshot table. Rank is a lifetime climb (0230) — it never falls.
--
-- New function names only; nothing existing is restated.
-- LEDGER: 0281 (0279 video and 0280 post audience belong to sibling sessions). NO db push.

-- ═══════════════════════════════ 1 · your week ═══════════════════════════════

drop function if exists public.get_my_week_vs_last();
create function public.get_my_week_vs_last()
returns table (
  out_week_start              timestamptz,
  out_this_week_seconds       integer,
  out_last_week_seconds       integer,
  out_last_week_to_date_secs  integer,
  out_sessions_this_week      integer,
  out_current_streak          integer,
  out_longest_streak          integer,
  out_tier                    text,
  out_division                integer,
  out_rank_index              integer,
  out_week_start_rank_index   integer
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_me         uuid := auth.uid();
  v_ws         timestamptz := week_start();
  v_prev       timestamptz := week_start() - interval '7 days';
  v_score      numeric;
  v_earned     numeric;
  v_tier       text;
  v_division   integer;
  v_rank_idx   integer;
  v_start_idx  integer;
begin
  if v_me is null then
    raise exception 'not authenticated';
  end if;

  v_score := universal_score(v_me);
  v_earned :=
      coalesce((select sum(ci.xp_earned) from check_ins ci
                 where ci.user_id = v_me and ci.removed_at is null and ci.created_at >= v_ws), 0)
    + coalesce((select sum(b.amount) from bonus_xp_awards b
                 where b.user_id = v_me and b.created_at >= v_ws), 0);

  select t.tier, t.division into v_tier, v_division from rank_tier_for_score(v_score) t;
  select rt.rank_index into v_rank_idx
    from rank_thresholds rt where rt.tier = v_tier and rt.division = v_division;
  select rt.rank_index into v_start_idx
    from rank_tier_for_score(v_score - v_earned) t0
    join rank_thresholds rt on rt.tier = t0.tier and rt.division = t0.division;

  return query
  select v_ws,
         coalesce(sum(ci.duration_seconds) filter (where ci.created_at >= v_ws), 0)::int,
         coalesce(sum(ci.duration_seconds) filter (where ci.created_at < v_ws), 0)::int,
         -- Last week up to the same offset into the week as now.
         coalesce(sum(ci.duration_seconds) filter (
           where ci.created_at < v_ws and ci.created_at < v_prev + (now() - v_ws)), 0)::int,
         (count(*) filter (where ci.created_at >= v_ws))::int,
         coalesce(p.current_streak, 0),
         coalesce(p.longest_streak, 0),
         v_tier,
         v_division,
         v_rank_idx,
         v_start_idx
    from profiles p
    left join check_ins ci
      on ci.user_id = p.id
     and ci.removed_at is null
     and ci.duration_seconds > 0
     and coalesce(ci.source, 'manual') = 'manual'
     and ci.created_at >= v_prev
   where p.id = v_me
   group by p.current_streak, p.longest_streak;
end;
$$;

revoke all on function public.get_my_week_vs_last() from public, anon, authenticated;
grant execute on function public.get_my_week_vs_last() to authenticated;

-- ═══════════════════════════════ 2 · who's backing you ═══════════════════════════════

drop function if exists public.get_my_backers_this_week();
create function public.get_my_backers_this_week()
returns table (
  out_user_id      uuid,
  out_display_name text,
  out_handle       text,
  out_avatar_url   text,
  out_cheers       integer,
  -- The latest cheer from this friend: 'lockin' | 'post' | 'milestone'.
  out_kind         text,
  out_preset       text,
  out_goal_type    text,
  out_category     text,
  out_activity     text,
  out_attach_kind  text,
  out_detail       text,
  out_at           timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_ws timestamptz := week_start();
begin
  if v_me is null then
    raise exception 'not authenticated';
  end if;

  return query
  with f as (
    select distinct case when fr.requester_id = v_me then fr.recipient_id else fr.requester_id end as fid
      from friend_requests fr
     where fr.status = 'accepted'
       and (fr.requester_id = v_me or fr.recipient_id = v_me)
  ),
  ev as (
    select c.from_user as uid, 'lockin'::text as kind, c.preset,
           s.goal_type, s.category, s.activity, null::text as attach_kind, null::text as detail,
           c.created_at as at
      from lockin_cheers c
      join lock_in_sessions s on s.id = c.session_id
     where c.to_user = v_me and c.created_at >= v_ws
    union all
    select pc.user_id, 'post', null,
           ap.attach_snapshot ->> 'goal_type', null, null, ap.attach_kind,
           ap.attach_snapshot ->> 'exercise',
           pc.created_at
      from agora_post_cheers pc
      join agora_posts ap on ap.id = pc.post_id
     where ap.user_id = v_me and pc.created_at >= v_ws
    union all
    select mc.user_id, 'milestone', null, null, null, null, m.kind, m.headline, mc.created_at
      from milestone_cheers mc
      join milestones m on m.id = mc.milestone_id
     where m.user_id = v_me and mc.created_at >= v_ws
  ),
  ok as (
    select e.*
      from ev e
      join f on f.fid = e.uid
      join profiles bp on bp.id = e.uid
     where e.uid <> v_me
       and not coalesce(bp.is_disabled, false)
       and not exists (
         select 1 from blocked_users b
          where (b.blocker_id = v_me and b.blocked_id = e.uid)
             or (b.blocker_id = e.uid and b.blocked_id = v_me))
  ),
  latest as (
    select distinct on (o.uid) o.*, count(*) over (partition by o.uid) as n
      from ok o
     order by o.uid, o.at desc
  )
  select l.uid, p.display_name, p.handle, p.avatar_url, l.n::int,
         l.kind, l.preset, l.goal_type, l.category, l.activity, l.attach_kind, l.detail, l.at
    from latest l
    join profiles p on p.id = l.uid
   order by l.at desc;
end;
$$;

revoke all on function public.get_my_backers_this_week() from public, anon, authenticated;
grant execute on function public.get_my_backers_this_week() to authenticated;

-- ═══════════════════════════════ 3 · what your people are doing ═══════════════════════════════

drop function if exists public.get_friends_recent_effort(integer);
create function public.get_friends_recent_effort(p_limit integer default 5)
returns table (
  out_user_id          uuid,
  out_display_name     text,
  out_handle           text,
  out_avatar_url       text,
  -- 'live' | 'lockin' | 'pr' | 'post'
  out_kind             text,
  out_live             boolean,
  out_goal_type        text,
  out_category         text,
  out_activity         text,
  out_duration_seconds integer,
  out_started_at       timestamptz,
  out_paused           boolean,
  out_exercise         text,
  out_weight           numeric,
  out_reps             integer,
  out_body             text,
  -- The friend's own Agora post for this effort, when there is one the caller may see — the
  -- target of a non-live Cheer. Null = no post to cheer (the client offers a message instead).
  out_post_id          uuid,
  out_i_cheered        boolean,
  out_at               timestamptz,
  -- Friends with anything to show, before the limit — the "+N more" tap-through.
  out_total            integer
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_me       uuid := auth.uid();
  v_since    timestamptz := now() - interval '7 days';
  v_see_live boolean;
begin
  if v_me is null then
    raise exception 'not authenticated';
  end if;

  v_see_live := coalesce((select p.show_live_status from profiles p where p.id = v_me), true);

  return query
  with f as (
    select t.id as fid, coalesce(t.show_live_status, true) as shows_live,
           coalesce(t.show_live_activity, true) as shows_what
      from (select distinct case when fr.requester_id = v_me then fr.recipient_id else fr.requester_id end as uid
              from friend_requests fr
             where fr.status = 'accepted'
               and (fr.requester_id = v_me or fr.recipient_id = v_me)) x
      join profiles t on t.id = x.uid
     where not coalesce(t.is_disabled, false)
       and not exists (
         select 1 from blocked_users b
          where (b.blocker_id = v_me and b.blocked_id = t.id)
             or (b.blocker_id = t.id and b.blocked_id = v_me))
  ),
  -- Friends' posts the caller may see, outside campfire and forest rooms. Room posts are stored
  -- visibility = 'public' (their audience is the room), so can_see_agora alone would pass a
  -- members-only campfire post to a non-member friend.
  vp as (
    select ap.id, ap.user_id, ap.attach_kind, ap.attach_ref_id, ap.body, ap.created_at
      from agora_posts ap
      join f on f.fid = ap.user_id
     where ap.created_at >= v_since - interval '1 day'
       and ap.campfire_id is null
       and ap.forest_id is null
       and can_see_agora(ap.user_id, ap.visibility, v_me)
  ),
  ev as (
    -- Live right now.
    select s.user_id as uid, 'live'::text as kind, true as live,
           case when f.shows_what then s.goal_type end as goal_type,
           case when f.shows_what then s.category end as category,
           case when f.shows_what then s.activity end as activity,
           null::int as duration_seconds, s.started_at, coalesce(s.paused, false) as paused,
           null::text as exercise, null::numeric as weight, null::int as reps, null::text as body,
           null::uuid as post_id,
           exists (select 1 from lockin_cheers c where c.from_user = v_me and c.session_id = s.id) as i_cheered,
           s.started_at as at
      from lock_in_sessions s
      join f on f.fid = s.user_id
     where s.status = 'active' and v_see_live and f.shows_live
    union all
    -- A finished lock-in. Its post (if shared) unmasks it and becomes the cheer target.
    select ci.user_id, 'lockin', false,
           case when f.shows_what or lp.id is not null then ci.goal_type end,
           case when f.shows_what or lp.id is not null then ci.category end,
           case when f.shows_what or lp.id is not null then ci.activity end,
           ci.duration_seconds, null, false, null, null, null, null,
           lp.id,
           lp.id is not null and exists (select 1 from agora_post_cheers pc where pc.post_id = lp.id and pc.user_id = v_me),
           ci.created_at
      from check_ins ci
      join f on f.fid = ci.user_id
      left join lateral (
        select vp.id from vp where vp.attach_kind = 'lockin' and vp.attach_ref_id = ci.id limit 1
      ) lp on true
     where ci.created_at >= v_since
       and ci.removed_at is null
       and ci.duration_seconds > 0
       and coalesce(ci.source, 'manual') = 'manual'
    union all
    -- A personal record that stands: ranked (not private) and not pulled or under dispute.
    select pr.user_id, 'pr', false, null, null, null, null, null, false,
           e.name, pr.weight, pr.reps, null,
           pp.id,
           pp.id is not null and exists (select 1 from agora_post_cheers pc where pc.post_id = pp.id and pc.user_id = v_me),
           pr.achieved_at
      from personal_records pr
      join f on f.fid = pr.user_id
      join workout_sets ws on ws.id = pr.workout_set_id
      join exercises e on e.id = pr.exercise_id
      left join lateral (
        select vp.id from vp where vp.attach_kind = 'pr' and vp.attach_ref_id = pr.id limit 1
      ) pp on true
     where pr.achieved_at >= v_since
       and ws.is_pr
       and not coalesce(ws.pr_private, false)
       and ws.pr_status = 'ok'
    union all
    -- A short text post — their own words ("orgo final in 3 days").
    select vp.user_id, 'post', false, null, null, null, null, null, false, null, null, null,
           left(btrim(vp.body), 120),
           vp.id,
           exists (select 1 from agora_post_cheers pc where pc.post_id = vp.id and pc.user_id = v_me),
           vp.created_at
      from vp
     where vp.attach_kind is null
       and vp.created_at >= v_since
       and nullif(btrim(vp.body), '') is not null
  ),
  -- One row per friend: live beats everything, otherwise their newest effort.
  latest as (
    select distinct on (e.uid) e.*
      from ev e
     order by e.uid, e.live desc, e.at desc
  ),
  counted as (
    select l.*, count(*) over () as total from latest l
  )
  select c.uid, p.display_name, p.handle, p.avatar_url,
         c.kind, c.live, c.goal_type, c.category, c.activity, c.duration_seconds, c.started_at, c.paused,
         c.exercise, c.weight, c.reps, c.body, c.post_id, c.i_cheered, c.at, c.total::int
    from counted c
    join profiles p on p.id = c.uid
   order by c.at desc
   limit least(greatest(coalesce(p_limit, 5), 1), 50);
end;
$$;

revoke all on function public.get_friends_recent_effort(integer) from public, anon, authenticated;
grant execute on function public.get_friends_recent_effort(integer) to authenticated;
