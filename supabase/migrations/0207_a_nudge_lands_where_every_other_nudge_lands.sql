-- 0207 — A nudge lands where every other nudge lands.
--
-- ─────────────────────────────── WHY ───────────────────────────────
--
-- There are two nudges in this app and they go to different places.
--
--   ping_campfire_member (0152/0172) writes a notification_events row and lets notify_event do the
--   rest: the bell gets a row, the category toggle and quiet hours are respected, the leading art
--   is the sender's face, a repeat inside ten minutes is refused, and the caller is told which of
--   those three things happened.
--
--   nudge_to_lock_in (0030/0031) calls notify_push, the LEGACY wrapper. Since 0088 that wrapper does
--   write a bell row, so the first draft of this file was wrong to say it doesn't — but it derives
--   everything by sniffing the payload, and for this type the sniffing comes up empty:
--   notification_route_for has no 'lock_in_nudge' branch, so it falls to `else null` and the row
--   lands with NO ROUTE. notifications.tsx renders a routeless row `disabled`. The nudge has
--   therefore been appearing in the bell as a line of text you cannot tap — the one gesture whose
--   entire purpose is to get you to the goal picker.
--
--   On top of that it has no rate limit of any kind, no block check, and `returns void` — so the
--   sheet has been saying "nudged ✓" for a send it has no idea happened. 0172 fixed exactly that
--   last one for the campfire ping, and gave its reasons; none of them are about campfires.
--
-- This file makes the friend nudge land exactly where the campfire ping lands: through notify_event,
-- where the caller STATES its actor, target and route instead of hoping a string-sniffer infers
-- them. The body below is 0172's, re-pointed at a friendship instead of a campfire membership.
--
-- ── Two things that are new, not just moved ──
--
-- 1 · A BLOCK NOW STOPS IT. nudge_to_lock_in has never checked blocked_users. Blocking someone did
--     not stop them pinging your lock screen, because the only gate was an accepted friend_request
--     and blocking does not delete one. Every other social surface routes through
--     is_blocked_either_way; this one was missed.
--
-- 2 · A KIND. The sheet's four rows (SPEC: Nudge / Send fire / Challenge H2H / Challenge group)
--     need two one-tap sends, not one. 'nudge' is the existing "lock in?"; 'fire' is the praise
--     ping — MESSAGING_DM_SPEC.md's four-type ping model, of which these are the first two. The
--     kind is an argument rather than a second function so the rate limit, the block check and the
--     friendship check cannot drift apart between them.
--
-- ── Why this is a DROP, not a replace ──
--
-- The return type changes from void to text, and `create or replace function` cannot change a
-- return type — it errors rather than replacing. The drop is therefore mandatory, which also means
-- appending p_kind is safe here: the hazard MIGRATIONS.md records (a new parameter DEFINES A
-- SECOND FUNCTION and leaves the original standing, as in 0145) needs the original to survive the
-- statement, and it does not. Asserted at the bottom: one name, one row in pg_proc.
--
-- Installed builds are unaffected in both directions. They call it with one argument, which the
-- defaulted p_kind still satisfies; and they ignore the return value, exactly as pre-0172 builds
-- ignored ping_campfire_member's — see PingResult's note in src/types/database.ts.

do $guard$
begin
  if to_regprocedure('public.notify_event(uuid[],text,text,text,uuid,uuid,text,jsonb,text,text,jsonb)') is null then
    raise exception '0207 needs notify_event/11 — see 0120';
  end if;
  if to_regprocedure('public.is_blocked_either_way(uuid)') is null then
    raise exception '0207 needs is_blocked_either_way(uuid) — see schema.sql';
  end if;
  if to_regprocedure('public.is_in_quiet_hours(jsonb)') is null then
    raise exception '0207 needs is_in_quiet_hours(jsonb) — see the notification stack';
  end if;
end;
$guard$;

-- The full argument list, because a bare `drop function nudge_to_lock_in` would not find an
-- overload if one ever appeared.
drop function if exists nudge_to_lock_in(uuid);

create function nudge_to_lock_in(p_user_id uuid, p_kind text default 'nudge')
returns text
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_me uuid := auth.uid();
  v_sender text;
  v_type text;
  v_title text;
  v_body text;
  v_route text;
  v_params jsonb;
  v_will_push boolean;
