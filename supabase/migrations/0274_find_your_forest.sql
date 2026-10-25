-- 0274 . FIND YOUR FOREST — interest hubs inside the Agora that funnel into campfires
-- (CODE_PROMPT_agora_forests.md, mock 283 §02).
--
-- Agora (open commons) → Forest (your interest/goal world) → Campfire (the committed private group
-- where challenges and dares run). A forest is cheap to make and open to find; a campfire is the
-- commitment. Inside a forest you see its feed, its members, how many are locked in right now, and
-- the campfires pinned to it — with their join codes — so you can step into one.
--
-- Shape:
--   · forests / forest_members — new, RLS on with NO policies: everything goes through the RPCs
--     below, which apply the forest's own rules (open vs request-to-join, this-uni-only).
--   · agora_posts.forest_id — a post is global (null) or forest-scoped. Reuses every bit of post
--     infra: create_agora_post's ownership/snapshot/UGC/rate-limit rules, comments, photo cleanup,
--     reports. create_forest_post stamps the id through a transaction-local setting so
--     create_agora_post itself is untouched.
--   · groups.forest_id — a campfire belongs to at most one forest.
--   · moderation_reports.reported_forest_id — a report path on forests themselves.
--
-- Restated from the LIVE prod bodies (pg_get_functiondef, 2026-10-25), each changed in one place:
--   · get_agora_feed — the global square excludes forest posts (forest_id is null);
--   · get_agora_item — a forest post's permalink is gated by the forest, not the post's dial, and
--     the item carries forest_id;
--   · agora_item_owner — the gate comments/threads use: a forest post reads as 'public' to anyone
--     who can read the forest, and as nothing at all to anyone who can't;
--   · notify_friends_agora_post — a forest post does not ping friends "posted to the Agora" (the
--     forest may be request-only; they couldn't open it).
--
-- Moderation is built in, not bolted on: forest owners remove posts and members (a removed member
-- can't rejoin), anyone can report a forest, blocks hide people across every forest, forest names /
-- purposes / tags run the UGC filter, and creation is rate-limited. Official forests (created_by
-- null) are moderated by admins.
--
-- No economy surface. Additive only.

-- ──────────────────── 1. tables ────────────────────
create table if not exists public.forests (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(btrim(name)) between 3 and 40),
  purpose     text check (purpose is null or char_length(purpose) <= 120),
  emoji       text not null default '🌲' check (char_length(emoji) <= 8),
  cover_url   text,
  created_by  uuid references public.profiles(id) on delete set null,
  visibility  text not null default 'open' check (visibility in ('open', 'request')),
  -- null = cross-uni; otherwise only people at that university can see or join it.
  university  text,
  tags        text[] not null default '{}' check (cardinality(tags) <= 6),
  is_official boolean not null default false,
  created_at  timestamptz not null default now(),
  removed_at  timestamptz
);

create unique index if not exists forests_name_uni_uniq
  on public.forests (lower(btrim(name)), coalesce(university, ''))
  where removed_at is null;
create index if not exists forests_created_idx on public.forests (created_at desc) where removed_at is null;

create table if not exists public.forest_members (
  forest_id uuid not null references public.forests(id) on delete cascade,
  user_id   uuid not null references public.profiles(id) on delete cascade,
  role      text not null default 'member' check (role in ('owner', 'member')),
  -- pending = asked to join a request-only forest; removed = taken out by an owner (stays, so they
  -- can't simply rejoin).
  status    text not null default 'active' check (status in ('active', 'pending', 'removed')),
  joined_at timestamptz not null default now(),
  primary key (forest_id, user_id)
);
create index if not exists forest_members_user_idx on public.forest_members (user_id) where status = 'active';

alter table public.forests enable row level security;          -- no policies: RPC-only
alter table public.forest_members enable row level security;   -- no policies: RPC-only
revoke all on public.forests from public, anon, authenticated;
revoke all on public.forest_members from public, anon, authenticated;

alter table public.agora_posts add column if not exists forest_id uuid references public.forests(id) on delete cascade;
create index if not exists agora_posts_forest_idx on public.agora_posts (forest_id, created_at desc) where forest_id is not null;

alter table public.groups add column if not exists forest_id uuid references public.forests(id) on delete set null;
create index if not exists groups_forest_idx on public.groups (forest_id) where forest_id is not null;

alter table public.moderation_reports add column if not exists reported_forest_id uuid references public.forests(id) on delete set null;

-- ──────────────────── 2. predicates ────────────────────
create or replace function public.forest_status_of(p_forest uuid, p_user uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select fm.status from forest_members fm where fm.forest_id = p_forest and fm.user_id = p_user;
$$;

create or replace function public.can_read_forest(p_forest uuid, p_viewer uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select case
      when p_viewer is null or f.removed_at is not null then false
      when is_admin() then true
      when forest_status_of(f.id, p_viewer) = 'active' then true
      when forest_status_of(f.id, p_viewer) = 'removed' then false
      when f.university is not null
           and f.university is distinct from (select p.university from profiles p where p.id = p_viewer) then false
      else f.visibility = 'open'
    end
    from forests f where f.id = p_forest
  ), false);
$$;

create or replace function public.is_forest_owner(p_forest uuid, p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select is_admin() or exists (
    select 1 from forest_members fm
     where fm.forest_id = p_forest and fm.user_id = p_user and fm.role = 'owner' and fm.status = 'active');
$$;

-- Live, un-paused lock-ins among a forest's active members who show live status (0245's rule).
create or replace function public.forest_locked_in_now(p_forest uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select count(distinct s.user_id)::int
    from forest_members fm
    join lock_in_sessions s on s.user_id = fm.user_id and s.status = 'active' and not coalesce(s.paused, false)
    join profiles p on p.id = fm.user_id
   where fm.forest_id = p_forest and fm.status = 'active'
     and coalesce(p.show_live_status, true) and not coalesce(p.is_disabled, false);
$$;

-- ──────────────────── 3. stamping a post into a forest ────────────────────
-- create_forest_post sets philoi.agora_forest_id (transaction-local) around its create_agora_post
-- call; this trigger moves it onto the row. Nothing else ever sets it, so every other insert path
-- stays global.
create or replace function public.agora_posts_stamp_forest()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v text := nullif(current_setting('philoi.agora_forest_id', true), '');
begin
  if new.forest_id is null and v is not null then
    new.forest_id := v::uuid;
  end if;
  return new;
end;
$$;

drop trigger if exists agora_posts_stamp_forest on public.agora_posts;
create trigger agora_posts_stamp_forest
  before insert on public.agora_posts
  for each row execute function public.agora_posts_stamp_forest();

-- ──────────────────── 4. restated from live: the global square, the item, the gate, the ping ────────────────────
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
    'created_at', ap.created_at
  )
  from agora_posts ap
  join profiles p on p.id = ap.user_id
  -- 0225 · the seasonal seat, not user_rank_state.rank_index (the permanent peak).
  left join rank_thresholds rt on rt.rank_index = rank_index_for_score(live_rank_xp(ap.user_id))
  where p_item_type = 'post'
    and ap.id = p_id
    -- 0274 · a forest post is gated by its forest, not by the post's own dial.
    and case when ap.forest_id is null then can_see_agora(ap.user_id, ap.visibility, auth.uid())
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
         case when ap.forest_id is null then ap.visibility else 'public' end,
         left(coalesce(nullif(btrim(ap.body), ''), 'their post'), 90)

  from agora_posts ap

  where p_post_id is not null and ap.id = p_post_id
    and (ap.forest_id is null or can_read_forest(ap.forest_id, auth.uid()))

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
  if new.forest_id is not null then
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
-- Browse. p_sort: active (default — forests with a pulse first) | popular | new | mine.
drop function if exists public.get_forests(text, text, integer);
create function public.get_forests(p_sort text default 'active', p_query text default null, p_limit integer default 40)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with me as (
    select p.id, p.university,
           coalesce((select pi.interests from profile_identity pi where pi.user_id = p.id), '{}') as interests,
           (select lower(coalesce(pr.name, '') || ' ' || coalesce(pr.abbrev, '')) from programs pr where pr.id = p.program_id) as program
      from profiles p where p.id = auth.uid()
  ),
  q as (select nullif(btrim(lower(coalesce(p_query, ''))), '') as q),
  base as (
    select f.*,
           forest_status_of(f.id, me.id) as my_status,
           (select count(*)::int from forest_members fm where fm.forest_id = f.id and fm.status = 'active') as member_count,
           forest_locked_in_now(f.id) as locked_in_now,
           (select count(*)::int from agora_posts ap where ap.forest_id = f.id and ap.created_at > now() - interval '24 hours') as posts_24h,
           (select count(*)::int from groups g where g.forest_id = f.id) as campfire_count,
           ( (case when f.university is not null and f.university = me.university then 2 else 0 end)
           + (case when f.tags && me.interests then 2 else 0 end)
           + (case when me.program is not null and exists (
                select 1 from unnest(f.tags) t where length(t) >= 3 and me.program like '%' || t || '%') then 2 else 0 end)
           ) as suggest_score
      from forests f, me, q
     where f.removed_at is null
       and (f.university is null or f.university = me.university or forest_status_of(f.id, me.id) = 'active')
       and coalesce(forest_status_of(f.id, me.id), '') <> 'removed'
       and (f.created_by is null or not exists (
             select 1 from blocked_users b
              where (b.blocker_id = me.id and b.blocked_id = f.created_by)
                 or (b.blocker_id = f.created_by and b.blocked_id = me.id)))
       and (q.q is null
            or lower(f.name) like '%' || q.q || '%'
            or lower(coalesce(f.purpose, '')) like '%' || q.q || '%'
            or exists (select 1 from unnest(f.tags) t where t like '%' || q.q || '%'))
       and (coalesce(p_sort, 'active') <> 'mine' or forest_status_of(f.id, me.id) in ('active', 'pending'))
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', b.id, 'name', b.name, 'purpose', b.purpose, 'emoji', b.emoji, 'cover_url', b.cover_url,
           'visibility', b.visibility, 'university', b.university, 'tags', to_jsonb(b.tags),
           'is_official', b.is_official, 'my_status', b.my_status,
           'member_count', b.member_count, 'locked_in_now', b.locked_in_now, 'posts_24h', b.posts_24h,
           'campfire_count', b.campfire_count,
           'pulse', b.locked_in_now > 0 or b.posts_24h > 0,
           'suggested', b.suggest_score > 0,
           'created_at', b.created_at
         ) order by
           case coalesce(p_sort, 'active')
             when 'new' then extract(epoch from b.created_at)
             when 'popular' then b.member_count::numeric
             else (b.locked_in_now * 10 + b.posts_24h * 3 + b.suggest_score * 5 + least(b.member_count, 50))::numeric
           end desc,
           b.member_count desc, b.created_at desc), '[]'::jsonb)
    from (select * from base
           order by case coalesce(p_sort, 'active')
                      when 'new' then extract(epoch from base.created_at)
                      when 'popular' then base.member_count::numeric
                      else (base.locked_in_now * 10 + base.posts_24h * 3 + base.suggest_score * 5 + least(base.member_count, 50))::numeric
                    end desc
           limit least(greatest(coalesce(p_limit, 40), 1), 100)) b;
