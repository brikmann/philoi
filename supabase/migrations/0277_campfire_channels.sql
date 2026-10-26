-- 0277 . CAMPFIRE CHANNELS — each campfire is a channel in the Feed (CODE_PROMPT feed channels,
-- mock 315). Tap "🏋️ Laurier Gym" on the Feed's channel row and you get a curated feed of just
-- what was posted TO that campfire: gym clips, comps, its live challenge in the header.
--
-- A post belongs to a campfire because it was posted there (the composer's lane picker, or the
-- done screen's "Post to the Agora → where"), never because its author is a member. Curated,
-- intentional — the same shape 0274 gave forests, and built the same way:
--
--   · agora_posts.campfire_id — null = global (or a forest post). Every bit of post infra is reused
--     (create_agora_post's ownership/snapshot/UGC/rate-limit rules, comments, cheers, photo cleanup,
--     reports): create_campfire_post stamps the id through a transaction-local setting, exactly as
--     create_forest_post does, so create_agora_post itself is untouched (0278 owns it).
--   · MEMBERS ONLY. A campfire channel is readable by its members and nobody else — whatever the
--     campfire's privacy dial says. 'open' means anyone may JOIN; it does not make the campfire's
--     channel a public square. can_read_campfire is the one gate, applied to the feed, the
--     permalink (get_agora_item) and the comment/thread gate (agora_item_owner).
--   · Blocks and disabled accounts hide posts here exactly as they do in the square and forests.
--
-- Restated from the LIVE prod bodies (pg_get_functiondef, 2026-10-26 — identical to 0274/0273),
-- each changed only where marked 0277:
--   · get_agora_feed — the square excludes campfire posts too (campfire_id is null);
--   · get_agora_item — a campfire post's permalink is gated by membership; the item carries
--     campfire_id;
--   · agora_item_owner — a campfire post reads as 'public' to members and as no row to anyone else;
--   · notify_friends_agora_post — a campfire post does not ping friends "posted to the Agora";
--   · post_session_to_agora — gains p_forest_id / p_campfire_id (the done screen's "where").
--     DROPPED and recreated: appending parameters with CREATE OR REPLACE would leave the 4-arg
--     overload standing (MIGRATIONS.md). Every new parameter defaults, so installed builds' named
--     4-arg calls resolve to the one survivor.
--
-- No economy surface, no push. Additive only.

-- ──────────────────── 1. the column ────────────────────
alter table public.agora_posts
  add column if not exists campfire_id uuid references public.groups(id) on delete cascade;

-- One place per post: the square, one forest, or one campfire.
alter table public.agora_posts drop constraint if exists agora_posts_one_channel;
alter table public.agora_posts add constraint agora_posts_one_channel
  check (forest_id is null or campfire_id is null);

-- The channel feed's keyset: newest first within one campfire.
create index if not exists agora_posts_campfire_feed_idx
  on public.agora_posts (campfire_id, created_at desc, id desc)
  where campfire_id is not null;

-- ──────────────────── 2. the gate ────────────────────
-- Members, and admins for moderation. Nothing about the campfire's privacy dial — see the header.
create or replace function public.can_read_campfire(p_campfire uuid, p_viewer uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_viewer is not null and (
    exists (select 1 from group_members gm where gm.group_id = p_campfire and gm.user_id = p_viewer)
    or is_admin()
  );
$$;

-- ──────────────────── 3. stamping a post into a campfire ────────────────────
-- create_campfire_post / post_session_to_agora set philoi.agora_campfire_id (transaction-local)
-- around their create_agora_post call; this moves it onto the row. Nothing else sets it, so every
-- other insert path is unaffected.
create or replace function public.agora_posts_stamp_campfire()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v text := nullif(current_setting('philoi.agora_campfire_id', true), '');
begin
  if new.campfire_id is null and v is not null then
    new.campfire_id := v::uuid;
  end if;
  return new;
end;
$$;

drop trigger if exists agora_posts_stamp_campfire on public.agora_posts;
create trigger agora_posts_stamp_campfire
  before insert on public.agora_posts
  for each row execute function public.agora_posts_stamp_campfire();

-- ──────────────────── 4. restated from live: the square, the item, the gate, the ping ────────────────────

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
    -- 0274 · forest posts live in their forest, not the global square.
    where ap.forest_id is null
      -- 0277 · and campfire posts live in their campfire's channel (get_campfire_feed).
      and ap.campfire_id is null
      and (p_scope = 'global' or ap.user_id in (select s.uid from scoped s))

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
    'forest_id', ap.forest_id,
    'campfire_id', ap.campfire_id,
    'created_at', ap.created_at
  )
  from agora_posts ap
  join profiles p on p.id = ap.user_id
  -- 0225 · the seasonal seat, not user_rank_state.rank_index (the permanent peak).
  left join rank_thresholds rt on rt.rank_index = rank_index_for_score(live_rank_xp(ap.user_id))
  where p_item_type = 'post'
    and ap.id = p_id
    -- 0274 · a forest post is gated by its forest, not by the post's own dial.
    -- 0277 · and a campfire post by membership of its campfire — a permalink is no way in.
    and case when ap.campfire_id is not null then can_read_campfire(ap.campfire_id, auth.uid())
             when ap.forest_id is null then can_see_agora(ap.user_id, ap.visibility, auth.uid())
             else can_read_forest(ap.forest_id, auth.uid()) end
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

CREATE OR REPLACE FUNCTION public.agora_item_owner(p_post_id uuid, p_milestone_id uuid)
 RETURNS TABLE(owner_id uuid, visibility text, headline text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$

  -- 0274 · a forest post reads as 'public' to anyone who can read its forest, and as no row at all
  -- to anyone who can't — so comments and threads follow the forest's rules, and a friend of the
  -- author gets nothing from a request-only forest.
  select ap.user_id,
         case when ap.forest_id is null and ap.campfire_id is null then ap.visibility else 'public' end,
         left(coalesce(nullif(btrim(ap.body), ''), 'their post'), 90)

  from agora_posts ap

  where p_post_id is not null and ap.id = p_post_id
    and (ap.forest_id is null or can_read_forest(ap.forest_id, auth.uid()))
    -- 0277 · same for a campfire post: 'public' to its members, no row at all to anyone else.
    and (ap.campfire_id is null or can_read_campfire(ap.campfire_id, auth.uid()))

  union all

  -- `in_agora` is not consulted here. Opting a milestone out of the FEED hides it from the town

  -- square; it does not retract the permalink that a friend's bell notification already opened,

  -- and it must not silently break cheering on a card someone is looking at.

  select m.user_id, m.visibility, m.headline

  from milestones m

  where p_milestone_id is not null and m.id = p_milestone_id;

$function$;

CREATE OR REPLACE FUNCTION public.notify_friends_agora_post()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_friends uuid[];
  v_name text;
  v_avatar text;
begin
  -- 0274 · a forest post is not "posted to the Agora" — and the forest may be request-only.
  -- 0277 · nor is a campfire post, and a friend outside the campfire couldn't open it.
  if new.forest_id is not null or new.campfire_id is not null then
    return new;
  end if;

  if exists (
    select 1 from notification_events
    where actor_id = new.user_id
      and type = 'friend_agora_post'
      and created_at > now() - interval '6 hours'
  ) then
    return new;
  end if;

  select coalesce(array_agg(f), '{}') into v_friends
  from unnest(friend_ids_for_notify(new.user_id)) as f
  where can_see_agora(new.user_id, coalesce(new.visibility, 'campus'), f);

  if array_length(v_friends, 1) is null then
    return new;
  end if;

  select coalesce(nullif(btrim(p.display_name), ''), p.handle), p.avatar_url
    into v_name, v_avatar
  from profiles p where p.id = new.user_id;

  perform notify_event(
    v_friends,
    'friend_agora_post',
    coalesce(v_name, 'A friend') || ' posted to the Agora',
    nullif(left(btrim(coalesce(new.body, '')), 140), ''),
    new.user_id,
    new.id,
    -- The permalink 0129's two Agora notifications already use.
    '/agora/[id]',
    jsonb_build_object('id', new.id::text, 'type', 'post'),
    v_avatar,
    'circle'
  );

  return new;
end;
$function$;

-- ──────────────────── 5. reads ────────────────────
-- The campfire's channel. Same row shape as get_agora_feed / get_forest_feed, so the client renders
-- it with the same card. A non-member gets no rows (not an error), the same as an empty channel —
-- the client only ever asks for campfires it lists from get_my_feed_channels anyway.
drop function if exists public.get_campfire_feed(uuid, timestamptz, uuid, integer);
create function public.get_campfire_feed(
  p_campfire_id uuid,
  p_before_at timestamptz default null,
  p_before_id uuid default null,
  p_limit integer default 20
)
returns table(item_type text, id uuid, user_id uuid, display_name text, handle text, avatar_url text,
              university text, rank_tier text, rank_division integer, visibility text, body text,
              photo_path text, attach_kind text, attach_snapshot jsonb, attachments jsonb,
              cheers bigint, cheered boolean, comments bigint, created_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  -- Alias-qualified throughout: the OUT names above shadow agora_posts / profiles columns.
  select
    'post'::text,
    ap.id,
    ap.user_id,
    p.display_name,
    p.handle,
    p.avatar_url,
    p.university,
    rt.tier,
    rt.division,
    ap.visibility,
    nullif(btrim(ap.body), ''),
    ap.photo_path,
    ap.attach_kind,
    ap.attach_snapshot,
    agora_attachments_json(ap.attachments, ap.attach_kind, ap.attach_ref_id, ap.attach_key, ap.attach_snapshot),
    (select count(*) from agora_post_cheers apc where apc.post_id = ap.id),
    exists (select 1 from agora_post_cheers apc where apc.post_id = ap.id and apc.user_id = auth.uid()),
    (select count(*) from agora_comments c where c.deleted_at is null and c.post_id = ap.id),
    ap.created_at
  from agora_posts ap
  join profiles p on p.id = ap.user_id
  left join rank_thresholds rt on rt.rank_index = rank_index_for_score(live_rank_xp(ap.user_id))
  where ap.campfire_id = p_campfire_id
    and can_read_campfire(p_campfire_id, auth.uid())
    and not p.is_disabled
    and not exists (
      select 1 from blocked_users b
      where (b.blocker_id = auth.uid() and b.blocked_id = ap.user_id)
         or (b.blocker_id = ap.user_id and b.blocked_id = auth.uid()))
    and (p_before_at is null
         or (ap.created_at, ap.id) < (p_before_at, coalesce(p_before_id, '00000000-0000-0000-0000-000000000000'::uuid)))
  order by ap.created_at desc, ap.id desc
  limit least(greatest(p_limit, 1), 50);
$$;

-- The channel row: your campfires and your forests, liveliest first (newest post in the channel,
-- then when you joined). A campfire row carries what its channel header shows — member count and
-- the live challenge ending soonest (get_circle_active_challenges' "live" set: draft/pending/active).
drop function if exists public.get_my_feed_channels();
create function public.get_my_feed_channels()
returns table(kind text, id uuid, name text, emoji text, member_count integer, last_post_at timestamptz,
              challenge_id uuid, challenge_name text, challenge_metric text, challenge_ends_at timestamptz,
              joined_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select * from (
    select
      'campfire'::text,
      g.id,
      g.name,
      g.emoji,
      (select count(*)::int from group_members gm2 where gm2.group_id = g.id),
      (select max(ap.created_at) from agora_posts ap where ap.campfire_id = g.id),
      ch.id,
      ch.public_name,
      ch.race_metric,
      ch.ends_at,
      gm.joined_at
    from group_members gm
    join groups g on g.id = gm.group_id
    left join lateral (
      select sc.id, sc.public_name, sc.race_metric, sc.ends_at
      from social_challenges sc
      where sc.circle_id = g.id and sc.mode = 'group' and sc.status in ('draft', 'pending', 'active')
      order by sc.ends_at asc nulls last, sc.created_at desc
      limit 1
    ) ch on true
    where gm.user_id = auth.uid()

    union all

    select
      'forest'::text,
      f.id,
      f.name,
      f.emoji,
      (select count(*)::int from forest_members fm2 where fm2.forest_id = f.id and fm2.status = 'active'),
      (select max(ap.created_at) from agora_posts ap where ap.forest_id = f.id),
      null::uuid, null::text, null::text, null::timestamptz,
      fm.joined_at
    from forest_members fm
    join forests f on f.id = fm.forest_id
    where fm.user_id = auth.uid() and fm.status = 'active' and f.removed_at is null
  ) c(kind, id, name, emoji, member_count, last_post_at, challenge_id, challenge_name, challenge_metric,
      challenge_ends_at, joined_at)
  order by coalesce(c.last_post_at, c.joined_at) desc, c.name;
$$;

-- ──────────────────── 6. writes ────────────────────
-- Post into a campfire's channel. Every create_agora_post rule applies; the campfire id is stamped
-- on the way in. Its own dial is 'public' because its audience is the campfire (the gate decides).
drop function if exists public.create_campfire_post(uuid, text, text, jsonb);
create function public.create_campfire_post(
  p_campfire_id uuid,
  p_body text default null,
  p_photo_path text default null,
  p_attachments jsonb default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if auth.uid() is null then raise exception 'Not signed in.'; end if;
  if not exists (select 1 from group_members gm where gm.group_id = p_campfire_id and gm.user_id = auth.uid()) then
    raise exception 'Join this campfire to post in it.';
  end if;

  perform set_config('philoi.agora_campfire_id', p_campfire_id::text, true);
  v_id := create_agora_post(p_body, p_photo_path, 'public', null, null, null, p_attachments);
  perform set_config('philoi.agora_campfire_id', '', true);
  return v_id;
end;
$$;

-- Author, or the campfire's owner/admin: take one post out of the channel.
create or replace function public.remove_campfire_post(p_post_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_post agora_posts;
begin
  select * into v_post from agora_posts ap where ap.id = p_post_id and ap.campfire_id is not null;
  if v_post.id is null then raise exception 'That post is gone.'; end if;
  if v_post.user_id <> auth.uid() and not exists (
       select 1 from group_members gm
       where gm.group_id = v_post.campfire_id and gm.user_id = auth.uid() and gm.role in ('owner', 'admin')) then
    raise exception 'Only the author or the campfire''s owner can remove this.';
  end if;
  delete from agora_posts ap where ap.id = p_post_id;
end;
$$;

-- Restated from the LIVE body (= 0273), changed only where marked 0277.
drop function if exists public.post_session_to_agora(uuid, text, text[], text);
create function public.post_session_to_agora(
  p_check_in_id uuid,
  p_caption     text default null,
  p_photo_paths text[] default null,
  p_visibility  text default 'friends',
  -- 0277 · where it goes. Both null = the Agora, exactly as before. At most one.
  p_forest_id   uuid default null,
  p_campfire_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_ci check_ins;
  v_paths text[] := '{}';
  v_path text;
  v_id uuid;
  v_snap jsonb;
begin
  if v_me is null then raise exception 'Not signed in.'; end if;

  select * into v_ci from check_ins c
   where c.id = p_check_in_id and c.user_id = v_me and c.removed_at is null;
  if v_ci.id is null then raise exception 'That session is not yours to post.'; end if;
  if v_ci.created_at < now() - interval '24 hours' then
    raise exception 'That session is too old to auto-post.';
  end if;

  foreach v_path in array coalesce(p_photo_paths, '{}') loop
    continue when nullif(btrim(v_path), '') is null;
    if split_part(v_path, '/', 1) <> v_me::text then raise exception 'That photo is not yours.'; end if;
    v_paths := v_paths || v_path;
  end loop;
  if cardinality(v_paths) > 4 then raise exception 'Up to 4 photos.'; end if;

  -- 0277 · the target, checked the same way create_forest_post / create_campfire_post check it.
  if p_forest_id is not null and p_campfire_id is not null then
    raise exception 'Post to one place at a time.';
  end if;
  if p_forest_id is not null and (
       forest_status_of(p_forest_id, v_me) is distinct from 'active'
       or not exists (select 1 from forests f where f.id = p_forest_id and f.removed_at is null)) then
    raise exception 'Join this forest to post in it.';
  end if;
  if p_campfire_id is not null
     and not exists (select 1 from group_members gm where gm.group_id = p_campfire_id and gm.user_id = v_me) then
    raise exception 'Join this campfire to post in it.';
  end if;

  -- Once per session. A second tap (or a retry after a flaky network) returns the first post.
  select ap.id into v_id
    from agora_posts ap
   where ap.user_id = v_me and ap.attach_kind = 'lockin' and ap.attach_ref_id = p_check_in_id
     and coalesce((ap.attach_snapshot->>'auto')::boolean, false)
   limit 1;
  if v_id is not null then return v_id; end if;

  -- 0277 · a targeted post is stamped through the same transaction-local settings the two
  -- stamp triggers read, and its audience is the channel, so its own dial is 'public' (as 0274's
  -- forest posts are).
  if p_forest_id is not null then perform set_config('philoi.agora_forest_id', p_forest_id::text, true); end if;
  if p_campfire_id is not null then perform set_config('philoi.agora_campfire_id', p_campfire_id::text, true); end if;
  v_id := create_agora_post(
    p_caption,
    v_paths[1],
    case when p_forest_id is not null or p_campfire_id is not null then 'public'
         when p_visibility in ('friends', 'campus', 'public') then p_visibility else 'friends' end,
    null, null, null,
    jsonb_build_array(jsonb_build_object('kind', 'lockin', 'ref_id', p_check_in_id))
  );
  perform set_config('philoi.agora_forest_id', '', true);
  perform set_config('philoi.agora_campfire_id', '', true);

  -- Mark it auto (the feed's ⚡ tag), carry XP + the extra photos. The snapshot is server-built by
  -- create_agora_post; this only adds keys to it, and mirrors element [0] like 0140 does.
  select ap.attachments->0->'snapshot' into v_snap from agora_posts ap where ap.id = v_id;
  v_snap := coalesce(v_snap, '{}'::jsonb) || jsonb_build_object(
    'auto', true,
    'xp_earned', coalesce(v_ci.xp_earned, 0),
    'photos', to_jsonb(coalesce(v_paths[2:], '{}'::text[]))
  );
  update agora_posts ap
     set attachments = jsonb_set(ap.attachments, '{0,snapshot}', v_snap),
         attach_snapshot = v_snap
   where ap.id = v_id;

  return v_id;
end;
$$;


-- ──────────────────── 7. grants ────────────────────
-- The gate and the stamp are called only from security-definer bodies (no RLS policy uses them).
revoke all on function public.can_read_campfire(uuid, uuid) from public, anon, authenticated;
revoke all on function public.agora_posts_stamp_campfire() from public, anon, authenticated;

revoke all on function public.get_campfire_feed(uuid, timestamptz, uuid, integer) from public, anon;
revoke all on function public.get_my_feed_channels() from public, anon;
revoke all on function public.create_campfire_post(uuid, text, text, jsonb) from public, anon;
revoke all on function public.remove_campfire_post(uuid) from public, anon;
revoke all on function public.post_session_to_agora(uuid, text, text[], text, uuid, uuid) from public, anon;

grant execute on function public.get_campfire_feed(uuid, timestamptz, uuid, integer) to authenticated;
grant execute on function public.get_my_feed_channels() to authenticated;
grant execute on function public.create_campfire_post(uuid, text, text, jsonb) to authenticated;
grant execute on function public.remove_campfire_post(uuid) to authenticated;
grant execute on function public.post_session_to_agora(uuid, text, text[], text, uuid, uuid) to authenticated;

-- ──────────────────── 8. assertions ────────────────────
-- Each "must not" is paired with the "must" that proves the check can see anything at all.
do $assert$
declare
  v_n int;
begin
  -- One post_session_to_agora, the 6-arg one.
  select count(*) into v_n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'post_session_to_agora';
  if v_n <> 1 then raise exception '0277: expected 1 post_session_to_agora, found %', v_n; end if;
  if to_regprocedure('public.post_session_to_agora(uuid,text,text[],text,uuid,uuid)') is null then
    raise exception '0277: the 6-arg post_session_to_agora is missing';
  end if;
  -- An installed build's call shape still has to resolve: 1 required arg, the rest defaulted.
  select p.pronargs - p.pronargdefaults into v_n from pg_proc p
   where p.oid = 'public.post_session_to_agora(uuid,text,text[],text,uuid,uuid)'::regprocedure;
  if v_n <> 1 then raise exception '0277: post_session_to_agora should require 1 arg, requires %', v_n; end if;

  -- Callable by members' clients, never by anon.
  if not has_function_privilege('authenticated', 'public.get_campfire_feed(uuid,timestamptz,uuid,integer)', 'execute') then
    raise exception '0277: authenticated cannot call get_campfire_feed';
  end if;
  if has_function_privilege('anon', 'public.get_campfire_feed(uuid,timestamptz,uuid,integer)', 'execute')
     or has_function_privilege('anon', 'public.get_my_feed_channels()', 'execute')
     or has_function_privilege('anon', 'public.create_campfire_post(uuid,text,text,jsonb)', 'execute')
     or has_function_privilege('anon', 'public.remove_campfire_post(uuid)', 'execute')
     or has_function_privilege('anon', 'public.post_session_to_agora(uuid,text,text[],text,uuid,uuid)', 'execute') then
    raise exception '0277: anon can call a campfire-channel function';
  end if;

  -- The square really filters campfire posts (code, not a comment: the comment line says
  -- "campfire's channel", never this exact predicate).
  if position('and ap.campfire_id is null' in (select p.prosrc from pg_proc p
       where p.oid = 'public.get_agora_feed(text,timestamptz,uuid,integer)'::regprocedure)) = 0 then
    raise exception '0277: get_agora_feed does not exclude campfire posts';
  end if;
  if position('can_read_campfire(ap.campfire_id, auth.uid())' in (select p.prosrc from pg_proc p
       where p.oid = 'public.get_agora_item(uuid,text)'::regprocedure)) = 0 then
    raise exception '0277: get_agora_item does not gate campfire posts';
  end if;
end;
$assert$;
