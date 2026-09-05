-- PRIVATE MODE — A VISIBILITY WALL, NOT AN ACCOUNT FREEZE
-- (CODE_PROMPT_leaderboard_private.md §1–§3)
--
-- Requested repeatedly and unprompted: "only my friends can see me." Not muted notifications — a
-- flat visibility block with a friends allowlist. A private user keeps earning XP, ranks and
-- streaks, keeps seeing their OWN real rank everywhere, and keeps getting paid for placements they
-- actually earned. What changes is who can read their numbers.
--
-- ══════════════════════════════════════════════════════════════════════════════════════════════
-- ONE PREDICATE, CALLED FROM EVERY SURFACE
--
-- The failure mode this migration is built to avoid is DRIFT: six surfaces each open-coding "am I
-- allowed to see this person", one of them getting it subtly wrong, and a private user leaking out
-- of exactly one board. So `can_see_rank(viewer, target)` is defined once and every surface below
-- calls it. If the rule changes, it changes in one body.
--
-- THE FRIEND PREDICATE IS COPIED FROM search_leaderboard's OWN `is_friend`, read out of prod
-- pg_proc rather than re-invented — an accepted friend_requests row in EITHER direction. Two
-- different spellings of "friends" is precisely the drift above, wearing a different hat.
--
-- SYMMETRIC BY DEFAULT (the prompt's "imposter-syndrome half"): the wall faces both ways, so a
-- private user's own boards are filtered to friends too. That is a deliberate product call and it
-- lives in ONE line below (`v_viewer_private or v_target_private`) — if Noah wants private to be
-- outbound-only, delete the viewer half and nothing else moves.
--
-- ══════════════════════════════════════════════════════════════════════════════════════════════
-- ⚠ THREE FUNCTIONS ARE DROPPED AND RECREATED, NOT REPLACED
--
-- get_user_rank, get_group_challenge_watch and get_challenge_results each gain an output column,
-- and `create or replace` CANNOT change a return type — it errors with "cannot change return type
-- of existing function". Per MIGRATIONS.md the drop is spelled with the full argument list so it
-- finds the right overload, and since the argument list is UNCHANGED there is no second signature
-- left standing afterwards (the 0145 trap). Verified by the overload count at the bottom.
--
-- ADDITIVE FOR OLD CLIENTS. Every added column is appended last and every added filter is a
-- no-op while `leaderboard_private` is false for everyone, which it is on the day this ships. A
-- build that has never heard of `muted` or `is_anonymous` reads the columns it knows and behaves
-- exactly as it does today — which matters because OTA cannot reach installs on an older
-- sdkVersion.
-- ══════════════════════════════════════════════════════════════════════════════════════════════

-- ─────────────────────────── 1 · the flag ───────────────────────────
--
-- Mirrors the photo_visibility precedent (0015/0026): a plain boolean on profiles, defaulted false,
-- written only through an RPC so a client can never set someone else's.

alter table profiles
  add column if not exists leaderboard_private boolean not null default false;

comment on column profiles.leaderboard_private is
  'Private mode (0170): when true, only accepted friends can see this user on boards, in search, '
  'on their profile rank block, and by name in challenge standings. A display wall — scoring, XP '
  'and reward grants all still read the real numbers.';

create or replace function set_leaderboard_private(p_on boolean)
returns void
language sql
security definer
set search_path = public
as $$
  update profiles set leaderboard_private = coalesce(p_on, false) where id = auth.uid();
$$;

revoke all on function set_leaderboard_private(boolean) from public, anon;
grant execute on function set_leaderboard_private(boolean) to authenticated;

-- ─────────────────────────── 2 · the one predicate ───────────────────────────
--
-- SECURITY DEFINER because it reads `profiles.leaderboard_private` and `friend_requests` for a
-- user the caller may have no RLS path to — the whole point is answering "may I see this stranger",
-- and a stranger's rows are what an invoker-rights function cannot reach.
--
-- STABLE, not IMMUTABLE: it reads tables. Marking it immutable would let the planner cache a
-- verdict across a friendship being accepted mid-statement.
--
-- A NULL VIEWER (anon / no session) is not nobody-special: it is the least-privileged viewer
-- there is, so it may see only non-private users.

create or replace function can_see_rank(p_viewer uuid, p_target uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_viewer_private boolean;
  v_target_private boolean;
begin
  if p_target is null then return false; end if;
  -- You can always see yourself. Checked first so a private user's own rank never round-trips
  -- through the friend lookup.
  if p_viewer = p_target then return true; end if;

  select coalesce(leaderboard_private, false) into v_target_private from profiles where id = p_target;
  if v_target_private is null then return false; end if;  -- no such profile

  if p_viewer is null then
    return not v_target_private;
  end if;

  select coalesce(leaderboard_private, false) into v_viewer_private from profiles where id = p_viewer;

  -- Nobody is private → ordinary public visibility, and no friend lookup at all. This is the
  -- overwhelmingly common path and it costs two index hits.
  if not coalesce(v_viewer_private, false) and not v_target_private then
    return true;
  end if;

  -- Someone is private, so the pair must be friends. Same predicate as search_leaderboard.
  return exists (
    select 1 from friend_requests fr
    where fr.status = 'accepted'
      and ((fr.requester_id = p_viewer and fr.recipient_id = p_target)
        or (fr.requester_id = p_target and fr.recipient_id = p_viewer))
  );
end;
$$;

comment on function can_see_rank(uuid, uuid) is
  'Private mode (0170): may p_viewer see p_target''s competitive numbers? True for self, for a '
  'pair where neither is private, or for accepted friends. The single definition every visibility '
  'surface calls — do not open-code this rule anywhere else.';

grant execute on function can_see_rank(uuid, uuid) to authenticated;

-- A private user's boards filter on every row, so the friendship lookup is the hot path.
create index if not exists friend_requests_accepted_requester_idx
  on friend_requests (requester_id, recipient_id) where status = 'accepted';
create index if not exists friend_requests_accepted_recipient_idx
  on friend_requests (recipient_id, requester_id) where status = 'accepted';

-- ─────────────────────────── 3 · every visibility surface honours it (§2) ───────────────────────────
--
-- Each body below is prod's CURRENT prosrc, read out of pg_proc, with the visibility predicate
-- added and NOTHING ELSE TOUCHED. That is the discipline this repo learned the hard way: a body
-- restated from an older migration file silently reverts whatever a sibling branch landed in
-- between. Diff these against pg_proc before pushing.

-- SEARCH — a private non-friend is simply not in the results. No "hidden" placeholder row: the
-- prompt's word is *unsearchable*, and a greyed-out row still confirms the account exists.
create or replace function search_leaderboard(p_query text, p_limit integer default 20)
returns table(user_id uuid, display_name text, handle text, avatar_url text, tier text,
              division integer, score numeric, board text, board_rank integer, is_friend boolean)
language plpgsql
stable
security definer
set search_path = public
as $$
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
      -- 0170 · THE ONLY ADDED LINE in this body.
      and can_see_rank(auth.uid(), p.id)
      and (p.handle ilike '%' || p_query || '%' or p.display_name ilike '%' || p_query || '%')
    order by
      (p.handle = p_query) desc,
      (p.handle ilike p_query || '%') desc,
      p.display_name asc
    limit p_limit
  ),
  scored as (
    select m.*, s.score, t.tier, t.division
    from matches m
    cross join lateral (select universal_score(m.id) as score) s
    cross join lateral rank_tier_for_score(s.score) t
  ),
  uni_ranked as (
    select p.id, row_number() over (order by universal_score(p.id) desc, p.display_name asc)::int as rank
    from profiles p
    where p.university = v_my_university and not p.is_demo and not p.is_disabled and v_my_university is not null
  ),
  global_ranked as (
    select p.id, row_number() over (order by universal_score(p.id) desc, p.display_name asc)::int as rank
    from profiles p
    where not p.is_demo and not p.is_disabled
  )
  select
    sc.id,
    sc.display_name,
    sc.handle,
    sc.avatar_url,
    sc.tier,
    sc.division,
    sc.score,
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
$$;

-- GLOBAL BOARD — the filter sits INSIDE the `ranked` CTE, above row_number(), which is what makes
-- "ranks recompute over the visible set" true rather than aspirational. Filtering after the window
-- function would leave gaps (…4, 6, 7…) that spell out exactly who is hidden.
create or replace function get_global_leaderboard(p_limit integer default 50)
returns table(user_id uuid, handle text, display_name text, avatar_url text, is_pro boolean,
              score numeric, tier text, division integer, university text,
              check_ins_this_week bigint, rank integer, is_me boolean)
language plpgsql
stable
security definer
set search_path = public
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
      -- 0170 · THE ONLY ADDED LINE.
      and can_see_rank(auth.uid(), p.id)
  )
  select r.*, (r.user_id = auth.uid()) as is_me
  from ranked r
  where r.rank <= p_limit or r.user_id = auth.uid()
  order by r.rank;
