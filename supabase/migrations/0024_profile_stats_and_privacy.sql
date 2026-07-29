-- Profile screen (design-mocks/15, PHILOI_UI_SPEC.md §18) support for viewing someone ELSE's
-- profile, not just your own — stats/rank are public (same as leaderboards already expose),
-- but the lock-in photo grid must respect their photo_visibility setting (§19).

-- Mirrors get_my_lockin_stats() but for an arbitrary user — stats/streak aren't
-- privacy-gated (leaderboards already surface XP/streak for everyone).
create or replace function get_user_lockin_stats(p_user_id uuid)
returns table (lockin_count bigint, total_seconds numeric)
language sql
security definer
set search_path = public
stable
as $$
  select
    count(*) as lockin_count,
    coalesce(sum(duration_seconds), 0) as total_seconds
  from check_ins
  where user_id = p_user_id and duration_seconds is not null and removed_at is null;
$$;

-- Mirrors get_my_ranks()'s universal branch only — the profile screen shows one overall
-- rank hexagon, not a per-domain breakdown.
create or replace function get_user_rank(p_user_id uuid)
returns table (
  score numeric,
  tier text,
  division int,
  xp_into_tier numeric,
  xp_for_next_tier numeric
)
language sql
security definer
set search_path = public
stable
as $$
  select
    s.score,
    t.tier,
    t.division,
    s.score - lo.cumulative_xp_required as xp_into_tier,
    coalesce(hi.cumulative_xp_required, lo.cumulative_xp_required) - lo.cumulative_xp_required as xp_for_next_tier
  from (select universal_score(p_user_id) as score) s
  cross join lateral rank_tier_for_score(s.score) t
  join rank_thresholds lo on lo.tier = t.tier and lo.division = t.division
  left join rank_thresholds hi on hi.rank_index = lo.rank_index + 1;
$$;

-- The profile photo grid, privacy-aware (§19): your own is always full access; someone
-- else's respects their photo_visibility — 'everyone' shows to anyone, 'campfires' only to
-- a circle-mate, otherwise nothing. Security definer + its own check because check_ins' RLS
-- ("read if circle-mate") has no path for a true stranger to read a row at all, regardless
-- of photo_visibility — 'everyone' needs this bypass to actually mean "anyone."
create or replace function get_user_lock_in_photos(p_user_id uuid, p_limit int default 6)
returns table (id uuid, goal_type text, goal_detail text, duration_seconds int, photo_url text)
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_visibility text;
  v_allowed boolean;
begin
  if p_user_id = auth.uid() then
    v_allowed := true;
  else
    select photo_visibility into v_visibility from profiles where id = p_user_id;
    v_allowed := v_visibility = 'everyone' or (v_visibility = 'campfires' and is_circle_mate_of(p_user_id));
  end if;

  if not v_allowed then
    return;
  end if;

  return query
  select ci.id, ci.goal_type, ci.goal_detail, ci.duration_seconds, ci.photo_url
  from check_ins ci
  where ci.user_id = p_user_id and ci.duration_seconds is not null and ci.removed_at is null
  order by ci.created_at desc
  limit p_limit;
end;
$$;
