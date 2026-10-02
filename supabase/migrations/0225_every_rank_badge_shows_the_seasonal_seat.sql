-- 0225 — every rank badge shows the seasonal seat. 🏅
--
-- ─────────────────────────────── WHY ───────────────────────────────
--
-- Decision (Noah, CODE_PROMPT_rank_display_seasonal.md): the badge beside a name — Agora, friends,
-- leaderboards, someone else's profile — must be the LIVE SEASONAL SEAT (live_rank_xp), the same
-- number the profile chip (get_my_ladder_status) already shows. Today two other sources leak through:
--
--   · the leaderboards / friends / search / get_user_rank badge rank_tier_for_score(universal_score),
--     i.e. lifetime XP. That equals the seat only while ladder_offset = 0.
--   · the Agora feed and permalink badge user_rank_state.rank_index — the PERMANENT PEAK. This is the
--     "Diamond I in the Agora, Gold II on the chip" report: with every offset at 0 on prod today, the
--     peak is the only source that disagrees.
--
-- ─────────────────────────────── WHAT CHANGES ───────────────────────────────
--
-- The SHOWN tier/division only. In each body the one badge lateral (or the Agora's rank_thresholds
-- join) now reads live_rank_xp(<id>). Everything else is the live body verbatim:
--   · board ORDER and the `score` column stay on universal_score — a row can sort by lifetime yet
--     show its seasonal tier. Intended.
--   · get_user_rank's xp_into_tier / xp_for_next_tier move with the badge (they measure the shown
--     division; against a lifetime score they would overflow it). Its `score` stays lifetime.
--   · the 0170/0217 can_see_rank walls are untouched.
--
-- NOT touched, on purpose: get_my_ladder_status (already the seat), get_my_ranks (your own XP bar and
-- the lock-in projection — their own basis), season_standings_for / placement snapshots,
-- universal_score, rank_index (the permanent peak), and the Agora's rank SHARE card
-- (agora_attachment_snapshot / get_agora_achievements: a frozen "my standing" attachment).
--
-- live_rank_xp stays revoked from clients (0190). Every body here is SECURITY DEFINER, so it may
-- call the seat internally; no grant is added, and that is asserted below.
--
-- When the seasonal rollover resets the seat through ladder_offset, every surface here follows it.
--
-- ─────────────────────────────── SAFETY ───────────────────────────────
-- Ten functions restated whole from LIVE prosrc (not from the migration files), each md5-pinned
-- (CR-stripped, as 0193 does). Signatures unchanged, so create-or-replace keeps every ACL.
-- The verify block runs the real RPCs as a simulated user inside a rolled-back savepoint.
--
-- NOTE: no explicit begin/commit — the migration runs in its own transaction.

-- ─────────────────────────────── GUARD ───────────────────────────────
do $guard$
declare
  v_md5 text;