end;
$$;

create or replace function get_university_leaderboard(p_university text, p_limit integer default 50)
returns table(user_id uuid, handle text, display_name text, avatar_url text, is_pro boolean,
              score numeric, tier text, division integer,
              check_ins_this_week bigint, rank integer, is_me boolean)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  return query
  with ranked as (
    select
      p.id as user_id, p.handle, p.display_name, p.avatar_url, p.is_pro,
      s.score, t.tier, t.division,
      coalesce((
        select count(*) from check_ins ci
        where ci.user_id = p.id and ci.created_at >= date_trunc('week', now())
      ), 0) as check_ins_this_week,
      row_number() over (order by s.score desc, p.display_name asc)::int as rank
    from profiles p
    cross join lateral (select universal_score(p.id) as score) s
    cross join lateral rank_tier_for_score(s.score) t
    where p.university = p_university
      and p.university_email_verified          -- new in 0062
      and not p.is_demo and not p.is_disabled
      -- 0170 · THE ONLY ADDED LINE.
      and can_see_rank(auth.uid(), p.id)
  )
  select r.*, (r.user_id = auth.uid()) as is_me
  from ranked r
  where r.rank <= p_limit or r.user_id = auth.uid()
  order by r.rank;
end;
$$;

-- CAMPFIRE BOARD. Sharing a campfire is NOT friendship, so a private member is hidden here too
-- from non-friends. They keep their seat in the fire and their place in its races — this is the
-- board, not the roster.
create or replace function get_group_leaderboard(p_group_id uuid)
returns table(user_id uuid, handle text, display_name text, avatar_url text, is_pro boolean,
              score numeric, tier text, division integer, check_ins_this_week bigint)