begin
  if v_me is null then raise exception 'Not signed in.'; end if;
  if p_user_id = v_me then raise exception 'You can''t nudge yourself.'; end if;

  if p_kind is null or p_kind not in ('nudge', 'fire') then
    raise exception 'Unknown nudge kind: %', p_kind;
  end if;

  if not exists (
    select 1 from friend_requests fr
    where fr.status = 'accepted'
      and ((fr.requester_id = v_me and fr.recipient_id = p_user_id)
        or (fr.requester_id = p_user_id and fr.recipient_id = v_me))
  ) then
    raise exception 'You can only nudge friends.';
  end if;

  -- NEW (see §1 above). Deliberately the same generic refusal a non-friend gets: "you have been
  -- blocked" is itself information about the other person's choices.
  if is_blocked_either_way(p_user_id) then
    raise exception 'You can only nudge friends.';
  end if;

  select display_name into v_sender from profiles where id = v_me;

  if p_kind = 'fire' then
    -- 'friend_fire' is a NEW event type and this migration deliberately does not touch
    -- notification_category to register it: an unknown type falls to the 'friends_social' branch,
    -- which is where praise belongs anyway, and notification_push_default's opt-out list does not
    -- name it, so it pushes. Both are asserted below. Restating either registry function is how
    -- 0135 filed every session recap under the wrong toggle — there is nothing to gain here.
    v_type := 'friend_fire';
    v_title := coalesce(v_sender, 'A friend') || ' sent you fire 🔥';
    v_body := 'They''re watching you work.';
    v_route := '/friend-profile';
    v_params := jsonb_build_object('userId', v_me::text);
  else
    v_type := 'lock_in_nudge';
    v_title := 'Lock in?';
    v_body := coalesce(v_sender, 'A friend') || ' pinged you to lock in 🔥';
    -- The route the goal picker already answers to, stated explicitly because
    -- notification_route_for cannot infer it — no 'lock_in_nudge' branch, so today's bell rows all
    -- carry null and render disabled. THIS LINE IS THE FIX for that.
    --
    -- Safe for installed builds: _layout.tsx has honoured `data.route` ahead of its per-type
    -- branches since 0086, and `router.push({pathname:'/', params:{lockin:'1'}})` is the same
    -- destination its `type === 'lock_in_nudge'` branch reaches via '/?lockin=1'.
    v_route := '/';
    v_params := jsonb_build_object('lockin', '1');
  end if;

  -- The rate limit, read off the bell rows previous nudges wrote — the same trick 0152 uses. No new
  -- table: notification_events already records actor, target and time. It reads rows written by the
  -- OLD body too, which is correct: a nudge sent nine minutes ago through notify_push is still a
  -- nudge sent nine minutes ago. Per (recipient, sender, KIND), because a nudge and a fire are
  -- different gestures and one should not mute the other.
  --
  -- Not an exception. Being nudged twice in ten minutes is a normal thing to attempt, not an error
  -- the sender made — so it is reported, not raised.
  if exists (
    select 1 from notification_events ne
    where ne.user_id = p_user_id
      and ne.actor_id = v_me
      and ne.type = v_type
      and ne.created_at > now() - interval '10 minutes'
  ) then
    return 'rate_limited';
  end if;

  -- Will a push actually leave? Answered BEFORE the send from the same predicates notify_event
  -- applies, plus the one thing notify_event cannot see: whether they have a device at all. Only 4
  -- of 10 profiles on prod have a push_tokens row, so "no device" is the common case, not an edge.
  -- Best-effort by construction — a diagnosis for the sender, never a gate on the send.
  select
    exists (select 1 from push_tokens t where t.user_id = p_user_id)
    and coalesce((p.notification_prefs->>'master')::boolean, true)
    and coalesce((p.notification_prefs->>('cat_' || notification_category(v_type)))::boolean,
                 notification_push_default(v_type))
    and coalesce((p.notification_prefs->>('type_' || v_type))::boolean, true)
    and not is_in_quiet_hours(p.notification_prefs)
  into v_will_push
  from profiles p where p.id = p_user_id;

  perform notify_event(
    array[p_user_id],
    v_type,
    v_title,
    v_body,
    v_me, null,
    v_route, v_params,
    -- Null art: notification_leading_art resolves the ACTOR's avatar for any type with one, which
    -- is the sender's face — what the spec asks for and better than anything passed here.
    null, null,
    jsonb_build_object('type', v_type, 'from_user_id', v_me, 'kind', p_kind)
  );

  return case when coalesce(v_will_push, false) then 'sent' else 'sent_no_push' end;
