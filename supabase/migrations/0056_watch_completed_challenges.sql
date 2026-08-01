-- Punchlist 4E: a COMPLETED challenge should be tappable and open its final standings.
--
-- Both watch RPCs hard-gated on status = 'active' and raised "Challenge not found or not active."
-- otherwise, so routing a finished challenge to watch/[challengeId] would have thrown instead of
-- showing a recap. Widened to also accept completed/expired.
--
-- Safe as a read-only recap: scores come from social_challenge_score(user, metric, starts_at,
-- ends_at), and once ends_at is in the past that window is fixed — so the same query that renders
-- live standings renders FINAL standings for a finished challenge, with no separate code path.
-- The access gate (circle-mate / friend+opt-in / participant) is unchanged, and cheer_challenge
-- deliberately KEEPS its active-only gate: you can watch a finished duel, not cheer one.
--
-- Bodies below are copied verbatim from 0041 (h2h) and 0040 (group) with ONLY the status
-- predicate changed, so the RETURNS TABLE shapes are identical and CREATE OR REPLACE is safe.

create or replace function get_challenge_watch(p_challenge_id uuid)
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
  created_by_cheers int,
  opponent_id uuid,
  opponent_name text,
  opponent_score numeric,
  opponent_live_status text,
  opponent_cheers int
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
  select * into v_challenge from social_challenges where id = p_challenge_id and status in ('active', 'completed', 'expired');
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
    v_challenge.created_by_cheers,
    v_challenge.opponent_id,
    opp.display_name,
    case when v_challenge.opponent_id is not null
      then social_challenge_score(v_challenge.opponent_id, v_challenge.race_metric, v_challenge.starts_at, v_challenge.ends_at)
      else null end,
    case when v_challenge.opponent_id is not null then live_status(v_challenge.opponent_id) else null end,
    v_challenge.opponent_cheers
  from profiles creator
  left join profiles opp on opp.id = v_challenge.opponent_id
  where creator.id = v_challenge.created_by;
end;
$$;

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
  select * into v_challenge from social_challenges where id = p_challenge_id and status in ('active', 'completed', 'expired') and mode = 'group';
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
