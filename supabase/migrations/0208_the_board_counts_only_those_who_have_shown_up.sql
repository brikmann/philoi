-- 0208 — the board (and the daily-placement denominator) counts only people who have DONE something.
--
-- ═════════════════════════════════ THE 29 ═════════════════════════════════
--
-- The daily-placement push (0205 §6) reports "You're #R of TOTAL", where TOTAL is:
--
--     count(*) over ()  from profiles  where not is_demo and not is_disabled
--
-- get_global_leaderboard (schema.sql) ranks over the SAME predicate, so the push and the board
-- agree with each other — but both include every profile that was never flagged is_demo/is_disabled,
-- and a pile of pre-launch photo-proof-of-concept accounts are exactly that: real rows, zero
-- activity, never flagged. With ~4 genuine users the board reads "of 29".
--
-- A leaderboard of people who have never locked in is wrong independent of flags, and a brand-new
-- real user with nothing on the board yet should not pad the denominator either. So this file adds
-- ONE predicate — a participation floor, `universal_score(id) > 0` — to both the placement board and
-- get_global_leaderboard, so the two stay in agreement AND stop counting ghosts.
--
-- Someone who has earned nothing is simply not ranked yet: they receive no placement push (they are
-- not in the board), and they do not appear on the global board until their first earning event.
-- This is additive to the is_demo/is_disabled filter, not a replacement — disabling a POC account
-- still removes it; this just means you no longer HAVE to.
--
-- Both functions were create-or-replace, diffed against their live bodies; the only change in each is
-- the single marked line. get_global_leaderboard already computes `s.score` per row, so the floor is
-- a free `and s.score > 0`; send_daily_placement's board CTE calls universal_score(p.id) directly.

-- ═══════════════════════════════ 1 · the global board ═══════════════════════════════

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
      -- 0208 · the participation floor. A profile that has earned nothing is not on the board.
      and s.score > 0
  )
  select r.*, (r.user_id = auth.uid()) as is_me
  from ranked r
  where r.rank <= p_limit or r.user_id = auth.uid()
  order by r.rank;
end;
$$;

-- ═══════════════════════════════ 2 · the daily-placement denominator ═══════════════════════════════
--
-- 0205 §6's body verbatim, with the one added floor in the board CTE. The due-time predicate,
-- the timezone fallback chain, and the once-per-day idempotency are unchanged — only WHO is ranked.

create or replace function public.send_daily_placement()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_sent int := 0;
  r record;
begin
  if not exists (
    select 1 from profiles p
    where not p.is_demo and not p.is_disabled
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
        row_number() over (order by universal_score(p.id) desc, p.display_name asc)::int as rank,
        count(*) over ()::int as total
      from profiles p
      where not p.is_demo and not p.is_disabled
        -- 0208 · same participation floor as the global board, so the push denominator equals what
        -- the leaderboard screen the notification links to actually shows.
        and universal_score(p.id) > 0
    )
    select b.id, b.rank, b.total
    from board b
    join profiles p on p.id = b.id
    where coalesce((p.notification_prefs->>'master')::boolean, true)
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
    perform notify_event(
      array[r.id],
      'daily_placement',
      'You''re #' || to_char(r.rank, 'FM999,999,999') || ' of ' || to_char(r.total, 'FM999,999,999'),
      case
        when r.rank <= 10    then 'Top 10. Defend it.'
        when r.rank <= 100   then 'Top 100 — the next ten are close.'
        when r.rank <= 1000  then 'Top 1,000. Keep climbing.'
        when r.rank <= 10000 then 'Top 10,000. Keep climbing.'
        else 'Climb.'
      end,
      null,
      null,
      '/(tabs)/leaderboards',
      '{}'::jsonb,
      null,
      'flame',
      jsonb_build_object('rank', r.rank, 'total', r.total)
    );
    v_sent := v_sent + 1;
  end loop;

  return v_sent;
end;
$function$;

revoke all on function public.send_daily_placement() from public, anon, authenticated;

-- ═══════════════════════════════ assertions ═══════════════════════════════

do $assert$
declare
  v_all   int;
  v_float int;
begin
  select count(*) into v_all
  from profiles p where not p.is_demo and not p.is_disabled;

  select count(*) into v_float
  from profiles p where not p.is_demo and not p.is_disabled and universal_score(p.id) > 0;

  -- The floor is FORWARD protection, not a cleanup of the 29 — so it is not an error for it to
  -- remove nobody. The 27 pre-launch POC accounts were already flagged is_demo before this file was
  -- applied (2026-09-23: total 29, is_demo 27, is_disabled 0, board 2, unflagged-with-zero-score 0),
  -- so on prod all = floored = 2 and the floor is a no-op until the next real signup who has not
  -- earned yet. An earlier draft asserted `v_float < v_all` here and aborted the migration on
  -- exactly that healthy state; it would also fail on every freshly rebuilt database, where no
  -- profile has earned. Report the shape, do not judge it.
  raise notice '0208: participation floor — % of % unflagged profiles are ranked', v_float, v_all;

  -- Still fatal: a floor that empties a NON-empty board means universal_score is broken.
  -- Guarded on v_all > 0 so a fresh database with no profiles replays cleanly.
  if v_all > 0 and v_float = 0 then
    raise exception '0208: participation floor removed EVERYONE (all=%) — universal_score is returning 0 for all, do not ship', v_all;
  end if;

  -- The floor reached the live body of BOTH functions. These are data-independent, so unlike the
  -- counts above they still discriminate on a fresh database. Namespace-qualified because a bare
  -- proname subquery errors on "more than one row" the day someone adds an overload.
  if (select prosrc from pg_proc
        where proname = 'send_daily_placement' and pronamespace = 'public'::regnamespace) !~ 'universal_score\(p\.id\) > 0' then
    raise exception '0208: send_daily_placement did not pick up the participation floor';
  end if;
  if (select prosrc from pg_proc
        where proname = 'get_global_leaderboard' and pronamespace = 'public'::regnamespace) !~ 's\.score > 0' then
    raise exception '0208: get_global_leaderboard did not pick up the participation floor';
  end if;
end;
$assert$;
