-- THE OTHER FOUR BOARDS 0246 FLATTENED.
--
-- 0246 (seasonal reset) restated every board function from a base older than 0062/0170/0217, so
-- besides the two big boards (fixed in 0253) it dropped guards from four more. Each body below is
-- the LIVE prod body (pg_get_functiondef, 2026-10-21) with only the lost lines put back:
--
--   * search_leaderboard — 0170's can_see_rank wall on the matches, so a private / friends-only
--     climber is findable again only by those allowed to see them. The board_rank each hit carries
--     is now ranked over the same set its board shows (0253: verified + walled), so a search hit's
--     "#4" is the "#4" on the board.
--   * get_user_board_position — 0217's early return for a hidden target, and the wall + verified
--     gate inside both rankings, for the same reason (the profile's "#3 on My uni").
--   * get_university_totals — 0062's verified gate and is_disabled filter, so Uni vs. Uni sums the
--     same people My uni lists.
--   * get_group_leaderboard — 0170's wall. A private member keeps their campfire seat; they are
--     just not on its board for non-friends.
--
-- Same signatures and return shapes, so CREATE OR REPLACE is safe and installed builds are
-- unaffected. 0246's ordering (season_score) and lifetime tier stay as they are.
--
-- LEDGER: apply this file alone, then `supabase migration repair --status applied 0254`.

begin;

create or replace function public.search_leaderboard(p_query text, p_limit integer default 20)
returns table(user_id uuid, display_name text, handle text, avatar_url text, tier text, division integer,
              score numeric, board text, board_rank integer, is_friend boolean)
language plpgsql
stable security definer
set search_path to 'public'
as $function$
declare
  v_my_university text;
begin
  select university into v_my_university from profiles where id = auth.uid();

  return query
  with matches as (
    select p.id, p.display_name, p.handle, p.avatar_url, p.university
    from profiles p
    where p.id <> auth.uid()
      and not p.is_demo and not p.is_disabled
      and can_see_rank(auth.uid(), p.id)       -- 0170, lost in 0246
      and (p.handle ilike '%' || p_query || '%' or p.display_name ilike '%' || p_query || '%')
    order by (p.handle = p_query) desc, (p.handle ilike p_query || '%') desc, p.display_name asc
    limit p_limit
  ),
  scored as (
    select m.*, s.season as score, t.tier, t.division
    from matches m
    cross join lateral (select season_score(m.id) as season, universal_score(m.id) as life) s
    cross join lateral rank_tier_for_score(s.life) t
  ),
  -- 0254 · ranked over exactly what get_university_leaderboard / get_global_leaderboard list (0253).
  uni_ranked as (
    select p.id, row_number() over (order by season_score(p.id) desc, p.display_name asc)::int as rank
    from profiles p
    where p.university = v_my_university and not p.is_demo and not p.is_disabled and v_my_university is not null
      and p.university_email_verified
      and can_see_rank(auth.uid(), p.id)
  ),
  global_ranked as (
    select p.id, row_number() over (order by season_score(p.id) desc, p.display_name asc)::int as rank
    from profiles p
    where not p.is_demo and not p.is_disabled
      and p.university_email_verified
      and can_see_rank(auth.uid(), p.id)
  )
  select
    sc.id, sc.display_name, sc.handle, sc.avatar_url, sc.tier, sc.division, sc.score,
    case when sc.university = v_my_university and v_my_university is not null then 'My uni' else 'Global' end as board,
    coalesce(
      case when sc.university = v_my_university and v_my_university is not null then ur.rank else null end,
      gr.rank
    ) as board_rank,
    exists (
      select 1 from friend_requests fr
      where fr.status = 'accepted'
        and ((fr.requester_id = auth.uid() and fr.recipient_id = sc.id) or (fr.requester_id = sc.id and fr.recipient_id = auth.uid()))
    ) as is_friend
  from scored sc
  left join uni_ranked ur on ur.id = sc.id
  left join global_ranked gr on gr.id = sc.id;
end;
$function$;

create or replace function public.get_user_board_position(p_user_id uuid)
returns table(board text, rank integer)
language plpgsql
stable security definer
set search_path to 'public'
as $function$
declare
  v_university text;
begin
  -- 0217, lost in 0246 · a hidden target has no position to show. Zero rows is what the profile
  -- already reads as "don't draw the line".
  if not can_see_rank(auth.uid(), p_user_id) then
    return;
  end if;

  select university into v_university from profiles where id = p_user_id;

  if v_university is not null then
    return query
    select 'My uni'::text, r.rank
    from (
      select p.id, row_number() over (order by season_score(p.id) desc, p.display_name asc)::int as rank
      from profiles p
      where p.university = v_university and not p.is_demo and not p.is_disabled
        and p.university_email_verified        -- 0254 · the board's own gate (0062)
        and can_see_rank(auth.uid(), p.id)     -- 0217, lost in 0246
    ) r
    where r.id = p_user_id;
    if found then return; end if;
  end if;

  return query
  select 'Global'::text, r.rank
  from (
    select p.id, row_number() over (order by season_score(p.id) desc, p.display_name asc)::int as rank
    from profiles p
    where not p.is_demo and not p.is_disabled
      and p.university_email_verified          -- 0254 · Global is every verified student (0253)
      and can_see_rank(auth.uid(), p.id)       -- 0217, lost in 0246
  ) r
  where r.id = p_user_id;
end;
$function$;

create or replace function public.get_university_totals(p_limit integer default 20)
returns table(university text, total_xp numeric, member_count bigint)
language sql
stable security definer
set search_path to 'public'
as $function$
  select
    p.university,
    sum(season_score(p.id)) as total_xp,
    count(*) as member_count
  from profiles p
  where p.university is not null
    and p.university_email_verified            -- 0062, lost in 0246
    and p.is_demo = false
    and p.is_disabled = false                  -- 0062, lost in 0246
  group by p.university
  order by total_xp desc
  limit p_limit;
$function$;

create or replace function public.get_group_leaderboard(p_group_id uuid)
returns table(user_id uuid, handle text, display_name text, avatar_url text, is_pro boolean,
              score numeric, tier text, division integer, check_ins_this_week bigint)
language sql
stable security definer
set search_path to 'public'
as $function$
  select
    gm.user_id, p.handle, p.display_name, p.avatar_url, p.is_pro,
    s.season as score, t.tier, t.division,
    coalesce((
      select count(*) from check_ins ci
      where ci.user_id = gm.user_id and ci.created_at >= date_trunc('week', now())
    ), 0) as check_ins_this_week
  from group_members gm
  join profiles p on p.id = gm.user_id
  cross join lateral (select season_score(gm.user_id) as season, universal_score(gm.user_id) as life) s
  cross join lateral rank_tier_for_score(s.life) t
  where gm.group_id = p_group_id and is_group_member(p_group_id)
    and can_see_rank(auth.uid(), gm.user_id)   -- 0170, lost in 0246
  order by s.season desc, check_ins_this_week desc, p.display_name asc;
$function$;

commit;
