-- §F1 — the one notification event pipeline (NOTIFICATIONS_SPEC.md, mock 106).
--
-- WHAT EXISTS TODAY: notify_push() (0026, quiet hours added in 0027) fires an Expo push and
-- nothing else. There is no in-app feed, so "every event also lands in the bell" has had nowhere
-- to land, and an event is remembered only for as long as the OS notification survives. Six
-- migrations already call notify_push directly.
--
-- WHAT THIS ADDS, DELIBERATELY WITHOUT REPLACING IT: a notification_events table (the bell feed)
-- and notify_event(), which writes the feed rows and THEN delegates to notify_push for the push
-- half. notify_push keeps its signature and behaviour, so every existing caller is untouched and
-- can be migrated over one at a time rather than in one risky sweep.
--
-- CATEGORIES. The spec names five (Friends & social · Challenges · Campfires · Streak & reminders
-- · Season & rank), but notification_prefs already carries a finer-grained, differently-named set
-- from 0026 (campfire_lockins, reactions, messages, campfire_cold, streak_risk, challenges). Both
-- are honoured: notify_event resolves an event type to a spec CATEGORY for the new toggles, and
-- the legacy keys keep gating the legacy callers. A category is opt-OUT (missing = on) except
-- where the spec says a default is off.

-- ───────────────────────────── the feed ─────────────────────────────

