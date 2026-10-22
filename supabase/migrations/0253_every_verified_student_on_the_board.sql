-- EVERY VERIFIED STUDENT ON THE BOARD.
--
-- Decision (Noah, 2026-10-21): the My-uni and Global boards list everyone who qualifies, not a top
-- 10. Global is every verified student in the app, ranked by XP. The 10-row cap was client-side
-- (leaderboards.tsx VISIBLE_RANKS); this migration does the server half:
--
--   * p_limit null = the whole board. Same signature, so CREATE OR REPLACE is safe and installed
--     builds (which pass 50) are unaffected.
--   * Global = verified students only (university_email_verified), the same gate My-uni has had
--     since 0062. 0208's "score > 0" participation floor is dropped: a verified student who hasn't
--     earned this term still has a seat, at the bottom.
--
-- It also restores two lines 0246 lost when it restated both boards from an older base:
--   * My-uni's `p.university_email_verified` gate (0062, UNI_VERIFICATION_SPEC.md §4) — an
--     unverified account was back on its campus board.
--   * `can_see_rank(auth.uid(), p.id)` on both boards (0170/0217) — a private or friends-only
--     climber was back on every public board.
-- Ordering stays 0246's: season_score for position and the shown score, lifetime universal_score
-- for tier/division.
--
-- And it brings the two readers of those boards back into agreement with them:
--   * get_my_placements (the done screen's "#R of N") — 0246 never restated it, so its global and
--     uni scopes still ranked on lifetime score, and global/friends kept 0208's score > 0 floor.
--     Live as Noah it read Friends 4 / Uni 14 / Global 5 against boards of 7 / 14 / 17. Each scope
--     now uses its board's exact filter and order. Friends is the Friends tab's pool
--     (get_my_cross_circle_people: friends + campfire-mates) plus self, by lifetime score.
--   * send_daily_placement (the "Holding at #R of N · Defend it" push) — ranks on My uni now, not on
--     lifetime-score Global, and its tap opens the My-uni tab (route param scope=uni).
--
-- LEDGER: prod's ledger has no 0246 row although 0246's bodies are live. Do NOT `db push`; apply
-- this file alone, then `supabase migration repair --status applied 0253`.

begin;

create or replace function get_university_leaderboard(p_university text, p_limit int default 50)
returns table (
  user_id uuid, handle text, display_name text, avatar_url text, is_pro boolean,
  score numeric, tier text, division int, check_ins_this_week bigint, rank int, is_me boolean
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
      s.season as score, t.tier, t.division,
      coalesce((
        select count(*) from check_ins ci
        where ci.user_id = p.id and ci.created_at >= date_trunc('week', now())
      ), 0) as check_ins_this_week,
      row_number() over (order by s.season desc, p.display_name asc)::int as rank
    from profiles p
    cross join lateral (select season_score(p.id) as season, universal_score(p.id) as life) s
    cross join lateral rank_tier_for_score(s.life) t
    where p.university = p_university
      and p.university_email_verified          -- 0062, lost in 0246
      and not p.is_demo and not p.is_disabled
      -- 0170/0217, lost in 0246. Inside the CTE so ranks recompute over the visible set.
      and can_see_rank(auth.uid(), p.id)
  )
  select r.user_id, r.handle, r.display_name, r.avatar_url, r.is_pro,
         r.score, r.tier, r.division, r.check_ins_this_week, r.rank,
         (r.user_id = auth.uid()) as is_me
  from ranked r
  where p_limit is null or r.rank <= p_limit or r.user_id = auth.uid()
  order by r.rank;
end;
$$;

create or replace function get_global_leaderboard(p_limit int default 50)
returns table (
  user_id uuid, handle text, display_name text, avatar_url text, is_pro boolean,
  score numeric, tier text, division int, university text, check_ins_this_week bigint, rank int, is_me boolean
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
      s.season as score, t.tier, t.division, p.university,
      coalesce((
        select count(*) from check_ins ci
        where ci.user_id = p.id and ci.created_at >= date_trunc('week', now())
      ), 0) as check_ins_this_week,
      row_number() over (order by s.season desc, p.display_name asc)::int as rank
    from profiles p
    cross join lateral (select season_score(p.id) as season, universal_score(p.id) as life) s
    cross join lateral rank_tier_for_score(s.life) t
    where p.university_email_verified          -- 0253 · Global is every verified student
      and not p.is_demo and not p.is_disabled
      and can_see_rank(auth.uid(), p.id)       -- 0170/0217, lost in 0246
  )
  select r.user_id, r.handle, r.display_name, r.avatar_url, r.is_pro,
         r.score, r.tier, r.division, r.university, r.check_ins_this_week, r.rank,
         (r.user_id = auth.uid()) as is_me
  from ranked r
  where p_limit is null or r.rank <= p_limit or r.user_id = auth.uid()
  order by r.rank;
end;
$$;

-- ─────────────────────────── the done screen's placements match the boards ───────────────────────────

create or replace function get_my_placements()
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
  -- Both scores once per profile, shared by all three scopes. season for uni/global (0246's board
  -- order), life for friends (the Friends tab sorts get_my_cross_circle_people's lifetime score).
  scored as (
    select p.id, p.display_name, p.university, p.university_email_verified,
           season_score(p.id) as season, universal_score(p.id) as life
    from profiles p
    where not p.is_demo and not p.is_disabled
      and can_see_rank(auth.uid(), p.id)
  ),
  friends_pool as (
    select case when fr.requester_id = auth.uid() then fr.recipient_id else fr.requester_id end as uid
    from friend_requests fr
    where fr.status = 'accepted' and (fr.requester_id = auth.uid() or fr.recipient_id = auth.uid())
    union
    select gm2.user_id
    from group_members gm1
    join group_members gm2 on gm2.group_id = gm1.group_id
    where gm1.user_id = auth.uid()
    union
    select auth.uid()
  ),
  global_board as (
    select s.id, row_number() over (order by s.season desc, s.display_name asc)::int as rnk, count(*) over ()::int as n
    from scored s
    where s.university_email_verified
  ),
  uni_board as (
    select s.id, row_number() over (order by s.season desc, s.display_name asc)::int as rnk, count(*) over ()::int as n
    from scored s, me
    where me.university is not null
      and s.university = me.university
      and s.university_email_verified
  ),
  friends_board as (
    select s.id, row_number() over (order by s.life desc, s.display_name asc)::int as rnk, count(*) over ()::int as n
    from scored s
    where s.id in (select uid from friends_pool)
  )
  select 'global', g.rnk, g.n from global_board g where g.id = auth.uid()
  union all
  select 'uni', u.rnk, u.n from uni_board u where u.id = auth.uid()
  union all
  select 'friends', f.rnk, f.n from friends_board f where f.id = auth.uid();
$$;

-- ─────────────────────────── the daily placement push ranks on My uni ───────────────────────────
-- Restated from the live prosrc (0216's movement copy + 0217's public-only gate). Changes:
--   * the board is My uni: verified, same university, season_score order — get_university_leaderboard
--     as a public viewer sees it. Non-public targets are left out rather than walled per recipient;
--     the only difference is a friends-dial classmate who is also the recipient's friend.
--   * recipients must be verified with a university — anyone else is on no uni board.
--   * the movement diff only reads a prior send whose payload says scope 'uni', so the first uni
--     push after this does not compare a uni rank against yesterday's global one.
--   * the title names the board, and the tap opens the My-uni tab.

create or replace function public.send_daily_placement()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_sent int := 0;
  r record;
  -- 0216 · movement
  v_prev  int;
  v_tier  text;
  v_title text;
  v_body  text;
  v_where text;
begin
  if not exists (
    select 1 from profiles p
    where not p.is_demo and not p.is_disabled
      -- 0217 · public only.
      and p.rank_visibility = 'public'
      -- 0253 · on a uni board.
      and p.university_email_verified and p.university is not null
      and coalesce((p.notification_prefs->>'master')::boolean, true)
      and coalesce((p.notification_prefs->>'placement_enabled')::boolean, true)
      and extract(hour from (now() at time zone
            coalesce(nullif(p.notification_prefs->>'timezone', ''), nullif(p.timezone, ''), 'UTC')))::int
          = coalesce((p.notification_prefs->>'placement_hour')::int, 21)
  ) then
    return 0;
  end if;

  for r in
    with board as (
      select
        p.id,
        row_number() over (partition by p.university order by season_score(p.id) desc, p.display_name asc)::int as rank,
        count(*) over (partition by p.university)::int as total
      from profiles p
      where not p.is_demo and not p.is_disabled
        and p.university_email_verified and p.university is not null
        and p.rank_visibility = 'public'
    )
    select b.id, b.rank, b.total
    from board b
    join profiles p on p.id = b.id
    where coalesce((p.notification_prefs->>'master')::boolean, true)
      -- 0217 · public only — friends and private get no placement push.
      and p.rank_visibility = 'public'
      and coalesce((p.notification_prefs->>'placement_enabled')::boolean, true)
      and extract(hour from (now() at time zone
            coalesce(nullif(p.notification_prefs->>'timezone', ''), nullif(p.timezone, ''), 'UTC')))::int
          = coalesce((p.notification_prefs->>'placement_hour')::int, 21)
      and not exists (
        select 1 from notification_events ne
        where ne.user_id = b.id
          and ne.type = 'daily_placement'
          and ne.created_at > now() - interval '23 hours'
      )
  loop
    -- 0216 · the last placement this user was sent. 0253 · only a uni one is comparable.
    v_prev := null;
    select case when ne.payload->>'rank' ~ '^[0-9]+$' then (ne.payload->>'rank')::int end
      into v_prev
    from notification_events ne
    where ne.user_id = r.id and ne.type = 'daily_placement'
      and ne.payload->>'scope' = 'uni'
    order by ne.created_at desc
    limit 1;

    v_tier := case
      when r.rank <= 10    then 'Top 10. Defend it.'
      when r.rank <= 100   then 'Top 100 — the next ten are close.'
      when r.rank <= 1000  then 'Top 1,000. Keep climbing.'
      when r.rank <= 10000 then 'Top 10,000. Keep climbing.'
      else 'Climb.'
    end;

    v_where := ' of ' || to_char(r.total, 'FM999,999,999') || ' at your uni';

    if v_prev is null then
      v_title := 'You''re #' || to_char(r.rank, 'FM999,999,999') || v_where;
      v_body  := v_tier;
    elsif v_prev > r.rank then
      v_title := 'You climbed to #' || to_char(r.rank, 'FM999,999,999') || v_where;
      v_body  := 'Up from #' || to_char(v_prev, 'FM999,999,999') || ' — ' || v_tier;
    elsif v_prev < r.rank then
      v_title := 'You''re #' || to_char(r.rank, 'FM999,999,999') || v_where;
      v_body  := 'Slipped from #' || to_char(v_prev, 'FM999,999,999') || ' — reclaim it.';
    else
      v_title := 'Holding at #' || to_char(r.rank, 'FM999,999,999') || v_where;
      v_body  := 'Same as yesterday. Defend it.';
    end if;

    perform notify_event(
      array[r.id],
      'daily_placement',
      v_title,
      v_body,
      null,
      null,
      '/(tabs)/leaderboards',
      '{"scope": "uni"}'::jsonb,
      null,
      'flame',
      jsonb_strip_nulls(jsonb_build_object('scope', 'uni', 'rank', r.rank, 'total', r.total, 'prev_rank', v_prev))
    );
    v_sent := v_sent + 1;
  end loop;

  return v_sent;
end;
$function$;

revoke all on function public.send_daily_placement() from public, anon, authenticated;

commit;
