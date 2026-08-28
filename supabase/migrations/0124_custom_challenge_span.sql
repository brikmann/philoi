-- 0124 — a challenge can run for an arbitrary span, not just 24h / 3d / 1w.
--
-- CODE_PROMPT_challenge_v2 B1. The prompt says "no new migration — the server path exists", and
-- that is HALF true, which is why this file exists:
--
--   · starts_on / ends_on have been columns since 0096. TRUE.
--   · start_challenge already honours them — `ends_at = coalesce(ends_on, now() + window_hours)`.
--     TRUE, and untouched below.
--   · Something can SET them. FALSE. Neither create RPC accepts them (0098's signatures stop at
--     p_public_name) and nothing else writes them, so every row in the table has both null and
--     start_challenge's coalesce has never once taken its first branch.
--
-- And one thing the prompt could not have known without reading respond_to_h2h_challenge:
--
--   · A DUEL NEVER REACHES start_challenge AT ALL. start_challenge is admin-gated on
--     is_campfire_admin(circle_id, ...), and a friend-to-friend duel has a null circle_id (§16) —
--     it would refuse every time. Duels start from respond_to_h2h_challenge (0112) instead, which
--     hardcodes `ends_at = now() + make_interval(hours => window_hours)`. So a custom span on a
--     duel would have been accepted at creation, stored, and then silently ignored at the gun.
--     Section 3 fixes that; it is the whole reason B1 is not UI-only.
--
-- DROP FIRST, BOTH OF THEM. Adding a DEFAULTED parameter to an existing function does not replace
-- it — it creates an overload, and every existing call then matches two candidates and fails with
-- "function is not unique". 0098's header calls this "the fourth time this trap has come up in
-- this series"; it is not going to be the last, so the drop stays.
--
-- Bodies are 0098's, transformed programmatically. Only the signature, the validation block, the
-- column list and the values tuple changed.
--
-- Forward-only. No data change: every existing row keeps null/null and behaves exactly as it does
-- today.

