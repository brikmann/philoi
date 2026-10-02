-- 0224 — A stale lock-in reminder is not a campfire.
--
-- ─────────────────────────────── WHY ───────────────────────────────
--
-- Tapping the "Still locked in?" row in the bell, for a session that has since ended, opened a blank
-- group chat titled "…" with 0 members, and any attempt to type in it crashed the app with
--
--     invalid input syntax for type uuid: "[groupId]"
--
-- The literal string "[groupId]" — the route placeholder, brackets and all — reached a uuid filter.
-- Here is the whole chain:
--
--   notify_stale_lock_ins() (0007/0012) sends the "Still locked in?" push with a data payload of
--   exactly {type: 'lockin_still_here', session_id: <uuid>}. No group_id — a lock-in is not a
--   campfire, it has no group.
--
--   Since 0088 that push also writes a bell row, and the bell derives its tap destination by calling
--   notification_route_for(type, data). That function has mapped 'lockin_still_here' to
--   '/group/[groupId]' since 0088 — which was always wrong: there is no group here, and the params
--   builder, finding no group_id in the payload, returns '{}'. So the row is stored with
--   route '/group/[groupId]' and NO params.
--
--   notifications.tsx does `router.push({ pathname: route, params: route_params })`. With the
--   placeholder segment unfilled, expo-router leaves it literal, the group screen reads
--   groupId = "[groupId]" from useLocalSearchParams, and every RPC it fires (get_campfire_preview,
--   list_campfire_members, chat send …) hands that literal to a `uuid` argument → the crash.
--
-- The PUSH tap was never affected: its payload carries no `route` key, so _layout.tsx's handler
-- skips the route branch and hits `data.type === 'lockin_still_here'`, which resolves the active
-- session and opens /lock-in (or does nothing if the session ended). Only the BELL row, built from
-- the bad mapping, carried the poison route.
--
-- ── THE FIX ──
--
-- Drop the one bad branch. 'lockin_still_here' now falls to `else null`, exactly like a streak
-- nudge: notification_route_for's own comment says a null route is correct for a type "with no
-- single destination", and a reminder about YOUR session is one of those — the bell cannot know
-- whether the session is still live, and the only safe live action (resume) is already handled by
-- the push's type-branch. notifications.tsx renders a null-route row `disabled`, so the row still
-- shows in the activity log; it simply is no longer a tap into a crash.
--
-- Everything else in notification_route_for is reproduced verbatim from 0088 — this is the only
-- change. (0088 is still the sole definer; nothing since has redefined this function.)

create or replace function notification_route_for(p_type text, p_data jsonb)
returns table (route text, params jsonb)
language sql
immutable
as $$
  select
    case p_type
      when 'challenge_invite'            then '/challenge-info/[challengeId]'
      when 'challenge_completed'         then '/challenge-info/[challengeId]'
      when 'challenge_forfeited'         then '/challenge-info/[challengeId]'
      when 'challenge_terms_updated'     then '/challenge-info/[challengeId]'
      when 'challenge_change_request'    then '/challenge-change/[requestId]'
      when 'challenge_change_answered'   then '/challenge-change/[requestId]'
      when 'join_request'                then '/group/[groupId]'
      when 'join_request_approved'       then '/group/[groupId]'
      when 'circle'                      then '/group/[groupId]'
      when 'check_in'                    then '/group/[groupId]'
      when 'message'                     then '/group/[groupId]'
      -- 'lockin_still_here' intentionally OMITTED (0224). It carries session_id, never group_id, so
      -- '/group/[groupId]' could never resolve and crashed the app. A null route is correct: the
      -- push's own type-branch handles resume; the bell row is a non-tappable log line.
      else null
    end,
    coalesce(
      case p_type
        when 'challenge_change_request'  then jsonb_build_object('requestId', p_data->>'request_id')
        when 'challenge_change_answered' then jsonb_build_object('requestId', p_data->>'request_id')
        else
          case
            when p_data ? 'challenge_id' then jsonb_build_object('challengeId', p_data->>'challenge_id')
            when p_data ? 'group_id'     then jsonb_build_object('groupId', p_data->>'group_id')
            else null
          end
      end,
      '{}'::jsonb
    );
$$;

-- Defuse the rows already on prod. Every bell row ever written for a stale lock-in carries the
-- poison route '/group/[groupId]' with empty params; left alone, each is still one tap from the
-- crash above. Null them so they render disabled like every other routeless row. This is a safety
-- repair of a broken pointer, not an economy backfill — it mints nothing and touches no other type.
update notification_events
   set route = null,
       route_params = '{}'::jsonb
 where type = 'lockin_still_here'
   and route = '/group/[groupId]';

-- ─────────────────────────── verification ───────────────────────────
do $verify$
declare
  v_route text;
  v_bad int;
begin
  -- 1 · the mapping no longer sends a lock-in reminder to a group.
  select route into v_route from notification_route_for('lockin_still_here', jsonb_build_object('session_id', gen_random_uuid()::text));
  if v_route is not null then
    raise exception '0224: lockin_still_here still routes to %, expected null', v_route;
  end if;

  -- 2 · positive control — a type that SHOULD route still does, so the rewrite did not blank the
  --     whole function.
  select route into v_route from notification_route_for('message', jsonb_build_object('group_id', gen_random_uuid()::text));
  if v_route is distinct from '/group/[groupId]' then
    raise exception '0224: message no longer routes to the group chat (got %); the function is over-nulled', v_route;
  end if;

  -- 3 · no stale poison row survives.
  select count(*) into v_bad from notification_events
   where type = 'lockin_still_here' and route = '/group/[groupId]';
  if v_bad <> 0 then
    raise exception '0224: % lockin_still_here rows still carry the placeholder route', v_bad;
  end if;

  raise notice '0224: the stale lock-in reminder is routeless; message rows still open the chat; no poison rows remain';
end
$verify$;
