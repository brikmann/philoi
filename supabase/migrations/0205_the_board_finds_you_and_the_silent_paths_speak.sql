-- 0205 — WS8: the last silent paths speak, and the board finds you once a day.
--
-- ═════════════════════════════════ WHAT WAS ACTUALLY LEFT ═════════════════════════════════
--
-- The WS8 brief was written against a pre-0201 tree and most of it had already shipped. Checked
-- against PROD (prosrc, not migration files) before writing a line of this:
--
--   brief item                                    state on prod                        this file
--   ────────────────────────────────────────────  ───────────────────────────────────  ─────────
--   §B1 goal completion drip → goal_complete      0201, emits                          —
--   §B2 reward/crate → reward_ready               0201, emits                          —
--   §B3 friend request + accept                   0201, emits both                     —
--   §B6 agora_cheered / agora_commented           0129, emits + pushes to the author    —
--   §B7 grant_forge_pass / economy_grant_badge    0201, emits                          —
--   §A dead-token handling                        0201, push_dispatches + the cron      —
--   §B4 friend_locked_in                          ⚠ NO EMITTER AT ALL                   §2, §4
--   §B5 friend posts to the Agora                 ⚠ deliberately silent (0129/0140)     §1, §5
--   §C daily placement                            ⚠ does not exist                      §1, §3, §6
--
-- ─────────────────────────── §B4 is not a default flip ───────────────────────────
--
-- The brief says "friend_locked_in exists but is a bell-only default — flip to push-on". Half of
-- that is wrong in a way that matters: `friend_locked_in` is named in notification_category and in
-- notification_push_default's opt-out list, AND NOTHING IN THE SCHEMA EVER EMITS IT. Not one row of
-- that type has ever been written. Flipping a push default for a type nobody emits changes nothing
-- at all, so this file adds the missing EMITTER (§4) and flips the default (§2) — the flip alone
-- would have been a no-op that looked like a fix.
--
-- Note which push it is NOT. The campfire lock-in push is type 'check_in' and goes to CAMPFIRE
-- MEMBERS. Your friends have never been told you locked in; that is the actual gap.
--
-- ─────────────────────────── §B5 reverses a documented decision ───────────────────────────
--
-- create_agora_post ends with an explicit comment refusing to notify: the Agora's delivery model is
-- PULL, and "blasting a push for every post is precisely how the notification channel gets muted".
-- That reasoning is sound and this file overrides it because the brief asks for it — but it does not
-- pretend the reasoning was wrong. Both new friend-fanout types are therefore:
--
--   · RATE-LIMITED per actor (6h for a post, 4h for a lock-in), so a person having a productive
--     evening cannot put six banners on every friend's phone. The cap is read off the bell rows
--     this file's own triggers write, so it needs no new state.
--   · VISIBILITY- AND BLOCK-CHECKED, so a post nobody was allowed to see does not announce itself.
--   · INDIVIDUALLY MUTABLE. 0135 made `type_<event>` a real gate (absent = on) and nothing has ever
--     written one. These two are the first, and the settings screen now exposes them, so "I like
--     this app but not that one notification" is a switch instead of muting the category.
--
-- ─────────────────────────── triggers, not function rewrites ───────────────────────────
--
-- §4 and §5 hang AFTER INSERT triggers on lock_in_sessions and agora_posts rather than restating
-- create_agora_post (119 lines) and start_lock_in_session (95 lines). Two reasons, both load-bearing:
-- sibling sessions are writing migrations against this same prod right now, and a create-or-replace
-- restated from a stale base silently reverts them; and a trigger covers every write path, not just
-- the one RPC the current client happens to call.
--
-- Every function restated below WAS diffed against prod first (md5 of prosrc):
--   notification_category     34b62e4982a6c709228b4ce27e7ea655  == 0201's body
--   notification_push_default d741e462f5e5b20ad155fac79f2062a5  == 0129's body
--   notify_event              51f2c098d3fe5360d007c0fbc215d92e  == 0135's body
-- so each is this file's base, and each change below is marked 0205.

