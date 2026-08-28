-- 0120 — the Strava-style self-recap on every completed lock-in, and per-relic push copy.
--
-- LOGIC_AUDIT §4: the push pipeline is solid, but the one notification a session-based app owes
-- its user does not exist. `friend_locked_in` tells your FRIENDS you locked in; nothing tells YOU
-- "that was 1h 20m — nice work". And every relic unlock since 0090 has pushed the same generic
-- title, "Relic earned", regardless of which relic it was.
--
-- Decision locked by Noah: the recap fires on EVERY completed session, not only long ones.

-- ─────────────────────── 1 · the category map learns the new type ───────────────────────
--
-- Restated in full from 0112 (the current definition) with TWO changes, because the whole CASE
-- has to be repeated to add a line and a half-copy would silently drop mappings:
--
--   · 'session_complete' -> 'streak_reminders'. That is the toggle the user already understands
--     as "nudges about my own consistency", and it means a recap can be muted without muting
--     anything social. LOGIC_AUDIT §5's cleanup item.
--   · 'milestone_cheered' / 'milestone_posted' are RESTORED to 'friends_social'. 0093 listed them
--     explicitly and 0112 dropped them when it restated the function. They still resolve to
--     friends_social through the else-branch, so nothing was broken — but the mapping stopped
--     being findable by anyone reading this function, which is the exact failure mode 0093's own
--     comment warned about.
create or replace function notification_category(p_type text)
returns text
language sql
immutable
as $nc$
  select case
    when p_type in ('friend_request', 'friend_accepted', 'friend_ranked_up', 'friend_passed_you',
                    'friend_joined', 'friend_locked_in',
                    'milestone_cheered', 'milestone_posted') then 'friends_social'
    when p_type in ('challenged', 'challenge_accepted', 'challenge_declined', 'challenge_passed',
                    'challenge_ending_soon', 'challenge_won', 'challenge_lost', 'goal_at_risk',
                    'goal_streak_milestone', 'challenge_cheered') then 'challenges'
    when p_type in ('campfire_joined', 'campfire_join_request', 'campfire_challenge_started',
                    'campfire_cold', 'campfire_added', 'campfire_settled', 'campfire_message')
      then 'campfires'
    when p_type in ('streak_at_risk', 'daily_fire_reminder', 'streak_milestone',
                    'session_complete') then 'streak_reminders'
    when p_type in ('season_ending', 'season_settled', 'ranked_up', 'rank_dropped', 'reward_ready')
      then 'season_rank'
    else 'friends_social'
  end;
$nc$;

-- ─────────────────────── 2 · the recap itself ───────────────────────
--
-- WHY actor_id IS NULL. notify_event skips any recipient equal to p_actor_id (0087) — that guard
-- is what stops "you cheered yourself" rows. A self-recap has no other party, so passing the user
-- as the actor would silently write nothing at all. Null actor = system event = allowed.
--
-- WHICH DURATION. Two different numbers exist and they disagree on purpose:
--   · check_ins.duration_seconds — now() minus started_at, written by stop_lock_in_session. This
--     is what the app showed on the timer, and it is what the user will compare the push against.
--   · last_confirmed_at - started_at — credited time, deliberately clipped at the last heartbeat
--     so a session left running overnight cannot farm XP (0033).
-- The recap quotes the FIRST (what they saw) and falls back to the second for a session finalised
-- by the stale-session sweep, which never creates the check-in the same way.
--
-- WHAT IT REPORTS. Duration, what it was for, the XP that landed, and the streak — all four are
-- already computed by the time this fires. See the trigger's name for why that ordering holds.
create or replace function notify_session_complete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_seconds int;
  v_minutes int;
  v_xp numeric;
  v_streak int;
  v_label text;
  v_body text;
begin
  if new.status <> 'completed' or coalesce(old.status, '') = 'completed' then
    return new;
  end if;

  select ci.duration_seconds, ci.xp_earned
    into v_seconds, v_xp
  from check_ins ci
  where ci.id = new.ended_check_in_id;

  v_minutes := coalesce(
    round(v_seconds / 60.0),
    round(extract(epoch from (new.last_confirmed_at - new.started_at)) / 60.0)
  )::int;

  -- A sub-minute session is a mis-tap, not an achievement. Still flips status, still counts
  -- everywhere else — it just does not earn a congratulatory push.
  if coalesce(v_minutes, 0) < 1 then return new; end if;

  select p.current_streak into v_streak from profiles p where p.id = new.user_id;

  v_label := case new.goal_type
    when 'gym' then 'in the gym'
    when 'study' then 'studying'
    when 'run' then 'on a run'
    when 'read' then 'reading'
    when 'job_applications' then 'on applications'
    else 'locked in'
  end;

  v_body := format('%s min %s', v_minutes, v_label);
  if coalesce(v_xp, 0) > 0 then
    v_body := v_body || format(' · +%s XP', round(v_xp));
  end if;
  if coalesce(v_streak, 0) > 1 then
    v_body := v_body || format(' · %s-day streak', v_streak);
  end if;
  v_body := v_body || '. Nice work.';

  perform notify_event(
    array[new.user_id], 'session_complete',
    format('🔥 Locked in for %s min', v_minutes),
    v_body,
    null, new.id,
    '/(tabs)', '{}'::jsonb,
    null, 'flame',
    jsonb_build_object('minutes', v_minutes, 'xp', round(coalesce(v_xp, 0)),
                       'streak', coalesce(v_streak, 0), 'goal_type', new.goal_type)
  );

  return new;
end;
$$;

