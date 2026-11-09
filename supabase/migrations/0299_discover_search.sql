-- 0299 · DISCOVER: AUTO-DETECT SEARCH + MATCH SUMMARY (ShareSpot ss2, mocks 345 / 349 / 357 / 383).
--
-- Search is a discovery board. Typing "running" doesn't pick a category — it surfaces people with
-- Running on their profile, run clubs and rooms, and posts about running, all at once. Rooms/clubs
-- already search by name and tag (get_discoverable_groups, get_forests). Three things didn't exist:
--
-- 1 · search_people_by_interest(p_query, p_limit) — people whose declared interests, disciplines or
--     program-implied tags include a vocab tag matching the query. Same consent model as the
--     grind-alike engine (0275): you must be discoverable yourself, and every candidate must pass
--     match_pair_ok (both opted in, both sides' scope settings, no blocks, no disabled/demo/test).
--     Not discoverable → []. No new exposure: these are exactly the people get_grind_alikes could
--     already show you, filtered by one tag.
--
-- 2 · search_agora_posts(p_query, p_before_at, p_before_id, p_limit) — posts whose body mentions the
--     term ("running" or "#running"), newest first, keyset-paged. The per-post gate is the feed's
--     own: can_see_agora_post (0280 — room posts by their room, the rest by their dial), mutual
--     blocks, disabled authors. Row shape = get_agora_feed's post rows, as jsonb.
--
-- 3 · get_trending_topics(p_limit) — topic rows for the board: the viewer's own interest tags first,
--     then featured vocab, each with the count of PUBLIC square posts (visibility 'public', not in a
--     room) from the last 30 days that mention it. Counting only public posts means the number never
--     leaks the existence of a post the viewer couldn't open.
--
-- 4 · get_match_summary(p_scope) — the matchmaking screen's signal bars (mock 383), aggregated over
--     the EXISTING matcher's output (grind_alike_rows, 0285/0295). No scoring changes: it counts how
--     many of your matches share a program / campus / patron with you, how many are live, and which
--     interest-tag reasons recur. Not discoverable → { discoverable: false }.
--
-- Additive: four new functions, nothing replaced. All security definer with a pinned search_path;
-- EXECUTE for authenticated only (revoked from public AND anon — revoking authenticated alone leaves
-- anon's grant standing).

begin;

-- ── 1 · people by interest ────────────────────────────────────────────────────────────────────────
create function public.search_people_by_interest(p_query text, p_limit integer default 12)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with q as (
    select lower(btrim(regexp_replace(coalesce(p_query, ''), '^#', ''))) as t
  ),
  hit as (
    -- Prefix or whole-word match on the label, or the key itself. "run" finds Running; "art" finds
    -- Art but not Martial arts' middle.
    select iv.key, iv.label, iv.icon
      from interest_vocab iv, q
     where iv.active and iv.kind in ('interest', 'discipline')
       and length(q.t) >= 2
       and (lower(iv.label) like q.t || '%'
            or lower(iv.label) like '% ' || q.t || '%'
            or lower(iv.key) = q.t)
  ),
  me as (
    select auth.uid() as id
     where auth.uid() is not null
       and coalesce((select ms.discoverable from match_settings ms where ms.user_id = auth.uid()), false)
  ),
  cand as (
    select p.id, p.display_name, p.handle, p.avatar_url, p.university,
           pr.abbrev as program_abbrev, pa.name as patron_name,
           (select h.label from hit h
             where h.key = any (coalesce(ui.interest_tags, '{}') || coalesce(ui.disciplines, '{}')
                                || program_interest_tags(p.program_id))
             order by h.label limit 1) as matched_label
      from me
      join match_settings ms on ms.discoverable and ms.user_id <> me.id
      join profiles p on p.id = ms.user_id
      left join user_interests ui on ui.user_id = p.id
      left join programs pr on pr.id = p.program_id
      left join patrons pa on pa.key = resolved_patron(p.patron_key)
     where match_pair_ok(me.id, p.id)
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'user_id', c.id, 'display_name', c.display_name, 'handle', c.handle,
           'avatar_url', c.avatar_url, 'university', c.university,
           'program_abbrev', c.program_abbrev, 'patron_name', c.patron_name,
           'matched_label', c.matched_label,
           'is_friend', are_friends(auth.uid(), c.id)
         ) order by c.display_name), '[]'::jsonb)
    from (select * from cand where matched_label is not null
           order by display_name
           limit least(greatest(coalesce(p_limit, 12), 1), 50)) c;
