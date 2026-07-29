-- Profile screen's stat row (design-mocks/15: "day streak / lock-ins / locked in") — total
-- lock-in count + total hours, both simple aggregates over the caller's own check_ins that
-- aren't worth a client-side full-table fetch just to sum duration_seconds.
create or replace function get_my_lockin_stats()
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
  where user_id = auth.uid() and duration_seconds is not null and removed_at is null;
$$;