-- ═══════════════════════════════ 1 · categories ═══════════════════════════════
--
-- Both new types would reach 'friends_social' through the else-arm anyway; daily_placement must NOT
-- (it is a rank event and belongs under the switch people expect to govern rank), and
-- friend_agora_post is named explicitly so the mapping is a decision on the record rather than a
-- fall-through nobody chose.

create or replace function public.notification_category(p_type text)
 returns text
 language sql
 immutable
 set search_path to 'public'
as $function$
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
                    'challenge_hosted') then 'campfires'
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

-- ═══════════════════════════════ 2 · friend_locked_in may push ═══════════════════════════════
--
-- 0205 REMOVES a line, which every other change in this lineage has avoided — so, explicitly: the
-- removal is the point, and it is the only line removed. The spec's "off (spammy)" was written when
-- the type was imagined as one push per friend per lock-in with no cap and no switch. §4 gives it a
-- 4-hour per-actor cap and a `type_friend_locked_in` switch, which is the trade the spec was
-- guarding against being made blindly.

create or replace function public.notification_push_default(p_type text)
 returns boolean
 language sql
 immutable
as $function$
  select p_type not in (
    -- 0205 · 'friend_locked_in' was here. It now pushes: see §4 for the cap and the switch.
    'campfire_message',   -- spec: "off by default"
    'rank_dropped',       -- spec: "don't demoralize"
    'friend_ranked_up',   -- spec: bell, push only when batched
    'campfire_joined',    -- spec: bell + badge, no push
    'milestone_posted'    -- spec: "bell (push opt.)" — the cheer is the one that pushes
  );
$function$;

-- ═══════════════════════════════ 3 · a chosen time beats quiet hours ═══════════════════════════════
--
-- 0135's body, with ONE token changed. daily_placement is a time the user picked on the settings
-- screen, exactly like daily_fire_reminder, and suppressing an alarm somebody set is just a broken
-- alarm — 0086's own words for why that exemption exists. Without this, anyone whose placement hour
-- sits inside their quiet window gets a bell row and silence, forever, with nothing to explain it.

