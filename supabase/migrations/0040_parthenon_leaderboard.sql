-- Parthenon podium leaderboard + the social layer around it (PHILOI_UI_SPEC.md §15/§16/§18,
-- mocks 37/41/42/43). Reuses get_user_rank/get_user_lock_in_photos (already built for the
-- profile screen) rather than duplicating rank/photo logic — this migration adds what's
-- genuinely new: true-rank pinning on big boards, a Global scope, leaderboard search, friend-
-- profile stats/relationship, the active-challenge marker, and the Watch spectator read.

-- ───────────────────────────── true-rank pinning ─────────────────────────────
-- "Your own pillar/row always pins at the bottom with your true rank (e.g. #47) even on a
-- 4,000-person board" — the old get_university_leaderboard only ever returned the top p_limit
-- rows, so a caller outside that window just vanished from their own board entirely. Fixed by
-- computing every member's real rank via window function, returning the top N PLUS the caller's
-- own row (at its true rank) whenever that falls outside the visible window.
drop function if exists get_university_leaderboard(text, int);

create function get_university_leaderboard(p_university text, p_limit int default 50)
returns table (
  user_id uuid,
  handle text,
  display_name text,
  avatar_url text,
  is_pro boolean,
  score numeric,
  tier text,
  division int,
  check_ins_this_week bigint,
  rank int,
  is_me boolean
)
language plpgsql
security definer
set search_path = public
stable
as $$
begin
  return query
  with ranked as (
    select
      p.id as user_id, p.handle, p.display_name, p.avatar_url, p.is_pro,
      s.score, t.tier, t.division,
      coalesce((
        select count(*) from check_ins ci
        where ci.user_id = p.id and ci.created_at >= date_trunc('week', now())
      ), 0) as check_ins_this_week,
      row_number() over (order by s.score desc, p.display_name asc)::int as rank
    from profiles p
    cross join lateral (select universal_score(p.id) as score) s
    cross join lateral rank_tier_for_score(s.score) t
    where p.university = p_university and not p.is_demo and not p.is_disabled
  )
  select r.*, (r.user_id = auth.uid()) as is_me
  from ranked r
  where r.rank <= p_limit or r.user_id = auth.uid()
  order by r.rank;
end;
$$;

