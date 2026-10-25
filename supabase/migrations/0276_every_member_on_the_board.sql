-- 0276 · Every member on the board (CODE_PROMPT_ui_pass2.md §4).
--
-- get_metric_leaderboard only ever returned people with a value > 0 for the metric, so a board read
-- as "the handful who logged something" instead of the real member base. The new Leaderboard tab
-- wants everyone in scope: ranked people first, then the rest at the bottom as "not ranked yet".
--
-- ADDITIVE, ON PURPOSE. Shipped builds (TestFlight / Play) call this function too, and their rows
-- have never seen a zero value or a null rank — OTA can't reach them. So the unranked tail is behind
-- a NEW parameter, p_include_unranked, defaulting to false: every existing call returns exactly what
-- it did before, byte for byte. Only the new client passes true.
--
-- Based on the LIVE prod body (pg_get_functiondef, 2026-10-25), which matches 0265. The changes are
-- only: the sixth parameter, the `pos` ordinal that orders ranked-then-unranked, and `rnk` being
-- null for unranked rows. Gates are untouched: university_email_verified and can_see_rank still
-- decide who is in `vals` at all.
--
-- Signature change = drop the old 5-arg overload in the same migration (MIGRATIONS.md "Appending a
-- parameter is not a replacement"). Every parameter after p_metric still has a default, so every
-- existing call shape resolves to the survivor. The survivor's ACL is restated to match live exactly:
-- authenticated + service_role, no anon, no public.

begin;

drop function if exists public.get_metric_leaderboard(text, text, text, integer, boolean);

create function public.get_metric_leaderboard(
  p_metric text,
  p_scope text default 'global'::text,
  p_window text default 'season'::text,
  p_limit integer default 50,
  p_verified_only boolean default false,
  p_include_unranked boolean default false
)
 returns table(user_id uuid, handle text, display_name text, avatar_url text, is_pro boolean, value numeric, verified boolean, tier text, division integer, rank integer, is_me boolean, university text, patron_key text, program_abbrev text, pr_set_id uuid)
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
begin
  return query
  with vals as (
    select p.id, p.handle, p.display_name, p.avatar_url, p.is_pro, p.university, p.program_id,
           user_metric(p.id, p_metric, p_window) as v_all,
           user_metric_verified(p.id, p_metric, p_window) as v_ok
    from profiles p
    join scope_user_ids(p_scope) pool on pool.id = p.id
    where p.university_email_verified          -- the board gate every board has (0062/0253)
      and can_see_rank(auth.uid(), p.id)       -- 0170/0217
  ),
  shown as (
    select vals.*, case when p_verified_only then coalesce(vals.v_ok, 0) else vals.v_all end as v
    from vals
  ),
  ranked as (
    select s.*,
           -- A rank only for someone with something on the board; the unranked tail gets null.
           case when coalesce(s.v, 0) > 0 then
             row_number() over (partition by coalesce(s.v, 0) > 0 order by s.v desc, s.display_name asc)::int
           end as rnk,
           -- Position on the page: ranked first by value, then the unranked tail by name. With
           -- p_include_unranked = false every row is ranked, so pos = rnk and the old limit holds.
           row_number() over (order by coalesce(s.v, 0) > 0 desc, s.v desc nulls last, s.display_name asc)::int as pos
    from shown s
    where coalesce(s.v, 0) > 0 or p_include_unranked
  )
  select r.id, r.handle, r.display_name, r.avatar_url, r.is_pro,
         coalesce(r.v, 0),
         case when r.v_ok is null then null else r.v_ok > 0 and r.v_ok >= r.v_all end,
         t.tier, t.division, r.rnk, (r.id = auth.uid()),
         r.university, pr.patron_key, pr.abbrev,
         case when p_metric like 'ex:%' and r.rnk is not null then
           user_exercise_best_set(r.id, split_part(p_metric, ':', 2), split_part(p_metric, ':', 3), p_window)
         end
  from ranked r
  cross join lateral rank_tier_for_score(universal_score(r.id)) t
  left join programs pr on pr.id = r.program_id
  where p_limit is null or r.pos <= p_limit or r.id = auth.uid()
  order by r.pos;
end;
$function$;

revoke all on function public.get_metric_leaderboard(text, text, text, integer, boolean, boolean) from public, anon;
grant execute on function public.get_metric_leaderboard(text, text, text, integer, boolean, boolean) to authenticated, service_role;

commit;
