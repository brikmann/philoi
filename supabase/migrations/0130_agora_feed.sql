-- The Agora, part 3 of 3 — the feed itself, plus the two pickers the composer attaches from.
--
-- AGORA_SPEC "Build notes (mostly reuse)": "The Agora is a feed query over milestones + user posts
-- with the three filters (friends = friend graph; university = profiles.university match; all =
-- public), newest-first, paginated." That query is get_agora_feed() below, and it is the only
-- place in the app that decides who sees what in the town square.
--
-- 🔒 Firewall (0128's header): reads only. Nothing here moves currency.

-- ───────────────────────────── the attachment snapshot ─────────────────────────────

/**
 * Freeze what the caller may attach to a post, and verify they own it.
 *
 * The rule this exists to enforce: THE CLIENT SENDS WHICH ACHIEVEMENT, NEVER WHAT IT SAYS. Every
 * branch below re-reads the fact from the table that owns it, scoped to auth.uid(), and returns
 * null if the row is not the caller's. A composer that could post its own snapshot could post
 * "Mythic relic · 1,000 lb club" without owning either, and the Agora's whole value — an audience
 * that believes what it sees — is gone the first time that happens.
 *
 * What lands in the jsonb is FACTS, not display strings: rank_index rather than "Hero II",
 * pass_xp rather than "Level 42", cosmetic_key rather than "Atlas' Burden". The catalog, the rank
 * tier names and the pass curve all live client-side (src/lib/economy/catalog, rank-tiers,
 * forge-pass), and duplicating any of them in SQL would guarantee two spellings of the same item.
 * Freezing the fact still gets the property that matters — 0093's argument about milestone effort
 * receipts — because "Hero II" is derived from a rank_index that will not change on this row.
 *
 * NOT granted to authenticated: create_agora_post is its only caller and passes auth.uid()'s own
 * ids by construction.
 */
create or replace function agora_attachment_snapshot(
  p_user uuid,
  p_kind text,
  p_ref_id uuid,
  p_key text
)
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v jsonb;
begin
  if p_kind is null then return null; end if;

  case p_kind

    when 'milestone' then
      -- Someone else's milestone is not yours to re-post as your own achievement. Sharing one
      -- with a caption is the same row appearing in the feed on its own; this branch is the
      -- author quoting their own.
      select jsonb_build_object(
        'milestone_id', m.id, 'kind', m.kind, 'headline', m.headline,
        'note', m.note, 'effort', m.effort
      ) into v
      from milestones m where m.id = p_ref_id and m.user_id = p_user;

    when 'lockin' then
      select jsonb_build_object(
        'check_in_id', c.id, 'goal_type', c.goal_type, 'goal_label', c.goal_label,
        'goal_detail', c.goal_detail, 'duration_seconds', c.duration_seconds,
        'distance_m', c.distance_m, 'completed_at', c.created_at
      ) into v
      from check_ins c
      where c.id = p_ref_id and c.user_id = p_user
        and c.duration_seconds is not null and c.removed_at is null;

    when 'rank' then
      -- No ref id: your standing is a single row of live state. tier/division come from
      -- rank_thresholds so the numeral on the card is the server's, not a client guess at the
      -- ladder's shape.
      select jsonb_build_object('rank_index', urs.rank_index, 'tier', rt.tier, 'division', rt.division)
      into v
      from user_rank_state urs
      join rank_thresholds rt on rt.rank_index = urs.rank_index
      where urs.user_id = p_user;

    when 'streak' then
      select jsonb_build_object('days', p.current_streak, 'longest', p.longest_streak) into v
      from profiles p where p.id = p_user and p.current_streak > 0;

    when 'pass' then
      -- pass_xp, not a level: the level curve is client-side (levelFromXp). Same number, one
      -- definition.
      select jsonb_build_object('season_id', fps.season_id, 'pass_xp', fps.pass_xp,
                                'owns_premium', fps.owns_premium)
      into v
      from forge_pass_state fps
      where fps.user_id = p_user
      order by fps.season_id desc
      limit 1;

    when 'cosmetic' then
      select jsonb_build_object(
        'cosmetic_key', co.cosmetic_key, 'slot', co.slot, 'source', co.source,
        'provenance', co.provenance, 'rarity_override', co.rarity_override,
        'season_stamp', co.season_stamp, 'acquired_at', co.acquired_at
      ) into v
      from cosmetics_owned co where co.user_id = p_user and co.cosmetic_key = p_key;

    when 'pr' then
      select jsonb_build_object(
        'exercise', e.name, 'weight', pr.weight, 'reps', pr.reps,
        'e1rm', pr.e1rm, 'achieved_at', pr.achieved_at
      ) into v
      from personal_records pr
      join exercises e on e.id = pr.exercise_id
      where pr.id = p_ref_id and pr.user_id = p_user;

    else
      v := null;
  end case;

  return v;
end;
$$;

revoke all on function agora_attachment_snapshot(uuid, text, uuid, text) from public, authenticated;

-- ───────────────────────────── posting ─────────────────────────────

/**
 * Post to the Agora.
 *
 * `p_photo_path` is a storage path the client has already uploaded under its own id prefix (the
 * bucket policy in 0128 is what stops it being anyone else's). It is stored, never trusted as a
 * URL — the feed hands back the path and the client resolves it against the public bucket.
 *
 * Raises rather than silently dropping an attachment the caller does not own: a composer that
 * showed "Atlas' Burden" attached and then posted without it is a worse outcome than an error,
 * because the poster does not find out.
 */
create or replace function create_agora_post(
  p_body text default null,
  p_photo_path text default null,
  p_visibility text default 'campus',
  p_attach_kind text default null,
  p_attach_ref_id uuid default null,
  p_attach_key text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_body text := nullif(btrim(coalesce(p_body, '')), '');
  v_snapshot jsonb;
  v_id uuid;
begin
  if v_user is null then raise exception 'Not signed in.'; end if;
  if v_body is null and p_photo_path is null and p_attach_kind is null then
    raise exception 'Write something, add a photo, or attach an achievement.';
  end if;

  -- The path must live under the poster's own prefix. The storage policy already enforces this on
  -- the upload; re-checking here stops a crafted RPC call from pointing a post at somebody else's
  -- image after the fact.
  if p_photo_path is not null and split_part(p_photo_path, '/', 1) <> v_user::text then
    raise exception 'That photo is not yours.';
  end if;

  if p_attach_kind is not null then
    v_snapshot := agora_attachment_snapshot(v_user, p_attach_kind, p_attach_ref_id, p_attach_key);
    if v_snapshot is null then
      raise exception 'That achievement is not yours to post.';
    end if;
  end if;

  insert into agora_posts (
    user_id, body, photo_path, visibility, attach_kind, attach_ref_id, attach_key, attach_snapshot
  )
  values (
    v_user,
    left(v_body, 1000),
    p_photo_path,
    coalesce(p_visibility, 'campus'),
    p_attach_kind,
    p_attach_ref_id,
    p_attach_key,
    coalesce(v_snapshot, '{}'::jsonb)
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

grant execute on function create_agora_post(text, text, text, text, uuid, text) to authenticated;

/** Delete your own post. Cascades its cheers and comments. Storage cleanup is the client's. */
create or replace function delete_agora_post(p_id uuid)
returns text
language sql
security definer
set search_path = public
as $$
  -- Returns the photo path so the caller can remove the object it just orphaned.
  delete from agora_posts ap where ap.id = p_id and ap.user_id = auth.uid()
  returning ap.photo_path;
$$;

grant execute on function delete_agora_post(uuid) to authenticated;

-- ───────────────────────────── the feed ─────────────────────────────

/**
 * The town square, at one of four reach dials.
 *
 *   friends    — the accepted friend graph. Intimate, always relevant.
 *   campfires  — anyone you share a campfire with. (The spec's "optional later"; mock 162 ships
 *                the chip, and it is one branch here.)
 *   university — everyone at your school. Where reach and school pride live.
 *   global     — everything, across campuses. The firehose, opt-in.
 *
 * THE SCOPE ONLY EVER NARROWS. Every row, at every scope including 'global', must still pass
 * can_see_agora() — the author's own friends/campus/public choice. That ordering is the whole of
 * the spec's privacy section: picking "Global" is a request to see MORE of what you are already
 * entitled to, never a way to see something its author published narrower. A friends-only post
 * therefore never appears under University even to a classmate, and a campus post never appears
 * under Global to somebody at another school.
 *
 * Pagination is a keyset on (created_at, id), not an offset. The feed is a UNION of two tables
 * whose rows interleave by time; an OFFSET over that re-reads and re-sorts everything above the
 * cursor on every page, and drops or duplicates rows as new posts land at the top mid-scroll.
 *
 * Returns display columns for the author (name/handle/avatar/university/rank) so the card
 * renders in one round trip. The equipped halo/card the cards wear on top is a separate batched
 * read the client already has (usePublicLoadouts) — deliberately not joined in here, since it is
 * per-slot rows and would fan this query out by a factor of the loadout size.
 */
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
  attach_kind text,
  attach_snapshot jsonb,
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
  -- created_at, university…) shadow the identically-named columns on agora_posts, milestones and
  -- profiles inside this body, and an unqualified one silently resolves to the OUT parameter —
  -- which is null on every row.
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

/**
 * One feed item, for the permalink a cheer/comment notification opens.
 *
 * Takes the item TYPE as well as the id, and answers for both — a comment can hang off a milestone
 * just as easily as off a post, and routing those notifications at /milestone/[id] instead would
 * land the reader on a screen with no comments on it, which is a dead end from a ping that
 * explicitly said somebody had said something.
 *
 * jsonb rather than a second RETURNS TABLE that would have to be kept column-for-column in step
 * with get_agora_feed's — the client renders both through the same card, so the shapes matching is
 * load-bearing, and a single object is the cheaper way to guarantee it.
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

-- ───────────────────────────── the composer's pickers ─────────────────────────────

/**
 * Everything the caller has earned, as one list (mock 162 panel 4 — "literally anything you've
 * earned or posted: rank, streaks, any collectible, any grade / milestone, any fitness period").
 *
 * One RPC rather than the six round trips its six sections would otherwise be: the picker is a
 * single sheet that opens all at once, and a per-section fetch would have it filling in in pieces.
 *
 * `facts` carries the same server-owned values agora_attachment_snapshot would freeze, so the
 * picker row and the posted card are rendered by the same client code from the same numbers —
 * there is no second formatting path that could disagree with what actually gets posted.
 */
create or replace function get_agora_achievements()
returns table (
  kind text,
  ref_id uuid,
  item_key text,
  section text,
  facts jsonb,
  sort_at timestamptz
)
language sql
security definer
set search_path = public
stable
as $$
  -- Standing: live state, no ref id.
  select 'rank'::text, null::uuid, null::text, 'standing'::text,
         jsonb_build_object('rank_index', urs.rank_index, 'tier', rt.tier, 'division', rt.division),
         urs.updated_at
  from user_rank_state urs
  join rank_thresholds rt on rt.rank_index = urs.rank_index
  where urs.user_id = auth.uid()

  union all
  select 'pass', null, null, 'standing',
         jsonb_build_object('season_id', fps.season_id, 'pass_xp', fps.pass_xp,
                            'owns_premium', fps.owns_premium),
         now()
  from forge_pass_state fps
  where fps.user_id = auth.uid() and fps.pass_xp > 0

  union all
  select 'streak', null, null, 'standing',
         jsonb_build_object('days', p.current_streak, 'longest', p.longest_streak),
         now()
  from profiles p
  where p.id = auth.uid() and p.current_streak > 0

  union all
  -- Collectibles. The key is the identity; the client's catalog turns it into a name, an icon and
  -- a rarity, which is where those already live for the shop, inventory and trophy hall.
  select 'cosmetic', null, co.cosmetic_key, 'collectibles',
         jsonb_build_object('cosmetic_key', co.cosmetic_key, 'slot', co.slot, 'source', co.source,
                            'provenance', co.provenance, 'rarity_override', co.rarity_override,
                            'season_stamp', co.season_stamp, 'acquired_at', co.acquired_at),
         co.acquired_at
  from cosmetics_owned co
  where co.user_id = auth.uid()

  union all
  -- Grades & milestones. Unpinned ones included: 0093 defines unpinned as "not on the profile",
  -- and the author choosing to bring one into the square now is exactly the composer's job.
  select 'milestone', m.id, null, 'milestones',
         jsonb_build_object('milestone_id', m.id, 'kind', m.kind, 'headline', m.headline,
                            'note', m.note, 'effort', m.effort),
         m.created_at
  from milestones m
  where m.user_id = auth.uid()

  union all
  -- Fitness. personal_records is one row per lift (unique on user+exercise), so this is already
  -- "your PRs" rather than a history to dedupe.
  select 'pr', pr.id, null, 'fitness',
         jsonb_build_object('exercise', e.name, 'weight', pr.weight, 'reps', pr.reps,
                            'e1rm', pr.e1rm, 'achieved_at', pr.achieved_at),
         pr.achieved_at
  from personal_records pr
  join exercises e on e.id = pr.exercise_id
  where pr.user_id = auth.uid()

  order by 6 desc nulls last;
$$;

grant execute on function get_agora_achievements() to authenticated;

/** Mock 162 panel 5 — "pick a completed session from your history." Yours, finished, not removed. */
create or replace function get_agora_lockins(p_limit int default 40)
returns table (
  id uuid,
  goal_type text,
  goal_label text,
  goal_detail text,
  duration_seconds int,
  distance_m numeric,
  completed_at timestamptz
)
language sql
security definer
set search_path = public
stable
as $$
  select c.id, c.goal_type, c.goal_label, c.goal_detail, c.duration_seconds, c.distance_m, c.created_at
  from check_ins c
  where c.user_id = auth.uid()
    and c.duration_seconds is not null
    and c.removed_at is null
  order by c.created_at desc
  limit least(greatest(p_limit, 1), 100);
$$;

grant execute on function get_agora_lockins(int) to authenticated;