begin
  select md5(replace(p.prosrc, chr(13), '')) into v_md5 from pg_proc p where p.oid = 'public.get_global_leaderboard(integer)'::regprocedure;
  if v_md5 is distinct from '14df86a505fc5f64702eef58b32fb507' then
    raise exception '0225: get_global_leaderboard(integer) has moved since this was written (md5 %). Re-restate from live prosrc.', v_md5;
  end if;

  select md5(replace(p.prosrc, chr(13), '')) into v_md5 from pg_proc p where p.oid = 'public.get_university_leaderboard(text, integer)'::regprocedure;
  if v_md5 is distinct from '299e3c9182b2cf2509ecc423b622135a' then
    raise exception '0225: get_university_leaderboard(text, integer) has moved since this was written (md5 %). Re-restate from live prosrc.', v_md5;
  end if;

  select md5(replace(p.prosrc, chr(13), '')) into v_md5 from pg_proc p where p.oid = 'public.get_group_leaderboard(uuid)'::regprocedure;
  if v_md5 is distinct from 'da5b78323bd89db8e16b36e47c4ae376' then
    raise exception '0225: get_group_leaderboard(uuid) has moved since this was written (md5 %). Re-restate from live prosrc.', v_md5;
  end if;

  select md5(replace(p.prosrc, chr(13), '')) into v_md5 from pg_proc p where p.oid = 'public.get_my_circle_ranks()'::regprocedure;
  if v_md5 is distinct from '34566d7fdaf7b0a7aa721f55e06f7a95' then
    raise exception '0225: get_my_circle_ranks() has moved since this was written (md5 %). Re-restate from live prosrc.', v_md5;
  end if;

  select md5(replace(p.prosrc, chr(13), '')) into v_md5 from pg_proc p where p.oid = 'public.get_my_cross_circle_people()'::regprocedure;
  if v_md5 is distinct from 'ebdd4cd6bff564e23f9957815d18a84a' then
    raise exception '0225: get_my_cross_circle_people() has moved since this was written (md5 %). Re-restate from live prosrc.', v_md5;
  end if;

  select md5(replace(p.prosrc, chr(13), '')) into v_md5 from pg_proc p where p.oid = 'public.get_my_friends()'::regprocedure;
  if v_md5 is distinct from '36cbc0d211d9e809b2199749abdfaa78' then
    raise exception '0225: get_my_friends() has moved since this was written (md5 %). Re-restate from live prosrc.', v_md5;
  end if;

  select md5(replace(p.prosrc, chr(13), '')) into v_md5 from pg_proc p where p.oid = 'public.search_leaderboard(text, integer)'::regprocedure;
  if v_md5 is distinct from '33bca393106bd9270c634203d7538ac2' then
    raise exception '0225: search_leaderboard(text, integer) has moved since this was written (md5 %). Re-restate from live prosrc.', v_md5;
  end if;

  select md5(replace(p.prosrc, chr(13), '')) into v_md5 from pg_proc p where p.oid = 'public.get_user_rank(uuid)'::regprocedure;
  if v_md5 is distinct from '0417d23052d771b25b30eb252811d7ff' then
    raise exception '0225: get_user_rank(uuid) has moved since this was written (md5 %). Re-restate from live prosrc.', v_md5;
  end if;

  select md5(replace(p.prosrc, chr(13), '')) into v_md5 from pg_proc p where p.oid = 'public.get_agora_feed(text, timestamp with time zone, uuid, integer)'::regprocedure;
  if v_md5 is distinct from 'f360eea20a13c0cd494260ebe2cd70f3' then
    raise exception '0225: get_agora_feed(text, timestamp with time zone, uuid, integer) has moved since this was written (md5 %). Re-restate from live prosrc.', v_md5;
  end if;

  select md5(replace(p.prosrc, chr(13), '')) into v_md5 from pg_proc p where p.oid = 'public.get_agora_item(uuid, text)'::regprocedure;
  if v_md5 is distinct from '5fd76e102de827169012b804225700d5' then
    raise exception '0225: get_agora_item(uuid, text) has moved since this was written (md5 %). Re-restate from live prosrc.', v_md5;
  end if;
end
$guard$;

-- ─────────────────────────────── THE TEN BODIES ───────────────────────────────
-- Each is pg_get_functiondef of the live body, verbatim, with only the badge source swapped.

-- ── get_global_leaderboard(integer) ──
CREATE OR REPLACE FUNCTION public.get_global_leaderboard(p_limit integer DEFAULT 50)
 RETURNS TABLE(user_id uuid, handle text, display_name text, avatar_url text, is_pro boolean, score numeric, tier text, division integer, university text, check_ins_this_week bigint, rank integer, is_me boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    -- 0225 · the badge is the seasonal seat; order/score stay lifetime.
    cross join lateral rank_tier_for_score(live_rank_xp(p.id)) t
    where not p.is_demo and not p.is_disabled
      -- 0208 Â· the participation floor. A profile that has earned nothing is not on the board.
      and s.score > 0
      -- 0217 Â· 0170's wall, lost in 0208's restate. Inside the CTE, above row_number(), so ranks
      -- recompute over the visible set rather than leaving gaps that spell out who is hidden.
      and can_see_rank(auth.uid(), p.id)
  )
  select r.*, (r.user_id = auth.uid()) as is_me
  from ranked r
  where r.rank <= p_limit or r.user_id = auth.uid()
  order by r.rank;
end;
$function$;

