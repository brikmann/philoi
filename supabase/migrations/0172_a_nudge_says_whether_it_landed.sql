-- THE NUDGE THAT "DOES FUCK ALL" (D5)
--
-- ══════════════════════════════════════════════════════════════════════════════════════════════
-- WHAT WAS ACTUALLY BROKEN — because it was NOT what it looked like
--
-- The reported symptom was "you tap ping and nothing happens to anyone". The obvious suspects were
-- all innocent, and each was checked against prod rather than against a migration file:
--
--   · ping_campfire_member IS deployed, and its prod prosrc is byte-identical to 0152's.
--   · It IS granted to `authenticated`.
--   · notification_category('campfire_ping') = 'campfires' and notification_push_default = true,
--     so the notify_event pref gates pass.
--   · notify_push_raw computes v_pref_key = null for this type, so its legacy-pref filter
--     short-circuits and it posts to Expo for every registered device.
--   · notification_events has never been purged (August rows are still there).
--
-- And yet: `select count(*) from notification_events where type = 'campfire_ping'` = 0. Not one
-- nudge has ever completed, in the entire life of the feature. So there was no push bug to find —
-- the push path was never reached.
--
-- What makes that state persist, and what this migration fixes, is that THE FUNCTION CANNOT TELL
-- ANYONE WHAT HAPPENED. It `returns void`, and it has two silent non-delivery paths:
--
--   1. THE RATE LIMIT RETURNS SILENTLY. Within ten minutes of a previous nudge to the same person
--      in the same campfire it `return`s having done nothing at all — and the sheet, which reads
--      "no exception" as "sent", still flips the row to "nudged". This is the exact shape of the
--      complaint, and it is self-reinforcing while testing: the first nudge is missed (recipient's
--      phone is on a desk), the tester taps again, and every further attempt for ten minutes is
--      swallowed while showing success.
--   2. NO DEVICE IS NOT AN ERROR. Only 4 of 10 profiles on prod have a push_tokens row. A nudge to
--      the other 6 writes a bell row, dispatches nothing, and reports success.
--
-- So the fix is not to the delivery path. It is to make the RPC ANSWER THE QUESTION, so the sender
-- is told the truth and the next person to debug this has a signal instead of a shrug.
--
-- ⚠ DROPPED, not replaced: void → text is a return-type change, which `create or replace` refuses.
-- The argument list is unchanged, so no second overload survives (MIGRATIONS.md, the 0145 trap).
-- ══════════════════════════════════════════════════════════════════════════════════════════════

drop function if exists ping_campfire_member(uuid, uuid);

create function ping_campfire_member(p_group_id uuid, p_user_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_group groups;
  v_sender text;
  v_will_push boolean;
begin
  if auth.uid() is null then raise exception 'Not signed in.'; end if;
  if p_user_id = auth.uid() then raise exception 'Pick someone else to nudge.'; end if;

  if not exists (select 1 from group_members where group_id = p_group_id and user_id = auth.uid()) then
    raise exception 'You are not in that campfire.';
  end if;
  if not exists (select 1 from group_members where group_id = p_group_id and user_id = p_user_id) then
    raise exception 'They are not in that campfire.';
  end if;

  -- The rate limit, read off the bell rows the previous nudges wrote. No new table: notification
  -- events already record actor, target and time, which is exactly the three things needed.
  --
  -- 0172 · it now SAYS SO instead of returning silently. Still not an exception: being nudged
  -- twice in ten minutes is a normal thing to attempt, not an error the sender did.
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
  -- at all. Best-effort by construction — notify_event stays authoritative for what it does, and
  -- this is a diagnosis for the sender, never a gate on the send.
  select
    exists (select 1 from push_tokens t where t.user_id = p_user_id)
    and coalesce((p.notification_prefs->>'master')::boolean, true)
    and coalesce((p.notification_prefs->>'cat_campfires')::boolean, true)
    and coalesce((p.notification_prefs->>'type_campfire_ping')::boolean, true)
    and not is_in_quiet_hours(p.notification_prefs)
  into v_will_push
  from profiles p where p.id = p_user_id;

  perform notify_event(
    array[p_user_id],
    'campfire_ping',
    coalesce(v_sender, 'Someone') || ' nudged you',
    'Get back to ' || coalesce(v_group.name, 'the campfire') || '.',
    auth.uid(), p_group_id,
    '/group/[groupId]', jsonb_build_object('groupId', p_group_id::text),
    null, 'rounded',
    jsonb_build_object('group_id', p_group_id, 'kind', 'ping')
  );

  -- 'sent'          — a bell row was written and a push was dispatched to a real device.
  -- 'sent_no_push'  — the bell row is there and they will see it in-app, but nothing buzzed:
  --                   no registered device, notifications off, or quiet hours. The sheet says so
  --                   rather than claiming a delivery that did not happen.
  return case when coalesce(v_will_push, false) then 'sent' else 'sent_no_push' end;
end;
$fn$;

-- The drop took the whole ACL with it. Note what is NOT restored: 0152 left this function with a
-- PUBLIC execute bit (`=X/postgres` in proacl) alongside anon and authenticated. It is security
-- definer and it pushes notifications, so PUBLIC is a wider door than it ever needed; anon and
-- authenticated below cover every role a client can reach the API as, and the body's own
-- `auth.uid() is null` guard already refuses an anonymous caller.
grant execute on function ping_campfire_member(uuid, uuid) to anon, authenticated, service_role;

comment on function ping_campfire_member(uuid, uuid) is
  'Silent nudge to one campfire member. Returns ''sent'', ''sent_no_push'' (bell row written but '
  'no device buzzed) or ''rate_limited'' (a nudge to this person in this campfire inside 10 min). '
  '0172 gave it a return value because both non-delivery paths used to be silent.';

do $verify$
declare v_n int;
begin
  select count(*) into v_n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'ping_campfire_member';
  if v_n <> 1 then
    raise exception '0172: ping_campfire_member has % overloads, expected exactly 1', v_n;
  end if;
  if (select pg_get_function_result(p.oid) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'ping_campfire_member') <> 'text' then
    raise exception '0172: ping_campfire_member did not come back as returns text';
  end if;
end
$verify$;
