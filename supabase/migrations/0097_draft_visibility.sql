-- Handoff B, 0097 — get_my_social_challenges learns about 'draft'.
--
-- Three problems, all from 0096 adding a status that 0049 could not have known about. Found by
-- handoff A tracing it; I had called this cosmetic and it is not.
--
-- 1. PHANTOM 0-0 DUEL. The score branches gate on `sc.status != 'pending'`, which a draft
--    satisfies, so they FIRE. starts_at is null until start_challenge sets it, and
--    social_challenge_score (0033) filters `ci.created_at >= p_starts_at and <= p_ends_at` — both
--    comparisons against null are NULL, so no rows match and `coalesce(sum(...), 0)` returns 0.
--    Not a history leak (A checked this too, and corrected an initial assumption that it was): the
--    result is my_score = 0 and opponent_score = 0, so the card draws a live, tied race for a
--    challenge nobody has been invited to.
--
-- 2. DRAFT VISIBLE TO THE CAMPFIRE. The WHERE is `sc.status != 'declined``, which a draft passes,
--    and the group arm matches on membership alone — so a group draft appears in every member's
--    list before a single invite goes out. Swapping the status literals does NOT fix this; it
--    needs its own predicate, which is the third change below.
--
-- 3. INVITES NO LONGER FLOAT. The sort keys on the literal 'pending'.
--
-- The body below is 0049's, transformed programmatically rather than retyped — only the four
-- predicates changed. Re-pasting a 90-line function by hand to alter three lines is how a
-- transcription error gets into a query that decides what people can see.

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
    case when sc.mode = 'h2h' and not challenge_is_awaiting(sc.status)
      then social_challenge_score(
        case when auth.uid() = sc.opponent_id then sc.opponent_id else sc.created_by end,
        sc.race_metric, sc.starts_at, sc.ends_at)
      else null end as my_score,
    case when sc.mode = 'h2h' and not challenge_is_awaiting(sc.status)
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
          where ci.user_id = gm.user_id and ci.removed_at is null
            and ci.created_at >= sc.starts_at and ci.created_at <= coalesce(sc.ends_at, now())
            and check_in_qualifies_for_challenge(ci.id)
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
  -- left join: an h2h challenge with nobody watching has a null circle_id — an inner join here
  -- would silently drop it out of the result set entirely (migration 0032).
  left join groups g on g.id = sc.circle_id
  join profiles creator on creator.id = sc.created_by
  left join profiles opp on opp.id = sc.opponent_id
  where (
    (sc.mode = 'group' and is_group_member(sc.circle_id))
    or sc.created_by = auth.uid()
    or sc.opponent_id = auth.uid()
  )
    and sc.status != 'declined'
    -- A DRAFT IS PRIVATE UNTIL SOMEONE IS INVITED. Without this a group draft is visible to the
    -- whole campfire the moment it is created, because the group arm above matches on membership
    -- alone. Swapping the status literals does not cover this — it is a separate leak.
    --
    -- challenge_is_DRAFT, not challenge_is_awaiting. The band includes 'pending', and a pending
    -- h2h invitee is not created_by — so the band form excluded the very person the invite is for,
    -- killing the whole duel-invite flow. The tell was the ORDER BY immediately below: it floats
    -- rows where opponent_id = auth.uid(), which the band predicate had just removed. A predicate
    -- that makes the sort beneath it unreachable is the wrong predicate.
    and (not challenge_is_draft(sc.status) or sc.created_by = auth.uid())
  order by
    (challenge_is_awaiting(sc.status) and sc.opponent_id = auth.uid()) desc,
    sc.created_at desc;
end;
$$;