create table if not exists notification_events (
  id uuid primary key default gen_random_uuid(),
  -- WHO SEES IT. One row per recipient, not one row per event with a recipient array: read state
  -- is per person, and a shared row would need a side table to track who had seen it — which is
  -- the same number of rows with an extra join.
  user_id uuid not null references profiles (id) on delete cascade,
  type text not null,
  category text not null,
  /** Who caused it — the friend, the opponent, the person who joined. Null for system events. */
  actor_id uuid references profiles (id) on delete set null,
  /** What it is about: a challenge, a campfire, a box. Untyped on purpose — it points into
   * different tables per type, so a FK would need one nullable column per target kind. */
  target_id uuid,
  title text not null,
  body text,
  /** Where tapping it goes. Stored rather than derived so a route change does not silently break
   * every historical row, and so the client needs no per-type switch to navigate. */
  route text,
  route_params jsonb not null default '{}'::jsonb,
  /** Leading art (spec's "pull the image that matches the event"). Resolved at WRITE time: the
   * subject's avatar can change or the account can vanish, and a feed row should keep showing what
   * it looked like when it happened rather than 404ing later. */
  image_url text,
  image_shape text not null default 'flame'
    check (image_shape in ('circle', 'hexagon', 'rounded', 'square', 'flame')),
  payload jsonb not null default '{}'::jsonb,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

-- The bell's two queries: "my unread count" and "my recent feed", both user-scoped and time
-- ordered. One index covers both.
create index if not exists notification_events_user_idx
  on notification_events (user_id, created_at desc);

-- Partial index for the badge count — the common case is a handful of unread rows against a long
-- history, so scanning only the unread ones keeps the count cheap as the table grows.
create index if not exists notification_events_unread_idx
  on notification_events (user_id) where read_at is null;

alter table notification_events enable row level security;

drop policy if exists notification_events_read_own on notification_events;
create policy notification_events_read_own on notification_events
  for select to authenticated using (user_id = auth.uid());

-- Users may mark their OWN rows read. No insert policy: notify_event is the only writer.
drop policy if exists notification_events_update_own on notification_events;
create policy notification_events_update_own on notification_events
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ───────────────────────────── category + defaults ─────────────────────────────

/**
 * Event type -> spec category. Unknown types fall to 'friends_social' rather than raising: a new
 * event type shipped ahead of its mapping should still reach the bell, not abort the transaction
 * of whatever business action emitted it.
 */
create or replace function notification_category(p_type text)
returns text
language sql
immutable
as $$
  select case
    when p_type in ('friend_request', 'friend_accepted', 'friend_ranked_up', 'friend_passed_you',
                    'friend_joined', 'friend_locked_in') then 'friends_social'
    when p_type in ('challenged', 'challenge_accepted', 'challenge_declined', 'challenge_passed',
                    'challenge_ending_soon', 'challenge_won', 'challenge_lost', 'goal_at_risk',
                    'goal_streak_milestone') then 'challenges'
    when p_type in ('campfire_joined', 'campfire_join_request', 'campfire_challenge_started',
                    'campfire_cold', 'campfire_added', 'campfire_settled', 'campfire_message')
      then 'campfires'
    when p_type in ('streak_at_risk', 'daily_fire_reminder', 'streak_milestone') then 'streak_reminders'
    when p_type in ('season_ending', 'season_settled', 'ranked_up', 'rank_dropped', 'reward_ready')
      then 'season_rank'
    else 'friends_social'
  end;
$$;

/**
 * Whether a type may PUSH by default.
 *
 * The spec is explicit that low-value events default to bell-only "so we don't train people to
 * mute us" — a user who gets eight pushes about friends locking in turns the whole channel off,
 * and then misses the one that mattered. These are the types it names.
 */
create or replace function notification_push_default(p_type text)
returns boolean
language sql
immutable
as $$
  select p_type not in (
    'friend_locked_in',   -- spec: "off (spammy)"
    'campfire_message',   -- spec: "off by default"
    'rank_dropped',       -- spec: "off (don't demoralize)"
    'friend_ranked_up',   -- spec: bell, push only when batched
    'campfire_joined'     -- spec: bell + badge, no push
  );
$$;

-- ───────────────────────────── the pipeline ─────────────────────────────

/**
 * Emit one event to many recipients: writes the bell row for each, then pushes to those eligible.
 *
 * ALWAYS writes the feed row, even when the category is muted. That is the spec's rule — "OFF
 * categories still populate the in-app bell (just no push)" — and it is what makes muting a
 * category safe: you stop being interrupted without losing the record.
 *
 * Push eligibility is the AND of: the type's default, the user's category toggle, the legacy
 * master switch, and quiet hours. Quiet hours are skipped for types the user themselves scheduled
 * (the daily reminder), since suppressing an alarm someone set is just a broken alarm.
 */
create or replace function notify_event(
  p_user_ids uuid[],
  p_type text,
  p_title text,
  p_body text default null,
  p_actor_id uuid default null,
  p_target_id uuid default null,
  p_route text default null,
  p_route_params jsonb default '{}'::jsonb,
  p_image_url text default null,
  p_image_shape text default 'flame',
  p_payload jsonb default '{}'::jsonb
)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_category text := notification_category(p_type);
  v_push_default boolean := notification_push_default(p_type);
  v_written int := 0;
  v_push_targets uuid[];
begin
  if p_user_ids is null or array_length(p_user_ids, 1) is null then
    return 0;
  end if;

  insert into notification_events (
    user_id, type, category, actor_id, target_id, title, body,
    route, route_params, image_url, image_shape, payload
  )
  select
    u, p_type, v_category, p_actor_id, p_target_id, p_title, p_body,
    p_route, coalesce(p_route_params, '{}'::jsonb), p_image_url, p_image_shape,
    coalesce(p_payload, '{}'::jsonb)
  from unnest(p_user_ids) as u
  -- Never notify someone about their own action. Without this, joining your own campfire or
  -- accepting your own challenge pings you about yourself.
  where p_actor_id is null or u <> p_actor_id;

  get diagnostics v_written = row_count;

  -- Who among them may be pushed. Read straight off profiles so one query decides it for the whole
  -- fan-out rather than notify_push re-deriving per recipient.
  select coalesce(array_agg(p.id), '{}')
    into v_push_targets
  from profiles p
  where p.id = any(p_user_ids)
    and (p_actor_id is null or p.id <> p_actor_id)
    and coalesce((p.notification_prefs->>'master')::boolean, true)
    -- The new five-category toggle. Missing = use the type's default, so an existing user with no
    -- new keys behaves exactly as the spec's defaults describe.
    and coalesce((p.notification_prefs->>('cat_' || v_category))::boolean, v_push_default)
    and (p_type = 'daily_fire_reminder' or not is_in_quiet_hours(p.notification_prefs));

  if array_length(v_push_targets, 1) is not null then
    perform notify_push(
      v_push_targets,
      p_title,
      coalesce(p_body, ''),
      jsonb_build_object('type', p_type, 'route', p_route, 'params', coalesce(p_route_params, '{}'::jsonb))
        || coalesce(p_payload, '{}'::jsonb),
      'accountability'
    );
  end if;

  return v_written;
end;
$$;

-- ───────────────────────────── read paths ─────────────────────────────

/** The bell's badge. Capped at 99 in the UI; returned uncapped so the caller decides. */
create or replace function get_unread_notification_count()
returns int
language sql
security definer
set search_path = public
stable
as $$
  select count(*)::int from notification_events
  where user_id = auth.uid() and read_at is null;
$$;

/** The feed. Newest first, bounded — the bell shows a recent window, not an archive. */
create or replace function get_my_notifications(p_limit int default 50)
returns setof notification_events
language sql
security definer
set search_path = public
stable
as $$
  select * from notification_events
  where user_id = auth.uid()
  order by created_at desc
  limit least(greatest(p_limit, 1), 200);
$$;

/** Mark everything read — what opening the bell does. Returns how many changed so the client can
 * skip a refetch when nothing did. */
create or replace function mark_notifications_read()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_n int;
begin
  update notification_events set read_at = now()
  where user_id = auth.uid() and read_at is null;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

revoke all on function notify_event(uuid[], text, text, text, uuid, uuid, text, jsonb, text, text, jsonb) from public;
revoke all on function notify_event(uuid[], text, text, text, uuid, uuid, text, jsonb, text, text, jsonb) from authenticated;
grant execute on function get_unread_notification_count() to authenticated;
grant execute on function get_my_notifications(int) to authenticated;
grant execute on function mark_notifications_read() to authenticated;
