-- Handoff B, 0099 — get_challenge_watch has been raising at runtime since 0081.
--
-- 0081 added `status text` to the RETURNS TABLE so the client could draw a finished duel's
-- read-only final state instead of inferring it from ends_at. RETURNS TABLE columns are plpgsql
-- OUT variables and they are in scope for the whole body, so every bare `status` in the body
-- became ambiguous against a real table column:
--
--   line 17  social_challenges.status  -- the lifecycle gate
--   line 28  friend_requests.status    -- friend-of-creator check
--   line 33  friend_requests.status    -- friend-of-opponent check
--
-- Default plpgsql.variable_conflict is `error`, so this is not a wrong-value bug — the function
-- raises `column reference "status" is ambiguous` on EVERY call. The watch screen
-- (src/app/watch/[challengeId].tsx via leaderboard-social.ts) has been dead since 0081 shipped.
--
-- 0081 already knew about this trap: the comment above the challenge_cheers select explains the
-- exact hazard for `cheered_for` and qualifies it with `cc.`. The new output column added in the
-- same migration was not given the same treatment. Adding a name to RETURNS TABLE is a change to
-- the body's namespace, not just to its signature.
--
-- Fix is aliasing only. No signature change, no gate change, no new behaviour. Every other OUT
-- name (mode, race_metric, target_count, window_hours, starts_at, ends_at, created_by ...) is a
-- social_challenges column too, but each is only ever read as v_challenge.<field>, so `status`
-- was the sole live reference. Verified by matching each OUT name against the body.
--
-- Drop-first rather than CREATE OR REPLACE: replace cannot change a return type, so if the
-- deployed body ever drifted from 0081 the replace would fail on a signature mismatch instead of
-- fixing anything. Migrations run in a transaction, so a failed create rolls the drop back.

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
as $fn$
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
  -- recipient hasn't answered.
  --
  -- Now stated with the 0096 bands instead of literals. Same three statuses exactly
  -- (live = 'active', settled = 'completed'|'expired'), so this is not a widening — but it says
  -- out loud that 'draft', which 0096 added to the vocabulary, is not watchable. A literal list
  -- silently keeps its old meaning when the vocabulary grows; a band does not.
  --
  -- sc.status, not status: `status` is an OUT column of this function (see header).
  select * into v_challenge
  from social_challenges sc
  where sc.id = p_challenge_id
    and (challenge_is_live(sc.status) or challenge_is_settled(sc.status));
  if v_challenge.id is null then
    raise exception 'Challenge not found or not active.';
  end if;

  select exists (
    select 1 from group_members gm1 join group_members gm2 on gm1.group_id = gm2.group_id
    where gm1.user_id = auth.uid() and gm2.user_id = v_challenge.created_by
  ) into v_shares_circle;

  -- fr.status, not status — same shadowing hazard, different table.
  select exists (
    select 1 from friend_requests fr where fr.status = 'accepted'
      and ((fr.requester_id = auth.uid() and fr.recipient_id = v_challenge.created_by) or (fr.requester_id = v_challenge.created_by and fr.recipient_id = auth.uid()))
  ) into v_is_friend_of_creator;

  select exists (
    select 1 from friend_requests fr where fr.status = 'accepted'
      and ((fr.requester_id = auth.uid() and fr.recipient_id = v_challenge.opponent_id) or (fr.requester_id = v_challenge.opponent_id and fr.recipient_id = auth.uid()))
  ) into v_is_friend_of_opponent;

  select p.watch_opt_in into v_creator_opted_in from profiles p where p.id = v_challenge.created_by;
  select p.watch_opt_in into v_opponent_opted_in from profiles p where p.id = v_challenge.opponent_id;

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
$fn$;
