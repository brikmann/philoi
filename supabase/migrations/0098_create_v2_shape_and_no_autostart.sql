-- Handoff B, 0098 — create learns the v2 shape: public name, shape tag, and NO AUTO-START.
--
-- NO AUTO-START, at last (the spec's first 🔴). create_group_challenge inserted with
-- `status = 'active', starts_at = now(), ends_at = now() + window` — so a group challenge began
-- the instant it was created, whether or not a single member had agreed to race. 0019's own
-- comment says the quiet part: "set immediately for group/solo (no invite step)".
--
-- It now inserts as a DRAFT with a null window. The window is set by start_challenge (0096), which
-- is also where every baseline is captured — the two have to happen together, because a baseline
-- taken before people accepted would credit whatever they did while deciding.
--
-- DROP FIRST, both of them. Each gains p_public_name, and adding a DEFAULTED parameter to an
-- existing function does not replace it — it creates an overload, and every existing 4/5-argument
-- call then matches two candidates and fails with "function is not unique". Fourth time this trap
-- has come up in this series; the drop is the whole fix.
--
-- Both bodies are the originals (h2h from 0053, group from 0019), transformed programmatically —
-- only the signature, the column list and the values tuple changed. Retyping a function that
-- writes a row people race on is how a transcription error becomes a broken challenge.

drop function if exists create_h2h_challenge(uuid, text, int, uuid, int);

create or replace function create_h2h_challenge(
  p_opponent_id uuid,
  p_race_metric text,
  p_window_hours int,
  p_circle_id uuid default null,
  p_payout_xp int default 200,
  p_public_name text default null
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

  insert into social_challenges (circle_id, created_by, mode, opponent_id, race_metric, window_hours, payout_xp, status, public_name, shape)
  values (p_circle_id, auth.uid(), 'h2h', p_opponent_id, p_race_metric, p_window_hours, p_payout_xp, 'pending', nullif(btrim(coalesce(p_public_name, '')), ''), 'duel')
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

drop function if exists create_group_challenge(uuid, int, int, int);

create or replace function create_group_challenge(
  p_circle_id uuid,
  p_target_count int,
  p_window_hours int,
  p_payout_xp int default 300,
  p_public_name text default null
)
returns social_challenges
language plpgsql
security definer
set search_path = public
as $$
declare
  v_challenge social_challenges;
begin
  if not is_group_member(p_circle_id) then
    raise exception 'Not a member of that campfire.';
  end if;

  insert into social_challenges (circle_id, created_by, mode, target_count, window_hours, payout_xp, status, starts_at, ends_at, public_name, shape)
  values (p_circle_id, auth.uid(), 'group', p_target_count, p_window_hours, p_payout_xp, 'draft', null, null, nullif(btrim(coalesce(p_public_name, '')), ''), 'collective')
  returning * into v_challenge;

  return v_challenge;
end;
$$;
