-- The Watch spectator screen's Cheer action (PHILOI_UI_SPEC.md §16: "spectators send a reaction
-- to a competitor, with a count") — H2H only (a group challenge shows a live leaderboard instead
-- of a 1v1 bar, with no single "competitor" to cheer). A plain atomic counter, not a per-spectator
-- reactions table — nothing here needs per-person dedup, just a live shared count everyone
-- watching sees the same value for.
alter table social_challenges add column if not exists created_by_cheers int not null default 0;
alter table social_challenges add column if not exists opponent_cheers int not null default 0;

create or replace function cheer_challenge(p_challenge_id uuid, p_for_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_challenge social_challenges;
begin
  select * into v_challenge from social_challenges where id = p_challenge_id and status = 'active';
  if v_challenge.id is null then
    raise exception 'Challenge not found or not active.';
  end if;
  if p_for_user_id = v_challenge.created_by then
    update social_challenges set created_by_cheers = created_by_cheers + 1 where id = p_challenge_id;
  elsif p_for_user_id = v_challenge.opponent_id then
    update social_challenges set opponent_cheers = opponent_cheers + 1 where id = p_challenge_id;
  else
    raise exception 'That person is not in this challenge.';
  end if;
end;
$$;

-- get_challenge_watch's RETURNS TABLE shape changes (two new cheer-count columns) — drop first
-- (CREATE OR REPLACE can't change RETURNS TABLE columns).
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