language sql
stable
security definer
set search_path = public
as $$
  select
    gm.user_id,
    p.handle,
    p.display_name,
    p.avatar_url,
    p.is_pro,
    s.score,
    t.tier,
    t.division,
    coalesce((
      select count(*) from check_ins ci
      where ci.user_id = gm.user_id and ci.created_at >= date_trunc('week', now())
    ), 0) as check_ins_this_week
  from group_members gm
  join profiles p on p.id = gm.user_id
  cross join lateral (select universal_score(gm.user_id) as score) s
  cross join lateral rank_tier_for_score(s.score) t
  where gm.group_id = p_group_id and is_group_member(p_group_id)
    -- 0170 · THE ONLY ADDED LINE.
    and can_see_rank(auth.uid(), gm.user_id)
  order by s.score desc, check_ins_this_week desc, p.display_name asc;
$$;

-- ─────────────────────────── 4 · profile rank reads "Rank muted", never a lie ───────────────────────────
--
-- ⚠ DROPPED, not replaced — this gains an output column and `create or replace` cannot change a
-- return type. Full argument list per MIGRATIONS.md; the argument list is unchanged, so no second
-- overload survives.
--
-- IT RETURNS A ROW, NOT ZERO ROWS. An empty result is indistinguishable from "this user has no
-- rank yet", and the client's `data[0] ?? null` would render an ordinary blank hexagon — silently
-- turning a privacy wall into a bug report. One row with every figure null and `muted = true` is
-- unambiguous, and a NULL score can never be mistaken for a real one the way a 0 could.
drop function if exists get_user_rank(uuid);

create function get_user_rank(p_user_id uuid)
returns table(score numeric, tier text, division integer,
              xp_into_tier numeric, xp_for_next_tier numeric, muted boolean)
language plpgsql
stable
security definer
set search_path = public
as $fn$
begin
  if not can_see_rank(auth.uid(), p_user_id) then
    return query select null::numeric, null::text, null::integer, null::numeric, null::numeric, true;
    return;
  end if;

  return query
  select
    s.score,
    t.tier,
    t.division,
    s.score - lo.cumulative_xp_required as xp_into_tier,
    coalesce(hi.cumulative_xp_required, lo.cumulative_xp_required) - lo.cumulative_xp_required as xp_for_next_tier,
    false
  from (select universal_score(p_user_id) as score) s
  cross join lateral rank_tier_for_score(s.score) t
  join rank_thresholds lo on lo.tier = t.tier and lo.division = t.division
  left join rank_thresholds hi on hi.rank_index = lo.rank_index + 1;
