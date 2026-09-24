-- 0214 · get_my_placements() — the done screen's placement beat (design-mocks/204).
--
-- After a lock-in the done screen shows where the caller stands on three boards — Friends, their
-- uni, Global — and how each moved since they last saw it. The movement baseline is client-side
-- (src/lib/placement-watch.ts); this function only answers "where am I right now, and out of how
-- many", in one round trip, instead of pulling a 50-row board per scope for one number each.
--
-- Each scope ranks over EXACTLY the predicate of the board the Leaderboard tab shows for it, so
-- the number on the done screen is the number you'd find on the tab:
--   global  — get_global_leaderboard (0208): not demo/disabled, score > 0.
--   uni     — get_university_leaderboard (0170): same university, verified campus email, not
--             demo/disabled, can_see_rank(). No score floor, because that board has none.
--   friends — the caller plus their accepted friends (friend_requests, 0031), with the global
--             board's filters. There is no friends board to mirror, so it borrows global's rules
--             rather than inventing a third set.
-- Ordering is the boards' own: score desc, display_name asc.
--
-- A scope the caller is NOT on returns no row (not on the global board yet, no verified uni, no
-- scored friends). The client reads a missing row as "don't draw this row", never as "#null".

create function get_my_placements()
returns table (scope text, rank int, total int)
language sql
security definer
set search_path = public
stable
as $$
  with me as (
    select p.id, p.university, p.university_email_verified
    from profiles p
    where p.id = auth.uid()
  ),
  -- universal_score once per profile, shared by all three scopes.
  scored as (
    select p.id, p.display_name, p.university, p.university_email_verified, universal_score(p.id) as score
    from profiles p
    where not p.is_demo and not p.is_disabled
  ),
  friend_ids as (
    select case when fr.requester_id = auth.uid() then fr.recipient_id else fr.requester_id end as uid
    from friend_requests fr
    where fr.status = 'accepted' and (fr.requester_id = auth.uid() or fr.recipient_id = auth.uid())
  ),
  global_board as (
    select s.id, row_number() over (order by s.score desc, s.display_name asc)::int as rnk, count(*) over ()::int as n
    from scored s
    where s.score > 0
  ),
  uni_board as (
    select s.id, row_number() over (order by s.score desc, s.display_name asc)::int as rnk, count(*) over ()::int as n
    from scored s, me
    where me.university is not null
      and s.university = me.university
      and s.university_email_verified
      and can_see_rank(auth.uid(), s.id)
  ),
  friends_board as (
    select s.id, row_number() over (order by s.score desc, s.display_name asc)::int as rnk, count(*) over ()::int as n
    from scored s
    where s.score > 0
      and (s.id = auth.uid() or s.id in (select uid from friend_ids))
  )
  select 'global', g.rnk, g.n from global_board g where g.id = auth.uid()
  union all
  select 'uni', u.rnk, u.n from uni_board u where u.id = auth.uid()
  union all
  select 'friends', f.rnk, f.n from friends_board f where f.id = auth.uid();
$$;

-- Callable by signed-in users only. Revoking from `public` alone leaves Supabase's default anon
-- grant standing, so anon is named explicitly.
revoke execute on function get_my_placements() from public, anon;
grant execute on function get_my_placements() to authenticated;

do $assert$
begin
  if (select count(*) from pg_proc where proname = 'get_my_placements' and pronamespace = 'public'::regnamespace) <> 1 then
    raise exception '0214: expected exactly one get_my_placements overload';
  end if;
  if has_function_privilege('anon', 'public.get_my_placements()', 'execute') then
    raise exception '0214: anon can still execute get_my_placements';
  end if;
  if not has_function_privilege('authenticated', 'public.get_my_placements()', 'execute') then
    raise exception '0214: authenticated cannot execute get_my_placements';
  end if;
end;
$assert$;