-- NAME ORDER MATTERS AGAIN. lock_in_sessions already carries `lock_in_sessions_relics` (0090),
-- and both are AFTER UPDATE OF status. 'lock_in_sessions_complete_push' sorts BEFORE it, which is
-- what we want: the recap is about the session, and a relic unlocked by the same session gets its
-- own push a moment later rather than being folded into this one.
--
-- The check-in that carries duration_seconds/xp_earned is inserted by stop_lock_in_session BEFORE
-- it flips the session to 'completed', and handle_check_in_insert's xp UPDATE has already run by
-- then, so both reads above are of settled values.
drop trigger if exists lock_in_sessions_complete_push on lock_in_sessions;
create trigger lock_in_sessions_complete_push
  after update of status on lock_in_sessions
  for each row execute function notify_session_complete();

-- ─────────────────────── 3 · a way to backfill without a push blast ───────────────────────
--
-- 0088's body verbatim except for ONE guard around the push half. (0088, not 0087 — 0088 is the
-- current definition, and the difference matters: it sends through notify_push_raw, because
-- notify_push became a feed+send wrapper in the same migration and routing through it here would
-- write every bell row a second time.)
--
-- WHY: 0123 backfills relic_progress by running economy_evaluate_relics() for every active
-- account. Every relic that retroactively qualifies calls notify_event, and notify_event ends in
-- net.http_post to Expo — so a deploy would fire a burst of "Socrates' Scroll — unlocked" pushes
-- at the entire user base at once, for progress they made months ago. A relic they earned in June
-- is a Trophy Hall discovery, not a 3am banner.
--
-- The bell row is still written for every recipient, exactly as before. The spec's rule is that a
-- muted category still populates the bell, and the same reasoning applies here: the record is what
-- makes the backfill visible, the interruption is what makes it obnoxious.
--
-- SESSION-SCOPED, not a stored setting: `set local` inside the backfill's transaction, so it is
-- impossible for this to leak into normal operation. current_setting(..., true) returns null
-- rather than raising when the GUC has never been set, which is the case for every real call.
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
  p_image_shape text default null,
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
  v_art record;
  v_url text;
  v_shape text;
begin
  if p_user_ids is null or array_length(p_user_ids, 1) is null then
    return 0;
  end if;

  -- An explicitly-passed image always wins; otherwise derive it. This is what lets a caller with
  -- something better than the subject's avatar (a rarity-coloured box) say so, while every other
  -- caller gets the right art for free.
  select * into v_art from notification_leading_art(p_type, p_actor_id, p_target_id);
  v_url := coalesce(p_image_url, v_art.url);
  v_shape := coalesce(p_image_shape, v_art.shape, 'flame');

  insert into notification_events (
    user_id, type, category, actor_id, target_id, title, body,
    route, route_params, image_url, image_shape, payload
  )
  select
    u, p_type, v_category, p_actor_id, p_target_id, p_title, p_body,
    p_route, coalesce(p_route_params, '{}'::jsonb), v_url, v_shape,
    coalesce(p_payload, '{}'::jsonb)
  from unnest(p_user_ids) as u
  where p_actor_id is null or u <> p_actor_id;

  get diagnostics v_written = row_count;

  -- THE ONE ADDED LINE. Everything above and below is 0087's.
  if coalesce(current_setting('philoi.suppress_push', true), 'off') = 'on' then
    return v_written;
  end if;

  select coalesce(array_agg(p.id), '{}')
    into v_push_targets
  from profiles p
  where p.id = any(p_user_ids)
    and (p_actor_id is null or p.id <> p_actor_id)
    and coalesce((p.notification_prefs->>'master')::boolean, true)
    and coalesce((p.notification_prefs->>('cat_' || v_category))::boolean, v_push_default)
    and (p_type = 'daily_fire_reminder' or not is_in_quiet_hours(p.notification_prefs));

  if array_length(v_push_targets, 1) is not null then
    perform notify_push_raw(
      v_push_targets,
      p_title,
      coalesce(p_body, ''),
      jsonb_build_object('type', p_type, 'route', p_route, 'params', coalesce(p_route_params, '{}'::jsonb))
        || coalesce(p_payload, '{}'::jsonb),
      'accountability',
      v_url
    );
  end if;

  return v_written;
end;
$$;

revoke all on function notify_event(uuid[], text, text, text, uuid, uuid, text, jsonb, text, text, jsonb) from public;
revoke all on function notify_event(uuid[], text, text, text, uuid, uuid, text, jsonb, text, text, jsonb) from authenticated;

-- ─────────────────────── 4 · a relic push that names the relic ───────────────────────
--
-- 0090's body verbatim except for the title, which was the literal 'Relic earned' for all of them
-- — LOGIC_AUDIT §4's "generic copy". relic_display_name() (0119) is the lookup; the flavour line
-- is already the p_why the callers pass, so the body needed no change.
--
-- Still returns false for an already-owned relic, and still grants through economy_grant_cosmetic
-- with source 'earned', so nothing about ownership or salvage changes.
create or replace function economy_grant_relic(
  p_user uuid, p_key text, p_rarity text, p_why text
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owned boolean;
begin
  select exists (
    select 1 from cosmetics_owned co
    where co.user_id = p_user and co.cosmetic_key = p_key
  ) into v_owned;
  if v_owned then return false; end if;

  perform economy_grant_cosmetic(p_user, p_key, null, p_rarity, 'earned', p_why);

  perform notify_event(
    array[p_user], 'reward_ready',
    relic_display_name(p_key) || ' — unlocked',
    p_why,
    null, null,
    '/inventory', '{}'::jsonb,
    null, 'rounded',
    jsonb_build_object('relic', p_key, 'rarity', p_rarity)
  );
  return true;
end;
$$;