-- ── get_university_leaderboard(text, integer) ──
CREATE OR REPLACE FUNCTION public.get_university_leaderboard(p_university text, p_limit integer DEFAULT 50)
 RETURNS TABLE(user_id uuid, handle text, display_name text, avatar_url text, is_pro boolean, score numeric, tier text, division integer, check_ins_this_week bigint, rank integer, is_me boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    -- 0225 · the badge is the seasonal seat; order/score stay lifetime.
    cross join lateral rank_tier_for_score(live_rank_xp(p.id)) t
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
$function$;

-- ── get_group_leaderboard(uuid) ──
CREATE OR REPLACE FUNCTION public.get_group_leaderboard(p_group_id uuid)
 RETURNS TABLE(user_id uuid, handle text, display_name text, avatar_url text, is_pro boolean, score numeric, tier text, division integer, check_ins_this_week bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  -- 0225 · the badge is the seasonal seat; order/score stay lifetime.
  cross join lateral rank_tier_for_score(live_rank_xp(gm.user_id)) t
  where gm.group_id = p_group_id and is_group_member(p_group_id)
    -- 0170 · THE ONLY ADDED LINE.
    and can_see_rank(auth.uid(), gm.user_id)
  order by s.score desc, check_ins_this_week desc, p.display_name asc;
$function$;

-- ── get_my_circle_ranks() ──
CREATE OR REPLACE FUNCTION public.get_my_circle_ranks()
 RETURNS TABLE(group_id uuid, group_name text, group_emoji text, my_rank bigint, member_count bigint, score numeric, tier text, division integer, check_ins_this_week bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
      -- 0217 Â· the wall â€” ranked over the members get_group_leaderboard would show you.
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
  -- 0225 · the badge is the seasonal seat; order/score stay lifetime.
  cross join lateral rank_tier_for_score(live_rank_xp(r.user_id)) t
  where r.user_id = auth.uid()
  order by g.name;
$function$;

-- ── get_my_cross_circle_people() ──
CREATE OR REPLACE FUNCTION public.get_my_cross_circle_people()
 RETURNS TABLE(user_id uuid, display_name text, handle text, avatar_url text, is_pro boolean, score numeric, tier text, division integer, current_streak integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  -- 0225 · the badge is the seasonal seat; order/score stay lifetime.
  cross join lateral rank_tier_for_score(live_rank_xp(p.id)) t
  where not p.is_demo and not p.is_disabled
    -- 0217 Â· the wall.
    and can_see_rank(auth.uid(), p.id)
  order by score desc;
$function$;

-- ── get_my_friends() ──
CREATE OR REPLACE FUNCTION public.get_my_friends()
 RETURNS TABLE(friend_id uuid, display_name text, avatar_url text, tier text, division integer, current_streak integer, last_lockin_at timestamp with time zone, shared_circle_id uuid, shared_circle_name text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with fr as (
    select case when requester_id = auth.uid() then recipient_id else requester_id end as uid
    from friend_requests
    where status = 'accepted' and (requester_id = auth.uid() or recipient_id = auth.uid())
  )
  select
    p.id as friend_id,
    p.display_name,
    p.avatar_url,
    -- 0217 Â· a friend on Private keeps their row; only the rank goes.
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
  -- 0225 · the badge is the seasonal seat; order/score stay lifetime.
  cross join lateral rank_tier_for_score(live_rank_xp(p.id)) r
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
$function$;

-- ── search_leaderboard(text, integer) ──
CREATE OR REPLACE FUNCTION public.search_leaderboard(p_query text, p_limit integer DEFAULT 20)
 RETURNS TABLE(user_id uuid, display_name text, handle text, avatar_url text, tier text, division integer, score numeric, board text, board_rank integer, is_friend boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    -- 0225 · the badge is the seasonal seat; order/score stay lifetime.
    cross join lateral rank_tier_for_score(live_rank_xp(m.id)) t
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
$function$;

-- ── get_user_rank(uuid) ──
CREATE OR REPLACE FUNCTION public.get_user_rank(p_user_id uuid)
 RETURNS TABLE(score numeric, tier text, division integer, xp_into_tier numeric, xp_for_next_tier numeric, muted boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    s.seat - lo.cumulative_xp_required as xp_into_tier,
    coalesce(hi.cumulative_xp_required, lo.cumulative_xp_required) - lo.cumulative_xp_required as xp_for_next_tier,
    false
  -- 0225 · the badge is the seasonal seat; order/score stay lifetime. xp_into/for_next measure the shown division.
  from (select universal_score(p_user_id) as score, live_rank_xp(p_user_id) as seat) s
  cross join lateral rank_tier_for_score(s.seat) t
  join rank_thresholds lo on lo.tier = t.tier and lo.division = t.division
  left join rank_thresholds hi on hi.rank_index = lo.rank_index + 1;
end;
$function$;

-- ── get_agora_feed(text, timestamp with time zone, uuid, integer) ──
CREATE OR REPLACE FUNCTION public.get_agora_feed(p_scope text DEFAULT 'friends'::text, p_before_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_before_id uuid DEFAULT NULL::uuid, p_limit integer DEFAULT 20)
 RETURNS TABLE(item_type text, id uuid, user_id uuid, display_name text, handle text, avatar_url text, university text, rank_tier text, rank_division integer, visibility text, body text, photo_path text, attach_kind text, attach_snapshot jsonb, attachments jsonb, cheers bigint, cheered boolean, comments bigint, created_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  -- Every reference is alias-qualified. RETURNS TABLE's OUT names (id, user_id, body, visibility,
  -- created_at, university, attachments…) shadow the identically-named columns on agora_posts,
  -- milestones and profiles inside this body, and an unqualified one silently resolves to the OUT
  -- parameter — which is null on every row.
  with me as (
    select p.id, p.university from profiles p where p.id = auth.uid()
  ),
  -- The scope's author set, resolved once. 'global' returns no rows and is handled by the
  -- `p_scope = 'global'` disjunct below rather than by materialising every profile in the table.
  scoped as (
    select case when fr.requester_id = auth.uid() then fr.recipient_id else fr.requester_id end as uid
    from friend_requests fr
    where p_scope = 'friends' and fr.status = 'accepted'
      and (fr.requester_id = auth.uid() or fr.recipient_id = auth.uid())
    union
    select gm2.user_id
    from group_members gm1
    join group_members gm2 on gm2.group_id = gm1.group_id
    where p_scope = 'campfires' and gm1.user_id = auth.uid()
    union
    select p.id
    from profiles p, me
    where p_scope = 'university' and me.university is not null and p.university = me.university
    union
    -- Always yourself. Your own post has to be visible in the square you just posted it to,
    -- and the friend graph does not contain you — without this, Friends is the one scope where
    -- posting appears to have done nothing.
    select auth.uid() where p_scope <> 'global'
  ),
  items as (
    select
      'post'::text as item_type,
      ap.id,
      ap.user_id,
      ap.visibility,
      nullif(btrim(ap.body), '') as body,
      ap.photo_path,
      ap.attach_kind,
      ap.attach_snapshot,
      -- 0140: the array, normalised so a row still carrying only the 0128 triple reads the same.
      agora_attachments_json(
        ap.attachments, ap.attach_kind, ap.attach_ref_id, ap.attach_key, ap.attach_snapshot
      ) as attachments,
      ap.created_at
    from agora_posts ap
    where p_scope = 'global' or ap.user_id in (select s.uid from scoped s)

    union all

    select
      'milestone'::text,
      m.id,
      m.user_id,
      m.visibility,
      m.note,
      null::text,
      'milestone'::text,
      -- Shaped exactly like a post's 'milestone' attachment so the card component has one branch
      -- for "a milestone rendered in the Agora", whether it auto-surfaced or somebody quoted it.
      jsonb_build_object(
        'milestone_id', m.id, 'kind', m.kind, 'headline', m.headline,
        'note', m.note, 'effort', m.effort
      ),
      -- 0140: and the same object again as a one-element array, so the renderer has ONE list to
      -- walk for both row types rather than a milestone-shaped exception to it.
      jsonb_build_array(jsonb_build_object(
        'kind', 'milestone', 'ref_id', m.id, 'key', null,
        'snapshot', jsonb_build_object(
          'milestone_id', m.id, 'kind', m.kind, 'headline', m.headline,
          'note', m.note, 'effort', m.effort
        )
      )),
      m.created_at
    from milestones m
    where (p_scope = 'global' or m.user_id in (select s.uid from scoped s))
      -- `pinned` is 0093's "share card only, nothing posted"; `in_agora` is 0128's per-post feed
      -- opt-out. Both have to be true for a milestone to be in the square.
      and m.pinned and m.in_agora
  )
  select
    i.item_type,
    i.id,
    i.user_id,
    p.display_name,
    p.handle,
    p.avatar_url,
    p.university,
    rt.tier,
    rt.division,
    i.visibility,
    i.body,
    i.photo_path,
    i.attach_kind,
    i.attach_snapshot,
    i.attachments,
    case i.item_type
      when 'post' then (select count(*) from agora_post_cheers apc where apc.post_id = i.id)
      else (select count(*) from milestone_cheers mc where mc.milestone_id = i.id)
    end,
    case i.item_type
      when 'post' then exists (
        select 1 from agora_post_cheers apc where apc.post_id = i.id and apc.user_id = auth.uid())
      else exists (
        select 1 from milestone_cheers mc where mc.milestone_id = i.id and mc.user_id = auth.uid())
    end,
    (select count(*) from agora_comments c
      where c.deleted_at is null
        and (case i.item_type when 'post' then c.post_id else c.milestone_id end) = i.id),
    i.created_at
  from items i
  join profiles p on p.id = i.user_id
  -- 0225 · the seasonal seat, not user_rank_state.rank_index (the permanent peak).
  left join rank_thresholds rt on rt.rank_index = rank_index_for_score(live_rank_xp(i.user_id))
  where can_see_agora(i.user_id, i.visibility, auth.uid())
    -- Mutual, same rule as schema.sql's messages policy: a block hides the square in both
    -- directions, not just blocker → blocked.
    and not exists (
      select 1 from blocked_users b
      where (b.blocker_id = auth.uid() and b.blocked_id = i.user_id)
         or (b.blocker_id = i.user_id and b.blocked_id = auth.uid())
    )
    -- A disabled account's posts leave the square with it. Its rows stay in the tables for
    -- moderation; what they stop being is content in front of an audience.
    and not p.is_disabled
    and (
      p_before_at is null
      or (i.created_at, i.id) < (p_before_at, coalesce(p_before_id, '00000000-0000-0000-0000-000000000000'::uuid))
    )
  order by i.created_at desc, i.id desc
  limit least(greatest(p_limit, 1), 50);
$function$;

-- ── get_agora_item(uuid, text) ──
CREATE OR REPLACE FUNCTION public.get_agora_item(p_id uuid, p_item_type text DEFAULT 'post'::text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select jsonb_build_object(
    'item_type', 'post',
    'id', ap.id,
    'user_id', ap.user_id,
    'display_name', p.display_name,
    'handle', p.handle,
    'avatar_url', p.avatar_url,
    'university', p.university,
    'rank_tier', rt.tier,
    'rank_division', rt.division,
    'visibility', ap.visibility,
    'body', nullif(btrim(ap.body), ''),
    'photo_path', ap.photo_path,
    'attach_kind', ap.attach_kind,
    'attach_snapshot', ap.attach_snapshot,
    'attachments', agora_attachments_json(
      ap.attachments, ap.attach_kind, ap.attach_ref_id, ap.attach_key, ap.attach_snapshot),
    'cheers', (select count(*) from agora_post_cheers apc where apc.post_id = ap.id),
    'cheered', exists (
      select 1 from agora_post_cheers apc where apc.post_id = ap.id and apc.user_id = auth.uid()),
    'comments', (select count(*) from agora_comments c where c.post_id = ap.id and c.deleted_at is null),
    'created_at', ap.created_at
  )
  from agora_posts ap
  join profiles p on p.id = ap.user_id
  -- 0225 · the seasonal seat, not user_rank_state.rank_index (the permanent peak).
  left join rank_thresholds rt on rt.rank_index = rank_index_for_score(live_rank_xp(ap.user_id))
  where p_item_type = 'post'
    and ap.id = p_id
    and can_see_agora(ap.user_id, ap.visibility, auth.uid())
    and not is_blocked_either_way(ap.user_id)

  union all

  -- Shaped identically, and the attachment is built the same way get_agora_feed builds it, so the
  -- card component has one branch for "a milestone in the Agora" whether it arrived by feed or by
  -- permalink. `in_agora` is not consulted: opting out hides it from the SQUARE, and must not
  -- break the link a friend's notification already handed somebody.
  select jsonb_build_object(
    'item_type', 'milestone',
    'id', m.id,
    'user_id', m.user_id,
    'display_name', p.display_name,
    'handle', p.handle,
    'avatar_url', p.avatar_url,
    'university', p.university,
    'rank_tier', rt.tier,
    'rank_division', rt.division,
    'visibility', m.visibility,
    'body', m.note,
    'photo_path', null,
    'attach_kind', 'milestone',
    'attach_snapshot', jsonb_build_object(
      'milestone_id', m.id, 'kind', m.kind, 'headline', m.headline,
      'note', m.note, 'effort', m.effort
    ),
    'attachments', jsonb_build_array(jsonb_build_object(
      'kind', 'milestone', 'ref_id', m.id, 'key', null,
      'snapshot', jsonb_build_object(
        'milestone_id', m.id, 'kind', m.kind, 'headline', m.headline,
        'note', m.note, 'effort', m.effort
      )
    )),
    'cheers', (select count(*) from milestone_cheers mc where mc.milestone_id = m.id),
    'cheered', exists (
      select 1 from milestone_cheers mc where mc.milestone_id = m.id and mc.user_id = auth.uid()),
    'comments', (select count(*) from agora_comments c where c.milestone_id = m.id and c.deleted_at is null),
    'created_at', m.created_at
  )
  from milestones m
  join profiles p on p.id = m.user_id
  -- 0225 · the seasonal seat, not user_rank_state.rank_index (the permanent peak).
  left join rank_thresholds rt on rt.rank_index = rank_index_for_score(live_rank_xp(m.user_id))
  where p_item_type = 'milestone'
    and m.id = p_id
    and can_see_agora(m.user_id, m.visibility, auth.uid())
    and not is_blocked_either_way(m.user_id);
$function$;

-- ─────────────────────────────── VERIFY ───────────────────────────────
do $structural$
declare
  v_src text;
begin
  select prosrc into v_src from pg_proc where oid = 'public.get_global_leaderboard(integer)'::regprocedure;
  if v_src !~ 'live_rank_xp\(' then raise exception '0225: get_global_leaderboard(integer) does not read the seat'; end if;
  if v_src ~ 'rank_tier_for_score\((s\.score|r\.score|universal_score)' or v_src ~ 'rt\.rank_index = urs\.rank_index' then
    raise exception '0225: get_global_leaderboard(integer) still badges from lifetime or the peak';
  end if;

  select prosrc into v_src from pg_proc where oid = 'public.get_university_leaderboard(text, integer)'::regprocedure;
  if v_src !~ 'live_rank_xp\(' then raise exception '0225: get_university_leaderboard(text, integer) does not read the seat'; end if;
  if v_src ~ 'rank_tier_for_score\((s\.score|r\.score|universal_score)' or v_src ~ 'rt\.rank_index = urs\.rank_index' then
    raise exception '0225: get_university_leaderboard(text, integer) still badges from lifetime or the peak';
  end if;

  select prosrc into v_src from pg_proc where oid = 'public.get_group_leaderboard(uuid)'::regprocedure;
  if v_src !~ 'live_rank_xp\(' then raise exception '0225: get_group_leaderboard(uuid) does not read the seat'; end if;
  if v_src ~ 'rank_tier_for_score\((s\.score|r\.score|universal_score)' or v_src ~ 'rt\.rank_index = urs\.rank_index' then
    raise exception '0225: get_group_leaderboard(uuid) still badges from lifetime or the peak';
  end if;

  select prosrc into v_src from pg_proc where oid = 'public.get_my_circle_ranks()'::regprocedure;
  if v_src !~ 'live_rank_xp\(' then raise exception '0225: get_my_circle_ranks() does not read the seat'; end if;
  if v_src ~ 'rank_tier_for_score\((s\.score|r\.score|universal_score)' or v_src ~ 'rt\.rank_index = urs\.rank_index' then
    raise exception '0225: get_my_circle_ranks() still badges from lifetime or the peak';
  end if;

  select prosrc into v_src from pg_proc where oid = 'public.get_my_cross_circle_people()'::regprocedure;
  if v_src !~ 'live_rank_xp\(' then raise exception '0225: get_my_cross_circle_people() does not read the seat'; end if;
  if v_src ~ 'rank_tier_for_score\((s\.score|r\.score|universal_score)' or v_src ~ 'rt\.rank_index = urs\.rank_index' then
    raise exception '0225: get_my_cross_circle_people() still badges from lifetime or the peak';
  end if;

  select prosrc into v_src from pg_proc where oid = 'public.get_my_friends()'::regprocedure;
  if v_src !~ 'live_rank_xp\(' then raise exception '0225: get_my_friends() does not read the seat'; end if;
  if v_src ~ 'rank_tier_for_score\((s\.score|r\.score|universal_score)' or v_src ~ 'rt\.rank_index = urs\.rank_index' then
    raise exception '0225: get_my_friends() still badges from lifetime or the peak';
  end if;

  select prosrc into v_src from pg_proc where oid = 'public.search_leaderboard(text, integer)'::regprocedure;
  if v_src !~ 'live_rank_xp\(' then raise exception '0225: search_leaderboard(text, integer) does not read the seat'; end if;
  if v_src ~ 'rank_tier_for_score\((s\.score|r\.score|universal_score)' or v_src ~ 'rt\.rank_index = urs\.rank_index' then
    raise exception '0225: search_leaderboard(text, integer) still badges from lifetime or the peak';
  end if;

  select prosrc into v_src from pg_proc where oid = 'public.get_user_rank(uuid)'::regprocedure;
  if v_src !~ 'live_rank_xp\(' then raise exception '0225: get_user_rank(uuid) does not read the seat'; end if;
  if v_src ~ 'rank_tier_for_score\((s\.score|r\.score|universal_score)' or v_src ~ 'rt\.rank_index = urs\.rank_index' then
    raise exception '0225: get_user_rank(uuid) still badges from lifetime or the peak';
  end if;

  select prosrc into v_src from pg_proc where oid = 'public.get_agora_feed(text, timestamp with time zone, uuid, integer)'::regprocedure;
  if v_src !~ 'live_rank_xp\(' then raise exception '0225: get_agora_feed(text, timestamp with time zone, uuid, integer) does not read the seat'; end if;
  if v_src ~ 'rank_tier_for_score\((s\.score|r\.score|universal_score)' or v_src ~ 'rt\.rank_index = urs\.rank_index' then
    raise exception '0225: get_agora_feed(text, timestamp with time zone, uuid, integer) still badges from lifetime or the peak';
  end if;

  select prosrc into v_src from pg_proc where oid = 'public.get_agora_item(uuid, text)'::regprocedure;
  if v_src !~ 'live_rank_xp\(' then raise exception '0225: get_agora_item(uuid, text) does not read the seat'; end if;
  if v_src ~ 'rank_tier_for_score\((s\.score|r\.score|universal_score)' or v_src ~ 'rt\.rank_index = urs\.rank_index' then
    raise exception '0225: get_agora_item(uuid, text) still badges from lifetime or the peak';
  end if;

  -- Order keys untouched: positions still ride lifetime.
  select prosrc into v_src from pg_proc where oid = 'public.get_global_leaderboard(integer)'::regprocedure;
  if v_src !~ 'order by s\.score desc' then raise exception '0225: the global board no longer orders by lifetime'; end if;
  -- The seat stays server-only.
  if has_function_privilege('authenticated', 'public.live_rank_xp(uuid)', 'execute')
     or has_function_privilege('anon', 'public.live_rank_xp(uuid)', 'execute') then
    raise exception '0225: live_rank_xp is client-callable';
  end if;
end
$structural$;

-- Behaviour, as a real caller. The top-scoring player is pushed below their lifetime tier with a
-- negative ladder_offset inside a savepoint that is always rolled back (the marker exception).
-- Assertions are relational — no counts of live pilot data.
do $probe$
declare
  v_marker constant text := '0225-probe-ok';
  v_u      uuid;
  v_score  numeric;
  v_life   record;
  v_seat   record;
  v_got    record;
  v_chip   record;
  v_post   uuid;
  v_feed   jsonb;
  v_before uuid[];
  v_after  uuid[];
  v_err    text;
begin
  select p.id, universal_score(p.id) into v_u, v_score
  from profiles p
  where not p.is_demo and not p.is_disabled
  order by universal_score(p.id) desc, p.id
  limit 1;

  if v_u is null or rank_index_for_score(v_score) <= rank_index_for_score(0) then
    raise notice '0225: no player sits above the floor tier; behavioural probe skipped (structural checks passed)';
    return;
  end if;

  begin
    perform set_config('philoi.suppress_push', 'on', true);
    perform set_config('request.jwt.claims', json_build_object('sub', v_u, 'role', 'authenticated')::text, true);

    -- Positive control first: at the player's CURRENT offset, the badge is whatever their seat is.
    select * into v_got from get_user_rank(v_u);
    select * into v_seat from rank_tier_for_score(live_rank_xp(v_u));
    if v_got.muted or (v_got.tier, v_got.division) is distinct from (v_seat.tier, v_seat.division) then
      raise exception '0225: positive control — get_user_rank % % but the seat is % %',
        v_got.tier, v_got.division, v_seat.tier, v_seat.division;
    end if;

    select array_agg(g.user_id order by g.rank) into v_before from get_global_leaderboard(50) g;

    -- Drop the seat to zero XP: lifetime is unchanged, the seat falls to the floor.
    insert into user_ladder_state (user_id, ladder_offset) values (v_u, -v_score)
    on conflict (user_id) do update set ladder_offset = -v_score;

    select * into v_life from rank_tier_for_score(universal_score(v_u));
    select * into v_seat from rank_tier_for_score(live_rank_xp(v_u));
    if (v_life.tier, v_life.division) is not distinct from (v_seat.tier, v_seat.division) then
      raise exception '0225: probe setup — the offset did not move the seat below lifetime';
    end if;

    -- 1 · someone else's profile badge dropped to the seat.
    select * into v_got from get_user_rank(v_u);
    if (v_got.tier, v_got.division) is distinct from (v_seat.tier, v_seat.division) then
      raise exception '0225: get_user_rank shows % % — seat is %, lifetime %',
        v_got.tier, v_got.division, v_seat.tier || ' ' || v_seat.division, v_life.tier || ' ' || v_life.division;
    end if;
    if v_got.score <> v_score then
      raise exception '0225: get_user_rank.score moved off lifetime (% vs %)', v_got.score, v_score;
    end if;

    -- 2 · the global board badge dropped, and the ORDER did not move.
    select g.tier, g.division into v_got from get_global_leaderboard(50) g where g.user_id = v_u;
    if (v_got.tier, v_got.division) is distinct from (v_seat.tier, v_seat.division) then
      raise exception '0225: global board badges % % — seat is % %', v_got.tier, v_got.division, v_seat.tier, v_seat.division;
    end if;
    select array_agg(g.user_id order by g.rank) into v_after from get_global_leaderboard(50) g;
    if v_after is distinct from v_before then
      raise exception '0225: the global board reordered when only the seat moved';
    end if;

    -- 3 · the chip and the board now agree.
    select * into v_chip from get_my_ladder_status();
    if (v_chip.out_tier, v_chip.out_division) is distinct from (v_seat.tier, v_seat.division) then
      raise exception '0225: chip % % disagrees with the board badge % %', v_chip.out_tier, v_chip.out_division, v_seat.tier, v_seat.division;
    end if;

    -- 4 · the Agora — only when this player has a post to read back.
    select ap.id into v_post from agora_posts ap where ap.user_id = v_u order by ap.created_at desc limit 1;
    if v_post is not null then
      v_feed := get_agora_item(v_post, 'post');
      if (v_feed ->> 'rank_tier', (v_feed ->> 'rank_division')::int) is distinct from (v_seat.tier, v_seat.division) then
        raise exception '0225: the Agora badges % % — seat is % %', v_feed ->> 'rank_tier', v_feed ->> 'rank_division', v_seat.tier, v_seat.division;
      end if;
    else
      raise notice '0225: probe player has no Agora post; Agora covered by the structural check only';
    end if;

    raise exception '%', v_marker;
  exception when others then
    get stacked diagnostics v_err = message_text;
    if v_err <> v_marker then raise exception '0225 probe: %', v_err; end if;
  end;

  raise notice '0225: badges read the seat; board order rides lifetime; chip == board';
end
$probe$;
