-- Punchlist 3: "Phantom H2H challenges can't be deleted." Confirmed live: 6 genuine duplicate
-- pending H2H rows between the same creator/opponent pair, 5 of them created within ~34 seconds
-- of each other on 2026-07-30 — a real multi-tap double-insert (from before punchlist 2 added a
-- visible "Challenge sent" confirmation, when tapping Challenge gave no feedback at all and
-- looked like it hadn't registered). Not the create_h2h_challenge self-challenge case (that guard
-- already existed and still blocks p_opponent_id = auth.uid() outright).

-- (a) Purge: keep the OLDEST pending/active row per (pair, mode), decline the rest. Soft
-- (status = 'declined'), not a hard delete — get_my_social_challenges() already excludes
-- declined rows, and this preserves the row for anyone who still holds a stale reference.
with ranked as (
  select
    id,
    row_number() over (
      partition by least(created_by, opponent_id), greatest(created_by, opponent_id), mode
      order by created_at asc
    ) as rn
  from social_challenges
  where mode = 'h2h' and opponent_id is not null and status in ('pending', 'active')
)
update social_challenges
set status = 'declined'
where id in (select id from ranked where rn > 1);

-- (b) Cancel/leave action — creator can cancel a pending invite before it's answered; either
-- participant can end an active one early. Completed/declined/expired challenges are historical
-- and stay immutable (no "un-completing" a finished race).
create or replace function cancel_social_challenge(p_challenge_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_challenge social_challenges;
begin
  select * into v_challenge from social_challenges where id = p_challenge_id;
  if v_challenge.id is null then
    raise exception 'Challenge not found.';
  end if;
  if v_challenge.status not in ('pending', 'active') then
    raise exception 'This challenge has already finished.';
  end if;
  if auth.uid() not in (v_challenge.created_by, v_challenge.opponent_id) then
    raise exception 'Not your challenge.';
  end if;

  update social_challenges set status = 'declined' where id = p_challenge_id;
end;
$$;

-- (c) Dedup guard on create — the actual fix, so new duplicates can't pile up again regardless
-- of client-side double-tap protection. One pending/active h2h at a time per pair, either
-- direction (the self-challenge guard just above already existed and is untouched).
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

  if not exists (
    select 1 from friend_requests
    where status = 'accepted'
      and ((requester_id = auth.uid() and recipient_id = p_opponent_id)
        or (requester_id = p_opponent_id and recipient_id = auth.uid()))
  ) then
    raise exception 'You can only challenge a friend.';
  end if;

  if p_circle_id is not null and not is_group_member(p_circle_id) then
    raise exception 'Not a member of that campfire.';
  end if;

  if exists (
    select 1 from social_challenges
    where mode = 'h2h' and status in ('pending', 'active')
      and ((created_by = auth.uid() and opponent_id = p_opponent_id)
        or (created_by = p_opponent_id and opponent_id = auth.uid()))
  ) then
    raise exception 'You already have an active or pending challenge with this person.';
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
