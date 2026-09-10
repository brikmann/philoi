-- A NUDGE CAN CARRY ITS OWN WORDS (D5)
--
-- ══════════════════════════════════════════════════════════════════════════════════════════════
-- 0172 made the nudge TELL THE TRUTH about whether it landed ('sent' / 'sent_no_push' /
-- 'rate_limited'). That was the right fix for "it does fuck all", and the ledger says it is live.
-- What it did not do is let the sender say anything: the body is a fixed
--
--     '{sender} nudged you' / 'Get back to {campfire}.'
--
-- and Noah's follow-up is that a nudge nobody wrote is not a nudge — "yo get back to locking in
-- bro" is the whole point. So the sender's line now carries into BOTH halves, the push body and
-- the in-app bell row, because they are the same notification: notify_event writes one row and
-- dispatches from it, so there is exactly one string to change and no way for the two to drift.
--
-- ⚠ ONE FUNCTION, NOT TWO. The message is a THIRD ARGUMENT WITH A DEFAULT rather than a second
-- overload, and that is load-bearing for the builds already on phones. runtimeVersion is still
-- 'sdkVersion' — there is no OTA to those clients — and they call this RPC with exactly two named
-- parameters. PostgREST matches a call by the argument NAMES it was given, so a two-parameter call
-- still resolves to this function and takes the default. An overload pair would instead make that
-- call ambiguous, which is the 0145 trap MIGRATIONS.md records, and 0172's own verification block
-- asserts there is exactly one `ping_campfire_member` — so keeping it at one is also what keeps
-- that assertion true.
--
-- ⚠ DROPPED, not replaced: adding a parameter changes the signature, and `create or replace`
-- refuses it — appending an argument is exactly the case that looks safe and is not. The drop
-- takes the ACL with it, so the grant is restated below (deliberately without the PUBLIC bit 0152
-- left behind, same as 0172).
--
-- 🔒 Firewall: one function. Nothing here moves currency.
-- ══════════════════════════════════════════════════════════════════════════════════════════════

drop function if exists ping_campfire_member(uuid, uuid);
drop function if exists ping_campfire_member(uuid, uuid, text);

create function ping_campfire_member(p_group_id uuid, p_user_id uuid, p_message text default null)
returns text
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_group  groups;
  v_sender text;
  v_will_push boolean;
  v_note   text;
  v_body   text;
begin
  if auth.uid() is null then raise exception 'Not signed in.'; end if;
  if p_user_id = auth.uid() then raise exception 'Pick someone else to nudge.'; end if;

  if not exists (select 1 from group_members where group_id = p_group_id and user_id = auth.uid()) then
    raise exception 'You are not in that campfire.';
  end if;
  if not exists (select 1 from group_members where group_id = p_group_id and user_id = p_user_id) then
    raise exception 'They are not in that campfire.';
  end if;

  -- The sender's own words, or nothing. Trimmed and length-capped HERE rather than trusted from
  -- the client: this string goes out as a push body to someone else's lock screen, and the client
  -- that sent it is the one place we cannot enforce anything. Empty after trimming is treated as
  -- absent, which is what makes the generic line the fallback rather than a blank notification.
  v_note := nullif(btrim(coalesce(p_message, '')), '');
  if v_note is not null then
    v_note := left(v_note, 140);
  end if;

  -- The rate limit, read off the bell rows the previous nudges wrote (0172). Unchanged, and
  -- deliberately NOT relaxed for a custom message: "let me say something different" is not a
  -- reason to be allowed to buzz someone twice inside ten minutes.
  if exists (
    select 1 from notification_events ne
    where ne.user_id = p_user_id
      and ne.actor_id = auth.uid()
      and ne.type = 'campfire_ping'
      and ne.target_id = p_group_id
      and ne.created_at > now() - interval '10 minutes'
  ) then
    return 'rate_limited';
  end if;

  select * into v_group from groups where id = p_group_id;
  select display_name into v_sender from profiles where id = auth.uid();

  -- Will a push actually leave? Answered BEFORE the send, from the same predicates notify_event
  -- applies, plus the thing notify_event cannot see: whether the recipient has a device registered
  -- at all. Best-effort by construction — a diagnosis for the sender, never a gate on the send.
  select
    exists (select 1 from push_tokens t where t.user_id = p_user_id)
    and coalesce((p.notification_prefs->>'master')::boolean, true)
    and coalesce((p.notification_prefs->>'cat_campfires')::boolean, true)
    and coalesce((p.notification_prefs->>'type_campfire_ping')::boolean, true)
    and not is_in_quiet_hours(p.notification_prefs)
  into v_will_push
  from profiles p where p.id = p_user_id;

  -- The title stays "{sender} nudged you" either way — the recipient has to know WHO before they
  -- know what — and only the body carries the custom line. That keeps a nudge recognisable as a
  -- nudge on a lock screen no matter what was typed into it.
  v_body := coalesce(v_note, 'Get back to ' || coalesce(v_group.name, 'the campfire') || '.');

  perform notify_event(
    array[p_user_id],
    'campfire_ping',
    coalesce(v_sender, 'Someone') || ' nudged you',
    v_body,
    auth.uid(), p_group_id,
    '/group/[groupId]', jsonb_build_object('groupId', p_group_id::text),
    null, 'rounded',
    -- The note rides in the payload too, so an in-app surface that wants to render it differently
    -- from the push body has it without re-parsing the sentence.
    jsonb_build_object('group_id', p_group_id, 'kind', 'ping', 'note', v_note)
  );

  -- 'sent'          — a bell row was written and a push was dispatched to a real device.
  -- 'sent_no_push'  — the bell row is there and they will see it in-app, but nothing buzzed:
  --                   no registered device, notifications off, or quiet hours.
  return case when coalesce(v_will_push, false) then 'sent' else 'sent_no_push' end;