$$;

-- One forest: header, my standing, members, campfires, presence. Header is visible to anyone who
-- could find the forest in browse; members / campfires / codes only to those who can read it.
drop function if exists public.get_forest(uuid);
create function public.get_forest(p_forest_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_f forests;
  v_status text;
  v_can_read boolean;
  v_is_owner boolean;
  v_out jsonb;
begin
  if v_me is null then raise exception 'not authenticated'; end if;
  select * into v_f from forests f where f.id = p_forest_id and f.removed_at is null;
  if v_f.id is null then return null; end if;

  v_status := forest_status_of(v_f.id, v_me);
  if v_status = 'removed' then return null; end if;
  if v_f.university is not null and v_status is distinct from 'active' and not is_admin()
     and v_f.university is distinct from (select p.university from profiles p where p.id = v_me) then
    return null;
  end if;
  if v_f.created_by is not null and is_blocked_either_way(v_f.created_by) then return null; end if;

  v_can_read := can_read_forest(v_f.id, v_me);
  v_is_owner := is_forest_owner(v_f.id, v_me);

  v_out := jsonb_build_object(
    'id', v_f.id, 'name', v_f.name, 'purpose', v_f.purpose, 'emoji', v_f.emoji, 'cover_url', v_f.cover_url,
    'visibility', v_f.visibility, 'university', v_f.university, 'tags', to_jsonb(v_f.tags),
    'is_official', v_f.is_official, 'created_at', v_f.created_at,
    'my_status', v_status, 'is_owner', v_is_owner, 'can_read', v_can_read,
    'member_count', (select count(*) from forest_members fm where fm.forest_id = v_f.id and fm.status = 'active'),
    'locked_in_now', forest_locked_in_now(v_f.id)
  );

  if v_can_read then
    v_out := v_out || jsonb_build_object(
      'members', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'user_id', p.id, 'display_name', p.display_name, 'handle', p.handle,
                 'avatar_url', p.avatar_url, 'role', fm.role,
                 'locked_in', exists (select 1 from lock_in_sessions s
                                       where s.user_id = p.id and s.status = 'active' and not coalesce(s.paused, false))
                              and coalesce(p.show_live_status, true)
               ) order by (fm.role = 'owner') desc, fm.joined_at)
          from (select * from forest_members x where x.forest_id = v_f.id and x.status = 'active'
                 order by (x.role = 'owner') desc, x.joined_at limit 60) fm
          join profiles p on p.id = fm.user_id
         where not coalesce(p.is_disabled, false)
           and not exists (select 1 from blocked_users b
                            where (b.blocker_id = v_me and b.blocked_id = p.id)
                               or (b.blocker_id = p.id and b.blocked_id = v_me))
      ), '[]'::jsonb),
      'campfires', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'id', g.id, 'name', g.name, 'emoji', g.emoji, 'privacy', g.privacy, 'goal_type', g.goal_type,
                 'member_count', (select count(*) from group_members gm where gm.group_id = g.id),
                 'is_member', exists (select 1 from group_members gm where gm.group_id = g.id and gm.user_id = v_me),
                 -- The funnel: an open campfire's code, shown to the forest's own members.
                 'join_code', case when g.privacy = 'open' and v_status = 'active' then g.join_code end
               ) order by g.created_at)
          from groups g
         where g.forest_id = v_f.id
           and not exists (select 1 from blocked_users b
                            where (b.blocker_id = v_me and b.blocked_id = g.owner_id)
                               or (b.blocker_id = g.owner_id and b.blocked_id = v_me))
      ), '[]'::jsonb)
    );
  end if;

  if v_is_owner then
    v_out := v_out || jsonb_build_object('pending', coalesce((
      select jsonb_agg(jsonb_build_object('user_id', p.id, 'display_name', p.display_name,
                                          'handle', p.handle, 'avatar_url', p.avatar_url) order by fm.joined_at)
        from forest_members fm join profiles p on p.id = fm.user_id
       where fm.forest_id = v_f.id and fm.status = 'pending'), '[]'::jsonb));
  end if;

  return v_out;