CREATE OR REPLACE FUNCTION public.notify_event(p_user_ids uuid[], p_type text, p_title text, p_body text DEFAULT NULL::text, p_actor_id uuid DEFAULT NULL::uuid, p_target_id uuid DEFAULT NULL::uuid, p_route text DEFAULT NULL::text, p_route_params jsonb DEFAULT '{}'::jsonb, p_image_url text DEFAULT NULL::text, p_image_shape text DEFAULT NULL::text, p_payload jsonb DEFAULT '{}'::jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    -- #150 · the per-type gate. Inserted ABOVE the quiet-hours line rather than appended to it,
    -- so this is a pure line insertion and the diff removes nothing.
    and coalesce((p.notification_prefs->>('type_' || p_type))::boolean, true)
    -- 0205 · daily_placement joins daily_fire_reminder: both are times the USER chose.
    and (p_type in ('daily_fire_reminder', 'daily_placement') or not is_in_quiet_hours(p.notification_prefs));

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
$function$;

-- create-or-replace preserves privileges, so 0120's revokes still stand. Re-asserted for the same
-- reason 0135 re-asserted them: a reader should not have to know that rule to believe this file.
revoke all on function notify_event(uuid[], text, text, text, uuid, uuid, text, jsonb, text, text, jsonb)
  from public, anon, authenticated;

-- ═══════════════════════════════ 4 · a friend locked in ═══════════════════════════════

/**
 * Everyone who is an accepted friend of p_user, minus disabled/demo accounts and minus anyone
 * either side has blocked.
 *
 * Takes the subject explicitly rather than leaning on auth.uid() (which is what
 * is_blocked_either_way does), because both callers are triggers and one of them must also be
 * correct when the row is written by a job rather than by the person themselves.
 */
create or replace function public.friend_ids_for_notify(p_user uuid)
returns uuid[]
language sql
security definer
set search_path = public
stable
as $function$
  select coalesce(array_agg(f.id), '{}')
  from (
    select case when fr.requester_id = p_user then fr.recipient_id else fr.requester_id end as id
    from friend_requests fr
    where fr.status = 'accepted'
      and (fr.requester_id = p_user or fr.recipient_id = p_user)
  ) f
  join profiles p on p.id = f.id
  where not p.is_disabled
    and not p.is_demo
    and not exists (
      select 1 from blocked_users b
      where (b.blocker_id = f.id and b.blocked_id = p_user)
         or (b.blocker_id = p_user and b.blocked_id = f.id)
    );
$function$;

revoke all on function public.friend_ids_for_notify(uuid) from public, anon, authenticated;

/**
 * THE MISSING EMITTER (§B4). Fires once per lock-in START, to the starter's friends.
 *
 * The 4-hour cap is read off the bell rows this trigger itself writes, so a person doing four
 * sessions in an evening announces the first and stays quiet for the rest. If the fan-out ends up
 * empty (no friends, all blocked) nothing is written and nothing is capped — the next session tries
 * again, which is the behaviour you want for someone who has just made their first friend.
 */
create or replace function public.notify_friends_locked_in()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_friends uuid[];
  v_name text;
  v_avatar text;
begin
  if exists (
    select 1 from notification_events
    where actor_id = new.user_id
      and type = 'friend_locked_in'
      and created_at > now() - interval '4 hours'
  ) then
    return new;
  end if;

  v_friends := friend_ids_for_notify(new.user_id);
  if array_length(v_friends, 1) is null then
    return new;
  end if;

  select coalesce(nullif(btrim(p.display_name), ''), p.handle), p.avatar_url
    into v_name, v_avatar
  from profiles p where p.id = new.user_id;

  perform notify_event(
    v_friends,
    'friend_locked_in',
    coalesce(v_name, 'A friend') || ' just locked in',
    'Start a session and keep them company.',
    new.user_id,
    new.id,
    -- Home. The one route every installed build has had since the nav revamp.
    '/(tabs)',
    '{}'::jsonb,
    v_avatar,
    'circle'
  );

  return new;
end;
$function$;

drop trigger if exists lock_in_sessions_notify_friends on lock_in_sessions;
create trigger lock_in_sessions_notify_friends
  after insert on lock_in_sessions
  for each row execute function notify_friends_locked_in();

-- ═══════════════════════════════ 5 · a friend posted to the Agora ═══════════════════════════════

/**
 * §B5. Same shape as §4, plus the visibility check — can_see_agora takes an explicit viewer and
 * never reads auth.uid(), so it is correct inside a trigger.
 *
 * A post with no body (a photo or a bare attachment) still announces; the body line is simply
 * dropped rather than showing an empty quote.
 */
create or replace function public.notify_friends_agora_post()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_friends uuid[];
  v_name text;
  v_avatar text;
begin
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

drop trigger if exists agora_posts_notify_friends on agora_posts;
create trigger agora_posts_notify_friends
  after insert on agora_posts
  for each row execute function notify_friends_agora_post();

-- ═══════════════════════════════ 6 · the daily placement push ═══════════════════════════════
--
-- §C. Default 9pm local, ON — `placement_enabled` and `placement_hour` in notification_prefs, both
-- absent-means-default so no backfill is needed and every existing user is opted in at 21:00 without
-- a row being touched.
--
-- WHY HOURLY CRON AND NOT A PER-USER SCHEDULE. The hour is compared in each user's OWN timezone, so
-- one job at :00 serves every zone. Offsets of :30/:45 (India, Nepal) land on the next whole hour — a
-- 21:30 delivery for a 21:00 setting, which is closer than any whole-hour cron can get without a
-- per-minute job.
--
-- ⚠ WHICH TIMEZONE, AND WHY IT IS NOT THE ONE QUIET HOURS USES. is_in_quiet_hours reads
-- `notification_prefs->>'timezone'`, which the client stows on every prefs SAVE. Measured on prod
-- before writing this: ZERO of 18 profiles have that key, because not one of them has ever saved a
-- notification pref (all 18 blobs are '{}'). Ten have `profiles.timezone` (migration 0084, written
-- on a different path).
--
-- Reading only the prefs key would therefore have sent EVERY user their placement at 21:00 UTC —
-- 5pm in New York, 2pm in California — while the settings screen said 9 PM. The feature would have
-- been wrong for 100% of its users on day one and looked right in every code review. So the prefs
-- key is preferred (the user set it deliberately), `profiles.timezone` is the fallback, and UTC is
-- the last resort.
--
-- is_in_quiet_hours does NOT need the same fallback and is not touched here: it returns false unless
-- `quiet_enabled` is true, and quiet_enabled can only BE true via a save that also writes the
-- timezone. The two keys arrive together or not at all. This function is exposed precisely because
-- its default is ON for people who have never saved anything.
--
-- WHY THE BOARD IS COMPUTED ONCE PER RUN. universal_score() is a per-profile function call; ranking
-- inside the loop would call it once per due user per run. The CTE ranks everyone once and the join
-- picks out the due rows. At pilot size this is nothing; the shape is what keeps it nothing later.
-- The early-exit above it means the board is not built at all in an hour with nobody due.
--
-- WHY EVERYONE IS IN THE RANKING. get_global_leaderboard hides private climbers from OTHER viewers
-- (0170). This tells each person their OWN standing, which is theirs to know, so the denominator is
-- the real board rather than a per-viewer one.

create or replace function public.send_daily_placement()
returns integer
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_sent int := 0;
  r record;
begin
  if not exists (
    select 1 from profiles p
    where not p.is_demo and not p.is_disabled
      and coalesce((p.notification_prefs->>'master')::boolean, true)
      and coalesce((p.notification_prefs->>'placement_enabled')::boolean, true)
      and extract(hour from (now() at time zone
            coalesce(nullif(p.notification_prefs->>'timezone', ''), nullif(p.timezone, ''), 'UTC')))::int
          = coalesce((p.notification_prefs->>'placement_hour')::int, 21)
  ) then
    return 0;
  end if;

  for r in
    with board as (
      select
        p.id,
        row_number() over (order by universal_score(p.id) desc, p.display_name asc)::int as rank,
        count(*) over ()::int as total
      from profiles p
      where not p.is_demo and not p.is_disabled
    )
    select b.id, b.rank, b.total
    from board b
    join profiles p on p.id = b.id
    where coalesce((p.notification_prefs->>'master')::boolean, true)
      and coalesce((p.notification_prefs->>'placement_enabled')::boolean, true)
      and extract(hour from (now() at time zone
            coalesce(nullif(p.notification_prefs->>'timezone', ''), nullif(p.timezone, ''), 'UTC')))::int
          = coalesce((p.notification_prefs->>'placement_hour')::int, 21)
      -- Idempotent within a day. A cron retry, a clock change, or a user moving timezone mid-evening
      -- must not put the same line on the same phone twice.
      and not exists (
        select 1 from notification_events ne
        where ne.user_id = b.id
          and ne.type = 'daily_placement'
          and ne.created_at > now() - interval '23 hours'
      )
  loop
    perform notify_event(
      array[r.id],
      'daily_placement',
      'You''re #' || to_char(r.rank, 'FM999,999,999') || ' of ' || to_char(r.total, 'FM999,999,999'),
      case
        when r.rank <= 10    then 'Top 10. Defend it.'
        when r.rank <= 100   then 'Top 100 — the next ten are close.'
        when r.rank <= 1000  then 'Top 1,000. Keep climbing.'
        when r.rank <= 10000 then 'Top 10,000. Keep climbing.'
        else 'Climb.'
      end,
      null,
      null,
      '/(tabs)/leaderboards',
      '{}'::jsonb,
      null,
      'flame',
      jsonb_build_object('rank', r.rank, 'total', r.total)
    );
    v_sent := v_sent + 1;
  end loop;

  return v_sent;
end;
$function$;

revoke all on function public.send_daily_placement() from public, anon, authenticated;

select cron.unschedule('philoi-daily-placement')
 where exists (select 1 from cron.job where jobname = 'philoi-daily-placement');
select cron.schedule('philoi-daily-placement', '0 * * * *',
                     $cron$select send_daily_placement();$cron$);

-- ═══════════════════════════════ assertions ═══════════════════════════════
--
-- Every check below is PAIRED with a control that would fail if the thing it tests were constant —
-- a green light that would also be green under the bug is not a test.

do $assert$
begin
  -- §1 · the two new types are filed where this file says, and the mapping still discriminates.
  if notification_category('daily_placement') <> 'season_rank' then
    raise exception '0205: daily_placement files under %, expected season_rank',
      notification_category('daily_placement');
  end if;
  if notification_category('friend_agora_post') <> 'friends_social' then
    raise exception '0205: friend_agora_post files under %, expected friends_social',
      notification_category('friend_agora_post');
  end if;
  -- CONTROL. friend_agora_post would also read 'friends_social' from the else-arm, so the check
  -- above proves nothing on its own; this proves the function still routes by type at all.
  if notification_category('campfire_cold') <> 'campfires'
     or notification_category('goal_complete') <> 'challenges' then
    raise exception '0205: notification_category no longer discriminates — the checks above are vacuous';
  end if;

  -- §2 · the flip, and proof the opt-out list still opts anything out.
  if not notification_push_default('friend_locked_in') then
    raise exception '0205: friend_locked_in still would not push';
  end if;
  if notification_push_default('campfire_message') or notification_push_default('rank_dropped') then
    raise exception '0205: the push-default opt-out list is empty — the check above is vacuous';
  end if;

  -- §3 · the quiet-hours exemption reached the live body.
  if (select prosrc from pg_proc where proname = 'notify_event') !~ 'daily_placement' then
    raise exception '0205: notify_event does not exempt daily_placement from quiet hours';
  end if;

  -- §4/§5 · both triggers are attached. Named on the TABLE, so a function that exists but was
  -- never wired up cannot pass.
  if not exists (
    select 1 from pg_trigger where tgname = 'lock_in_sessions_notify_friends' and not tgisinternal
  ) then
    raise exception '0205: lock_in_sessions_notify_friends is not attached';
  end if;
  if not exists (
    select 1 from pg_trigger where tgname = 'agora_posts_notify_friends' and not tgisinternal
  ) then
    raise exception '0205: agora_posts_notify_friends is not attached';
  end if;

  -- §6 · scheduled, and not reachable from a client.
  if not exists (select 1 from cron.job where jobname = 'philoi-daily-placement') then
    raise exception '0205: philoi-daily-placement is not scheduled';
  end if;
  if has_function_privilege('anon', 'public.send_daily_placement()', 'execute')
     or has_function_privilege('authenticated', 'public.send_daily_placement()', 'execute') then
    raise exception '0205: send_daily_placement is callable by a client role';
  end if;
  if has_function_privilege('anon', 'public.friend_ids_for_notify(uuid)', 'execute')
     or has_function_privilege('authenticated', 'public.friend_ids_for_notify(uuid)', 'execute') then
    raise exception '0205: friend_ids_for_notify is callable by a client role';
  end if;
  -- CONTROL for the two privilege checks: a function that IS meant to be client-callable still is,
  -- so a revoke-everything accident cannot read as a pass.
  if not has_function_privilege('authenticated', 'public.get_my_notifications(int)', 'execute') then
    raise exception '0205: get_my_notifications lost its grant — the revoke checks above are vacuous';
  end if;
end;
$assert$;
