-- 0301 — THE GYM SPARK: the server side of src/lib/api/gym-spark.ts.
--
-- Three client RPCs and two private helpers. Same firewall as the Agora: nothing here touches XP,
-- embers or rank.
--
--   set_agora_post_pr(post, bool)        — the author flags/unflags their OWN post as a PR (mock 401).
--   get_gym_feed(filter, at, id, limit)  — get_agora_feed's rows, unchanged, + is_pr + the newest
--                                          visible comment (mock 400). It WRAPS the live
--                                          get_agora_feed rather than copying its body, so every
--                                          visibility / block / disabled / room rule that feed
--                                          enforces (and any later amendment to it) applies here
--                                          for free. Filters: 'gym' → 'global', 'following' →
--                                          'friends', 'prs' → the PR-flagged posts of 'global'.
--   get_gym_board(window)                — one leaderboard for 'week' or 'all' (mock 402).
--
-- WHAT A "SESSION" IS. One finished lock-in = one check_ins row. stop_lock_in_session (and the
-- idle-hour auto-stop, 0271) inserts exactly one check_ins row (source 'manual', duration = the
-- credited seconds, ≥ 1) and stamps it on lock_in_sessions.ended_check_in_id. On prod every
-- source='manual' check-in is some lock_in_session's ended_check_in_id (0 orphans, 2026-11-16), and
-- check_ins.created_at is the moment the session finished — the right instant to bucket into a
-- week. The filter is exactly the one 0281 get_my_week_vs_last and 0288 people_week_stats use for
-- "your hours" (removed_at is null, duration_seconds > 0, source 'manual'), so the Board can never
-- disagree with Home about what counted; Strava imports (source 'strava') are not lock-ins and are
-- excluded, a moderator-removed check-in stops counting. lock_in_sessions itself is NOT used for
-- anything time-based: last_confirmed_at == started_at on most rows and its duration is not there.
--
-- SWAPPABLE METRIC. "What is a session" lives only in gym_board_sessions(); "what the board ranks
-- by" lives only in gym_board_metric(). Ranking by volume / PRs / minutes later is a re-cut of
-- gym_board_metric alone (the client field stays `sessions` for v1). Both helpers are private:
-- no client role can execute them; get_gym_board (SECURITY DEFINER, owned by postgres) calls them.
--
-- Additive only: one column (default false), five NEW functions. Nothing existing is restated.

-- ─────────────────────────────── 1 · THE PR FLAG ───────────────────────────────

alter table public.agora_posts add column if not exists is_pr boolean not null default false;

-- ─────────────────────────────── 2 · set_agora_post_pr ───────────────────────────────

create function public.set_agora_post_pr(p_post_id uuid, p_is_pr boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Not signed in.' using errcode = '42501';
  end if;

  update agora_posts ap
     set is_pr = coalesce(p_is_pr, false)
   where ap.id = p_post_id
     and ap.user_id = auth.uid();

  -- Not found and not yours are the same answer: an id is not proof you may see the post.
  if not found then
    raise exception 'Post not found.' using errcode = 'P0002';
  end if;
end;
$$;

revoke all on function public.set_agora_post_pr(uuid, boolean) from public, anon, authenticated;
grant execute on function public.set_agora_post_pr(uuid, boolean) to authenticated, service_role;

-- ─────────────────────────────── 3 · get_gym_feed ───────────────────────────────

-- One decorated page of get_agora_feed: its 23 columns in its order + is_pr + the top comment.
-- Private (called only from get_gym_feed). p_prs_only skips the comment lookup on non-PR rows,
-- which the 'prs' loop throws away anyway — the rows themselves are all returned so the loop can
-- advance its cursor to the true last row of the page.
--
-- The top comment mirrors get_agora_comments' filter (deleted_at is null, mutual block with the
-- caller) and additionally drops disabled commenters, like the feed drops disabled authors. The
-- item itself already passed get_agora_feed's visibility gate, so its thread is readable.
-- Every column is alias-qualified: RETURNS TABLE's OUT names shadow same-named table columns.
create function public.gym_feed_page(
  p_scope text, p_before_at timestamptz, p_before_id uuid, p_limit integer, p_prs_only boolean
)
returns table (
  item_type text, id uuid, user_id uuid, display_name text, handle text, avatar_url text,
  university text, rank_tier text, rank_division integer, visibility text, body text,
  photo_path text, attach_kind text, attach_snapshot jsonb, attachments jsonb, cheers bigint,
  cheered boolean, comments bigint, created_at timestamptz, audience text, audience_ref_id uuid,
  audience_name text, audience_emoji text,
  is_pr boolean, top_comment_name text, top_comment_body text
)
language sql
stable
set search_path = public
as $$
  select
    f.item_type, f.id, f.user_id, f.display_name, f.handle, f.avatar_url,
    f.university, f.rank_tier, f.rank_division, f.visibility, f.body,
    f.photo_path, f.attach_kind, f.attach_snapshot, f.attachments, f.cheers,
    f.cheered, f.comments, f.created_at, f.audience, f.audience_ref_id,
    f.audience_name, f.audience_emoji,
    coalesce(ap.is_pr, false),
    tc.name,
    tc.body
  from get_agora_feed(p_scope, p_before_at, p_before_id, p_limit) f
  left join agora_posts ap on f.item_type = 'post' and ap.id = f.id
  left join lateral (
    select coalesce(nullif(btrim(cp.display_name), ''), cp.handle) as name, c.body
      from agora_comments c
      join profiles cp on cp.id = c.user_id
     where c.deleted_at is null
       and f.comments > 0
       and (not p_prs_only or coalesce(ap.is_pr, false))
       and (case f.item_type when 'post' then c.post_id else c.milestone_id end) = f.id
       and not cp.is_disabled
       and not exists (
         select 1 from blocked_users b
          where (b.blocker_id = auth.uid() and b.blocked_id = c.user_id)
             or (b.blocker_id = c.user_id and b.blocked_id = auth.uid())
       )
     order by c.created_at desc, c.id desc
     limit 1
  ) tc on true
  order by f.created_at desc, f.id desc;
