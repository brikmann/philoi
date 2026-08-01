-- Punchlist 2, §1: "Can't see a person's leaderboard stats on their profile. Add their rank
-- hexagon + XP + board position to the friend profile." get_user_rank already covers the
-- hexagon/XP; this adds the missing piece — the same row_number() position search_leaderboard()
-- computes per search result, but for exactly one target user, so the friend-profile screen can
-- show "#3 on My uni" / "#2,481 on Global" without pulling in the search RPC.
create or replace function get_user_board_position(p_user_id uuid)
returns table (board text, rank int)
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_university text;
begin
  select university into v_university from profiles where id = p_user_id;

  if v_university is not null then
    return query
    select 'My uni'::text, r.rank
    from (
      select p.id, row_number() over (order by universal_score(p.id) desc, p.display_name asc)::int as rank
      from profiles p
      where p.university = v_university and not p.is_demo and not p.is_disabled
    ) r
    where r.id = p_user_id;
    if found then return; end if;
  end if;

  return query
  select 'Global'::text, r.rank
  from (
    select p.id, row_number() over (order by universal_score(p.id) desc, p.display_name asc)::int as rank
    from profiles p
    where not p.is_demo and not p.is_disabled
  ) r
  where r.id = p_user_id;
end;
$$;