$$;

-- ── 2 · posts by topic ────────────────────────────────────────────────────────────────────────────
create function public.search_agora_posts(
  p_query     text,
  p_before_at timestamptz default null,
  p_before_id uuid default null,
  p_limit     integer default 24
)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with q as (
    select lower(btrim(regexp_replace(coalesce(p_query, ''), '^#', ''))) as t
  ),
  hits as (
    select ap.id, ap.user_id, ap.visibility, nullif(btrim(ap.body), '') as body, ap.photo_path,
           ap.attach_kind, ap.attach_snapshot,
           agora_attachments_json(ap.attachments, ap.attach_kind, ap.attach_ref_id, ap.attach_key, ap.attach_snapshot)
             as attachments,
           ap.created_at, ap.forest_id, ap.campfire_id, ap.audience
      from agora_posts ap, q
     where length(q.t) >= 2
       and lower(ap.body) like '%' || q.t || '%'
       and can_see_agora_post(ap.user_id, ap.visibility, ap.forest_id, ap.campfire_id, auth.uid())
       and not exists (
         select 1 from blocked_users b
          where (b.blocker_id = auth.uid() and b.blocked_id = ap.user_id)
             or (b.blocker_id = ap.user_id and b.blocked_id = auth.uid()))
       and (p_before_at is null
            or (ap.created_at, ap.id) < (p_before_at, coalesce(p_before_id, '00000000-0000-0000-0000-000000000000'::uuid)))
     order by ap.created_at desc, ap.id desc
     limit least(greatest(coalesce(p_limit, 24), 1), 50)
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'item_type', 'post', 'id', h.id, 'user_id', h.user_id,
           'display_name', p.display_name, 'handle', p.handle, 'avatar_url', p.avatar_url,
           'university', p.university, 'rank_tier', rt.tier, 'rank_division', rt.division,
           'visibility', h.visibility, 'body', h.body, 'photo_path', h.photo_path,
           'attach_kind', h.attach_kind, 'attach_snapshot', h.attach_snapshot, 'attachments', h.attachments,
           'cheers', (select count(*) from agora_post_cheers apc where apc.post_id = h.id),
           'cheered', exists (select 1 from agora_post_cheers apc where apc.post_id = h.id and apc.user_id = auth.uid()),
           'comments', (select count(*) from agora_comments c where c.deleted_at is null and c.post_id = h.id),
           'created_at', h.created_at, 'audience', h.audience,
           'audience_ref_id', coalesce(h.campfire_id, h.forest_id),
           'audience_name', coalesce(g.name, fo.name), 'audience_emoji', coalesce(g.emoji, fo.emoji)
         ) order by h.created_at desc, h.id desc), '[]'::jsonb)
    from hits h
    join profiles p on p.id = h.user_id and not p.is_disabled
    left join rank_thresholds rt on rt.rank_index = rank_index_for_score(live_rank_xp(h.user_id))
    left join groups g on g.id = h.campfire_id
    left join forests fo on fo.id = h.forest_id;
$$;

