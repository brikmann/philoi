-- 0217 — THREE DIALS FOR WHO SEES YOUR CLIMB (CODE_PROMPT_season_privacy.md, extends 0170)
--
-- 0170 gave rank visibility two states: a boolean `leaderboard_private`. This file turns it into
-- three, on one column:
--
--   public   (default) — anyone sees your rank; you see the open boards; you get the daily placement push.
--   friends            — only accepted friends see you; your boards are your friends. = 0170's `true`.
--   private  (NEW)     — nobody but you. Not even friends. Your boards are just you: no comparison anywhere.
--
-- 🔴 REWARDS DO NOT CHANGE WITH THE DIAL. Every season-close path (snapshot_season_standings,
-- close_season_*, grant_season_placement_rewards, reward_band_rank) ranks on forge_pass_state and
-- never reads visibility. This file does not touch any of them and the verify block at the bottom
-- fails the migration if any of them ever starts to. The dial is how you use the app, never what
-- you earn.
--
-- ══════════════════════════════════════════════════════════════════════════════════════════════
-- THE WALL STAYS SYMMETRIC (0170's product call, kept on purpose)
--
-- The directive lists can_see_rank's rules from the TARGET's side: public → everyone, friends →
-- friends, private → self only. That is all kept. 0170 also filters on the VIEWER's side ("a private
-- user's own boards are filtered to friends too"), and that half is what makes the "what YOU see"
-- column of the dial table true on the server:
--
--   viewer friends  → every board they read is re-ranked over themselves + friends = "#1 of 6"
--   viewer private  → every board they read is just themselves = no comparison
--
-- Dropping the viewer half would push that job onto the client, and old installed builds (OTA is
-- off) would suddenly show today's Friends-mode users the full global board they opted out of.
-- If Noah ever wants the wall outbound-only, delete the two `v_viewer` branches in can_see_rank and
-- nothing else moves.
--
-- ══════════════════════════════════════════════════════════════════════════════════════════════
-- OLD CLIENTS
--
-- `leaderboard_private` stays, kept equal to `rank_visibility <> 'public'` by a trigger, so an old
-- build still reads a sane hidden/visible flag. ⚠ An old build shows a 'private' user as "Private
-- mode: on", i.e. friends-can-see-me. The server still enforces 'private' (friends see nothing) — the
-- mismatch is only in what that old settings row SAYS, and 'private' can only be chosen from a new
-- build in the first place. `set_leaderboard_private` keeps working: true → friends (but never
-- downgrades an existing 'private'), false → public.
--
-- ══════════════════════════════════════════════════════════════════════════════════════════════
-- ALSO FIXED: 0208 DROPPED 0170's FILTER FROM THE GLOBAL BOARD
--
-- 0208 restated get_global_leaderboard to add the participation floor and, restating from a body
-- older than 0170, lost `and can_see_rank(auth.uid(), p.id)`. Since then Friends-mode users have
-- been on everyone's global board. Restored below from the live prosrc — the only added line.
-- get_my_placements (0214) mirrors the global board's predicate, so it picks up the same line on its
-- global and friends scopes (a private friend is not in your "#N of M among friends").
--
-- Restated bodies (md5 of live prosrc when this was written):
--   can_see_rank            b9a36c5987e9b7ba905904ee80d7c8d8  — rewritten
--   set_leaderboard_private 97cb12fbfb3016a6eb5aa34e78bc5a3a  — rewritten (maps onto the enum)
--   get_global_leaderboard  8977a9023809bc512981782f059fec0a  — 0208 body + can_see_rank line
--   get_my_placements       1333120c637cdf685a2252969c0bd9d9  — + can_see_rank on global/friends
--   send_daily_placement    e10a5c5120123ba36cf182510ee19ac9  — 0216 body + public-only gate (two lines)
--   get_my_cross_circle_people 67b31d2d71dbaafb37018b068ddc76bc — + can_see_rank (§6b)
--   get_my_circle_ranks        9d07b6b86d2a11d5b46b21ec10ba67ee — + can_see_rank (§6b)
--   get_user_board_position    96abf12779044ebac95a85f638b75079 — + can_see_rank (§6b)
--   get_my_friends             18eb7d67dcdc6f000b99467b2e5ef680 — tier/division null when hidden (§6b)

-- ─────────────────────────── 1 · the dial ───────────────────────────

alter table profiles
  add column if not exists rank_visibility text not null default 'public';

alter table profiles drop constraint if exists profiles_rank_visibility_check;
alter table profiles
  add constraint profiles_rank_visibility_check check (rank_visibility in ('public', 'friends', 'private'));

-- Backfill from 0170 BEFORE the sync trigger exists, so the trigger never sees these writes.
-- Nobody is 'private' yet — that state did not exist.
update profiles set rank_visibility = 'friends' where leaderboard_private and rank_visibility <> 'friends';

comment on column profiles.rank_visibility is
  'Season rank visibility (0217): public (default) | friends | private. Read through can_see_rank(); '
  'a display wall only — scoring, XP and every season reward read the real numbers regardless.';

comment on column profiles.leaderboard_private is
  'COMPAT (0217): kept equal to rank_visibility <> ''public'' by profiles_sync_rank_visibility for '
  'builds that predate rank_visibility. Read rank_visibility instead.';

-- ─────────────────────────── 2 · the compat flag follows the dial ───────────────────────────
--
-- The enum is the truth. If a writer changed ONLY the boolean (an old build, or anything else that
-- predates 0217), that change is translated onto the enum first; then the boolean is re-derived.
-- `is distinct from` so a client PATCHing the whole row back unchanged is a no-op, same as the
-- privilege-flag trigger on this table.

create or replace function sync_rank_visibility()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    if coalesce(new.leaderboard_private, false) and new.rank_visibility = 'public' then
      new.rank_visibility := 'friends';
    end if;
  elsif new.leaderboard_private is distinct from old.leaderboard_private
        and new.rank_visibility is not distinct from old.rank_visibility then
    new.rank_visibility := case
      when not coalesce(new.leaderboard_private, false) then 'public'
      when old.rank_visibility = 'private' then 'private'
      else 'friends'
    end;
  end if;

  new.leaderboard_private := new.rank_visibility <> 'public';
  return new;
end;
$$;

drop trigger if exists profiles_sync_rank_visibility on profiles;
create trigger profiles_sync_rank_visibility
  before insert or update of leaderboard_private, rank_visibility on profiles
  for each row execute function sync_rank_visibility();

-- ─────────────────────────── 3 · the one predicate ───────────────────────────

create or replace function can_see_rank(p_viewer uuid, p_target uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_viewer text;
  v_target text;
begin
  if p_target is null then return false; end if;
  -- You can always see yourself — in every dial. The tier ladder is the ipsative core.
  if p_viewer = p_target then return true; end if;

  select rank_visibility into v_target from profiles where id = p_target;
  if v_target is null then return false; end if;  -- no such profile

  -- 0217 · private: nobody but self. Not even friends, so no friend lookup at all.
  if v_target = 'private' then return false; end if;

  if p_viewer is null then
    return v_target = 'public';
  end if;

  select rank_visibility into v_viewer from profiles where id = p_viewer;

  -- The viewer half (symmetric, see header). A private viewer's boards are only themselves.
  if v_viewer = 'private' then return false; end if;

  -- Both public → ordinary visibility, no friend lookup. The overwhelmingly common path.
  if coalesce(v_viewer, 'public') = 'public' and v_target = 'public' then
    return true;
  end if;

  -- Someone is on 'friends', so the pair must be friends. Same predicate as search_leaderboard.
  return exists (
    select 1 from friend_requests fr
    where fr.status = 'accepted'
      and ((fr.requester_id = p_viewer and fr.recipient_id = p_target)
        or (fr.requester_id = p_target and fr.recipient_id = p_viewer))
  );
end;
$$;

comment on function can_see_rank(uuid, uuid) is
  'Rank visibility (0170, three dials in 0217): may p_viewer see p_target''s competitive numbers? '
  'Self always. Target private → nobody else. Viewer private → nobody else. Both public → yes. '
  'Otherwise accepted friends only. The single definition every visibility surface calls.';

-- ─────────────────────────── 4 · setters ───────────────────────────

create or replace function set_rank_visibility(p_scope text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Not signed in.' using errcode = '42501';
  end if;
  if p_scope is null or p_scope not in ('public', 'friends', 'private') then
    raise exception 'Rank visibility must be public, friends or private.' using errcode = '22023';
  end if;
  update profiles set rank_visibility = p_scope where id = auth.uid();
end;
$$;

revoke all on function set_rank_visibility(text) from public, anon;
grant execute on function set_rank_visibility(text) to authenticated;

-- Old builds' toggle. `true` means "hide me", and 'private' already hides more than 'friends', so
-- a true never widens a private user to friends.
create or replace function set_leaderboard_private(p_on boolean)
returns void
language sql
security definer
set search_path = public
as $$
  update profiles
  set rank_visibility = case
    when not coalesce(p_on, false) then 'public'
    when rank_visibility = 'private' then 'private'
    else 'friends'
  end
  where id = auth.uid();
$$;

-- ─────────────────────────── 5 · the global board gets its wall back ───────────────────────────
--
-- Live prosrc (0208) with the one 0170 line restored. Same signature and return type, so
-- create-or-replace keeps the ACL.

create or replace function get_global_leaderboard(p_limit int default 50)
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
      -- 0217 · 0170's wall, lost in 0208's restate. Inside the CTE, above row_number(), so ranks
      -- recompute over the visible set rather than leaving gaps that spell out who is hidden.
      and can_see_rank(auth.uid(), p.id)
  )
  select r.*, (r.user_id = auth.uid()) as is_me
  from ranked r
  where r.rank <= p_limit or r.user_id = auth.uid()
  order by r.rank;
end;
$$;

-- ─────────────────────────── 6 · the done screen's placements match the boards ───────────────────────────

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
      -- 0217 · same wall as get_global_leaderboard.
      and can_see_rank(auth.uid(), s.id)
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
      -- 0217 · a friend on 'private' is not in your friends standing.
      and can_see_rank(auth.uid(), s.id)
  )
  select 'global', g.rnk, g.n from global_board g where g.id = auth.uid()
  union all
  select 'uni', u.rnk, u.n from uni_board u where u.id = auth.uid()
  union all
  select 'friends', f.rnk, f.n from friends_board f where f.id = auth.uid();
$$;

-- ─────────────────────────── 6b · the four score reads 0170 never walled ───────────────────────────
--
-- 0170 walled every BOARD it knew about. These four also hand the caller someone else's score,
-- tier or position, and none of them calls can_see_rank — which was a small leak for Friends mode
-- and would be a large one for Private ("nobody but you"). Each is its live prosrc with only the
-- marked lines added; signatures unchanged, so create-or-replace keeps each ACL.
--
--   get_my_cross_circle_people  — the Leaderboard tab's Campfires board. Hidden people leave the
--                                 pool, same rule as get_group_leaderboard ("the board, not the roster").
--   get_my_circle_ranks         — "you're #N in <campfire>". Ranked over the members you can see.
--   get_user_board_position     — "#N on Global" on someone's profile. Nothing for a hidden target,
--                                 and ranked over the viewer's visible set so it matches their board.
--   get_my_friends              — a friends LIST, not a board: a friend on Private keeps their row
--                                 and loses only tier/division (null). Friends-dial friends are
--                                 visible to friends by definition, so only Private nulls here.

create or replace function get_my_cross_circle_people()
returns table(user_id uuid, display_name text, handle text, avatar_url text, is_pro boolean,
              score numeric, tier text, division integer, current_streak integer)
language sql
stable
security definer
set search_path = public
as $$
  with mates as (
    select distinct gm2.user_id
    from group_members gm1
    join group_members gm2 on gm2.group_id = gm1.group_id
    where gm1.user_id = auth.uid()
  ),
  friends as (
    select case when requester_id = auth.uid() then recipient_id else requester_id end as user_id
    from friend_requests
    where status = 'accepted' and (requester_id = auth.uid() or recipient_id = auth.uid())
  ),
  pool as (
    select user_id from mates
    union
    select user_id from friends
  )
  select
    p.id as user_id,
    p.display_name,
    p.handle,
    p.avatar_url,
    p.is_pro,
    universal_score(p.id) as score,
    t.tier,
    t.division,
    p.current_streak
  from pool m
  join profiles p on p.id = m.user_id
  cross join lateral rank_tier_for_score(universal_score(p.id)) t
  where not p.is_demo and not p.is_disabled
    -- 0217 · the wall.
    and can_see_rank(auth.uid(), p.id)
  order by score desc;
$$;

create or replace function get_my_circle_ranks()
returns table(group_id uuid, group_name text, group_emoji text, my_rank bigint, member_count bigint,
              score numeric, tier text, division integer, check_ins_this_week bigint)
language sql
stable
security definer
set search_path = public
as $$
  with weekly as (
    select
      gm.group_id,
      gm.user_id,
      (select universal_score(gm.user_id)) as score,
      coalesce((
        select count(*) from check_ins ci
        where ci.user_id = gm.user_id and ci.created_at >= date_trunc('week', now())
      ), 0) as check_ins_this_week
    from group_members gm
    where is_group_member(gm.group_id)
      -- 0217 · the wall — ranked over the members get_group_leaderboard would show you.
      and can_see_rank(auth.uid(), gm.user_id)
  ),
  ranked as (
    select
      w.*,
      rank() over (partition by w.group_id order by w.score desc, w.check_ins_this_week desc) as rnk,
      count(*) over (partition by w.group_id) as member_count
    from weekly w
  )
  select
    g.id as group_id,
    g.name as group_name,
    g.emoji as group_emoji,
    r.rnk as my_rank,
    r.member_count,
    r.score,
    t.tier,
    t.division,
    r.check_ins_this_week
  from ranked r
  join groups g on g.id = r.group_id
  cross join lateral rank_tier_for_score(r.score) t
  where r.user_id = auth.uid()
  order by g.name;
$$;

create or replace function get_user_board_position(p_user_id uuid)
returns table(board text, rank integer)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_university text;
begin
  -- 0217 · a hidden target has no position to show. Zero rows is what the profile already reads
  -- as "don't draw the line".
  if not can_see_rank(auth.uid(), p_user_id) then
    return;
  end if;

  select university into v_university from profiles where id = p_user_id;

  if v_university is not null then
    return query
    select 'My uni'::text, r.rank
    from (
      select p.id, row_number() over (order by universal_score(p.id) desc, p.display_name asc)::int as rank
      from profiles p
      where p.university = v_university and not p.is_demo and not p.is_disabled
        -- 0217 · ranked over the viewer's visible set, so the number matches their board.
        and can_see_rank(auth.uid(), p.id)
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
      -- 0217 · as above.
      and can_see_rank(auth.uid(), p.id)
  ) r
  where r.id = p_user_id;
end;
$$;

create or replace function get_my_friends()
returns table(friend_id uuid, display_name text, avatar_url text, tier text, division integer,
              current_streak integer, last_lockin_at timestamp with time zone,
              shared_circle_id uuid, shared_circle_name text)
language sql
stable
security definer
set search_path = public
as $$
  with fr as (
    select case when requester_id = auth.uid() then recipient_id else requester_id end as uid
    from friend_requests
    where status = 'accepted' and (requester_id = auth.uid() or recipient_id = auth.uid())
  )
  select
    p.id as friend_id,
    p.display_name,
    p.avatar_url,
    -- 0217 · a friend on Private keeps their row; only the rank goes.
    case when vis.ok then r.tier end,
    case when vis.ok then r.division end,
    p.current_streak,
    (
      select max(ci.created_at)
      from check_ins ci
      where ci.user_id = p.id and ci.duration_seconds > 0 and ci.removed_at is null
    ) as last_lockin_at,
    shared.circle_id as shared_circle_id,
    shared.circle_name as shared_circle_name
  from fr
  join profiles p on p.id = fr.uid
  cross join lateral rank_tier_for_score(universal_score(p.id)) r
  cross join lateral (select can_see_rank(auth.uid(), p.id) as ok) vis
  left join lateral (
    select g.id as circle_id, g.name as circle_name
    from group_members gm1
    join group_members gm2 on gm2.group_id = gm1.group_id and gm2.user_id = p.id
    join groups g on g.id = gm1.group_id
    where gm1.user_id = auth.uid()
    limit 1
  ) shared on true
  order by p.display_name;
$$;

-- ─────────────────────────── 7 · the daily placement push is for the public board ───────────────────────────
--
-- 0216's body (movement copy) with two added lines, one in the early-exit and one in the recipient
-- filter. Friends opted into a friends comparison, not "#150 of N"; private opted out of comparison
-- entirely. The board CTE is deliberately untouched — who is RANKED is 0208's call; this only
-- changes who is TOLD.

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
      -- 0217 · public only.
      and p.rank_visibility = 'public'
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
      -- 0217 · public only — friends and private get no global placement push.
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

-- ─────────────────────────── 8 · verify ───────────────────────────
--
-- Data-independent where it can be. The behavioural matrix (can_see_rank across all nine dial
-- pairs × friend/stranger, and the season snapshot under every dial) ran as a rolled-back probe
-- against prod before this shipped — see the commit message.

do $verify$
declare
  v_dupes text;
  v_src text;
  v_leaks text;
begin
  select string_agg(d.proname || ' x' || d.cnt, ', ') into v_dupes
  from (
    select p.proname, count(*) as cnt
    from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and p.proname in ('can_see_rank', 'set_rank_visibility', 'set_leaderboard_private',
                        'get_global_leaderboard', 'get_my_placements', 'send_daily_placement',
                        'sync_rank_visibility', 'get_my_cross_circle_people', 'get_my_circle_ranks',
                        'get_user_board_position', 'get_my_friends')
    group by p.proname having count(*) > 1
  ) d;
  if v_dupes is not null then
    raise exception '0217 left duplicate overloads: %', v_dupes;
  end if;

  -- Backfill + compat: the boolean and the enum agree on every row, and nobody became private.
  if exists (select 1 from profiles where leaderboard_private is distinct from (rank_visibility <> 'public')) then
    raise exception '0217: leaderboard_private and rank_visibility disagree after backfill';
  end if;

  -- Grants.
  if has_function_privilege('anon', 'public.set_rank_visibility(text)', 'execute') then
    raise exception '0217: anon can execute set_rank_visibility';
  end if;
  if not has_function_privilege('authenticated', 'public.set_rank_visibility(text)', 'execute') then
    raise exception '0217: authenticated cannot execute set_rank_visibility';
  end if;
  if has_function_privilege('anon', 'public.send_daily_placement()', 'execute')
     or has_function_privilege('authenticated', 'public.send_daily_placement()', 'execute') then
    raise exception '0217: send_daily_placement is callable by a client role';
  end if;

  -- The push gate landed, and 0205/0208/0216's parts of the body survived the restate.
  select prosrc into v_src from pg_proc
  where proname = 'send_daily_placement' and pronamespace = 'public'::regnamespace;
  if (select count(*) from regexp_matches(v_src, 'rank_visibility = ''public''', 'g')) <> 2 then
    raise exception '0217: send_daily_placement is missing the public-only gate';
  end if;
  if v_src !~ 'universal_score\(p\.id\) > 0' or v_src !~ 'interval ''23 hours'''
     or v_src !~ 'nullif\(p\.timezone, ''''\)' then
    raise exception '0217: send_daily_placement lost a 0205/0208 predicate';
  end if;
  if v_src !~ 'Up from #' or v_src !~ 'Slipped from #' or v_src !~ 'Holding at #' then
    raise exception '0217: send_daily_placement lost 0216''s movement copy';
  end if;

  -- The global board has its wall and kept its floor.
  select prosrc into v_src from pg_proc
  where proname = 'get_global_leaderboard' and pronamespace = 'public'::regnamespace;
  if v_src !~ 'can_see_rank\(auth\.uid\(\), p\.id\)' or v_src !~ 's\.score > 0' then
    raise exception '0217: get_global_leaderboard is missing its wall or its floor';
  end if;

  -- Every function that hands the caller someone else's score now goes through the wall.
  select string_agg(p.proname, ', ') into v_leaks
  from pg_proc p
  where p.pronamespace = 'public'::regnamespace
    and p.proname in ('get_global_leaderboard', 'get_university_leaderboard', 'get_group_leaderboard',
                      'search_leaderboard', 'get_user_rank', 'get_my_placements', 'get_rank_movement',
                      'get_my_cross_circle_people', 'get_my_circle_ranks', 'get_user_board_position',
                      'get_my_friends', 'get_group_challenge_watch', 'get_challenge_results')
    and p.prosrc !~ 'can_see_rank\(';
  if v_leaks is not null then
    raise exception '0217: these score reads skip can_see_rank: %', v_leaks;
  end if;
  v_leaks := null;

  -- 🔴 Rewards never read visibility. Every season / placement-reward function, by name.
  select string_agg(p.proname, ', ') into v_leaks
  from pg_proc p
  where p.pronamespace = 'public'::regnamespace
    and p.proname in ('snapshot_season_standings', 'close_season_scope', 'close_season_placements',
                      'close_season_if_due', 'close_season_vs_unis', 'grant_season_placement_rewards',
                      'reward_band_rank', 'placement_multiplier', 'grant_reward')
    and p.prosrc ~* 'can_see_rank|rank_visibility|leaderboard_private';
  if v_leaks is not null then
    raise exception '0217: a reward path reads rank visibility: %', v_leaks;
  end if;
  if (select count(*) from pg_proc p
      where p.pronamespace = 'public'::regnamespace
        and p.proname in ('snapshot_season_standings', 'grant_season_placement_rewards')) <> 2 then
    raise exception '0217: the reward-path assertion is checking functions that no longer exist';
  end if;
end
$verify$;