end;
$$;

-- The forest's feed. Same row shape as get_agora_feed so the client renders it with the same card.
drop function if exists public.get_forest_feed(uuid, timestamptz, uuid, integer);
create function public.get_forest_feed(
  p_forest_id uuid,
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
    0::bigint,
    false,
    (select count(*) from agora_comments c where c.deleted_at is null and c.post_id = ap.id),
    ap.created_at
  from agora_posts ap
  join profiles p on p.id = ap.user_id
  left join rank_thresholds rt on rt.rank_index = rank_index_for_score(live_rank_xp(ap.user_id))
  where ap.forest_id = p_forest_id
    and can_read_forest(p_forest_id, auth.uid())
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

-- ──────────────────── 6. writes ────────────────────
create or replace function public.forest_clean_tags(p_tags text[])
returns text[]
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_tag text;
  v_out text[] := '{}';
begin
  foreach v_tag in array coalesce(p_tags, '{}') loop
    v_tag := lower(btrim(v_tag));
    continue when v_tag = '' or v_tag = any (v_out);
    if char_length(v_tag) > 24 then raise exception 'Keep each tag under 24 characters.'; end if;
    perform ugc_assert_clean(v_tag);
    v_out := v_out || v_tag;
  end loop;
  if cardinality(v_out) > 6 then raise exception 'Up to 6 tags.'; end if;
  return v_out;
end;
$$;

drop function if exists public.create_forest(text, text, text, text[], text, boolean);
create function public.create_forest(
  p_name text,
  p_purpose text default null,
  p_emoji text default null,
  p_tags text[] default null,
  p_visibility text default 'open',
  p_this_uni_only boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_name text := btrim(coalesce(p_name, ''));
  v_purpose text := nullif(btrim(coalesce(p_purpose, '')), '');
  v_uni text;
  v_id uuid;
begin
  if v_me is null then raise exception 'Not signed in.'; end if;
  if char_length(v_name) < 3 or char_length(v_name) > 40 then raise exception 'Name it in 3–40 characters.'; end if;
  if v_purpose is not null and char_length(v_purpose) > 120 then raise exception 'Keep the purpose under 120 characters.'; end if;
  if coalesce(p_visibility, 'open') not in ('open', 'request') then raise exception 'Unknown visibility.'; end if;

  -- Cheap to make, not free to spam: 3 a day, 20 live at once.
  if (select count(*) from forests f where f.created_by = v_me and f.created_at > now() - interval '24 hours') >= 3 then
    raise exception 'You''ve started 3 forests today — try again tomorrow.';
  end if;
  if (select count(*) from forests f where f.created_by = v_me and f.removed_at is null) >= 20 then
    raise exception 'You own 20 forests already.';
  end if;

  perform ugc_assert_clean(v_name);
  if v_purpose is not null then perform ugc_assert_clean(v_purpose); end if;

  if coalesce(p_this_uni_only, false) then
    select p.university into v_uni from profiles p where p.id = v_me;
    if v_uni is null then raise exception 'Add your university first to make a this-uni-only forest.'; end if;
  end if;

  if exists (select 1 from forests f
              where f.removed_at is null and lower(btrim(f.name)) = lower(v_name)
                and coalesce(f.university, '') = coalesce(v_uni, '')) then
    raise exception 'A forest with that name already exists — join it instead.';
  end if;

  insert into forests (name, purpose, emoji, created_by, visibility, university, tags)
  values (v_name, v_purpose, coalesce(nullif(btrim(coalesce(p_emoji, '')), ''), '🌲'), v_me,
          coalesce(p_visibility, 'open'), v_uni, forest_clean_tags(p_tags))
  returning id into v_id;

  insert into forest_members (forest_id, user_id, role, status) values (v_id, v_me, 'owner', 'active');
  return v_id;
end;
$$;

-- Returns the caller's status afterwards: 'active' (open forest) or 'pending' (request-only).
create or replace function public.join_forest(p_forest_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_f forests;
  v_status text;
begin
  if v_me is null then raise exception 'Not signed in.'; end if;
  select * into v_f from forests f where f.id = p_forest_id and f.removed_at is null;
  if v_f.id is null then raise exception 'That forest is gone.'; end if;

  v_status := forest_status_of(v_f.id, v_me);
  if v_status = 'removed' then raise exception 'You can''t rejoin this forest.'; end if;
  if v_status in ('active', 'pending') then return v_status; end if;
  if v_f.university is not null
     and v_f.university is distinct from (select p.university from profiles p where p.id = v_me) then
    raise exception 'This forest is only for %.', v_f.university;
  end if;
  if v_f.created_by is not null and is_blocked_either_way(v_f.created_by) then
    raise exception 'That forest is gone.';
  end if;

  insert into forest_members (forest_id, user_id, role, status)
  values (v_f.id, v_me, 'member', case when v_f.visibility = 'open' then 'active' else 'pending' end)
  returning status into v_status;
  return v_status;
end;
$$;

create or replace function public.leave_forest(p_forest_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'Not signed in.'; end if;
  if exists (select 1 from forest_members fm
              where fm.forest_id = p_forest_id and fm.user_id = auth.uid() and fm.role = 'owner') then
    raise exception 'Owners can''t leave — close the forest instead.';
  end if;
  delete from forest_members fm
   where fm.forest_id = p_forest_id and fm.user_id = auth.uid() and fm.status in ('active', 'pending');
end;
$$;

-- Owner (or admin): close a forest. Its posts and memberships stay for moderation; it leaves every
-- read. Its campfires simply stop being listed under it.
create or replace function public.close_forest(p_forest_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_forest_owner(p_forest_id, auth.uid()) then raise exception 'Only the owner can close this forest.'; end if;
  update forests set removed_at = now() where id = p_forest_id and removed_at is null;
end;
$$;

create or replace function public.respond_forest_request(p_forest_id uuid, p_user_id uuid, p_approve boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_forest_owner(p_forest_id, auth.uid()) then raise exception 'Only the owner can do that.'; end if;
  if coalesce(p_approve, false) then
    update forest_members set status = 'active', joined_at = now()
     where forest_id = p_forest_id and user_id = p_user_id and status = 'pending';
  else
    delete from forest_members where forest_id = p_forest_id and user_id = p_user_id and status = 'pending';
  end if;
end;
$$;

-- Owner tool: take someone out. They stay as 'removed' so they can't walk straight back in, and
-- their posts in this forest go with them.
create or replace function public.remove_forest_member(p_forest_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_forest_owner(p_forest_id, auth.uid()) then raise exception 'Only the owner can do that.'; end if;
  if p_user_id = auth.uid() then raise exception 'You can''t remove yourself.'; end if;
  if exists (select 1 from forest_members fm where fm.forest_id = p_forest_id and fm.user_id = p_user_id and fm.role = 'owner') then
    raise exception 'You can''t remove an owner.';
  end if;
  insert into forest_members (forest_id, user_id, role, status) values (p_forest_id, p_user_id, 'member', 'removed')
  on conflict (forest_id, user_id) do update set status = 'removed';
  -- Hard delete: 0131 + 0273's cleanup triggers take the photos with them.
  delete from agora_posts ap where ap.forest_id = p_forest_id and ap.user_id = p_user_id;
end;
$$;

-- Author or forest owner: remove one post from a forest.
create or replace function public.remove_forest_post(p_post_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_post agora_posts;
begin
  select * into v_post from agora_posts ap where ap.id = p_post_id and ap.forest_id is not null;
  if v_post.id is null then raise exception 'That post is gone.'; end if;
  if v_post.user_id <> auth.uid() and not is_forest_owner(v_post.forest_id, auth.uid()) then
    raise exception 'Only the author or the forest owner can remove this.';
  end if;
  delete from agora_posts ap where ap.id = p_post_id;
end;
$$;

-- Post into a forest. Every create_agora_post rule applies; the forest id is stamped on the way in.
drop function if exists public.create_forest_post(uuid, text, text, jsonb);
create function public.create_forest_post(
  p_forest_id uuid,
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
  if forest_status_of(p_forest_id, auth.uid()) is distinct from 'active'
     or not exists (select 1 from forests f where f.id = p_forest_id and f.removed_at is null) then
    raise exception 'Join this forest to post in it.';
  end if;

  perform set_config('philoi.agora_forest_id', p_forest_id::text, true);
  v_id := create_agora_post(p_body, p_photo_path, 'public', null, null, null, p_attachments);
  perform set_config('philoi.agora_forest_id', '', true);
  return v_id;
end;
$$;

-- Start a campfire inside a forest: an ordinary campfire (create_group_with_owner — same owner row,
-- same invite code), pre-linked to the forest.
drop function if exists public.create_campfire_in_forest(uuid, text, text, text, text, text);
create function public.create_campfire_in_forest(
  p_forest_id uuid,
  p_name text,
  p_emoji text,
  p_goal_type text,
  p_cadence text,
  p_privacy text default 'open'
)
returns groups
language plpgsql
security definer
set search_path = public
as $$
declare
  v_f forests;
  v_group groups;
begin
  if forest_status_of(p_forest_id, auth.uid()) is distinct from 'active' then
    raise exception 'Join this forest first.';
  end if;
  select * into v_f from forests f where f.id = p_forest_id and f.removed_at is null;
  if v_f.id is null then raise exception 'That forest is gone.'; end if;

  v_group := create_group_with_owner(p_name, p_emoji, p_goal_type, p_cadence, null, v_f.university, p_privacy);
  update groups set forest_id = p_forest_id where id = v_group.id returning * into v_group;
  return v_group;
end;
$$;

-- Pin a campfire you own to a forest you're in (or unpin it: p_forest_id null). The forest owner can
-- also unpin any campfire from their forest.
create or replace function public.set_campfire_forest(p_group_id uuid, p_forest_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group groups;
begin
  select * into v_group from groups g where g.id = p_group_id;
  if v_group.id is null then raise exception 'That campfire is gone.'; end if;

  if p_forest_id is null then
    if v_group.owner_id <> auth.uid()
       and not (v_group.forest_id is not null and is_forest_owner(v_group.forest_id, auth.uid())) then
      raise exception 'Only the campfire or forest owner can unpin this.';
    end if;
    update groups set forest_id = null where id = p_group_id;
    return;
  end if;

  if v_group.owner_id <> auth.uid() then raise exception 'Only the campfire owner can pin it.'; end if;
  if forest_status_of(p_forest_id, auth.uid()) is distinct from 'active' then raise exception 'Join that forest first.'; end if;
  update groups set forest_id = p_forest_id where id = p_group_id;
end;
$$;

-- A report path on forests themselves (posts and comments already have one). Same table, same
-- reasons, same admin queue.
create or replace function public.report_forest(p_forest_id uuid, p_reason text, p_note text default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if auth.uid() is null then raise exception 'Not signed in.'; end if;
  if not exists (select 1 from forests f where f.id = p_forest_id) then raise exception 'That forest is gone.'; end if;
  insert into moderation_reports (reporter_id, reported_forest_id, reported_user_id, reason, note, reported_content_snapshot)
  select auth.uid(), f.id, f.created_by,
         case when p_reason in ('Spam or misleading', 'Harassment or bullying', 'Inappropriate or offensive content',
                                'Child safety / CSAE', 'Other') then p_reason else 'Other' end,
         left(nullif(btrim(coalesce(p_note, '')), ''), 500),
         jsonb_build_object('kind', 'forest', 'name', f.name, 'purpose', f.purpose, 'tags', to_jsonb(f.tags))
    from forests f where f.id = p_forest_id
  returning id into v_id;
  return v_id;
end;
$$;

-- ──────────────────── 7. seed: official forests so the grid is never empty ────────────────────
insert into forests (name, purpose, emoji, visibility, university, tags, is_official)
select v.name, v.purpose, v.emoji, 'open', v.university, v.tags, true
  from (values
    ('6am Club', 'Locked in before the sun is.', '🌅', null::text, array['morning', 'routine']),
    ('Finals szn', 'Exam season. Nobody grinds alone.', '📚', null, array['study', 'exams']),
    ('Deep Work Club', 'Phone down, head down, hours up.', '🧠', null, array['deep work', 'focus']),
    ('Pre-med grind', 'MCAT, orgo, and the long road to med school.', '🩺', null, array['pre-med', 'study']),
    ('Run club', 'Easy miles, long runs, new PRs.', '🏃', null, array['run', 'cardio']),
    ('Powerlifting @ Laurier', 'Squat, bench, deadlift — Golden Hawks edition.', '🏋️', 'Wilfrid Laurier University', array['gym', 'powerlifting']),
    ('Kin @ Laurier (KP344)', 'Kinesiology at Laurier — your class, one forest.', '🎓', 'Wilfrid Laurier University', array['kinesiology', 'kin', 'kp344'])
  ) as v(name, purpose, emoji, university, tags)
 where not exists (
   select 1 from forests f
    where f.removed_at is null and lower(btrim(f.name)) = lower(v.name)
      and coalesce(f.university, '') = coalesce(v.university, ''));

-- ──────────────────── 8. grants ────────────────────
revoke all on function public.forest_status_of(uuid, uuid) from public, anon, authenticated;
revoke all on function public.can_read_forest(uuid, uuid) from public, anon;
revoke all on function public.is_forest_owner(uuid, uuid) from public, anon, authenticated;
revoke all on function public.forest_locked_in_now(uuid) from public, anon, authenticated;
revoke all on function public.agora_posts_stamp_forest() from public, anon, authenticated;
revoke all on function public.forest_clean_tags(text[]) from public, anon, authenticated;
-- can_read_forest runs inside agora_item_owner, which RLS-free RPCs call as the querying role.
grant execute on function public.can_read_forest(uuid, uuid) to authenticated;

revoke all on function public.get_forests(text, text, integer) from public, anon;
revoke all on function public.get_forest(uuid) from public, anon;
revoke all on function public.get_forest_feed(uuid, timestamptz, uuid, integer) from public, anon;
revoke all on function public.create_forest(text, text, text, text[], text, boolean) from public, anon;
revoke all on function public.join_forest(uuid) from public, anon;
revoke all on function public.leave_forest(uuid) from public, anon;
revoke all on function public.close_forest(uuid) from public, anon;
revoke all on function public.respond_forest_request(uuid, uuid, boolean) from public, anon;
revoke all on function public.remove_forest_member(uuid, uuid) from public, anon;
revoke all on function public.remove_forest_post(uuid) from public, anon;
revoke all on function public.create_forest_post(uuid, text, text, jsonb) from public, anon;
revoke all on function public.create_campfire_in_forest(uuid, text, text, text, text, text) from public, anon;
revoke all on function public.set_campfire_forest(uuid, uuid) from public, anon;
revoke all on function public.report_forest(uuid, text, text) from public, anon;

grant execute on function public.get_forests(text, text, integer) to authenticated;
grant execute on function public.get_forest(uuid) to authenticated;
grant execute on function public.get_forest_feed(uuid, timestamptz, uuid, integer) to authenticated;
grant execute on function public.create_forest(text, text, text, text[], text, boolean) to authenticated;
grant execute on function public.join_forest(uuid) to authenticated;
grant execute on function public.leave_forest(uuid) to authenticated;
grant execute on function public.close_forest(uuid) to authenticated;
grant execute on function public.respond_forest_request(uuid, uuid, boolean) to authenticated;
grant execute on function public.remove_forest_member(uuid, uuid) to authenticated;
grant execute on function public.remove_forest_post(uuid) to authenticated;
grant execute on function public.create_forest_post(uuid, text, text, jsonb) to authenticated;
grant execute on function public.create_campfire_in_forest(uuid, text, text, text, text, text) to authenticated;
grant execute on function public.set_campfire_forest(uuid, uuid) to authenticated;
grant execute on function public.report_forest(uuid, text, text) to authenticated;

-- ──────────────────── assertions ────────────────────
do $assert$
declare
  v_n int;
begin
  -- The global square must not carry forest posts.
  if (select prosrc from pg_proc where oid = 'public.get_agora_feed(text,timestamptz,uuid,integer)'::regprocedure)
     !~ 'ap\.forest_id is null' then
    raise exception '0274: get_agora_feed does not exclude forest posts';
  end if;
  if (select prosrc from pg_proc where oid = 'public.agora_item_owner(uuid,uuid)'::regprocedure)
     !~ 'can_read_forest' then
    raise exception '0274: agora_item_owner does not gate forest posts';
  end if;
  if (select prosrc from pg_proc where oid = 'public.notify_friends_agora_post()'::regprocedure)
     !~ 'new\.forest_id is not null' then
    raise exception '0274: notify_friends_agora_post still pings for forest posts';
  end if;
  if exists (select 1 from information_schema.role_table_grants
              where table_schema = 'public' and table_name in ('forests', 'forest_members')
                and grantee in ('anon', 'authenticated')) then
    raise exception '0274: forests tables must be RPC-only';
  end if;
  select count(*) into v_n from forests where is_official and removed_at is null;
  if v_n < 7 then raise exception '0274: expected the 7 official forests, got %', v_n; end if;
  -- One signature per name — nothing here added an overload.
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public'
                and p.proname in ('get_agora_feed', 'get_agora_item', 'agora_item_owner', 'create_agora_post')
              group by p.proname having count(*) > 1) then
    raise exception '0274: an Agora function now has two overloads';
  end if;
end;
$assert$;
