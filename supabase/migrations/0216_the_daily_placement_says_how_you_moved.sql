-- 0216 — the daily-placement push says how you MOVED, not just where you are.
--
-- 0205 §6's push reports standing only: "You're #R of N" + a tier line. "You climbed from #200 to
-- #150" was expected and never built. It needs no new storage: every daily_placement row already
-- carries payload {rank, total}, and the once-per-23h lock means the newest existing daily_placement
-- for a user IS the previous send. Read its rank back, diff it, and write the copy from the move.
--
--   no prior placement  → "You're #R of N"        / tier line               (unchanged first-time copy)
--   climbed (prev > R)  → "You climbed to #R of N" / "Up from #prev — tier"
--   slipped (prev < R)  → "You're #R of N"        / "Slipped from #prev — reclaim it."
--   held    (prev = R)  → "Holding at #R of N"    / "Same as yesterday. Defend it."
--
-- No recency gate: a last placement from last week is still the last comparison point, and
-- "up from #200" is still true. Type, category, deep link and quiet-hours handling are unchanged —
-- still 'daily_placement'. payload keeps {rank, total} unchanged so tomorrow reads today back the
-- same way; prev_rank is added when there is one.
--
-- Restated from the live prosrc (0208 body — 0205's due-hour + timezone fallback + once-per-day lock,
-- 0208's participation floor). The only change is inside the loop: the v_prev lookup and the copy.

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
    -- 0216 · the last placement this user was sent. The 23h lock above means it is the prior send.
    -- A row whose payload lacks a numeric rank reads as "no prior" rather than aborting the batch.
    select case when ne.payload->>'rank' ~ '^[0-9]+$' then (ne.payload->>'rank')::int end
      into v_prev
    from notification_events ne
    where ne.user_id = r.id and ne.type = 'daily_placement'
    order by ne.created_at desc
    limit 1;

    v_tier := case
      when r.rank <= 10    then 'Top 10. Defend it.'
      when r.rank <= 100   then 'Top 100 — the next ten are close.'
      when r.rank <= 1000  then 'Top 1,000. Keep climbing.'
      when r.rank <= 10000 then 'Top 10,000. Keep climbing.'
      else 'Climb.'
    end;

    if v_prev is null then
      v_title := 'You''re #' || to_char(r.rank, 'FM999,999,999') || ' of ' || to_char(r.total, 'FM999,999,999');
      v_body  := v_tier;
    elsif v_prev > r.rank then
      v_title := 'You climbed to #' || to_char(r.rank, 'FM999,999,999') || ' of ' || to_char(r.total, 'FM999,999,999');
      v_body  := 'Up from #' || to_char(v_prev, 'FM999,999,999') || ' — ' || v_tier;
    elsif v_prev < r.rank then
      v_title := 'You''re #' || to_char(r.rank, 'FM999,999,999') || ' of ' || to_char(r.total, 'FM999,999,999');
      v_body  := 'Slipped from #' || to_char(v_prev, 'FM999,999,999') || ' — reclaim it.';
    else
      v_title := 'Holding at #' || to_char(r.rank, 'FM999,999,999') || ' of ' || to_char(r.total, 'FM999,999,999');
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
      '{}'::jsonb,
      null,
      'flame',
      jsonb_strip_nulls(jsonb_build_object('rank', r.rank, 'total', r.total, 'prev_rank', v_prev))
    );
    v_sent := v_sent + 1;
  end loop;

  return v_sent;
end;
$function$;

revoke all on function public.send_daily_placement() from public, anon, authenticated;

-- ═══════════════════════════════ assertions ═══════════════════════════════
-- Data-independent, so they discriminate on a fresh database too. The behavioural checks
-- (climbed / slipped / first-time / floor) ran as a rolled-back probe against prod before this shipped.

do $assert$
declare
  v_src text;
begin
  select prosrc into v_src from pg_proc
  where proname = 'send_daily_placement' and pronamespace = 'public'::regnamespace;

  if v_src !~ 'universal_score\(p\.id\) > 0' then
    raise exception '0216: send_daily_placement lost the 0208 participation floor';
  end if;
  if v_src !~ 'interval ''23 hours''' then
    raise exception '0216: send_daily_placement lost the 0205 once-per-day lock';
  end if;
  if v_src !~ 'nullif\(p\.timezone, ''''\)' then
    raise exception '0216: send_daily_placement lost the 0205 profiles.timezone fallback';
  end if;
  if v_src !~ 'Up from #' or v_src !~ 'Slipped from #' or v_src !~ 'Holding at #' then
    raise exception '0216: send_daily_placement did not pick up the movement copy';
  end if;
end;
$assert$;
