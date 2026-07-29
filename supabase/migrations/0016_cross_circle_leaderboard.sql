-- The Leaderboard tab's "Campfires" pool (PHILOI_UI_SPEC.md §15) — "rank people, not
-- campfires": everyone who shares ANY circle with the caller, deduped by user (someone in two
-- of your campfires shows once), ranked by each person's own universal XP. Distinct from
-- get_my_circle_ranks() (kept as-is — that one is "my rank inside each separate circle," used
-- by that circle's own header/detail leaderboard, not this cross-campfire tab).
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
  from mates m
  join profiles p on p.id = m.user_id
  cross join lateral rank_tier_for_score(universal_score(p.id)) t
  order by score desc;
$$;

-- "Vs. unis" (design-mocks/11) — campus-vs-campus total XP, summed across every member at
-- that university who's on Philoi (not scoped to the caller's own circles).
create or replace function get_university_totals(p_limit int default 20)
returns table (university text, total_xp numeric, member_count bigint)
language sql
security definer
set search_path = public
stable
as $$
  select
    p.university,
    sum(universal_score(p.id)) as total_xp,
    count(*) as member_count
  from profiles p
  where p.university is not null and p.is_demo = false
  group by p.university
  order by total_xp desc
  limit p_limit;
$$;
