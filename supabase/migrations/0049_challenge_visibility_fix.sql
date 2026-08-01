-- RENUMBERED from 0046 to 0049: it collided with 0046_synced_activity_detail.sql, which was
-- already applied and had taken version 0046 in supabase_migrations. That ledger keys on the
-- version alone, so as 0046 this file was treated as already-applied and SILENTLY SKIPPED by
-- every db push — the fix below had never actually reached the database. Content unchanged.

-- Punchlist 2, §2: "The receiver sees the same challenge duplicated (currently shows
-- 'challenging myself in an XP battle' 4x)." Root cause: get_my_social_challenges()'s WHERE
-- clause included `is_group_member(sc.circle_id) OR ...` unconditionally — correct for GROUP
-- challenges (every campfire member genuinely is a participant, "the whole campfire commits"),
-- but wrong for H2H: a friend-to-friend duel that opted a campfire in to WATCH (circle_id set,
-- §16) was showing up in every OTHER campfire member's own "my challenges" list too, not just
-- the two real participants'. Since my_score/opponent_score are computed as "whichever side
-- isn't me is the opponent, otherwise assume I'm the creator", a pure spectator got a card
-- mislabeling the CREATOR's score as their own "You" — reading like a nonsensical self-duel,
-- and duplicating once per H2H challenge that circle happens to be watching.
-- Campfire-wide visibility for an H2H duel is what the marker chip + Watch screen (migration
-- 0040) are for — this RPC goes back to being genuinely "MY challenges" only.
-- Dropped first: RETURNS TABLE gained an is_participant column (see below).
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
  order by
    (sc.status = 'pending' and sc.opponent_id = auth.uid()) desc,
    sc.created_at desc;
end;
$$;