end;
$fn$;

-- ─────────────────────────── 5 · in a challenge, a private player is "Anonymous" (§3) ───────────────────────────
--
-- THE INTRIGUE IS THE POINT. A private racer is not removed from the standings — removing them
-- would quietly shrink the field and change what the race looks like. They are shown, at the
-- bottom, with no position: you know someone else is in this, you do not know where they stand.
-- They could be last. They could be about to win.
--
-- 🔴 THIS IS A DISPLAY LAYER AND NOTHING ELSE. Settlement, ranking, percentiles and payouts all
-- read challenge_participants.final_* on the real numbers, written by the settlement job, and none
-- of that goes anywhere near this function. An anonymous racer can win and be paid in full. If
-- anonymity ever reaches the scoring path it is a bug, not a feature.
--
-- ONE PREDICATE PER ROW, via a lateral, rather than four calls to can_see_rank in four select
-- expressions. can_see_rank is STABLE, so the planner MAY fold repeats — "may" is not a guarantee
-- worth betting a per-row friend lookup on.

drop function if exists get_group_challenge_watch(uuid);

create function get_group_challenge_watch(p_challenge_id uuid)
returns table(challenge_id uuid, target_count integer, window_hours integer,
              starts_at timestamptz, ends_at timestamptz, status text,
              circle_id uuid, circle_name text, public_name text, shape text, race_metric text,
              member_id uuid, member_name text, member_progress numeric,
              member_live_status text, member_cheers integer, cheered_by_me boolean,
              is_anonymous boolean)
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_challenge social_challenges;
begin
  -- sc.status, not status: `status` is an OUT column of this function. Same trap as 0099.
  select * into v_challenge from social_challenges sc
  where sc.id = p_challenge_id
    and sc.mode = 'group'
    and (challenge_is_live(sc.status) or challenge_is_settled(sc.status));
  if v_challenge.id is null then
    raise exception 'Group challenge not found or not active.';
  end if;
  if not is_group_member(v_challenge.circle_id) then
    raise exception 'Not a member of that campfire.';
  end if;

  return query
  select
    v_challenge.id,
    v_challenge.target_count,
    v_challenge.window_hours,
    v_challenge.starts_at,
    v_challenge.ends_at,
    v_challenge.status,
    v_challenge.circle_id,
    g.name,
    v_challenge.public_name,
    v_challenge.shape,
    v_challenge.race_metric,
    f.user_id,
    -- 0170 · name, progress and live status are the three things anonymity hides. Everything else
    -- on the row is about the CHALLENGE, not about who is running it.
    case when vis.ok then p.display_name else 'Anonymous' end,
    case when vis.ok then
      case
        when v_challenge.shape = 'placement' then
          -- Net of the baseline, evaluated at the end of the window once it has passed — the same
          -- expression settlement uses (0127), so the live board and the final board cannot disagree.
          greatest(
            challenge_metric_value(v_challenge.race_metric, f.user_id,
              least(now(), coalesce(v_challenge.ends_at, now()))) - f.baseline,
            0)
        else (
          select count(*) from check_ins ci
          where ci.user_id = f.user_id and ci.removed_at is null
            and ci.created_at >= v_challenge.starts_at and ci.created_at <= coalesce(v_challenge.ends_at, now())
            and check_in_qualifies_for_challenge(ci.id)
        )::numeric
      end
    else null end,
    case when vis.ok then live_status(f.user_id) else null end,
    (select count(*)::int from challenge_cheers cc
      where cc.challenge_id = p_challenge_id and cc.for_user_id = f.user_id),
    exists (select 1 from challenge_cheers cc
      where cc.challenge_id = p_challenge_id and cc.spectator_id = auth.uid() and cc.for_user_id = f.user_id),
    not vis.ok
  from challenge_field(p_challenge_id, v_challenge.circle_id) f
  join profiles p on p.id = f.user_id
  join groups g on g.id = v_challenge.circle_id
  cross join lateral (select can_see_rank(auth.uid(), f.user_id) as ok) vis;
end;
$fn$;

-- SETTLED STANDINGS. Same rule, with one deliberate exception: THE WINNER IS ALWAYS NAMED. A race
-- whose result is "somebody anonymous won" has no result, and the prompt's §3 says to surface what
-- the rules require on reveal. Everyone else still private stays anonymous, at the bottom, with no
-- place, no figure and no payout shown — another racer's reward is not the reader's business.
drop function if exists get_challenge_results(uuid);

