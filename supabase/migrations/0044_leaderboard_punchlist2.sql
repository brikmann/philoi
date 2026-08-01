-- Punchlist 2, §1: "Board renders empty... should auto-populate your relevant pool: friends +
-- friend-requests + everyone in your campfires" — the Campfires scope was ONLY ever
-- circle-co-membership, so a user with no (or a brand new, empty) campfire saw nothing even
-- when they had real friends. Widened to friends OR campfire-mates, deduped via UNION (the
-- caller's own row still comes through the mates branch, same as before — no self-exclusion
-- needed). Also now excludes demo/disabled accounts, matching every sibling leaderboard RPC.
create or replace function get_my_cross_circle_people()
returns table (
  user_id uuid,
  display_name text,
  handle text,
  avatar_url text,
  is_pro boolean,
  score numeric,
  tier text,
  division int,
  current_streak int
)
language sql
security definer
set search_path = public
stable
as $$
  with mates as (
    select distinct gm2.user_id
    from group_members gm1
    join group_members gm2 on gm2.group_id = gm1.group_id
    where gm1.user_id = auth.uid()
  ),
  friends as (
    select case when requester_id = auth.uid() then recipient_id else requester_id end as user_id
    from friend_requests
    where status = 'accepted' and (requester_id = auth.uid() or recipient_id = auth.uid())
  ),
  pool as (
    select user_id from mates
    union
    select user_id from friends
  )
  select
    p.id as user_id,
    p.display_name,
    p.handle,
    p.avatar_url,
    p.is_pro,
    universal_score(p.id) as score,
    t.tier,
    t.division,
    p.current_streak
  from pool m
  join profiles p on p.id = m.user_id
  cross join lateral rank_tier_for_score(universal_score(p.id)) t
  where not p.is_demo and not p.is_disabled
  order by score desc;
$$;

-- Punchlist 2, §1: "colloquial short name on the board ('Laurier', 'Waterloo', 'UofT'), full
-- legal name in profile/settings" — a canonical short_name per university, alongside its
-- existing full name. Backfilled for the schools already in the table; NULL for anything added
-- later falls back to the full name client-side (see getUniversityShortName()).
alter table universities add column if not exists short_name text;

update universities set short_name = case name
  when 'University of Waterloo' then 'Waterloo'
  when 'Wilfrid Laurier University' then 'Laurier'
  when 'Toronto Metropolitan University' then 'TMU'
  when 'University of Toronto' then 'UofT'
  when 'McMaster University' then 'McMaster'
  when 'Queen''s University' then 'Queen''s'
  when 'Western University' then 'Western'
  when 'University of Guelph' then 'Guelph'
  when 'University of Ottawa' then 'Ottawa'
  when 'York University' then 'York'
  else short_name
end
where short_name is null;

-- get_university_totals/get_global_leaderboard/get_university_leaderboard all return the raw
-- `university` column already (the full legal name, stored on profiles.university) — the client
-- maps that to its short form via a lookup (mirrors src/lib/university-crests.ts's pattern)
-- rather than this migration reshaping every leaderboard RPC's return columns.
