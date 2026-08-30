-- The Agora, multimedia — a post carries a photo AND a lock-in AND an achievement, together.
--
-- Mock 162 scoped Photo / Achievement / Lock-in as COMBINABLE media on one post. 0128 shipped a
-- single attachment triple (attach_kind, attach_ref_id, attach_key) with one frozen snapshot, and
-- the composer enforced the same exclusivity on top of it: picking a reward deleted the photo you
-- had just chosen. That is what this migration undoes.
--
-- 🔒 Firewall (0128's header): reads and one insert. Nothing here moves currency.
--
-- SHAPE. `agora_posts.attachments` is a jsonb ARRAY of
--     { kind, ref_id, key, snapshot }
-- where `snapshot` is exactly what agora_attachment_snapshot() already returns for that kind. The
-- array is the source of truth on the read path; the 0128 single-attachment columns are kept in
-- step with element [0] so that
--   (a) `agora_posts_not_empty` — which tests attach_kind — still means what it says, and
--   (b) a build that predates this migration keeps rendering the post's first attachment rather
--       than an empty card. There is no OTA for those builds (runtimeVersion is still sdkVersion),
--       so "the old client keeps working" is a hard requirement here, not a courtesy.

-- ───────────────────────────── the column ─────────────────────────────

alter table agora_posts
  add column if not exists attachments jsonb not null default '[]'::jsonb;

do $$
begin
  alter table agora_posts
    add constraint agora_posts_attachments_is_array check (jsonb_typeof(attachments) = 'array');
exception
  when duplicate_object then null;
end;
$$;

comment on column agora_posts.attachments is
  'Frozen attachments as an ordered array of {kind, ref_id, key, snapshot} — see 0140. Source of '
  'truth; attach_kind/attach_ref_id/attach_key/attach_snapshot mirror element [0] for back-compat.';

-- Every post written before this migration: fold its single attachment into the array so the read
-- path has exactly one shape to think about.
update agora_posts
set attachments = jsonb_build_array(jsonb_build_object(
      'kind', attach_kind,
      'ref_id', attach_ref_id,
      'key', attach_key,
      'snapshot', coalesce(attach_snapshot, '{}'::jsonb)))
where attach_kind is not null
  and jsonb_array_length(attachments) = 0;

/**
 * The read-path normaliser: one array, whatever the row was written by.
 *
 * Belt and braces on top of the backfill above. A row could still arrive with an empty array and a
 * populated legacy triple — an old build calling the legacy branch of create_agora_post below, or a
 * restored backup taken before this ran — and a feed that rendered those as attachment-less would
 * be silently dropping the whole point of the post.
 *
 * No SET search_path, deliberately: it references no tables and no schema-qualified anything, and a
 * function with a SET clause cannot be inlined by the planner — which this one wants to be, since
 * it is evaluated per row of every feed page.
 */
create or replace function agora_attachments_json(
  p_attachments jsonb,
  p_kind text,
  p_ref_id uuid,
  p_key text,
  p_snapshot jsonb
)
returns jsonb
language sql
immutable
as $$
  select case
    when jsonb_typeof(p_attachments) = 'array' and jsonb_array_length(p_attachments) > 0
      then p_attachments
    when p_kind is null
      then '[]'::jsonb
    else jsonb_build_array(jsonb_build_object(
      'kind', p_kind, 'ref_id', p_ref_id, 'key', p_key,
      'snapshot', coalesce(p_snapshot, '{}'::jsonb)))
  end;
$$;

-- Same posture as agora_attachment_snapshot (0130): the feed reads call it from inside SECURITY
-- DEFINER bodies, so the owner's own execute right is the only one it needs.
revoke all on function agora_attachments_json(jsonb, text, uuid, text, jsonb) from public, authenticated;

-- ───────────────────────────── posting ─────────────────────────────

/**
 * Post to the Agora, with any combination of {photo, lock-in, achievement}.
 *
 * DROP-then-CREATE rather than CREATE OR REPLACE: appending `p_attachments` changes the argument
 * list, and Postgres will not replace a function through that — it would quietly leave the 6-arg
 * one standing beside a new 7-arg overload, and PostgREST would then have two candidates to
 * resolve a post against.
 *
 * The new parameter is LAST and defaulted, so a build that predates this migration keeps calling
 * the same function with the same six named arguments and keeps working. That path is not dead
 * code — there is no OTA channel for those installs (runtimeVersion is still sdkVersion), so they
 * post through the legacy branch below until they are replaced by a store build.
 *
 * Ownership is re-verified PER ATTACHMENT. agora_attachment_snapshot re-reads each fact from the
 * table that owns it scoped to auth.uid() and returns null when the row is not the caller's, and
 * every null raises here. A crafted call listing somebody else's relic alongside your own lock-in
 * fails the whole post rather than landing with the half it was entitled to — 0130's argument, now
 * applied element by element: a composer that showed an attachment and then posted without it is
 * worse than an error, because the poster never finds out.
 *
 * Still raises rather than silently dropping. Still refuses a photo path outside the caller's own
 * storage prefix. Still grants to `authenticated` only.
 */
drop function if exists create_agora_post(text, text, text, text, uuid, text);

create or replace function create_agora_post(
  p_body text default null,
  p_photo_path text default null,
  p_visibility text default 'campus',
  p_attach_kind text default null,
  p_attach_ref_id uuid default null,
  p_attach_key text default null,
  p_attachments jsonb default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_body text := nullif(btrim(coalesce(p_body, '')), '');
  v_input jsonb;
  v_entry jsonb;
  v_kind text;
  v_ref_id uuid;
  v_key text;
  v_snapshot jsonb;
  v_seen text[] := '{}';
  v_out jsonb := '[]'::jsonb;
  v_id uuid;
begin
  if v_user is null then raise exception 'Not signed in.'; end if;

  -- Two callers, one body. The current composer sends the array and leaves the 0128 triple null;
  -- an older build sends the triple and no array. Folding the legacy shape into the array HERE,
  -- rather than keeping a second function for it, is what stops the two ownership checks drifting.
  if p_attachments is null
     or jsonb_typeof(p_attachments) <> 'array'
     or jsonb_array_length(p_attachments) = 0 then
    v_input := case
      when p_attach_kind is null then '[]'::jsonb
      else jsonb_build_array(jsonb_build_object(
        'kind', p_attach_kind, 'ref_id', p_attach_ref_id, 'key', p_attach_key))
    end;
  else
    v_input := p_attachments;
  end if;

  if v_body is null and p_photo_path is null and jsonb_array_length(v_input) = 0 then
    raise exception 'Write something, add a photo, or attach an achievement.';
  end if;

  -- Bounded before the loop, not by it. One-per-kind already caps this at the seven kinds that
  -- exist, but checking up front means a padded payload costs one comparison instead of a
  -- thousand ownership lookups.
  if jsonb_array_length(v_input) > 7 then
    raise exception 'Too many attachments on one post.';
  end if;

  -- The path must live under the poster's own prefix. The storage policy already enforces this on
  -- the upload; re-checking here stops a crafted RPC call from pointing a post at somebody else's
  -- image after the fact.
  if p_photo_path is not null and split_part(p_photo_path, '/', 1) <> v_user::text then
    raise exception 'That photo is not yours.';
  end if;

  for v_entry in select value from jsonb_array_elements(v_input) loop
    v_kind := nullif(btrim(coalesce(v_entry->>'kind', '')), '');
    if v_kind is null then
      raise exception 'That attachment has no kind.';
    end if;

    -- At most one of each. Two lock-ins or two relics on one card is the collage the single-slot
    -- design was guarding against; a photo AND a lock-in AND a reward is the thing mock 162 asked
    -- for. This is the line between them.
    if v_kind = any (v_seen) then
      raise exception 'Only one % attachment per post.', v_kind;
    end if;
    v_seen := v_seen || v_kind;

    v_ref_id := nullif(btrim(coalesce(v_entry->>'ref_id', '')), '')::uuid;
    v_key := nullif(btrim(coalesce(v_entry->>'key', '')), '');

    -- Per-element ownership. An unknown kind falls through the snapshot's ELSE to null and lands
    -- here too, so this one check covers both "not yours" and "not a thing".
    v_snapshot := agora_attachment_snapshot(v_user, v_kind, v_ref_id, v_key);
    if v_snapshot is null then
      raise exception 'That achievement is not yours to post.';
    end if;

    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'kind', v_kind, 'ref_id', v_ref_id, 'key', v_key, 'snapshot', v_snapshot));
  end loop;

  insert into agora_posts (
    user_id, body, photo_path, visibility,
    attach_kind, attach_ref_id, attach_key, attach_snapshot, attachments
  )
  values (
    v_user,
    left(v_body, 1000),
    p_photo_path,
    coalesce(p_visibility, 'campus'),
    -- Element [0] mirrored into 0128's columns: `agora_posts_not_empty` tests attach_kind, and a
    -- pre-0140 build reads attach_snapshot. Both keep meaning what they meant.
    v_out->0->>'kind',
    nullif(v_out->0->>'ref_id', '')::uuid,
    nullif(v_out->0->>'key', ''),
    coalesce(v_out->0->'snapshot', '{}'::jsonb),
    v_out
  )
  returning id into v_id;

  -- Nothing follows. No grant_reward, no notify_event fan-out to a campus. The Agora's delivery
  -- model is PULL — people open the square and see what is in it — and blasting a push for every
  -- post is precisely how the notification channel gets muted (0129's note). The author's friends
  -- still get the direct milestone ping from 0093 for real accomplishments; that is the spec's
  -- "complements notifications", and it is enough.
  return v_id;
end;
$$;

grant execute on function create_agora_post(text, text, text, text, uuid, text, jsonb) to authenticated;

-- ───────────────────────────── the feed ─────────────────────────────

/**
 * Same query as 0130, plus one column: `attachments`, the whole array.
 *
 * DROP-then-CREATE for the same reason as above — RETURNS TABLE is part of the signature, and a
 * column cannot be added to one in place. The body below is 0130's, verbatim apart from the two
 * splices marked `-- 0140`; nothing else about who sees what has changed, and this file must not
 * become a second, drifting statement of that rule.
 *
 * `attach_kind` and `attach_snapshot` STAY in the result. They are element [0] restated, and a
 * pre-0140 build reads exactly those two and ignores the column it has never heard of.
 */
drop function if exists get_agora_feed(text, timestamptz, uuid, int);

create or replace function get_agora_feed(
  p_scope text default 'friends',
  p_before_at timestamptz default null,
  p_before_id uuid default null,
  p_limit int default 20
)
returns table (
  item_type text,
  id uuid,
  user_id uuid,
  display_name text,
  handle text,
  avatar_url text,
  university text,
  /**
   * The author's standing, already resolved to (tier, division).
   *
   * NOT a bare rank_index. The ladder's shape — which tiers exist, how many divisions each has,
   * that Primordial has none — is `rank_thresholds`, and handing the client an index would have
   * forced a second copy of that table into TypeScript to turn 11 into "Hero II". One join here
   * is cheaper than a duplicate ladder that silently goes stale the next time a tier is added.
   */
  rank_tier text,
  rank_division int,
  visibility text,
  body text,
  photo_path text,
  /** Element [0] of `attachments`, kept for builds that predate 0140. */
  attach_kind text,
  attach_snapshot jsonb,
  /** Every frozen attachment on the post, in the order it was composed. See 0140. */
  attachments jsonb,
  cheers bigint,
  cheered boolean,
  comments bigint,
  created_at timestamptz
)
language sql
security definer
set search_path = public
stable
as $$
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
  left join user_rank_state urs on urs.user_id = i.user_id
  left join rank_thresholds rt on rt.rank_index = urs.rank_index
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
$$;

grant execute on function get_agora_feed(text, timestamptz, uuid, int) to authenticated;

-- ───────────────────────────── the permalink ─────────────────────────────

/**
 * Same item, plus `attachments` — 0130's body with one key added to each half of the union.
 *
 * A plain CREATE OR REPLACE here, unlike the two above: the return type is jsonb and the argument
 * list is untouched, so there is no signature to change. That is the reason 0130 chose jsonb over
 * a second RETURNS TABLE kept column-for-column in step with the feed's — this migration is what
 * that choice was for.
 */
create or replace function get_agora_item(p_id uuid, p_item_type text default 'post')
returns jsonb
language sql
security definer
set search_path = public
stable
as $$
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
  left join user_rank_state urs on urs.user_id = ap.user_id
  left join rank_thresholds rt on rt.rank_index = urs.rank_index
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
  left join user_rank_state urs on urs.user_id = m.user_id
  left join rank_thresholds rt on rt.rank_index = urs.rank_index
  where p_item_type = 'milestone'
    and m.id = p_id
    and can_see_agora(m.user_id, m.visibility, auth.uid())
    and not is_blocked_either_way(m.user_id);
$$;

grant execute on function get_agora_item(uuid, text) to authenticated;
