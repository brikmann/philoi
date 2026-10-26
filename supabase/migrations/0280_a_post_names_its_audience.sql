-- 0280 . A POST NAMES ITS AUDIENCE (mock 320, the Social tab). "You pick who sees it": every post is
-- for one audience — your friends, one campfire, one forest, or everyone — only that audience can
-- read it, and only that audience is notified. No ranking anywhere: the feed is the sources you
-- chose, newest first.
--
-- THE AUDIENCE IS DERIVED, NOT STORED TWICE. A post already says where it lives: campfire_id (0277),
-- forest_id (0274), and the visibility dial (friends/campus/public, 0128). Every read gate in the
-- schema — can_see_agora, can_read_forest, can_read_campfire — decides on those three columns. A
-- second, hand-written `audience` column would be a fourth place to disagree with them, and the one
-- the UI shows. So `audience` + `audience_ref_id` are GENERATED from the three: the tag a post wears
-- is, by construction, the rule that gated it. The composer chooses an audience by choosing which
-- create RPC to call (create_agora_post friends|public, create_campfire_post, create_forest_post);
-- none of them changes.
--
-- NO "everyone" BACKFILL. The handoff proposed backfilling legacy posts to `everyone` (flagged for
-- confirmation). On 2026-10-26 prod held 20 posts: 17 'campus', 3 'friends', 0 'public', none in a
-- room. Backfilling them to everyone would have made 20 posts world-readable that their authors had
-- scoped narrower. Derived, they keep exactly the reach they were posted with: the 3 friends posts
-- read 'friends', the 17 campus posts read 'campus' — a fifth, legacy value the new composer no
-- longer offers but the gates still honour.
--
-- What changes:
--   1. agora_posts.audience / audience_ref_id — generated, stored.
--   2. can_see_agora_post — ONE per-post gate. can_see_agora(owner, visibility, viewer) alone is
--      wrong for a room post: those are stored visibility='public' (their reach is the room), so it
--      answers TRUE for every viewer. Anything reading agora_posts outside the room feeds should ask
--      this instead.
--   3. get_agora_feed — two new scopes and the audience on every row (DROPPED + recreated: the
--      RETURNS TABLE gains columns). Existing scopes behave exactly as before.
--        · 'all'      — the Social tab's default channel: your friends' posts (what each one let you
--                       see), every post in a campfire or forest you're in, and your own. The union
--                       of what you're entitled to, newest first. That is the whole ranking model.
--        · 'everyone' — the public square: posts made for everyone, from anybody. Discoverable here,
--                       never pushed.
--   4. get_agora_item — the permalink carries the audience too.
--   5. notify_friends_agora_post — the notification follows the audience:
--        friends (and legacy campus) → your friends who can see it (unchanged, 6h throttle);
--        campfire / forest → that room's members (new: 'campfire_post' / 'forest_post', throttled
--                           per author per room, 6h, through notify_event so #150's gates apply);
--        everyone → nobody. Not pushed, discoverable. (Before 0280 a public post pinged friends.)
--   6. notification_category — the two new types filed under Campfires.
--
-- RLS is already the server-side wall and stays as it is: agora_posts' only SELECT policy is
-- "user_id = auth.uid()" (asserted below), so a client reading the table directly gets its own rows
-- and nothing else; every other read is a security-definer RPC that applies the gate above.
--
-- Restated from the LIVE prod bodies (pg_get_functiondef, 2026-10-26 — identical to 0277's text,
-- and notification_category to 0205's), each changed only where marked 0280. Additive. No economy.

-- ──────────────────── 1. the audience, derived ────────────────────
alter table public.agora_posts
  add column if not exists audience text generated always as (
    case
      when campfire_id is not null then 'campfire'
      when forest_id is not null then 'forest'
      when visibility = 'public' then 'everyone'
      when visibility = 'campus' then 'campus'
      else 'friends'
    end
  ) stored;

alter table public.agora_posts
  add column if not exists audience_ref_id uuid generated always as (coalesce(campfire_id, forest_id)) stored;

comment on column public.agora_posts.audience is
  '0280 · who this post is for: friends | campfire | forest | everyone (| campus, legacy). Generated from campfire_id / forest_id / visibility — the same columns every read gate decides on.';
comment on column public.agora_posts.audience_ref_id is
  '0280 · the campfire (groups.id) or forest the post was made for; null for friends / everyone / campus.';

-- ──────────────────── 2. the one per-post gate ────────────────────
create or replace function public.can_see_agora_post(
  p_owner uuid,
  p_visibility text,
  p_forest_id uuid,
  p_campfire_id uuid,
  p_viewer uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when p_viewer is null then false
    -- The author always sees their own — including in a room they have since left.
    when p_owner = p_viewer then true
    when p_campfire_id is not null then can_read_campfire(p_campfire_id, p_viewer)
    when p_forest_id is not null then can_read_forest(p_forest_id, p_viewer)
    else can_see_agora(p_owner, p_visibility, p_viewer)
  end;
$$;

-- ──────────────────── 3. the feed ────────────────────
-- The return shape grows (audience, audience_ref_id, audience_name, audience_emoji), so this is a
-- drop + create, not a replace. Same argument list, so installed builds' calls resolve unchanged;
-- they simply ignore the extra columns.
drop function if exists public.get_agora_feed(text, timestamptz, uuid, integer);
CREATE FUNCTION public.get_agora_feed(p_scope text DEFAULT 'friends'::text, p_before_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_before_id uuid DEFAULT NULL::uuid, p_limit integer DEFAULT 20)
 RETURNS TABLE(item_type text, id uuid, user_id uuid, display_name text, handle text, avatar_url text, university text, rank_tier text, rank_division integer, visibility text, body text, photo_path text, attach_kind text, attach_snapshot jsonb, attachments jsonb, cheers bigint, cheered boolean, comments bigint, created_at timestamp with time zone,
               -- 0280 · who the item is for, and the room's name/emoji for its tag.
               audience text, audience_ref_id uuid, audience_name text, audience_emoji text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  -- Every reference is alias-qualified. RETURNS TABLE's OUT names (id, user_id, body, visibility,
  -- created_at, university, attachments, audience…) shadow the identically-named columns on
  -- agora_posts, milestones and profiles inside this body, and an unqualified one silently resolves
  -- to the OUT parameter — which is null on every row.
  with me as (
    select p.id, p.university from profiles p where p.id = auth.uid()
  ),
  -- The scope's author set, resolved once. 'global' returns no rows and is handled by the
  -- `p_scope = 'global'` disjunct below rather than by materialising every profile in the table.
  scoped as (
    select case when fr.requester_id = auth.uid() then fr.recipient_id else fr.requester_id end as uid
    from friend_requests fr
    -- 0280 · 'all' starts from the same friend set.
    where p_scope in ('friends', 'all') and fr.status = 'accepted'
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
    -- 0280 · except in 'everyone': that channel is posts MADE for everyone, yours included only
    -- when they were.
    select auth.uid() where p_scope not in ('global', 'everyone')
  ),
  -- 0280 · the rooms you're in — 'all' carries every post made for one of them.
  my_campfires as (
    select gm.group_id from group_members gm where p_scope = 'all' and gm.user_id = auth.uid()
  ),
  my_forests as (
    select fm.forest_id from forest_members fm
    where p_scope = 'all' and fm.user_id = auth.uid() and fm.status = 'active'
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
      ap.created_at,
      -- 0280
      ap.forest_id,
      ap.campfire_id,
      ap.audience
    from agora_posts ap
    where (
        -- 0274 · forest posts live in their forest, not the global square.
        ap.forest_id is null
        -- 0277 · and campfire posts live in their campfire's channel (get_campfire_feed).
        and ap.campfire_id is null
        and (p_scope = 'global'
             -- 0280 · the public square: made for everyone.
             or (p_scope = 'everyone' and ap.visibility = 'public')
             or ap.user_id in (select s.uid from scoped s))
      )
      -- 0280 · 'all' also carries the posts made for the rooms you're in.
      or ap.campfire_id in (select c.group_id from my_campfires c)
      or ap.forest_id in (select f.forest_id from my_forests f)

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
      m.created_at,
      -- 0280 · a milestone is never in a room; its audience is its dial, named like a post's.
      null::uuid,
      null::uuid,
      case m.visibility when 'public' then 'everyone' when 'campus' then 'campus' else 'friends' end
    from milestones m
    where (p_scope = 'global'
           or (p_scope = 'everyone' and m.visibility = 'public')
           or m.user_id in (select s.uid from scoped s))
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
    i.created_at,
    -- 0280
    i.audience,
    coalesce(i.campfire_id, i.forest_id),
    coalesce(g.name, fo.name),
    coalesce(g.emoji, fo.emoji)
  from items i
  join profiles p on p.id = i.user_id
  -- 0225 · the seasonal seat, not user_rank_state.rank_index (the permanent peak).
  left join rank_thresholds rt on rt.rank_index = rank_index_for_score(live_rank_xp(i.user_id))
  -- 0280 · the room's name for the tag.
  left join groups g on g.id = i.campfire_id
  left join forests fo on fo.id = i.forest_id
  -- 0280 · the per-post gate: a room post by its room, everything else by its dial. (can_see_agora
  -- alone passes every room post — they are stored 'public'.)
  where can_see_agora_post(i.user_id, i.visibility, i.forest_id, i.campfire_id, auth.uid())
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
  -- Reverse-chronological, and nothing else. No affinity, no engagement, no injected rows.
  order by i.created_at desc, i.id desc
  limit least(greatest(p_limit, 1), 50);
$function$;

-- ──────────────────── 4. the permalink ────────────────────
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
    -- 0280 · the audience tag, as the feed rows carry it.
    'audience', ap.audience,
    'audience_ref_id', ap.audience_ref_id,
    'audience_name', (select coalesce(g.name, fo.name)
                        from (select 1) x
                        left join groups g on g.id = ap.campfire_id
                        left join forests fo on fo.id = ap.forest_id),
    'audience_emoji', (select coalesce(g.emoji, fo.emoji)
                         from (select 1) x
                         left join groups g on g.id = ap.campfire_id
                         left join forests fo on fo.id = ap.forest_id),
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
    -- 0280
    'audience', case m.visibility when 'public' then 'everyone' when 'campus' then 'campus' else 'friends' end,
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

-- ──────────────────── 5. the notification follows the audience ────────────────────
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
  -- 0280 · a room post's audience.
  v_room uuid := coalesce(new.campfire_id, new.forest_id);
  v_type text := case when new.campfire_id is not null then 'campfire_post' else 'forest_post' end;
  v_room_name text;
  v_room_emoji text;
  v_members uuid[];
begin
  -- 0280 · made for everyone: discoverable in Social's Everyone channel, pushed to nobody. "Everyone"
  -- is a promise about who MAY read it, not a reason to light up anyone's phone.
  if new.campfire_id is null and new.forest_id is null and new.visibility = 'public' then
    return new;
  end if;

  select coalesce(nullif(btrim(p.display_name), ''), p.handle), p.avatar_url
    into v_name, v_avatar
  from profiles p where p.id = new.user_id;

  -- 0274 · a forest post is not "posted to the Agora" — and the forest may be request-only.
  -- 0277 · nor is a campfire post, and a friend outside the campfire couldn't open it.
  -- 0280 · so a room post notifies the room: its members, and nobody outside it.
  if v_room is not null then
    -- One ping per author per room every six hours — the friends rule, per room.
    if exists (
      select 1 from notification_events ne
      where ne.actor_id = new.user_id
        and ne.type = v_type
        and ne.payload->>'room_id' = v_room::text
        and ne.created_at > now() - interval '6 hours'
    ) then
      return new;
    end if;

    if new.campfire_id is not null then
      select g.name, g.emoji into v_room_name, v_room_emoji from groups g where g.id = new.campfire_id;
      select coalesce(array_agg(gm.user_id), '{}') into v_members
      from group_members gm
      join profiles pr on pr.id = gm.user_id
      where gm.group_id = new.campfire_id
        and gm.user_id <> new.user_id
        and not pr.is_disabled and not pr.is_demo
        and not exists (
          select 1 from blocked_users b
          where (b.blocker_id = gm.user_id and b.blocked_id = new.user_id)
             or (b.blocker_id = new.user_id and b.blocked_id = gm.user_id));
    else
      select f.name, f.emoji into v_room_name, v_room_emoji from forests f where f.id = new.forest_id;
      select coalesce(array_agg(fm.user_id), '{}') into v_members
      from forest_members fm
      join profiles pr on pr.id = fm.user_id
      where fm.forest_id = new.forest_id
        and fm.status = 'active'
        and fm.user_id <> new.user_id
        and not pr.is_disabled and not pr.is_demo
        and not exists (
          select 1 from blocked_users b
          where (b.blocker_id = fm.user_id and b.blocked_id = new.user_id)
             or (b.blocker_id = new.user_id and b.blocked_id = fm.user_id));
    end if;

    if array_length(v_members, 1) is null then
      return new;
    end if;

    perform notify_event(
      v_members,
      v_type,
      coalesce(v_name, 'Someone') || ' posted in ' || btrim(coalesce(v_room_emoji, '') || ' ' || coalesce(v_room_name, 'your ' || case when new.campfire_id is not null then 'campfire' else 'forest' end)),
      nullif(left(btrim(coalesce(new.body, '')), 140), ''),
      new.user_id,
      new.id,
      -- The permalink; get_agora_item gates it by the same room membership.
      '/agora/[id]',
      jsonb_build_object('id', new.id::text, 'type', 'post'),
      v_avatar,
      'circle',
      jsonb_build_object('room_id', v_room::text)
    );
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

CREATE OR REPLACE FUNCTION public.notification_category(p_type text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  select case
    when p_type in ('friend_request', 'friend_accepted', 'friend_ranked_up', 'friend_passed_you',
                    'friend_joined', 'friend_locked_in',
                    'milestone_cheered', 'milestone_posted',
                    'agora_cheered', 'agora_commented',
                    -- 0205 · a friend posting to the Agora. Friend chatter, governed by the friend
                    -- switch — and by its own type_ switch under it.
                    'friend_agora_post',
                    'check_in', 'reaction') then 'friends_social'
    when p_type in ('challenged', 'challenge_accepted', 'challenge_declined', 'challenge_passed',
                    'challenge_ending_soon', 'challenge_won', 'challenge_lost', 'goal_at_risk',
                    'goal_streak_milestone', 'challenge_cheered',
                    'challenge_invite', 'challenge_forfeited', 'challenge_change_request',
                    'challenge_change_answered', 'challenge_terms_updated',
                    -- 0164 · the vouch flow. Filed with challenges rather than friends_social even
                    -- though a vouch request comes FROM a friend: what it is about is a goal and
                    -- its reward, and somebody muting friend chatter still wants to be asked.
                    'vouch_requested', 'vouch_passed', 'vouch_settled',
                    -- 0201 · a goal completing. Without this it fell to the else-arm and muting
                    -- friend chatter would have silenced it.
                    'goal_complete') then 'challenges'
    when p_type in ('campfire_joined', 'campfire_join_request', 'campfire_challenge_started',
                    'campfire_cold', 'campfire_added', 'campfire_settled', 'campfire_message',
                    'join_request', 'join_request_approved', 'campfire_admin_granted',
                    'chat_batch', 'mention',
                    'campfire_ping',
                    -- 0162 · fires at every member of a campfire, so the campfire toggle governs it.
                    'challenge_hosted',
                    -- 0280 · a post made for a room you're in. Room chatter, under the room switch.
                    'campfire_post', 'forest_post') then 'campfires'
    when p_type in ('streak_at_risk', 'daily_fire_reminder', 'streak_milestone',
                    'session_complete',
                    'streak_risk', 'lock_in_nudge', 'lockin_still_here') then 'streak_reminders'
    when p_type in ('season_ending', 'season_settled', 'ranked_up', 'rank_dropped', 'reward_ready',
                    -- 0201 · the pass and badges are rewards, filed with the other rewards.
                    'pass_unlocked', 'badge_earned',
                    -- 0205 · where you stand on the board IS a rank event. Filed here rather than
                    -- left to the else-arm, so "Season & rank: off" actually silences it.
                    'daily_placement')
      then 'season_rank'
    else 'friends_social'
  end;
$function$;

-- ──────────────────── 6. grants ────────────────────
-- The gate is called only from security-definer bodies, like can_read_campfire.
revoke all on function public.can_see_agora_post(uuid, text, uuid, uuid, uuid) from public, anon, authenticated;
-- The feed was dropped, so its grants went with it. Signed-in callers only (anon always got zero
-- rows: every gate is false for a null viewer).
revoke all on function public.get_agora_feed(text, timestamptz, uuid, integer) from public, anon;
grant execute on function public.get_agora_feed(text, timestamptz, uuid, integer) to authenticated, service_role;

-- ──────────────────── 7. assertions ────────────────────
-- Each "must not" is paired with the "must" that proves the check can see anything at all.
do $assert$
declare
  v_n int;
  v_src text;
begin
  -- The audience is derived from the three columns, for every row that exists.
  select count(*) into v_n from agora_posts ap
   where ap.audience is distinct from case
           when ap.campfire_id is not null then 'campfire'
           when ap.forest_id is not null then 'forest'
           when ap.visibility = 'public' then 'everyone'
           when ap.visibility = 'campus' then 'campus'
           else 'friends' end
      or ap.audience_ref_id is distinct from coalesce(ap.campfire_id, ap.forest_id);
  if v_n <> 0 then raise exception '0280: % posts carry an audience that disagrees with their columns', v_n; end if;
  -- …and no post was widened: nothing reads 'everyone' unless its dial already said public.
  select count(*) into v_n from agora_posts ap where ap.audience = 'everyone' and ap.visibility <> 'public';
  if v_n <> 0 then raise exception '0280: % posts were widened to everyone', v_n; end if;
  if (select count(*) from agora_posts) > 0 and not exists (select 1 from agora_posts ap where ap.audience is not null) then
    raise exception '0280: audience is null on every post';
  end if;

  -- RLS is the client-side wall: the only SELECT policy on agora_posts is own-rows.
  select count(*) into v_n from pg_policies
   where schemaname = 'public' and tablename = 'agora_posts' and cmd in ('SELECT', 'ALL');
  if v_n <> 1 then raise exception '0280: expected 1 select policy on agora_posts, found %', v_n; end if;
  if not exists (select 1 from pg_policies
       where schemaname = 'public' and tablename = 'agora_posts' and cmd = 'SELECT'
         and replace(qual, ' ', '') = '(user_id=auth.uid())') then
    raise exception '0280: agora_posts select policy is no longer own-rows only';
  end if;

  -- One get_agora_feed, callable signed-in, never anon.
  select count(*) into v_n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'get_agora_feed';
  if v_n <> 1 then raise exception '0280: expected 1 get_agora_feed, found %', v_n; end if;
  if not has_function_privilege('authenticated', 'public.get_agora_feed(text,timestamptz,uuid,integer)', 'execute') then
    raise exception '0280: authenticated cannot call get_agora_feed';
  end if;
  if has_function_privilege('anon', 'public.get_agora_feed(text,timestamptz,uuid,integer)', 'execute') then
    raise exception '0280: anon can call get_agora_feed';
  end if;
  if has_function_privilege('authenticated', 'public.can_see_agora_post(uuid,text,uuid,uuid,uuid)', 'execute')
     or has_function_privilege('anon', 'public.can_see_agora_post(uuid,text,uuid,uuid,uuid)', 'execute') then
    raise exception '0280: can_see_agora_post is callable by a client';
  end if;

  -- The feed gates every row per post (code, not a comment: the predicate's exact text).
  select p.prosrc into v_src from pg_proc p
   where p.oid = 'public.get_agora_feed(text,timestamptz,uuid,integer)'::regprocedure;
  if position('where can_see_agora_post(i.user_id, i.visibility, i.forest_id, i.campfire_id, auth.uid())' in v_src) = 0 then
    raise exception '0280: get_agora_feed does not gate rows with can_see_agora_post';
  end if;
  if position('order by i.created_at desc, i.id desc' in v_src) = 0 then
    raise exception '0280: get_agora_feed is no longer reverse-chronological';
  end if;

  -- The new types file under Campfires; the old one is where it was.
  if notification_category('campfire_post') <> 'campfires' or notification_category('forest_post') <> 'campfires' then
    raise exception '0280: room post notifications are not under campfires';
  end if;
  if notification_category('friend_agora_post') <> 'friends_social' then
    raise exception '0280: friend_agora_post moved category';
  end if;
end;
$assert$;
