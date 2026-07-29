-- H2H challenges go friend-to-friend (PHILOI_UI_SPEC.md §16, design-mocks/13/21): opponent-first,
-- gated on the real friend graph (0031) instead of shared-campfire membership, with an optional
-- "let a campfire watch" toggle. Group challenges stay campfire-first/campfire-required — only
-- h2h's shape changes here.

-- circle_id is now optional: an h2h challenge between two friends with no shared campfire (or
-- who just don't want one watching) has nothing to store here. Group challenges always pass one
-- (validated in create_group_challenge, unchanged) so this relaxation is a strict widening.
alter table social_challenges alter column circle_id drop not null;

-- Signature change (p_circle_id moves from required/1st to optional/last, p_opponent_id moves
-- up) — a plain CREATE OR REPLACE would create a second overload instead of replacing this,
-- same lesson as every other reshaped RPC this session. Drop the old 5-arg version first.
drop function if exists create_h2h_challenge(uuid, uuid, text, int, int);

create or replace function create_h2h_challenge(
  p_opponent_id uuid,
  p_race_metric text,
  p_window_hours int,
  p_circle_id uuid default null,
  p_payout_xp int default 200
)
returns social_challenges
language plpgsql
security definer
set search_path = public
as $$
declare
  v_challenge social_challenges;
begin
  if p_opponent_id = auth.uid() then
    raise exception 'Pick someone else to challenge.';
  end if;

  -- Friend-gated, not campfire-gated — an h2h is between two people, full stop (§16).
  if not exists (
    select 1 from friend_requests
    where status = 'accepted'
      and ((requester_id = auth.uid() and recipient_id = p_opponent_id)
        or (requester_id = p_opponent_id and recipient_id = auth.uid()))
  ) then
    raise exception 'You can only challenge a friend.';
  end if;

  -- The watching campfire (if any) only needs the CALLER to belong to it — the opponent
  -- doesn't have to be a member, they're just being watched, not hosted.
  if p_circle_id is not null and not is_group_member(p_circle_id) then
    raise exception 'Not a member of that campfire.';
  end if;

  insert into social_challenges (circle_id, created_by, mode, opponent_id, race_metric, window_hours, payout_xp, status)
  values (p_circle_id, auth.uid(), 'h2h', p_opponent_id, p_race_metric, p_window_hours, p_payout_xp, 'pending')
  returning * into v_challenge;

  perform notify_push(
    array[p_opponent_id],
    'You''ve been challenged',
    (select display_name from profiles where id = auth.uid()) || ' challenged you to a head-to-head.',
    jsonb_build_object('type', 'challenge_invite', 'challenge_id', v_challenge.id),
    'accountability'
  );

  return v_challenge;
end;
$$;

-- get_my_social_challenges() joined groups with an INNER join, which would silently drop any
-- h2h challenge that has no watching campfire (circle_id null) out of the result set entirely —
-- a friend-to-friend challenge with nobody watching would just vanish from the Challenges tab.
-- LEFT join fixes it; circle_name/circle_emoji already nullable in the return shape.
drop function if exists get_my_social_challenges();

create function get_my_social_challenges()
returns table (
  id uuid,
  circle_id uuid,
  circle_name text,
  circle_emoji text,
  created_by uuid,
  created_by_name text,
  mode text,
  opponent_id uuid,
  opponent_name text,
  race_metric text,
  my_score numeric,
  opponent_score numeric,
  target_count int,
  member_count int,
  completed_count int,
  window_hours int,
  starts_at timestamptz,
  ends_at timestamptz,
  status text,
  winner_id uuid,
  payout_xp int,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public
stable
as $$
begin
  return query
  select
    sc.id,
    sc.circle_id,
    g.name as circle_name,
    g.emoji as circle_emoji,
    sc.created_by,
    creator.display_name as created_by_name,
    sc.mode,
    sc.opponent_id,
    opp.display_name as opponent_name,
    sc.race_metric,
    case when sc.mode = 'h2h' and sc.status != 'pending'
      then social_challenge_score(
        case when auth.uid() = sc.opponent_id then sc.opponent_id else sc.created_by end,
        sc.race_metric, sc.starts_at, sc.ends_at)
      else null end as my_score,
    case when sc.mode = 'h2h' and sc.status != 'pending'
      then social_challenge_score(
        case when auth.uid() = sc.opponent_id then sc.created_by else sc.opponent_id end,
        sc.race_metric, sc.starts_at, sc.ends_at)
      else null end as opponent_score,
    sc.target_count,
    case when sc.mode = 'group' then (select count(*)::int from group_members where group_id = sc.circle_id) else null end as member_count,
    case when sc.mode = 'group' then (
      select count(*)::int from group_members gm
      where gm.group_id = sc.circle_id
        and (
          select count(*) from check_ins ci
          where ci.user_id = gm.user_id and ci.duration_seconds is not null and ci.removed_at is null
            and ci.created_at >= sc.starts_at and ci.created_at <= coalesce(sc.ends_at, now())
        ) >= sc.target_count
    ) else null end as completed_count,
    sc.window_hours,
    sc.starts_at,
    sc.ends_at,
    sc.status,
    sc.winner_id,
    sc.payout_xp,
    sc.created_at
  from social_challenges sc
  left join groups g on g.id = sc.circle_id
  join profiles creator on creator.id = sc.created_by
  left join profiles opp on opp.id = sc.opponent_id
  where (is_group_member(sc.circle_id) or sc.created_by = auth.uid() or sc.opponent_id = auth.uid())
    and sc.status != 'declined'
  order by
    (sc.status = 'pending' and sc.opponent_id = auth.uid()) desc,
    sc.created_at desc;
end;
$$;