create function get_challenge_results(p_challenge_id uuid)
returns table(member_id uuid, member_name text, score_value numeric, place integer,
              percentile numeric, awarded_xp integer, is_winner boolean, reward jsonb,
              is_anonymous boolean)
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_challenge social_challenges;
begin
  select * into v_challenge from social_challenges sc where sc.id = p_challenge_id;
  if v_challenge.id is null then
    raise exception 'Challenge not found.';
  end if;
  if not challenge_is_settled(v_challenge.status) then
    -- Not an access error. A live challenge has no result yet, and returning an empty set here
    -- would let a results screen render "nobody placed" over a race still being run.
    raise exception 'That challenge has not finished yet.';
  end if;
  if not can_watch_challenge(p_challenge_id) then
    raise exception 'You do not have access to watch this challenge.';
  end if;

  return query
  select
    p.user_id,
    case when vis.shown then pr.display_name else 'Anonymous' end,
    case when vis.shown then p.final_value else null end,
    case when vis.shown then p.final_rank else null end,
    case when vis.shown then p.final_percentile else null end,
    case when vis.shown then coalesce((
      select sum(b.amount)::int from bonus_xp_awards b
      where b.challenge_id = p_challenge_id and b.user_id = p.user_id
    ), 0) else null end,
    v_challenge.winner_id is not null and p.user_id = v_challenge.winner_id,
    case when vis.shown then p.reward_payload else null end,
    not vis.shown
  from challenge_participants p
  join profiles pr on pr.id = p.user_id
  cross join lateral (
    select can_see_rank(auth.uid(), p.user_id)
        or (v_challenge.winner_id is not null and p.user_id = v_challenge.winner_id) as shown
  ) vis
  where p.challenge_id = p_challenge_id and p.state = 'accepted'
  -- Anonymous rows sink to the bottom (§3 "pinned at the bottom"). Then the original ordering:
  -- nulls last so a challenge settled before 0111 (no final_rank written) still lists its field
  -- rather than ordering on nothing.
  order by (not vis.shown), p.final_rank asc nulls last, pr.display_name asc;
end;
$fn$;

-- ─────────────────────────── 6 · grants ───────────────────────────
--
-- The three dropped functions lost their whole ACL with the drop, so these are re-issued rather
-- than reflexive. The PUBLIC grant (=X/postgres) each carried is deliberately NOT restored: anon
-- and authenticated are granted explicitly below, which covers every role a client can reach the
-- API as, and every one of these is security definer — a PUBLIC execute bit on a definer function
-- is a wider door than anything here needs.
grant execute on function get_user_rank(uuid) to anon, authenticated, service_role;
grant execute on function get_group_challenge_watch(uuid) to anon, authenticated, service_role;
grant execute on function get_challenge_results(uuid) to anon, authenticated, service_role;

-- ─────────────────────────── 7 · verify, inside the migration ───────────────────────────
--
-- MIGRATIONS.md: "count the overloads afterwards". A drop-and-recreate that quietly left a stale
-- signature standing is the 0145 outage, and it is cheap to make impossible rather than unlikely.
do $verify$
declare
  v_dupes text;
  v_a uuid;
  v_b uuid;
begin
  select string_agg(d.proname || ' x' || d.cnt, ', ')
    into v_dupes
  from (
    select p.proname, count(*) as cnt
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('get_user_rank', 'get_group_challenge_watch', 'get_challenge_results',
                        'can_see_rank', 'set_leaderboard_private')
    group by p.proname having count(*) > 1
  ) d;

  if v_dupes is not null then
    raise exception '0170 left duplicate overloads: %', v_dupes;
  end if;

  -- The wall is off for everyone on the day this ships, so every surface above must still be a
  -- no-op. If this assertion fails, can_see_rank is wrong in its default case and every board in
  -- the app just emptied itself.
  select id into v_a from profiles where not is_demo order by created_at asc limit 1;
  select id into v_b from profiles where not is_demo order by created_at desc limit 1;

  if exists (select 1 from profiles where leaderboard_private) then
    raise notice '0170: private mode already set on some profiles - skipping the no-op assertion.';
  elsif v_a is not null and v_b is not null and not can_see_rank(v_a, v_b) then
    raise exception '0170: can_see_rank says no with nobody private - the boards would be empty.';
  end if;
end
$verify$;