end;
$fn$;

grant execute on function ping_campfire_member(uuid, uuid, text) to anon, authenticated, service_role;

comment on function ping_campfire_member(uuid, uuid, text) is
  'Silent nudge to one campfire member, with an optional sender-written line (0181; trimmed, '
  'capped at 140, falls back to the generic body when empty). Returns ''sent'', ''sent_no_push'' '
  'or ''rate_limited'' — see 0172 for why it has a return value at all.';

-- PostgREST caches the schema; a signature change is invisible to it until it reloads, and an
-- un-reloaded cache is what turns this into "the RPC 404s on device but works in SQL".
notify pgrst, 'reload schema';

-- ─────────────────────────── verification ───────────────────────────
--
-- The body, not the DDL. A dry-run proves this compiles; only calling it proves the default
-- resolves, the custom line reaches the notification, and the empty string falls back.
do $verify$
declare
  v_n      int;
  v_group  uuid;
  v_sender uuid;
  v_target uuid;
  v_res    text;
  v_body   text;
begin
  select count(*) into v_n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'ping_campfire_member';
  if v_n <> 1 then
    raise exception '0181: ping_campfire_member has % overloads, expected exactly 1', v_n;
  end if;

  -- Two members of one campfire, or there is nothing to nudge.
  select a.group_id, a.user_id, b.user_id
    into v_group, v_sender, v_target
  from group_members a
  join group_members b on b.group_id = a.group_id and b.user_id <> a.user_id
  limit 1;

  if v_group is null then
    raise notice '0181: no two-member campfire to probe — signature checked, body not exercised';
    return;
  end if;

  -- security definer reads auth.uid(); impersonate the sender so the body actually runs.
  perform set_config('request.jwt.claims', json_build_object('sub', v_sender::text)::text, true);

  -- ⚠ NO REAL PHONE MAY BUZZ FOR A MIGRATION.
  --
  -- The probes below call the RPC for real, against two real members of a real campfire, because
  -- that is the only way to test a plpgsql BODY — a begin/rollback dry-run proves the DDL and
  -- nothing else. But notify_event dispatches to Expo through notify_push_raw, and an HTTP call
  -- does not roll back: a verification block that "cleans up after itself" would still have sent
  -- three push notifications to somebody's lock screen.
  --
  -- 0120 added `philoi.suppress_push` for exactly this. It short-circuits the dispatch and leaves
  -- everything before it — the notification_events insert, the preference gates, the return value
  -- — running normally, which is precisely the half being asserted on here. `true` scopes it to
  -- this transaction, so it cannot leak into anything that runs after this migration.
  perform set_config('philoi.suppress_push', 'on', true);

  -- POSITIVE: the custom line reaches the notification body.
  delete from notification_events
  where user_id = v_target and actor_id = v_sender and type = 'campfire_ping'
    and created_at > now() - interval '10 minutes';

  v_res := ping_campfire_member(v_group, v_target, '  yo get back to locking in bro  ');
  if v_res not in ('sent', 'sent_no_push') then
    raise exception '0181: a first nudge returned %, expected sent/sent_no_push', v_res;
  end if;

  select body into v_body from notification_events
  where user_id = v_target and actor_id = v_sender and type = 'campfire_ping'
  order by created_at desc limit 1;

  if v_body <> 'yo get back to locking in bro' then
    raise exception '0181: custom nudge body was %, expected the trimmed sender line', v_body;
  end if;

  -- NEGATIVE CONTROL for that positive: an all-whitespace message must NOT produce a blank body,
  -- it must fall back to the generic line. Without this, the assertion above would pass on an
  -- implementation that simply wrote whatever it was handed.
  delete from notification_events
  where user_id = v_target and actor_id = v_sender and type = 'campfire_ping'
    and created_at > now() - interval '10 minutes';

  perform ping_campfire_member(v_group, v_target, '   ');
  select body into v_body from notification_events
  where user_id = v_target and actor_id = v_sender and type = 'campfire_ping'
  order by created_at desc limit 1;

  if v_body like 'yo get back%' or v_body is null or btrim(v_body) = '' then
    raise exception '0181: an empty message did not fall back to the generic body (got %)', v_body;
  end if;

  -- And the two-argument call — the shape every already-installed build sends — still resolves.
  delete from notification_events
  where user_id = v_target and actor_id = v_sender and type = 'campfire_ping'
    and created_at > now() - interval '10 minutes';

  v_res := ping_campfire_member(p_group_id => v_group, p_user_id => v_target);
  if v_res not in ('sent', 'sent_no_push') then
    raise exception '0181: the legacy two-argument call returned %', v_res;
  end if;

  -- Leave no test nudges behind.
  delete from notification_events
  where user_id = v_target and actor_id = v_sender and type = 'campfire_ping'
    and created_at > now() - interval '10 minutes';

  raise notice '0181: custom line lands, blank falls back, two-arg call still resolves';
end
$verify$;