-- ───────────────────────── 1 · one definition of a legal span ─────────────────────────
--
-- Both create paths check the same thing, so it is one function rather than two copies that drift.
-- The CLIENT checks this too (challenge-span-picker's spanError) — that copy exists to say it
-- helpfully before a round trip, this one exists because it is the one that is actually enforced.
--
-- The cap is a year. It is far beyond the semester mock 114 asks for, and it is not arbitrary
-- caution: window_hours feeds grant_reward's duration band, and an unbounded span would let a
-- creator dial the payout multiplier up by typing a bigger number into a date field.
create or replace function assert_challenge_span(p_starts_on timestamptz, p_ends_on timestamptz)
returns void
language plpgsql
immutable
as $$
begin
  -- Both null is the preset case and is the ONLY partial state allowed: one date without the other
  -- would leave start_challenge's coalesce half-applied, which is a window nobody chose.
  if p_starts_on is null and p_ends_on is null then
    return;
  end if;
  if p_starts_on is null or p_ends_on is null then
    raise exception 'A custom span needs both a start and an end date.';
  end if;
  if p_ends_on <= p_starts_on then
    raise exception 'The end date has to come after the start.';
  end if;
  if p_ends_on - p_starts_on > interval '366 days' then
    raise exception 'A challenge can run for at most 366 days.';
  end if;
end;
$$;

-- ───────────────────────── 2 · the two create paths accept a span ─────────────────────────

drop function if exists create_h2h_challenge(uuid, text, int, uuid, int, text);

create or replace function create_h2h_challenge(
  p_opponent_id uuid,
  p_race_metric text,
  p_window_hours int,
  p_circle_id uuid default null,
  p_payout_xp int default 200,
  p_public_name text default null,
  p_starts_on timestamptz default null,
  p_ends_on timestamptz default null
)
returns social_challenges
language plpgsql
security definer
set search_path = public
as $$
declare
  v_challenge social_challenges;
begin
  perform assert_challenge_span(p_starts_on, p_ends_on);

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

  insert into social_challenges (circle_id, created_by, mode, opponent_id, race_metric, window_hours, payout_xp, status, public_name, shape, starts_on, ends_on)
  values (p_circle_id, auth.uid(), 'h2h', p_opponent_id, p_race_metric, p_window_hours, p_payout_xp, 'pending', nullif(btrim(coalesce(p_public_name, '')), ''), 'duel', p_starts_on, p_ends_on)
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

drop function if exists create_group_challenge(uuid, int, int, int, text);

create or replace function create_group_challenge(
  p_circle_id uuid,
  p_target_count int,
  p_window_hours int,
  p_payout_xp int default 300,
  p_public_name text default null,
  p_starts_on timestamptz default null,
  p_ends_on timestamptz default null
)
returns social_challenges
language plpgsql
security definer
set search_path = public
as $$
declare
  v_challenge social_challenges;
begin
  perform assert_challenge_span(p_starts_on, p_ends_on);

  if not is_group_member(p_circle_id) then
    raise exception 'Not a member of that campfire.';
  end if;

  insert into social_challenges (circle_id, created_by, mode, target_count, window_hours, payout_xp, status, starts_at, ends_at, public_name, shape, starts_on, ends_on)
  values (p_circle_id, auth.uid(), 'group', p_target_count, p_window_hours, p_payout_xp, 'draft', null, null, nullif(btrim(coalesce(p_public_name, '')), ''), 'collective', p_starts_on, p_ends_on)
  returning * into v_challenge;

  return v_challenge;
end;
$$;

-- ───────────────────────── 3 · a duel's gun honours the span too ─────────────────────────
--
-- Body is 0112's, unchanged except for the two coalesces. Same signature and same return shape, so
-- `create or replace` is correct and no overload is created.
--
-- starts_at (the recorded gun) stays now() rather than starts_on. Those are two different facts:
-- starts_on is when the creator SAID the race should run from, starts_at is when it actually began,
-- and the baselines below are taken now — so backdating starts_at would claim baselines were
-- captured at a moment they were not. ends_at is the one that decides the race, and that is the
-- one that follows ends_on.
--
-- A span whose end has already passed settles on the next sweep, which is correct: the race the
-- creator described is over. assert_challenge_span cannot prevent that on its own — an opponent
-- can sit on an invite until the window closes — and treating it as an error here would strand the
-- challenge in 'pending' forever instead.
create or replace function respond_to_h2h_challenge(p_challenge_id uuid, p_accept boolean)
returns social_challenges
language plpgsql
security definer
set search_path = public
as $rh$
declare
  v_challenge social_challenges;
begin
  select * into v_challenge from social_challenges
  where id = p_challenge_id and opponent_id = auth.uid() and status = 'pending';

  if v_challenge.id is null then
    raise exception 'Challenge not found or already answered.';
  end if;

  update challenge_participants
     set state = case when p_accept then 'accepted' else 'declined' end,
         responded_at = now()
   where challenge_id = p_challenge_id and user_id = auth.uid();

  if p_accept then
    update social_challenges
    set status = 'active',
        starts_at = now(),
        starts_on = coalesce(starts_on, now()),
        ends_at = coalesce(ends_on, now() + make_interval(hours => window_hours))
    where id = p_challenge_id
    returning * into v_challenge;

    update challenge_participants p
       set baseline = challenge_metric_value(v_challenge.race_metric, p.user_id, v_challenge.starts_at)
     where p.challenge_id = p_challenge_id;
  else
    update social_challenges set status = 'declined' where id = p_challenge_id returning * into v_challenge;
  end if;

  return v_challenge;
end;
$rh$;

grant execute on function assert_challenge_span(timestamptz, timestamptz) to authenticated;
grant execute on function create_h2h_challenge(uuid, text, int, uuid, int, text, timestamptz, timestamptz) to authenticated;
grant execute on function create_group_challenge(uuid, int, int, int, text, timestamptz, timestamptz) to authenticated;
grant execute on function respond_to_h2h_challenge(uuid, boolean) to authenticated;
