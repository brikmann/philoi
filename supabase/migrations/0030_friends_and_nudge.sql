-- Friend ping (design-mocks/21, PHILOI_UI_SPEC.md §16) — a person-first "Your people" screen.
-- This codebase has NO friend-request graph (see the note near get_group_preview in schema.sql:
-- "no friend-graph exists in this schema"), so "friends" is defined as the honest available
-- proxy: people you share at least one campfire with. That's already the app's unit of social
-- connection everywhere else (leaderboards, challenges, live presence), so it needs no new
-- accept/request table — just a query over group_members co-membership.

-- Everyone I share a campfire with, once each, with their overall rank + streak for the row's
-- status line and ONE shared circle for context (used as the circle a H2H/group challenge is
-- created against — createH2HChallenge requires a circle both of us belong to). "Locked in now"
-- is intentionally NOT here: the screen reads that live from lock_in_sessions (same source as the
-- campfire presence strip) so it stays fresh between this list's refetches.
create or replace function get_my_friends()
returns table (
  friend_id uuid,
  display_name text,
  avatar_url text,
  tier text,
  division int,
  current_streak int,
  last_lockin_at timestamptz,
  shared_circle_id uuid,
  shared_circle_name text
)
language sql
security definer
set search_path = public
stable
as $$
  with co as (
    -- distinct co-members, keeping one shared circle each (the lowest group_id, deterministic)
    select distinct on (gm2.user_id)
      gm2.user_id as uid,
      gm1.group_id as circle_id
    from group_members gm1
    join group_members gm2 on gm2.group_id = gm1.group_id
    where gm1.user_id = auth.uid()
      and gm2.user_id <> auth.uid()
    order by gm2.user_id, gm1.group_id
  )
  select
    p.id as friend_id,
    p.display_name,
    p.avatar_url,
    r.tier,
    r.division,
    p.current_streak,
    -- Their last real lock-in — drives the "going cold Nd" status line (design-mocks/21) for a
    -- friend whose streak has lapsed to 0 but who has locked in before. Null = never locked in.
    (
      select max(ci.created_at)
      from check_ins ci
      where ci.user_id = p.id and ci.duration_seconds > 0 and ci.removed_at is null
    ) as last_lockin_at,
    co.circle_id as shared_circle_id,
    g.name as shared_circle_name
  from co
  join profiles p on p.id = co.uid
  join groups g on g.id = co.circle_id
  cross join lateral rank_tier_for_score(universal_score(p.id)) r
  order by p.display_name;
$$;

-- One-tap "nudge to lock in" (design-mocks/21's 🔥 quick-action + sheet primary) — fires a push
-- only. There's no in-app notification centre table in this schema, so the push IS the nudge;
-- tapping it deep-links into the lock-in goal picker (handled app-side by the 'lock_in_nudge'
-- type). Gated to people you actually share a campfire with, matching get_my_friends' definition.
create or replace function nudge_to_lock_in(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sender text;
begin
  if p_user_id = auth.uid() then
    raise exception 'You can''t nudge yourself.';
  end if;
  if not exists (
    select 1 from group_members gm1
    join group_members gm2 on gm2.group_id = gm1.group_id
    where gm1.user_id = auth.uid() and gm2.user_id = p_user_id
  ) then
    raise exception 'You can only nudge people in your campfires.';
  end if;

  select display_name into v_sender from profiles where id = auth.uid();

  perform notify_push(
    array[p_user_id],
    'Lock in?',
    coalesce(v_sender, 'A friend') || ' pinged you to lock in 🔥',
    jsonb_build_object('type', 'lock_in_nudge', 'from_user_id', auth.uid()),
    'accountability'
  );
end;
$$;