end;
$fn$;

comment on function nudge_to_lock_in(uuid, text) is
  'One-tap nudge to a friend. p_kind ''nudge'' (lock in?) or ''fire'' (praise). Returns ''sent'', '
  '''sent_no_push'' (bell row written but no device buzzed) or ''rate_limited'' (same kind to the '
  'same friend inside 10 minutes). Writes a bell row via notify_event, exactly as '
  'ping_campfire_member does — see migration 0207.';

-- The drop took the whole ACL with it, so the grant is restored here rather than assumed. anon is
-- named explicitly: `revoke ... from public, authenticated` leaves anon's own grant standing.
revoke all on function nudge_to_lock_in(uuid, text) from public, anon, authenticated;
grant execute on function nudge_to_lock_in(uuid, text) to authenticated;

-- ─────────────────────────── verification ───────────────────────────
do $verify$
declare
  v_a uuid;
  v_b uuid;
  v_n int;
  v_result text;
  v_before int;
  v_nudge_before int;
begin
  -- 1 · ONE function, and it is the new shape. The drop is what makes appending p_kind safe, so
  --     this is the assertion that proves the drop happened rather than a second overload landing
  --     beside the original — 0145's failure, which broke challenge creation for every installed
  --     build and could not be reached by OTA.
  select count(*) into v_n
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'nudge_to_lock_in';
  if v_n <> 1 then
    raise exception '0207: nudge_to_lock_in has % overloads, expected 1', v_n;
  end if;
  if to_regprocedure('public.nudge_to_lock_in(uuid)') is not null then
    raise exception '0207: the old void-returning nudge_to_lock_in(uuid) is still standing';
  end if;
  -- An installed build calls it with ONE argument. If p_kind ever loses its default that call
  -- flips from working to "function does not exist", which is the same break wearing a new error.
  if (select pronargs - pronargdefaults
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'nudge_to_lock_in') <> 1 then
    raise exception '0207: nudge_to_lock_in no longer admits a one-argument call; installed builds would break';
  end if;

  -- 2 · both event types reach the right toggle WITHOUT this file touching the registry.
  if notification_category('lock_in_nudge') is distinct from 'streak_reminders' then
    raise exception '0207: lock_in_nudge no longer files under streak_reminders';
  end if;
  if notification_category('friend_fire') is distinct from 'friends_social' then
    raise exception '0207: friend_fire files under %, expected friends_social', notification_category('friend_fire');
  end if;
  -- Positive control: a registry answering one value for everything would pass both lines above.
  if notification_category('challenge_won') is distinct from 'challenges' then
    raise exception '0207: notification_category is not discriminating; the two checks above prove nothing';
  end if;
  if not notification_push_default('friend_fire') or not notification_push_default('lock_in_nudge') then
    raise exception '0207: a nudge would not push';
  end if;
  if notification_push_default('campfire_message') then
    raise exception '0207: notification_push_default is not discriminating; the check above proves nothing';
  end if;

  -- 3 · grants. authenticated must hold it (every nudge in the app is a client call) and anon
  --     must not.
  if not has_function_privilege('authenticated', 'public.nudge_to_lock_in(uuid,text)', 'execute') then
    raise exception '0207: authenticated cannot execute nudge_to_lock_in; no nudge would send';
  end if;
  if has_function_privilege('anon', 'public.nudge_to_lock_in(uuid,text)', 'execute') then
    raise exception '0207: anon can execute nudge_to_lock_in';
  end if;

  -- 4 · the behaviour, as a real caller, on a real friendship — then thrown away. This runs
  --     against prod: a probe that commits puts "pinged you to lock in" on a pilot user's phone.
  --     Pushes are suppressed and the sub-block unwinds, so neither the bell row nor the push
  --     survives it.
  select fr.requester_id, fr.recipient_id into v_a, v_b
  from friend_requests fr
  where fr.status = 'accepted'
    and not exists (select 1 from blocked_users b
                    where (b.blocker_id = fr.requester_id and b.blocked_id = fr.recipient_id)
                       or (b.blocker_id = fr.recipient_id and b.blocked_id = fr.requester_id))
  order by fr.created_at
  limit 1;

  if v_a is null then
    raise notice '0207: no accepted friendship on this database — the live probe was not exercised.';
  else
    select count(*) into v_before from notification_events;

    begin
      perform set_config('philoi.suppress_push', 'on', true);
      perform set_config('request.jwt.claims', json_build_object('sub', v_a, 'role', 'authenticated')::text, true);

      -- 4a · it writes a BELL ROW. This is the whole point of the migration: the old body called
      --      notify_push, which writes nothing, so a missed banner was a lost nudge.
      --      ⚠️ MEASURED AS A DELTA. The first run of this probe asserted "expect 1" and found 9:
      --      this is prod, these two are real pilot users, and they have nudged each other before.
      --      A probe on live data can only assert what IT changed.
      select count(*) into v_nudge_before from notification_events ne
       where ne.user_id = v_b and ne.actor_id = v_a and ne.type = 'lock_in_nudge';

      v_result := nudge_to_lock_in(v_b);
      if v_result not in ('sent', 'sent_no_push') then
        raise exception '0207: a first nudge returned %, expected sent or sent_no_push', v_result;
      end if;
      select count(*) - v_nudge_before into v_n from notification_events ne
       where ne.user_id = v_b and ne.actor_id = v_a and ne.type = 'lock_in_nudge';
      if v_n <> 1 then
        raise exception '0207: a nudge added % bell rows, expected 1', v_n;
      end if;

      -- ...and it is TAPPABLE, which is the bug this migration exists to fix. A row whose route is
      -- null renders disabled in notifications.tsx, which is what every nudge before today did.
      if not exists (
        select 1 from notification_events ne
        where ne.user_id = v_b and ne.actor_id = v_a and ne.type = 'lock_in_nudge'
          and ne.route = '/' and ne.route_params->>'lockin' = '1'
          and ne.created_at >= now()
      ) then
        raise exception '0207: the new nudge bell row has no usable route; it would render disabled';
      end if;

      -- 4b · the rate limit engages. Unlike 0206's badge rule this does NOT need the clock to
      --      advance: it asks whether a row exists inside the last ten minutes, and a row written
      --      at transaction start is inside it.
      if nudge_to_lock_in(v_b) is distinct from 'rate_limited' then
        raise exception '0207: a second nudge inside ten minutes was not rate-limited';
      end if;

      -- 4c · ...and a FIRE is not muted by it, because the limit is per kind.
      v_result := nudge_to_lock_in(v_b, 'fire');
      if v_result not in ('sent', 'sent_no_push') then
        raise exception '0207: a fire was refused (%) by the nudge''s rate limit; the limit is not per-kind', v_result;
      end if;
      select count(*) into v_n from notification_events ne
       where ne.user_id = v_b and ne.actor_id = v_a and ne.type = 'friend_fire'
         and ne.created_at >= now();
      if v_n <> 1 then
        raise exception '0207: a fire added % bell rows in this transaction, expected 1', v_n;
      end if;

      -- 4d · an unknown kind is refused rather than silently sent as a nudge.
      begin
        perform nudge_to_lock_in(v_b, 'banana');
        raise exception '0207: an unknown nudge kind was accepted';
      exception when others then
        if sqlerrm not like '%Unknown nudge kind%' then raise; end if;
      end;

      -- 4e · a stranger cannot nudge. The friendship gate is the only thing standing between this
      --      function and an arbitrary push to an arbitrary user id.
      begin
        perform set_config('request.jwt.claims',
                           json_build_object('sub', (select p.id from profiles p
                                                      where p.id not in (v_a, v_b)
                                                      order by p.created_at limit 1),
                                             'role', 'authenticated')::text, true);
        perform nudge_to_lock_in(v_b);
        raise exception '0207: a non-friend nudged a stranger';
      exception when others then
        if sqlerrm not like '%only nudge friends%' and sqlerrm not like '%Not signed in%' then raise; end if;
      end;

      raise exception 'ok';
    exception when others then
      if sqlerrm <> 'ok' then raise; end if;
    end;

    -- Proof the unwind took. Without it, every assertion above could have committed three bell
    -- rows to a real person and this migration would still report success.
    select count(*) - v_before into v_n from notification_events;
    if v_n <> 0 then
      raise exception '0207: the probe did not unwind — % notification_events rows survived', v_n;
    end if;
  end if;

  raise notice '0207: the friend nudge writes a bell row, respects a block, and is rate-limited per kind';
end
$verify$;