-- ── 3 · trending topics ───────────────────────────────────────────────────────────────────────────
create function public.get_trending_topics(p_limit integer default 8)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with mine as (
    select unnest(coalesce(ui.interest_tags, '{}')) as key
      from user_interests ui where ui.user_id = auth.uid()
  ),
  topics as (
    select iv.key, iv.label, iv.icon,
           exists (select 1 from mine m where m.key = iv.key) as is_mine,
           iv.featured, iv.sort
      from interest_vocab iv
     where iv.active and iv.kind = 'interest'
       and (iv.featured or iv.key in (select m.key from mine m))
  ),
  pub as (
    select lower(ap.body) as b
      from agora_posts ap
      join profiles p on p.id = ap.user_id and not p.is_disabled
     where ap.visibility = 'public' and ap.forest_id is null and ap.campfire_id is null
       and ap.created_at > now() - interval '30 days'
       and ap.body is not null
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'key', t.key, 'label', t.label, 'icon', t.icon, 'is_mine', t.is_mine, 'post_count', t.n
         ) order by t.is_mine desc, t.n desc, t.sort nulls last, t.label), '[]'::jsonb)
    from (
      select tp.*, (select count(*) from pub where pub.b like '%' || lower(tp.label) || '%') as n
        from topics tp
       order by tp.is_mine desc, n desc, tp.sort nulls last
       limit least(greatest(coalesce(p_limit, 8), 1), 30)
    ) t;
$$;

-- ── 4 · match summary ─────────────────────────────────────────────────────────────────────────────
create function public.get_match_summary(p_scope text default null)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with me as (
    select p.id, p.university, p.program_id, resolved_patron(p.patron_key) as patron_key,
           pr.abbrev as program_abbrev, pr.name as program_name, pa.name as patron_name
      from profiles p
      left join programs pr on pr.id = p.program_id
      left join patrons pa on pa.key = resolved_patron(p.patron_key)
     where p.id = auth.uid()
       and coalesce((select ms.discoverable from match_settings ms where ms.user_id = p.id), false)
  ),
  m_rows as (
    select g.o_user, g.o_reasons, g.o_live
      from me, grind_alike_rows(me.id, null, case when p_scope in ('program', 'uni', 'wider') then p_scope end) g
  ),
  cmp as (
    select r.o_user, r.o_live,
           coalesce(c.program_id = me.program_id, false) as same_program,
           coalesce(c.university = me.university, false) as same_uni,
           coalesce(resolved_patron(c.patron_key) = me.patron_key, false) as same_patron,
           exists (select 1 from jsonb_array_elements(r.o_reasons) x where x->>'key' like 'tag:%') as shares_tag
      from m_rows r cross join me
      join profiles c on c.id = r.o_user
  ),
  tags as (
    select x->>'label' as label, count(*) as n
      from m_rows r, jsonb_array_elements(r.o_reasons) x
     where x->>'key' like 'tag:%'
     group by 1
     order by n desc, label
     limit 5
  )
  select case when not exists (select 1 from me) then jsonb_build_object('discoverable', false)
  else (
    select jsonb_build_object(
      'discoverable', true,
      'total',        (select count(*) from cmp),
      'live',         (select count(*) from cmp where o_live),
      'interests',    jsonb_build_object('count', (select count(*) from cmp where shares_tag),
                                         'labels', coalesce((select jsonb_agg(label order by n desc, label) from tags), '[]'::jsonb)),
      'program',      jsonb_build_object('count', (select count(*) from cmp where same_program),
                                         'label', coalesce(me.program_abbrev, me.program_name)),
      'campus',       jsonb_build_object('count', (select count(*) from cmp where same_uni), 'label', me.university),
      'patron',       jsonb_build_object('count', (select count(*) from cmp where same_patron), 'label', me.patron_name)
    ) from me)
  end;
$$;

revoke all on function public.search_people_by_interest(text, integer) from public, anon;
revoke all on function public.search_agora_posts(text, timestamptz, uuid, integer) from public, anon;
revoke all on function public.get_trending_topics(integer) from public, anon;
revoke all on function public.get_match_summary(text) from public, anon;
grant execute on function public.search_people_by_interest(text, integer) to authenticated;
grant execute on function public.search_agora_posts(text, timestamptz, uuid, integer) to authenticated;
grant execute on function public.get_trending_topics(integer) to authenticated;
grant execute on function public.get_match_summary(text) to authenticated;

commit;
