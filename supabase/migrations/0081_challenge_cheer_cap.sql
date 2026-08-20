-- Cap Cheer at one per spectator per challenge (punchlist A4).
--
-- 0041 shipped cheers as two bare counters on social_challenges and a function that did an
-- unconditional `+ 1`. Its own comment said "nothing here needs per-person dedup, just a live
-- shared count" — in practice that made Cheer an unlimited-click button, so the number meant
-- "how many times did anyone tap" rather than "how many people are behind you", which is the
-- only reading that carries any weight.
--
-- The counters stay (the watch screen reads them on every poll and a COUNT(*) per side per poll
-- is wasteful), but they are now derived from an insert that can only succeed once per spectator.

create table if not exists challenge_cheers (
  challenge_id uuid not null references social_challenges(id) on delete cascade,
  -- WHO tapped. The unique key is (challenge, spectator) and deliberately NOT
  -- (challenge, spectator, for_user): one cheer per challenge means you back ONE side, you don't
  -- get to cheer both competitors in a duel.
  spectator_id uuid not null references profiles(id) on delete cascade,
  for_user_id uuid not null references profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (challenge_id, spectator_id)
);

alter table challenge_cheers enable row level security;

-- Readable by anyone who can already watch the challenge; get_challenge_watch does the real
-- access check, so this policy only has to stop direct table reads by strangers.
drop policy if exists challenge_cheers_select on challenge_cheers;
create policy challenge_cheers_select on challenge_cheers
  for select using (spectator_id = auth.uid());

-- No insert/update/delete policy on purpose: cheer_challenge is security definer and is the only
-- writer. A client cannot forge a row or un-cheer.

-- Backfill is intentionally skipped. The existing counters are tap-counts with no record of who
-- tapped, so there is no honest way to reconstruct per-spectator rows from them. Leaving the old
-- totals in place keeps live challenges from visibly losing their numbers; every cheer from here
-- is deduped, and the counters converge as challenges turn over.

-- DROP FIRST. 0041's cheer_challenge is `returns void` and this one returns the authoritative
-- count, and CREATE OR REPLACE cannot change a function's return type — it fails with "cannot
-- change return type of existing function", which reads like a body error and is easy to
-- misdiagnose. Same trap as the RETURNS TABLE change further down.
--
-- Safe for clients already in the field: supabase-js ignores an unexpected return value, so a
-- build compiled against the void version keeps working after this lands.
drop function if exists cheer_challenge(uuid, uuid);

create function cheer_challenge(p_challenge_id uuid, p_for_user_id uuid)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_challenge social_challenges;
  v_inserted int;
  v_count int;
begin
  select * into v_challenge from social_challenges where id = p_challenge_id and status = 'active';
  if v_challenge.id is null then
    -- Also covers a COMPLETED challenge: once it settles the watch screen is read-only, so a
    -- late cheer must not land (punchlist A4 / CHALLENGE_UI_SPEC §58).
    raise exception 'Challenge not found or not active.';
  end if;

  if p_for_user_id not in (v_challenge.created_by, coalesce(v_challenge.opponent_id, '00000000-0000-0000-0000-000000000000'::uuid)) then
    raise exception 'That person is not in this challenge.';
  end if;

  -- A competitor cheering their own duel is just self-voting; the count is meant to be the room.
  if auth.uid() in (v_challenge.created_by, coalesce(v_challenge.opponent_id, '00000000-0000-0000-0000-000000000000'::uuid)) then
    raise exception 'You can''t cheer a challenge you''re competing in.';
  end if;

  insert into challenge_cheers (challenge_id, spectator_id, for_user_id)
  values (p_challenge_id, auth.uid(), p_for_user_id)
  on conflict (challenge_id, spectator_id) do nothing;

  -- row_count is 0 when the conflict clause swallowed the insert, i.e. this spectator has already
  -- cheered. Silent no-op rather than an exception — the client disables the button, so reaching
  -- here is a double-tap or a stale screen, not something worth erroring at a user.
  get diagnostics v_inserted = row_count;

  if v_inserted > 0 then
    if p_for_user_id = v_challenge.created_by then
      update social_challenges set created_by_cheers = created_by_cheers + 1 where id = p_challenge_id;
    else
      update social_challenges set opponent_cheers = opponent_cheers + 1 where id = p_challenge_id;
    end if;
  end if;

  -- Hand back the authoritative count for the side that was cheered, so the client renders the
  -- server's number instead of keeping a local optimistic delta it never reconciles.
  select case when p_for_user_id = v_challenge.created_by then created_by_cheers else opponent_cheers end
    into v_count
  from social_challenges where id = p_challenge_id;

  return v_count;
end;
$$;

-- get_challenge_watch gains status, has_cheered and cheered_for, so its RETURNS TABLE shape
-- changes. CREATE OR REPLACE cannot change RETURNS TABLE columns even when only APPENDING one —
-- it fails with a "cannot change return type of existing function" that reads like a body error.
-- Drop first.
--
-- The body below is 0056's (the most recent definition — NOT 0041's, which 0056 superseded when
-- it widened the status gate to include completed/expired), plus the three new columns.
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
  status text,
  created_by uuid,
  created_by_name text,
  created_by_score numeric,
  created_by_live_status text,
  created_by_cheers int,
  opponent_id uuid,
  opponent_name text,
  opponent_score numeric,
  opponent_live_status text,
  opponent_cheers int,
  has_cheered boolean,
  cheered_for uuid
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
  v_cheered_for uuid;
begin
  -- Gate copied from 0056, which already widened this past 'active' so a finished duel opens its
  -- final standings. Deliberately NOT dropped altogether: without it a 'pending' (not yet
  -- accepted) or 'declined' challenge becomes watchable, which would leak an invite the
  -- recipient hasn't answered. What is new is that `status` is now RETURNED, so the client can
  -- draw the read-only final state instead of inferring it from ends_at (§58).
  select * into v_challenge from social_challenges
   where id = p_challenge_id and status in ('active', 'completed', 'expired');
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

  -- Qualified with the table alias. The RETURNS TABLE above declares `cheered_for`, and an
  -- unqualified reference in the body resolves to THAT output column rather than to the table's
  -- own, which is how a previous RPC in this project silently returned nulls.
  select cc.for_user_id into v_cheered_for
  from challenge_cheers cc
  where cc.challenge_id = p_challenge_id and cc.spectator_id = auth.uid();

  return query
  select
    v_challenge.id,
    v_challenge.mode,
    v_challenge.race_metric,
    v_challenge.target_count,
    v_challenge.window_hours,
    v_challenge.starts_at,
    v_challenge.ends_at,
    v_challenge.status,
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
    v_challenge.opponent_cheers,
    v_cheered_for is not null,
    v_cheered_for
  from profiles creator
  left join profiles opp on opp.id = v_challenge.opponent_id
  where creator.id = v_challenge.created_by;
end;
$$;
