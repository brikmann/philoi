-- 0193 — Cindy counts the minutes a session has earned, through one seam.
--
-- CODE_PROMPT_focus_nudge_time_and_calendar.md §1 tail. get_coach_context().active_session
-- .minutes_so_far is raw wall-clock `now() − started_at`. Once pause/resume exists (task #205,
-- CODE_PROMPT_lockin_pause.md), paused time is not focus and must not be quoted as if it were.
--
-- ─────────────────────────────── WHY A SEAM AND NOT THE FORMULA ───────────────────────────────
--
-- Pause/resume has NO server state yet. On 2026-09-16 there is no paused_at /
-- accumulated_paused_seconds column on lock_in_sessions — not in prod, not in any migration, not
-- in any sibling worktree. A body that read those columns would create cleanly (plpgsql resolves
-- columns at call time) and then throw on every call, which is every Cindy message.
--
-- So this migration moves the definition of "credited seconds so far" into
-- lock_in_credited_seconds_so_far(session_id), which today returns EXACTLY the old expression, and
-- points minutes_so_far at it. Behaviour is unchanged on apply. When #205 adds the pause columns,
-- its migration redefines this one small helper —
--
--     (now − started_at) − accumulated_paused_seconds − (paused ? now − paused_at : 0)
--
-- — and Cindy is pause-aware with no restatement of this 12KB body. That is the other half of the
-- point: get_coach_context has been redefined whole 0101 → 0178, and every restatement is a chance
-- for a sibling branch to be silently reverted. The next change to session time should not be one.
--
-- 🔴 FOR #205: redefine lock_in_credited_seconds_so_far in the pause migration. Do not restate
-- get_coach_context for it.
--
-- ─────────────────────────────── WHAT CHANGED ───────────────────────────────
--
-- get_coach_context below is restated from the LIVE pg_get_functiondef (prosrc md5
-- 8426bd073cd7075f542cd594d74272da, byte-identical to 0178's file body). Exactly one expression
-- differs:
--
--   - 'minutes_so_far', round(extract(epoch from (now() - s.started_at)) / 60.0)
--   + 'minutes_so_far', round(lock_in_credited_seconds_so_far(s.id) / 60.0)
--
-- and the post-check pins the resulting prosrc md5, so any other drift fails the migration. The
-- helper returns numeric epoch seconds (not a rounded int) so round(x / 60.0) is the identical
-- computation it replaced. ACL untouched: create or replace keeps get_coach_context's grants.
--
-- Not changed, noticed: unlock_progress.completed_session_hours still reads
-- last_confirmed_at − started_at, which is ~0 on most sessions (0188's root cause). Out of scope
-- for a one-line migration; it wants its own.

-- ── base check · restated from the LIVE body ──
do $base$
begin
  -- CR-stripped: a body applied from a CRLF checkout must not fail an otherwise identical pin.
  if (select md5(replace(p.prosrc, chr(13), '')) from pg_proc p
      where p.proname = 'get_coach_context' and p.pronamespace = 'public'::regnamespace)
     is distinct from '8426bd073cd7075f542cd594d74272da' then
    raise exception '0193: live get_coach_context changed since this file was drafted — rebase onto it';
  end if;
end;
$base$;

create or replace function lock_in_credited_seconds_so_far(p_session_id uuid)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  -- Today: wall-clock, because no pause state exists. #205 replaces this body, and only this body.
  select extract(epoch from (now() - s.started_at))
  from lock_in_sessions s
  where s.id = p_session_id;
$$;

comment on function lock_in_credited_seconds_so_far(uuid) is
  'Seconds of focus a lock-in session has earned so far. Wall-clock until pause/resume (#205) lands; '
  'that migration redefines this body to exclude paused time. Read by get_coach_context. 0193.';

revoke all on function public.lock_in_credited_seconds_so_far(uuid) from public, anon, authenticated;

create or replace function public.get_coach_context()
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare
  v_user uuid := auth.uid();
  v_profile record;
  v_rank record;
  v_next record;
  v_xp_rate numeric;
  v_rate_sessions int;
  v_result jsonb;
begin
  if v_user is null then
    raise exception 'get_coach_context: not authenticated';
  end if;

  select p.display_name, p.handle, p.university, p.timezone, p.current_streak, p.longest_streak,
         p.embers, p.daily_goal_mode, p.created_at, p.height_cm, p.weight_kg, p.weight_unit
    into v_profile
  from profiles p where p.id = v_user;

  -- ── rank + the ladder math, which is what turns "how far to Hero?" into a number ──
  -- rank_tier_for_score/universal_score are the same pair get_my_ranks uses, called directly so
  -- this reads p_user's rank rather than depending on an auth.uid()-scoped helper.
  select t.tier, t.division, universal_score(v_user) as score
    into v_rank
  from rank_tier_for_score(universal_score(v_user)) t limit 1;

  -- The user's measured XP/hour over 30 days. Mirrors src/lib/api/xp-rate.ts EXACTLY (>= 60s,
  -- non-null duration, not removed) — if these two drift, Cindy and the lock-in pill would quote
  -- different numbers for the same question, which is worse than either being slightly off.
  select coalesce(sum(c.xp_earned), 0) / nullif(sum(c.duration_seconds) / 3600.0, 0), count(*)
    into v_xp_rate, v_rate_sessions
  from check_ins c
  where c.user_id = v_user
    and c.created_at >= now() - interval '30 days'
    and c.removed_at is null
    and c.duration_seconds is not null
    and c.duration_seconds >= 60;

  -- Fewer than 3 timed sessions is not a rate, it's noise (same floor as xp-rate.ts). Null here
  -- makes the model say "once you've got a few sessions logged" instead of inventing a pace.
  if coalesce(v_rate_sessions, 0) < 3 then
    v_xp_rate := null;
  end if;

  select rt.tier, rt.division, rt.cumulative_xp_required
    into v_next
  from rank_thresholds rt
  where rt.cumulative_xp_required > coalesce(v_rank.score, 0)
  order by rt.cumulative_xp_required asc
  limit 1;

  v_result := jsonb_build_object(
    'generated_at', now(),

    'profile', jsonb_build_object(
      'display_name', v_profile.display_name,
      'first_name', split_part(coalesce(v_profile.display_name, ''), ' ', 1),
      'handle', v_profile.handle,
      'university', v_profile.university,
      'timezone', v_profile.timezone,
      'local_time', to_char(now() at time zone coalesce(v_profile.timezone, 'UTC'), 'YYYY-MM-DD HH24:MI (Dy)'),
      'current_streak', v_profile.current_streak,
      'longest_streak', v_profile.longest_streak,
      'embers', v_profile.embers,
      'member_since', v_profile.created_at
    ),

    -- ── THE BODY THE GOAL IS SCORED AGAINST (DIFFICULTY_SCOPING.md "Fitness is IPSATIVE") ──
    -- Self-reported, optional, and the ONLY reason it is here: a load goal has to be read as a
    -- multiple of the person lifting it, or Cindy scores the plates instead of the effort. Null is
    -- a supported state and the prompt says what to do with it -- ask once, or fall back to the
    -- demographic anchors. Never to raw pounds.
    --
    -- 🔒 SCORING ONLY. Nothing downstream of this pays out: fitness loot comes from consistency
    -- goals and relic rungs, and a one-off PR mints no box however good the ratio (the 🔴 DECISION
    -- in DIFFICULTY_SCOPING.md). Weight moves the FLEX -- share card, leaderboard order, and later
    -- the discipline cosmetics -- and nothing in the economy.
    --
    -- BOTH UNITS ARE SHIPPED on purpose. The prompt forbids inventing numbers, and a unit
    -- conversion done in the model's head is exactly the kind of invented number that reads as
    -- authoritative. `weight_unit` is which one to SAY it back in; `weight_lb` is so she never
    -- has to multiply.
    'body', jsonb_build_object(
      'height_cm', v_profile.height_cm,
      'weight_kg', v_profile.weight_kg,
      'weight_lb', case when v_profile.weight_kg is null then null
                        else round(v_profile.weight_kg * 2.2046226218, 1) end,
      'weight_unit', coalesce(v_profile.weight_unit, 'lb')
    ),

    -- ── RANK + THE XP LADDER ──
    -- The whole ladder ships with the context, not just the current rung: "how much to reach
    -- Hero" needs every threshold between here and Hero, and shipping the table is far cheaper
    -- and more reliable than teaching the model to ask for each rung.
    'rank', jsonb_build_object(
      'tier', v_rank.tier,
      'division', v_rank.division,
      'score', round(coalesce(v_rank.score, 0)::numeric, 1),
      'next_tier', v_next.tier,
      'next_division', v_next.division,
      'xp_to_next', case when v_next.cumulative_xp_required is null then null
                        else round((v_next.cumulative_xp_required - coalesce(v_rank.score, 0))::numeric, 0) end,
      'xp_per_hour', case when v_xp_rate is null then null else round(v_xp_rate::numeric, 0) end,
      'xp_rate_sessions', v_rate_sessions,
      'ladder', (
        select coalesce(jsonb_agg(jsonb_build_object(
                 'tier', rt.tier, 'division', rt.division, 'cumulative_xp', rt.cumulative_xp_required
               ) order by rt.rank_index), '[]'::jsonb)
        from rank_thresholds rt
      )
    ),

    -- ── SESSIONS: what's happening right now, and the recent shape of their effort ──
    'active_session', (
      select jsonb_build_object(
               'id', s.id, 'goal_type', s.goal_type, 'goal_detail', s.goal_detail,
               'circle_id', s.circle_id, 'started_at', s.started_at,
               'minutes_so_far', round(lock_in_credited_seconds_so_far(s.id) / 60.0)
             )
      from lock_in_sessions s
      where s.user_id = v_user and s.status = 'active'
      order by s.started_at desc limit 1
    ),

    'recent_sessions', (
      select coalesce(jsonb_agg(x order by x->>'at' desc), '[]'::jsonb) from (
        select jsonb_build_object(
                 'at', c.created_at, 'type', c.goal_type, 'detail', c.goal_detail,
                 'minutes', round(c.duration_seconds / 60.0), 'xp', c.xp_earned
               ) as x
        from check_ins c
        where c.user_id = v_user and c.removed_at is null
          and c.created_at >= now() - interval '14 days'
        order by c.created_at desc limit 25
      ) s
    ),

    -- Rolled up so the model doesn't have to sum 25 rows to answer "how am I doing this week" —
    -- and so it can compare this week against the user's own norm rather than a generic one.
    'effort', jsonb_build_object(
      'today_minutes', (
        select coalesce(round(sum(c.duration_seconds) / 60.0), 0) from check_ins c
        where c.user_id = v_user and c.removed_at is null
          and c.created_at >= date_trunc('day', now() at time zone coalesce(v_profile.timezone, 'UTC'))
      ),
      'week_minutes', (
        select coalesce(round(sum(c.duration_seconds) / 60.0), 0) from check_ins c
        where c.user_id = v_user and c.removed_at is null and c.created_at >= now() - interval '7 days'
      ),
      'prev_week_minutes', (
        select coalesce(round(sum(c.duration_seconds) / 60.0), 0) from check_ins c
        where c.user_id = v_user and c.removed_at is null
          and c.created_at >= now() - interval '14 days' and c.created_at < now() - interval '7 days'
      ),
      'total_hours', (
        select coalesce(round(sum(c.duration_seconds) / 3600.0, 1), 0) from check_ins c
        where c.user_id = v_user and c.removed_at is null
      ),
      'hours_since_last_session', (
        select round(extract(epoch from (now() - max(c.created_at))) / 3600.0, 1) from check_ins c
        where c.user_id = v_user and c.removed_at is null
      ),
      -- By type, so "lock in on classes to reach Hero" can be answered about STUDY specifically
      -- rather than about all effort averaged together.
      'by_type_30d', (
        select coalesce(jsonb_object_agg(t.goal_type, t.minutes), '{}'::jsonb) from (
          select c.goal_type, round(sum(c.duration_seconds) / 60.0) as minutes
          from check_ins c
          where c.user_id = v_user and c.removed_at is null
            and c.created_at >= now() - interval '30 days'
          group by c.goal_type
        ) t
      )
    ),

    -- ── GOALS + CHALLENGES + STANDINGS ──
    'goals', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'id', g.id, 'type', g.type, 'label', g.label, 'cadence', g.cadence,
               'current_streak', g.current_streak
             )), '[]'::jsonb)
      from goals g where g.user_id = v_user and g.archived_at is null
    ),

    'challenges', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'id', ch.id, 'type', ch.type, 'label', ch.label, 'target', ch.target,
               'unit', ch.unit, 'period', ch.period, 'progress', ch.progress,
               'pct', case when ch.target > 0 then round(100.0 * ch.progress / ch.target) else null end,
               'period_start', ch.period_start, 'completed_at', ch.completed_at
             )), '[]'::jsonb)
      from challenges ch
      where ch.user_id = v_user and ch.completed_at is null
    ),

    -- ── COSMETICS: inventory, what's equipped, and what it would take to unlock the rest ──
    -- The equipped flame is Cindy's own appearance (CINDY_SPEC: "customizing a flame = dressing
    -- up your companion"), so she genuinely needs to know what she's wearing.
    'equipped', (
      select coalesce(jsonb_object_agg(e.slot, e.cosmetic_key), '{}'::jsonb)
      from equipped_loadout e where e.user_id = v_user
    ),
    'owned_cosmetics', (
      select coalesce(jsonb_agg(co.cosmetic_key), '[]'::jsonb)
      from cosmetics_owned co where co.user_id = v_user
    ),

    -- Live progress toward the relic conditions economy_evaluate_relics() actually checks. These
    -- numbers are what make "what do I need to unlock X" a receipt instead of a guess; the
    -- condition TEXT ships from the client catalog, the PROGRESS ships from here.
    'unlock_progress', jsonb_build_object(
      'longest_streak', v_profile.longest_streak,
      'completed_session_hours', (
        select coalesce(round(sum(extract(epoch from (s.last_confirmed_at - s.started_at))) / 3600.0, 1), 0)
        from lock_in_sessions s where s.user_id = v_user and s.status = 'completed'
      ),
      'peak_tier', v_rank.tier,
      'best_season_percentile', (
        select round(min(100.0 * ss.rank / greatest(ss.board_size, 1)), 1)
        from season_standings ss where ss.user_id = v_user
      )
    ),

    -- ── MILESTONES (PROFILE_SPEC §G) — 🔒 zero XP, and the model is told so in the prompt ──
    'milestones', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'id', m.id, 'kind', m.kind, 'headline', m.headline, 'at', m.created_at
             ) order by m.created_at desc), '[]'::jsonb)
      from (select * from milestones where user_id = v_user order by created_at desc limit 10) m
    ),
    -- The receipts a new milestone would be stamped with, so Cindy can say "backed by your 41h"
    -- BEFORE posting rather than discovering the numbers afterwards.
    'milestone_effort', (
      select jsonb_build_object(
        'hours', coalesce(round(sum(c.duration_seconds) / 3600.0), 0),
        'lockins', count(*),
        'streak', v_profile.current_streak
      )
      from check_ins c where c.user_id = v_user and c.removed_at is null
    ),

    -- ── THE BELL ──
    'notifications', jsonb_build_object(
      'unread', (select count(*) from notification_events n where n.user_id = v_user and n.read_at is null),
      'recent', (
        select coalesce(jsonb_agg(jsonb_build_object(
                 'type', n.type, 'title', n.title, 'body', n.body, 'at', n.created_at,
                 'read', n.read_at is not null
               ) order by n.created_at desc), '[]'::jsonb)
        from (select * from notification_events where user_id = v_user
              order by created_at desc limit 12) n
      )
    ),

    -- ── CAMPFIRES ── membership only. Never other members' private rows: Cindy is scoped to the
    -- caller, and a circle she can name is not a circle she can read into.
    'campfires', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'id', g.id, 'name', g.name, 'role', gm.role
             )), '[]'::jsonb)
      from group_members gm join groups g on g.id = gm.group_id
      where gm.user_id = v_user
    )
  );

  return v_result;
end;
$function$;

-- ── post-check ──
do $assert$
begin
  if (select count(*) from pg_proc p
      where p.proname = 'get_coach_context' and p.pronamespace = 'public'::regnamespace) <> 1 then
    raise exception '0193: get_coach_context overload count <> 1';
  end if;
  -- Pins the WHOLE body: the live base with exactly the one minutes_so_far line swapped.
  -- CR-stripped: a body applied from a CRLF checkout must not fail an otherwise identical pin.
  if (select md5(replace(p.prosrc, chr(13), '')) from pg_proc p
      where p.proname = 'get_coach_context' and p.pronamespace = 'public'::regnamespace)
     <> '191206d4a2e157f8b5e09e3d749c09e2' then
    raise exception '0193: get_coach_context body is not the expected one-line change';
  end if;
end;
$assert$;