-- Same true-rank pattern, no university filter — "the best individuals anywhere" (§15's 4th
-- scope tab, distinct from Vs. unis' collective school ranking below).
drop function if exists get_global_leaderboard(int);
create function get_global_leaderboard(p_limit int default 50)
returns table (
  user_id uuid,
  handle text,
  display_name text,
  avatar_url text,
  is_pro boolean,
  score numeric,
  tier text,
  division int,
  university text,
  rank int,
  is_me boolean
)
language plpgsql
security definer
set search_path = public
stable
as $$
begin
  return query
  with ranked as (
    select
      p.id as user_id, p.handle, p.display_name, p.avatar_url, p.is_pro,
      s.score, t.tier, t.division, p.university,
      row_number() over (order by s.score desc, p.display_name asc)::int as rank
    from profiles p
    cross join lateral (select universal_score(p.id) as score) s
    cross join lateral rank_tier_for_score(s.score) t
    where not p.is_demo and not p.is_disabled
  )
  select r.*, (r.user_id = auth.uid()) as is_me
  from ranked r
  where r.rank <= p_limit or r.user_id = auth.uid()
  order by r.rank;
end;
$$;

-- ───────────────────────────── leaderboard search ─────────────────────────────
-- Find anyone by name/@handle (§15's magnifier) — each result carries its own rank hexagon,
-- live position + XP, which board that position is on (their own university if it matches the
-- searcher's, else Global), and a friend tag. Position is computed the same way the two
-- leaderboard functions above do (a plain row_number, not a stored value) so it's always live.
create or replace function search_leaderboard(p_query text, p_limit int default 20)
returns table (
  user_id uuid,
  display_name text,
  handle text,
  avatar_url text,
  tier text,
  division int,
  score numeric,
  board text, -- 'My uni' | 'Global'
  board_rank int,
  is_friend boolean
)
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_my_university text;
begin
  select university into v_my_university from profiles where id = auth.uid();

  return query
  with matches as (
    select p.id, p.display_name, p.handle, p.avatar_url, p.university
    from profiles p
    where p.id <> auth.uid()
      and not p.is_demo and not p.is_disabled
      and (p.handle ilike '%' || p_query || '%' or p.display_name ilike '%' || p_query || '%')
    order by
      (p.handle = p_query) desc,
      (p.handle ilike p_query || '%') desc,
      p.display_name asc
    limit p_limit
  ),
  scored as (
    select m.*, s.score, t.tier, t.division
    from matches m
    cross join lateral (select universal_score(m.id) as score) s
    cross join lateral rank_tier_for_score(s.score) t
  ),
  uni_ranked as (
    select p.id, row_number() over (order by universal_score(p.id) desc, p.display_name asc)::int as rank
    from profiles p
    where p.university = v_my_university and not p.is_demo and not p.is_disabled and v_my_university is not null
  ),
  global_ranked as (
    select p.id, row_number() over (order by universal_score(p.id) desc, p.display_name asc)::int as rank
    from profiles p
    where not p.is_demo and not p.is_disabled
  )
  select
    sc.id,
    sc.display_name,
    sc.handle,
    sc.avatar_url,
    sc.tier,
    sc.division,
    sc.score,
    case when sc.university = v_my_university and v_my_university is not null then 'My uni' else 'Global' end as board,
    coalesce(
      case when sc.university = v_my_university and v_my_university is not null then ur.rank else null end,
      gr.rank
    ) as board_rank,
    exists (
      select 1 from friend_requests fr
      where fr.status = 'accepted'
        and ((fr.requester_id = auth.uid() and fr.recipient_id = sc.id) or (fr.requester_id = sc.id and fr.recipient_id = auth.uid()))
    ) as is_friend
  from scored sc
  left join uni_ranked ur on ur.id = sc.id
  left join global_ranked gr on gr.id = sc.id;
end;
$$;

-- ───────────────────────────── Watch opt-in ─────────────────────────────
-- "Let friends watch my live challenges" (§16/§19) — default OFF; publishing your live standing
-- to friends is opt-in, same consent posture as auto-post-synced.
alter table profiles add column if not exists watch_opt_in boolean not null default false;

create or replace function set_my_watch_opt_in(p_enabled boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update profiles set watch_opt_in = p_enabled where id = auth.uid();
end;
$$;

-- ───────────────────────────── friend-profile support ─────────────────────────────
-- Mirrors search_people()'s relationship CASE for exactly one target — the friend-profile
-- screen's Add friend / Friends ✓ button needs this same state machine but isn't a search result.
create or replace function get_relationship_with(p_user_id uuid)
returns text
language sql
security definer
set search_path = public
stable
as $$
  select case
    when p_user_id = auth.uid() then 'self'
    when exists (
      select 1 from friend_requests
      where status = 'accepted'
        and ((requester_id = auth.uid() and recipient_id = p_user_id) or (requester_id = p_user_id and recipient_id = auth.uid()))
    ) then 'friends'
    when exists (select 1 from friend_requests where status = 'pending' and requester_id = auth.uid() and recipient_id = p_user_id) then 'requested'
    when exists (select 1 from friend_requests where status = 'pending' and requester_id = p_user_id and recipient_id = auth.uid()) then 'incoming'
    else 'none'
  end;
$$;

-- Non-sensitive aggregate stats (streak/lock-ins/hours + the goal types they work on) — the
-- friend-profile's stat row + "Works on" chips (mock 43). No privacy gate needed here (unlike
-- photos below): a streak/lock-in count carries no specific content, same as the leaderboard
-- itself already exposing everyone's XP.
create or replace function get_profile_stats(p_user_id uuid)
returns table (current_streak int, lock_in_count bigint, hours_locked_in numeric, goal_types text[])
language sql
security definer
set search_path = public
stable
as $$
  select
    p.current_streak,
    (select count(*) from check_ins ci where ci.user_id = p_user_id and ci.duration_seconds is not null and ci.removed_at is null),
    round(coalesce((select sum(ci.duration_seconds) from check_ins ci where ci.user_id = p_user_id and ci.removed_at is null), 0) / 3600.0, 1),
    coalesce((select array_agg(distinct ci.goal_type) from check_ins ci where ci.user_id = p_user_id and ci.removed_at is null), '{}')
  from profiles p
  where p.id = p_user_id;
$$;

-- ───────────────────────────── active-challenge marker ─────────────────────────────
-- The pulsing chip (mock 37) — visible on your own fire always, on a campfire's member row to
-- any co-member, and on a friend's row/profile to friends (unconditionally — the marker itself
-- isn't watch-gated, only the Watch CTA is; can_watch below is what actually gates that button).
create or replace function get_active_challenge_marker(p_user_id uuid)
returns table (
  challenge_id uuid,
  mode text,
  circle_id uuid,
  opponent_id uuid,
  opponent_name text,
  race_metric text,
  target_count int,
  ends_at timestamptz,
  can_watch boolean
)
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_is_self boolean := p_user_id = auth.uid();
  v_shares_circle boolean;
  v_is_friend boolean;
  v_target_opted_in boolean;
begin
  select exists (
    select 1 from group_members gm1 join group_members gm2 on gm1.group_id = gm2.group_id
    where gm1.user_id = auth.uid() and gm2.user_id = p_user_id
  ) into v_shares_circle;

  select exists (
    select 1 from friend_requests
    where status = 'accepted'
      and ((requester_id = auth.uid() and recipient_id = p_user_id) or (requester_id = p_user_id and recipient_id = auth.uid()))
  ) into v_is_friend;

  if not v_is_self and not v_shares_circle and not v_is_friend then
    return; -- no visibility path at all — not self, no shared campfire, not a friend
  end if;

  select watch_opt_in into v_target_opted_in from profiles where id = p_user_id;

  return query
  select
    sc.id,
    sc.mode,
    sc.circle_id,
    sc.opponent_id,
    opp.display_name,
    sc.race_metric,
    sc.target_count,
    sc.ends_at,
    -- Campfire Watch = any co-member of that challenge's circle; profile Watch = friends AND
    -- their opt-in (§16's access gate, both paths, whichever applies to this viewer).
    (v_shares_circle and sc.circle_id is not null) or (v_is_friend and coalesce(v_target_opted_in, false)) as can_watch
  from social_challenges sc
  left join profiles opp on opp.id = sc.opponent_id
  where sc.status = 'active'
    and (sc.created_by = p_user_id or sc.opponent_id = p_user_id)
  order by sc.ends_at asc nulls last
  limit 1;
end;
$$;

-- ───────────────────────────── Watch — live spectator read ─────────────────────────────
-- The actual contest data (§16): matchup, live scores, live status. Gated identically to
-- can_watch above — re-checked here (not just trusted from the marker) since this is a direct
-- RPC a client could call on its own.
-- Dropped first, same as get_university_leaderboard/get_global_leaderboard above: CREATE OR
-- REPLACE cannot change an existing function's RETURNS TABLE columns, and this function already
-- exists on the database with the 17-column post-cheers shape (created_by_cheers /
-- opponent_cheers). Replacing it in place with this 15-column version fails with "cannot change
-- return type of existing function" — which is exactly what stalled this migration. 0041 drops
-- it again and recreates it WITH the cheer columns, so the end state after both is unchanged.
drop function if exists get_challenge_watch(uuid);

create function get_challenge_watch(p_challenge_id uuid)
returns table (
  challenge_id uuid,
  mode text,
  race_metric text,
  target_count int,
  window_hours int,
  starts_at timestamptz,
  ends_at timestamptz,
  created_by uuid,
  created_by_name text,
  created_by_score numeric,
  created_by_live_status text,
  opponent_id uuid,
  opponent_name text,
  opponent_score numeric,
  opponent_live_status text
)
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_challenge social_challenges;
  v_shares_circle boolean;
  v_creator_opted_in boolean;
  v_opponent_opted_in boolean;
  v_is_friend_of_creator boolean;
  v_is_friend_of_opponent boolean;
begin
  select * into v_challenge from social_challenges where id = p_challenge_id and status = 'active';
  if v_challenge.id is null then
    raise exception 'Challenge not found or not active.';
  end if;

  select exists (
    select 1 from group_members gm1 join group_members gm2 on gm1.group_id = gm2.group_id
    where gm1.user_id = auth.uid() and gm2.user_id = v_challenge.created_by
  ) into v_shares_circle;

  select exists (
    select 1 from friend_requests where status = 'accepted'
      and ((requester_id = auth.uid() and recipient_id = v_challenge.created_by) or (requester_id = v_challenge.created_by and recipient_id = auth.uid()))
  ) into v_is_friend_of_creator;

  select exists (
    select 1 from friend_requests where status = 'accepted'
      and ((requester_id = auth.uid() and recipient_id = v_challenge.opponent_id) or (requester_id = v_challenge.opponent_id and recipient_id = auth.uid()))
  ) into v_is_friend_of_opponent;

  select watch_opt_in into v_creator_opted_in from profiles where id = v_challenge.created_by;
  select watch_opt_in into v_opponent_opted_in from profiles where id = v_challenge.opponent_id;

  if not (
    (v_shares_circle and v_challenge.circle_id is not null)
    or (v_is_friend_of_creator and coalesce(v_creator_opted_in, false))
    or (v_is_friend_of_opponent and coalesce(v_opponent_opted_in, false))
    or auth.uid() in (v_challenge.created_by, v_challenge.opponent_id)
  ) then
    raise exception 'You don''t have access to watch this challenge.';
  end if;

  return query
  select
    v_challenge.id,
    v_challenge.mode,
    v_challenge.race_metric,
    v_challenge.target_count,
    v_challenge.window_hours,
    v_challenge.starts_at,
    v_challenge.ends_at,
    v_challenge.created_by,
    creator.display_name,
    social_challenge_score(v_challenge.created_by, v_challenge.race_metric, v_challenge.starts_at, v_challenge.ends_at),
    live_status(v_challenge.created_by),
    v_challenge.opponent_id,
    opp.display_name,
    case when v_challenge.opponent_id is not null
      then social_challenge_score(v_challenge.opponent_id, v_challenge.race_metric, v_challenge.starts_at, v_challenge.ends_at)
      else null end,
    case when v_challenge.opponent_id is not null then live_status(v_challenge.opponent_id) else null end
  from profiles creator
  left join profiles opp on opp.id = v_challenge.opponent_id
  where creator.id = v_challenge.created_by;
end;
$$;

-- Shared "🔥 locked in now · Gym · 12:34" / "last active 2h ago" text (§16) — used by the
-- Watch scoreboard for each side; a plain SQL function since it's pure read + string formatting.
create or replace function live_status(p_user_id uuid)
returns text
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_session lock_in_sessions;
  v_last_check_in timestamptz;
  v_elapsed_minutes int;
begin
  select * into v_session from lock_in_sessions where user_id = p_user_id and status = 'active';
  if v_session.id is not null then
    v_elapsed_minutes := extract(epoch from now() - v_session.started_at)::int / 60;
    return 'locked in now · ' || initcap(v_session.goal_type) || ' · ' || v_elapsed_minutes || 'm';
  end if;

  select max(created_at) into v_last_check_in from check_ins where user_id = p_user_id and removed_at is null;
  if v_last_check_in is null then
    return 'no activity yet';
  end if;

  return 'last active ' || case
    when now() - v_last_check_in < interval '1 hour' then extract(epoch from now() - v_last_check_in)::int / 60 || 'm ago'
    when now() - v_last_check_in < interval '24 hours' then extract(epoch from now() - v_last_check_in)::int / 3600 || 'h ago'
    else extract(epoch from now() - v_last_check_in)::int / 86400 || 'd ago'
  end;
end;
$$;

-- Group challenge's live leaderboard (§16: "a group challenge shows a live group leaderboard
-- instead of the 1v1 bar") — same access gate as get_challenge_watch, just a different shape.
create or replace function get_group_challenge_watch(p_challenge_id uuid)
returns table (
  challenge_id uuid,
  target_count int,
  window_hours int,
  starts_at timestamptz,
  ends_at timestamptz,
  circle_id uuid,
  circle_name text,
  member_id uuid,
  member_name text,
  member_progress bigint,
  member_live_status text
)
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_challenge social_challenges;
begin
  select * into v_challenge from social_challenges where id = p_challenge_id and status = 'active' and mode = 'group';
  if v_challenge.id is null then
    raise exception 'Group challenge not found or not active.';
  end if;
  if not is_group_member(v_challenge.circle_id) then
    raise exception 'Not a member of that campfire.';
  end if;

  return query
  select
    v_challenge.id,
    v_challenge.target_count,
    v_challenge.window_hours,
    v_challenge.starts_at,
    v_challenge.ends_at,
    v_challenge.circle_id,
    g.name,
    gm.user_id,
    p.display_name,
    (
      select count(*) from check_ins ci
      where ci.user_id = gm.user_id and ci.removed_at is null
        and ci.created_at >= v_challenge.starts_at and ci.created_at <= coalesce(v_challenge.ends_at, now())
        and check_in_qualifies_for_challenge(ci.id)
    ) as member_progress,
    live_status(gm.user_id) as member_live_status
  from group_members gm
  join profiles p on p.id = gm.user_id
  join groups g on g.id = v_challenge.circle_id
  where gm.group_id = v_challenge.circle_id
  order by member_progress desc;
end;
$$;
