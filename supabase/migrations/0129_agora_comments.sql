-- The Agora, part 2 of 3 — cheers and comments (AGORA_SPEC.md "Cheer + discuss").
--
-- "Each item takes cheers (the positive reaction) and comments for actual conversation. This is
-- the 'gather and talk' part." A feed you can only scroll is a notification list with extra steps;
-- the discussion is the half that makes it a square.
--
-- 🔒 Firewall (0128's header): nothing here moves currency. Cheering and commenting pay out
-- nothing to either side, which is also what keeps them from being farmed.

-- ───────────────────────────── who may touch an item ─────────────────────────────

/**
 * Resolve an Agora feed item — post OR milestone — to its author, audience and headline.
 *
 * Exactly one of the two ids is expected. Every write path below (cheer, comment) needs the same
 * three facts about the same two row types, and the alternative to this function is that same
 * two-branch lookup copy-pasted into each of them — which is how one branch eventually forgets
 * the visibility check.
 *
 * NOT granted to authenticated: it answers "who wrote this and at what audience" for an arbitrary
 * id, without checking whether the caller may see it. Its callers are SECURITY DEFINER and check.
 */
create or replace function agora_item_owner(p_post_id uuid, p_milestone_id uuid)
returns table (owner_id uuid, visibility text, headline text)
language sql
security definer
set search_path = public
stable
as $$
  select ap.user_id, ap.visibility, left(coalesce(nullif(btrim(ap.body), ''), 'their post'), 90)
  from agora_posts ap
  where p_post_id is not null and ap.id = p_post_id
  union all
  -- `in_agora` is not consulted here. Opting a milestone out of the FEED hides it from the town
  -- square; it does not retract the permalink that a friend's bell notification already opened,
  -- and it must not silently break cheering on a card someone is looking at.
  select m.user_id, m.visibility, m.headline
  from milestones m
  where p_milestone_id is not null and m.id = p_milestone_id;
$$;

revoke all on function agora_item_owner(uuid, uuid) from public, authenticated;

-- ───────────────────────────── cheering a post ─────────────────────────────

/**
 * Cheer a freeform post. The milestone twin is 0093's cheer_milestone(), which this deliberately
 * does not try to absorb — that function is live, its notification copy is milestone-specific, and
 * a merged "cheer anything" RPC would have been a rewrite of shipped behaviour for no gain. The
 * client dispatches on item type; the feed reports one merged count either way.
 *
 * Returns the new cheer count so the card updates without a refetch.
 */
create or replace function cheer_agora_post(p_post_id uuid)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner uuid;
  v_visibility text;
  v_headline text;
  v_name text;
  v_avatar text;
  v_count int;
begin
  if auth.uid() is null then raise exception 'Not signed in.'; end if;

  select o.owner_id, o.visibility, o.headline into v_owner, v_visibility, v_headline
  from agora_item_owner(p_post_id, null) o;
  if v_owner is null then raise exception 'That post is gone.'; end if;
  if not can_see_agora(v_owner, v_visibility, auth.uid()) then raise exception 'Not visible to you.'; end if;
  if is_blocked_either_way(v_owner) then raise exception 'Not visible to you.'; end if;

  insert into agora_post_cheers (post_id, user_id) values (p_post_id, auth.uid())
  on conflict (post_id, user_id) do nothing;

  -- Only the FIRST cheer from this person notifies. A repeat tap is a no-op insert and must not
  -- re-ping the author (0093's rule, same reason).
  if found and v_owner <> auth.uid() then
    select p.display_name, p.avatar_url into v_name, v_avatar from profiles p where p.id = auth.uid();
    perform notify_event(
      array[v_owner],
      'agora_cheered',
      '🎉 ' || coalesce(v_name, 'Someone') || ' cheered your post.',
      v_headline,
      auth.uid(),
      p_post_id,
      '/agora/[id]',
      -- `type` alongside the id: the permalink serves both row types, and it reads the id out of
      -- whichever table this says. Explicit here even though 'post' is the default, so the two
      -- notification paths in this file don't look like they disagree.
      jsonb_build_object('id', p_post_id::text, 'type', 'post'),
      v_avatar,
      'circle'
    );
  end if;

  select count(*) into v_count from agora_post_cheers apc where apc.post_id = p_post_id;
  return v_count;
end;
$$;

grant execute on function cheer_agora_post(uuid) to authenticated;

-- ───────────────────────────── comments ─────────────────────────────

/**
 * One comment table for both feed item types, rather than agora_post_comments plus
 * milestone_comments. The Agora renders one card shape over two row types and the comments sheet
 * is part of that card — splitting the table would mean every read, every count and every
 * moderation query existed twice, forever, to say the same thing.
 */
create table if not exists agora_comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid references agora_posts (id) on delete cascade,
  milestone_id uuid references milestones (id) on delete cascade,
  user_id uuid not null references profiles (id) on delete cascade,
  body text not null check (char_length(btrim(body)) between 1 and 500),
  /**
   * Soft delete, exactly as `messages` does it (schema.sql): a hard delete would destroy the
   * evidence behind any pending report on this comment, which is the one thing a moderation
   * queue cannot recover.
   */
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  -- Exactly one parent. A comment on both, or on neither, is not a thing that can be rendered.
  constraint agora_comments_one_parent check (num_nonnulls(post_id, milestone_id) = 1)
);

create index if not exists agora_comments_post_idx on agora_comments (post_id, created_at) where post_id is not null;
create index if not exists agora_comments_milestone_idx on agora_comments (milestone_id, created_at) where milestone_id is not null;

alter table agora_comments enable row level security;

-- Own-rows-only, same shape as agora_posts: the visibility of a comment is the visibility of the
-- item it hangs off, which RLS on this table cannot see. get_agora_comments() is the read path.
drop policy if exists agora_comments_own on agora_comments;
create policy agora_comments_own on agora_comments
  for select to authenticated using (user_id = auth.uid());

/**
 * Post a comment.
 *
 * Notifies the item's author (not other commenters — a thread notification model on a feed this
 * broad is how the bell becomes noise, and the spec is explicit about not training people to mute
 * us). Blocking is enforced in both directions before the row is written, so a blocked user cannot
 * reach someone's post through the comment box after being removed from everywhere else.
 */
create or replace function add_agora_comment(
  p_post_id uuid default null,
  p_milestone_id uuid default null,
  p_body text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner uuid;
  v_visibility text;
  v_headline text;
  v_name text;
  v_avatar text;
  v_body text := btrim(coalesce(p_body, ''));
  v_id uuid;
begin
  if auth.uid() is null then raise exception 'Not signed in.'; end if;
  if v_body = '' then raise exception 'Write something first.'; end if;
  if num_nonnulls(p_post_id, p_milestone_id) <> 1 then raise exception 'Comment on one thing.'; end if;

  select o.owner_id, o.visibility, o.headline into v_owner, v_visibility, v_headline
  from agora_item_owner(p_post_id, p_milestone_id) o;
  if v_owner is null then raise exception 'That post is gone.'; end if;
  if not can_see_agora(v_owner, v_visibility, auth.uid()) then raise exception 'Not visible to you.'; end if;
  if is_blocked_either_way(v_owner) then raise exception 'Not visible to you.'; end if;

  insert into agora_comments (post_id, milestone_id, user_id, body)
  values (p_post_id, p_milestone_id, auth.uid(), left(v_body, 500))
  returning id into v_id;

  if v_owner <> auth.uid() then
    select p.display_name, p.avatar_url into v_name, v_avatar from profiles p where p.id = auth.uid();
    perform notify_event(
      array[v_owner],
      'agora_commented',
      coalesce(v_name, 'Someone') || ' commented on your post.',
      left(v_body, 140),
      auth.uid(),
      coalesce(p_post_id, p_milestone_id),
      -- Both types land on the Agora permalink, which renders the card AND the thread. Sending a
      -- milestone comment to /milestone/[id] would drop the reader on a screen with no comments
      -- on it — a dead end from a ping that said somebody had said something.
      '/agora/[id]',
      jsonb_build_object(
        'id', coalesce(p_post_id, p_milestone_id)::text,
        'type', case when p_post_id is not null then 'post' else 'milestone' end
      ),
      v_avatar,
      'circle'
    );
  end if;

  return v_id;
end;
$$;

grant execute on function add_agora_comment(uuid, uuid, text) to authenticated;

/**
 * A thread, oldest-first — conversation order, not feed order.
 *
 * Blocked people are dropped here rather than client-side: a `.not('user_id','in',...)` filter is
 * the exact pattern schema.sql's messages policy was rewritten to stop trusting, because a direct
 * API call walks straight past it.
 */
create or replace function get_agora_comments(
  p_post_id uuid default null,
  p_milestone_id uuid default null,
  p_limit int default 100
)
returns table (
  id uuid,
  user_id uuid,
  display_name text,
  handle text,
  avatar_url text,
  body text,
  is_mine boolean,
  created_at timestamptz
)
language sql
security definer
set search_path = public
stable
as $$
  -- Every column is alias-qualified: RETURNS TABLE's names shadow same-named table columns inside
  -- the body, so a bare `body` here would resolve to the OUT parameter and return nulls.
  select
    c.id,
    c.user_id,
    p.display_name,
    p.handle,
    p.avatar_url,
    c.body,
    c.user_id = auth.uid(),
    c.created_at
  from agora_comments c
  join profiles p on p.id = c.user_id
  where c.deleted_at is null
    and (
      (p_post_id is not null and c.post_id = p_post_id)
      or (p_milestone_id is not null and c.milestone_id = p_milestone_id)
    )
    -- The thread is only readable if the ITEM is. Re-checked per read rather than trusted from
    -- whatever screen called: a permalink id is guessable in a way a feed row is not.
    and exists (
      select 1 from agora_item_owner(p_post_id, p_milestone_id) o
      where can_see_agora(o.owner_id, o.visibility, auth.uid())
    )
    and not exists (
      select 1 from blocked_users b
      where (b.blocker_id = auth.uid() and b.blocked_id = c.user_id)
         or (b.blocker_id = c.user_id and b.blocked_id = auth.uid())
    )
  order by c.created_at
  limit least(greatest(p_limit, 1), 200);
$$;

grant execute on function get_agora_comments(uuid, uuid, int) to authenticated;

/**
 * Delete a comment. Yours, or anything on an item you authored — the "hide" half of the spec's
 * "report/hide + block". Someone whose post attracts a comment they do not want on it should not
 * have to wait on a moderation queue to take it off their own card.
 *
 * Soft, per the table's note: the row stays for any report already filed against it.
 */
create or replace function delete_agora_comment(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner uuid;
begin
  if auth.uid() is null then raise exception 'Not signed in.'; end if;

  select o.owner_id into v_owner
  from agora_comments c
  cross join lateral agora_item_owner(c.post_id, c.milestone_id) o
  where c.id = p_id;

  update agora_comments c
  set deleted_at = now()
  where c.id = p_id
    and c.deleted_at is null
    and (c.user_id = auth.uid() or v_owner = auth.uid());
end;
$$;

grant execute on function delete_agora_comment(uuid) to authenticated;

-- Moderation evidence, the comment twin of 0128's post column.
alter table moderation_reports
  add column if not exists reported_agora_comment_id uuid references agora_comments (id) on delete set null;

-- ───────────────────────────── notification wiring ─────────────────────────────

/**
 * The Agora's two types file under 'friends_social' — the same toggle milestone cheers already
 * use, since this is the same "somebody reacted to you" class of event.
 *
 * Rebuilt from 0112's version (the latest), with 0093's milestone types folded back in. 0112
 * dropped them from the explicit list; they landed on the 'friends_social' fallback and so kept
 * working, but the mapping then disagreed with the spec's table and the next person reading this
 * function would not find them. Listed explicitly, same as 0093 argued.
 */
create or replace function notification_category(p_type text)
returns text
language sql
immutable
as $nc$
  select case
    when p_type in ('friend_request', 'friend_accepted', 'friend_ranked_up', 'friend_passed_you',
                    'friend_joined', 'friend_locked_in',
                    -- §8 (NOTIFICATIONS_SPEC "Friends & social").
                    'milestone_cheered', 'milestone_posted',
                    -- The Agora (AGORA_SPEC) — reactions to you, on your own posts.
                    'agora_cheered', 'agora_commented') then 'friends_social'
    when p_type in ('challenged', 'challenge_accepted', 'challenge_declined', 'challenge_passed',
                    'challenge_ending_soon', 'challenge_won', 'challenge_lost', 'goal_at_risk',
                    'goal_streak_milestone', 'challenge_cheered') then 'challenges'
    when p_type in ('campfire_joined', 'campfire_join_request', 'campfire_challenge_started',
                    'campfire_cold', 'campfire_added', 'campfire_settled', 'campfire_message')
      then 'campfires'
    when p_type in ('streak_at_risk', 'daily_fire_reminder', 'streak_milestone') then 'streak_reminders'
    when p_type in ('season_ending', 'season_settled', 'ranked_up', 'rank_dropped', 'reward_ready')
      then 'season_rank'
    else 'friends_social'
  end;
$nc$;

/**
 * Both Agora types PUSH by default, and neither is added to the opt-out list below.
 *
 * The line 0093 drew is the right one: an event about somebody engaging with YOU personally is
 * worth interrupting for; an event about somebody else's activity is not. A cheer and a comment
 * are both the first kind. Note what is NOT here — there is deliberately no notification for "a
 * post appeared in the Agora". In a feed whose whole design is dozens of posts a day, that is the
 * type that gets the entire channel muted.
 *
 * Re-stated verbatim from 0093 (same signature, so create-or-replace) so the list stays in one
 * readable place rather than being something you have to diff three files to reconstruct.
 */
create or replace function notification_push_default(p_type text)
returns boolean
language sql
immutable
as $np$
  select p_type not in (
    'friend_locked_in',   -- spec: "off (spammy)"
    'campfire_message',   -- spec: "off by default"
    'rank_dropped',       -- spec: "don't demoralize"
    'friend_ranked_up',   -- spec: bell, push only when batched
    'campfire_joined',    -- spec: bell + badge, no push
    'milestone_posted'    -- spec: "bell (push opt.)" — the cheer is the one that pushes
  );
$np$;
