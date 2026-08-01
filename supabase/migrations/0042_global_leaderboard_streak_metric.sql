-- get_global_leaderboard was missing check_ins_this_week — get_university_leaderboard already
-- has it, and it's what backs the Leaderboard tab's "Streaks" metric toggle (PHILOI_UI_SPEC.md
-- §15) for that scope. Without it, Global couldn't offer the same toggle as every other
-- individual scope. Dropped first: RETURNS TABLE gains a column.
drop function if exists get_global_leaderboard(int);

create function get_global_leaderboard(p_limit int default 50)
returns table (
  user_id uuid,
  handle text,
  display_name text,
  avatar_url text,
  is_pro boolean,
  score numeric,
  tier text,
  division int,
  university text,
  check_ins_this_week bigint,
  rank int,
  is_me boolean
)
language plpgsql
security definer
set search_path = public
stable
as $$
begin
  return query
  with ranked as (
    select
      p.id as user_id, p.handle, p.display_name, p.avatar_url, p.is_pro,
      s.score, t.tier, t.division, p.university,
      coalesce((
        select count(*) from check_ins ci
        where ci.user_id = p.id and ci.created_at >= date_trunc('week', now())
      ), 0) as check_ins_this_week,
      row_number() over (order by s.score desc, p.display_name asc)::int as rank
    from profiles p
    cross join lateral (select universal_score(p.id) as score) s
    cross join lateral rank_tier_for_score(s.score) t
    where not p.is_demo and not p.is_disabled
  )
  select r.*, (r.user_id = auth.uid()) as is_me
  from ranked r
  where r.rank <= p_limit or r.user_id = auth.uid()
  order by r.rank;
end;
$$;