$$;

revoke all on function public.gym_feed_page(text, timestamptz, uuid, integer, boolean)
  from public, anon, authenticated;

create function public.get_gym_feed(
  p_filter text, p_before_at timestamptz, p_before_id uuid, p_limit integer
)
returns table (
  item_type text, id uuid, user_id uuid, display_name text, handle text, avatar_url text,
  university text, rank_tier text, rank_division integer, visibility text, body text,
  photo_path text, attach_kind text, attach_snapshot jsonb, attachments jsonb, cheers bigint,
  cheered boolean, comments bigint, created_at timestamptz, audience text, audience_ref_id uuid,
  audience_name text, audience_emoji text,
  is_pr boolean, top_comment_name text, top_comment_body text
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_limit  integer := least(greatest(coalesce(p_limit, 20), 1), 50);
  v_at     timestamptz := p_before_at;
  v_id     uuid := p_before_id;
  v_page   integer;
  v_got    integer := 0;
  v_iter   integer := 0;
begin
  if auth.uid() is null then
    raise exception 'Not signed in.' using errcode = '42501';
  end if;

  if p_filter = 'gym' then
    return query select g.* from gym_feed_page('global', p_before_at, p_before_id, v_limit, false) g;
    return;
  elsif p_filter = 'following' then
    return query select g.* from gym_feed_page('friends', p_before_at, p_before_id, v_limit, false) g;
    return;
  elsif p_filter is distinct from 'prs' then
    raise exception 'Unknown gym feed filter: %', p_filter using errcode = '22023';
  end if;

  -- 'prs': walk 'global' in pages of 50 (get_agora_feed's cap), keep the PR posts, advance the
  -- cursor to each page's LAST row (PR or not) so a sparse run of PRs pages correctly, and stop
  -- at v_limit rows, a short page (the feed is exhausted), or 40 pages (2,000 rows scanned).
  -- Rows come out in (created_at desc, id desc), so the client's (created_at, id) cursor holds.
  loop
    v_iter := v_iter + 1;
    v_page := 0;
    for item_type, id, user_id, display_name, handle, avatar_url,
        university, rank_tier, rank_division, visibility, body,
        photo_path, attach_kind, attach_snapshot, attachments, cheers,
        cheered, comments, created_at, audience, audience_ref_id,
        audience_name, audience_emoji,
        is_pr, top_comment_name, top_comment_body
      in select g.* from gym_feed_page('global', v_at, v_id, 50, true) g
    loop
      v_page := v_page + 1;
      v_at := created_at;
      v_id := id;
      if item_type = 'post' and is_pr and v_got < v_limit then
        return next;
        v_got := v_got + 1;
      end if;
    end loop;

    exit when v_got >= v_limit or v_page < 50 or v_iter >= 40;
  end loop;
end;
$$;

revoke all on function public.get_gym_feed(text, timestamptz, uuid, integer) from public, anon, authenticated;
grant execute on function public.get_gym_feed(text, timestamptz, uuid, integer) to authenticated, service_role;

-- ─────────────────────────────── 4 · get_gym_board ───────────────────────────────

-- THE definition of a session (see header): one finished lock-in's check-in. p_since null = all time.
create function public.gym_board_sessions(p_since timestamptz)
returns table (user_id uuid, at timestamptz)
language sql
stable
set search_path = public
as $$
  select ci.user_id, ci.created_at
    from check_ins ci
   where ci.removed_at is null
     and ci.duration_seconds > 0
     and coalesce(ci.source, 'manual') = 'manual'
     and (p_since is null or ci.created_at >= p_since);
$$;

revoke all on function public.gym_board_sessions(timestamptz) from public, anon, authenticated;

-- THE ranking metric. v1 = session count. Swap this body to rank by something else.
create function public.gym_board_metric(p_since timestamptz)
returns table (user_id uuid, value integer)
language sql
stable
set search_path = public
as $$
  select s.user_id, count(*)::integer
    from gym_board_sessions(p_since) s
   group by s.user_id;
$$;

revoke all on function public.gym_board_metric(timestamptz) from public, anon, authenticated;

-- Everyone with metric ≥ 1 in the window, plus the caller ALWAYS (0 if none). Minus disabled and
-- demo accounts and anyone blocked either way with the caller (the caller is never filtered out of
-- their own row). rank() over the metric desc — ties share a rank; ties are listed by display_name.
-- week_streak = consecutive Sunday-00:00-UTC weeks (week_start(), 0071 ↔ lib/time/week.ts) with
-- ≥ 1 session, ending this week — or last week if there is none yet this week, so a streak isn't
-- shown as broken on Sunday morning.
create function public.get_gym_board(p_window text)
returns table (
  rank integer, user_id uuid, display_name text, handle text, avatar_url text,
  sessions integer, week_streak integer, is_me boolean
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_me    uuid := auth.uid();
  v_since timestamptz;
begin
  if v_me is null then
    raise exception 'Not signed in.' using errcode = '42501';
  end if;

  if p_window = 'week' then
    v_since := week_start(now());
  elsif p_window = 'all' then
    v_since := null;
  else
    raise exception 'Unknown gym board window: %', p_window using errcode = '22023';
  end if;

  return query
  with metric as (
    select m.user_id as uid, m.value from gym_board_metric(v_since) m where m.value >= 1
  ),
  people as (
    select x.uid, coalesce(max(x.value), 0) as value
      from (select mt.uid, mt.value from metric mt
            union all
            select v_me, 0) x
     group by x.uid
  ),
  visible as (
    select pe.uid, pe.value, pr.display_name, pr.handle, pr.avatar_url
      from people pe
      join profiles pr on pr.id = pe.uid
     where pe.uid = v_me
        or (not pr.is_disabled
            and not pr.is_demo
            and not exists (
              select 1 from blocked_users b
               where (b.blocker_id = v_me and b.blocked_id = pe.uid)
                  or (b.blocker_id = pe.uid and b.blocked_id = v_me)))
  ),
  weeks as (
    select distinct s.user_id as uid, week_start(s.at) as wk
      from gym_board_sessions(null) s
     where s.user_id in (select v.uid from visible v)
  ),
  anchored as (
    select w.uid, w.wk,
           row_number() over (partition by w.uid order by w.wk desc) - 1 as n,
           case when max(w.wk) over (partition by w.uid) >= week_start(now())
                then week_start(now())
                else week_start(now()) - interval '168 hours' end as anchor
      from weeks w
  ),
  -- Weeks are distinct and descending, so once one misses (anchor - n weeks) every later one does.
  streaks as (
    select a.uid, count(*)::integer as streak
      from anchored a
     where a.wk = a.anchor - a.n * interval '168 hours'
     group by a.uid
  )
  select
    (rank() over (order by v.value desc))::integer,
    v.uid,
    v.display_name,
    v.handle,
    v.avatar_url,
    v.value::integer,
    coalesce(st.streak, 0),
    v.uid = v_me
  from visible v
  left join streaks st on st.uid = v.uid
  order by v.value desc, v.display_name, v.uid;
end;
$$;

revoke all on function public.get_gym_board(text) from public, anon, authenticated;
grant execute on function public.get_gym_board(text) to authenticated, service_role;
