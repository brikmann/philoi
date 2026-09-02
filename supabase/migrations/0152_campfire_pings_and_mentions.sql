-- 0152 · The two ways to reach one person in a campfire: a mention and a ping (mock 101, §4/§6).
--
-- The campfire-as-chat pass adds two things that both end in someone's notification tray and are
-- otherwise nothing alike:
--
--   @mention — a VISIBLE message aimed at someone. It is posted in the chat, everyone can read it,
--              and the person named is told it was aimed at them. `@all` names the whole fire.
--   ping     — a SILENT nudge. No chat message exists at all; one person gets a push and a bell
--              row and that is the entire interaction.
--
-- They are deliberately separate features with separate entry points (the composer vs the + menu),
-- because they are separate social acts — "hey, in front of everyone" and "hey, just you".
--
-- ══════════════════════════════════════════════════════════════════════════════════════════════
-- WHY A TRIGGER FOR MENTIONS AND AN RPC FOR PINGS
--
-- A mention is a CONSEQUENCE of a message existing, so it belongs on the insert: the client already
-- writes `messages` directly (see lib/api/messages.ts — a plain PostgREST insert, not an RPC), and
-- a trigger means the notification cannot be skipped by any writer, now or later. Asking the client
-- to send the message AND then call a notify RPC would make the notification a second round-trip
-- that fails independently of the message it describes.
--
-- A ping has no row to hang off — nothing is stored — so it has to be a call. It cannot be
-- notify_event directly, because that function is not granted to `authenticated` and must not be:
-- it takes an arbitrary array of user ids and arbitrary copy, so a client that could call it could
-- push anything to anyone. ping_campfire_member is the narrow door — it decides the copy, and it
-- checks that both people share the campfire before it says a word.
--
-- ══════════════════════════════════════════════════════════════════════════════════════════════
-- THE MENTION TOKEN IS A HANDLE, and this file has to agree with src/lib/mentions.ts about that.
--
-- `messages` stores one text column and nothing else, so there is nowhere to keep a structured
-- mention list beside the body — the token in the text IS the data. Display names cannot be that
-- token: they contain spaces, so "@Noah B2 you in?" has no rule that recovers whether the mention
-- was "Noah", "Noah B" or "Noah B2", and they are not unique either. Handles are unique, have no
-- spaces, and are already what the mock's autocomplete shows as the sub-label.
--
-- The regex below is the Postgres twin of MENTION_RE in mentions.ts. If one changes, both change:
--   client:  /(^|[^\w@])@(all|[a-zA-Z0-9_]{2,30})\b/g
--   here:    '(^|[^a-zA-Z0-9_@])@(all|[a-zA-Z0-9_]{2,30})([^a-zA-Z0-9_]|$)'
-- Postgres has no \b, so the trailing boundary is spelled out as a character class.

-- ─────────────────────────── 1 · mentions notify on insert ───────────────────────────

create or replace function notify_message_mentions()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_handles text[];
  v_group groups;
  v_sender text;
  v_targets uuid[];
  v_all boolean;
  v_body text;
begin
  -- Cheap bail before any regex work: the overwhelming majority of messages contain no '@'.
  if new.body is null or position('@' in new.body) = 0 then return new; end if;

  select array_agg(distinct lower(m[2])) into v_handles
  from regexp_matches(new.body, '(^|[^a-zA-Z0-9_@])@(all|[a-zA-Z0-9_]{2,30})([^a-zA-Z0-9_]|$)', 'g') m;

  if v_handles is null then return new; end if;

  select * into v_group from groups where id = new.group_id;
  if v_group.id is null then return new; end if;

  select display_name into v_sender from profiles where id = new.user_id;

  v_all := 'all' = any(v_handles);

  if v_all then
    -- Everyone in the fire except the person who wrote it.
    select coalesce(array_agg(gm.user_id), '{}') into v_targets
    from group_members gm
    where gm.group_id = new.group_id and gm.user_id <> new.user_id;
  else
    -- Only handles that belong to actual MEMBERS of this campfire. Without the group_members
    -- join, "@someone" would notify a stranger who happens to hold that handle — a way to push
    -- arbitrary text to any account in the app by typing their handle into a campfire they are
    -- not in.
    select coalesce(array_agg(p.id), '{}') into v_targets
    from profiles p
    join group_members gm on gm.user_id = p.id and gm.group_id = new.group_id
    where lower(p.handle) = any(v_handles) and p.id <> new.user_id;
  end if;

  if coalesce(array_length(v_targets, 1), 0) = 0 then return new; end if;

  -- Trimmed for the notification body. The full message is one tap away and a push that runs to
  -- 2000 characters is not a push.
  v_body := left(regexp_replace(new.body, E'[\\n\\r]+', ' ', 'g'), 140);

  perform notify_event(
    v_targets,
    'mention',
    case when v_all
      then coalesce(v_sender, 'Someone') || ' mentioned everyone'
      else coalesce(v_sender, 'Someone') || ' mentioned you' end,
    coalesce(v_group.name, 'Your campfire') || ' · ' || v_body,
    new.user_id, new.group_id,
    '/group/[groupId]', jsonb_build_object('groupId', new.group_id::text),
    null, 'rounded',
    jsonb_build_object('message_id', new.id, 'group_id', new.group_id, 'all', v_all)
  );

  return new;
end;
$$;

-- 'mention' already maps to the 'messages' notification category (0026 onward, still true in
-- 0135's per-type gate), so a member who has muted this campfire's chat is filtered by
-- notify_event itself. Nothing to add there.
drop trigger if exists messages_notify_mentions on messages;
create trigger messages_notify_mentions
  after insert on messages
  for each row execute function notify_message_mentions();

-- ─────────────────────────── 2 · the silent nudge ───────────────────────────

/**
 * Ping one member of a campfire you are both in. Posts nothing; sends one notification.
 *
 * THREE GUARDS, and none of them are optional:
 *   · both parties must be members of the campfire — otherwise this is a way to push text to any
 *     account in the app by id;
 *   · you cannot ping yourself, which is only ever a mistake;
 *   · at most one nudge to the same person in the same campfire per 10 minutes. A nudge exists to
 *     be slightly annoying, which is exactly why it needs a ceiling — without one this is a
 *     harassment primitive with a bell icon on it. The limit is silent rather than an error: the
 *     sender is told it went, because telling them it was suppressed just invites a retry.
 *
 * The COPY IS FIXED, server-side. No caller-supplied text, so a ping cannot carry a message —
 * which is the product rule ("silent nudge", not a private DM) and the abuse guard at once.
 */
create or replace function ping_campfire_member(p_group_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group groups;
  v_sender text;
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
  if exists (
    select 1 from notification_events ne
    where ne.user_id = p_user_id
      and ne.actor_id = auth.uid()
      and ne.type = 'campfire_ping'
      and ne.target_id = p_group_id
      and ne.created_at > now() - interval '10 minutes'
  ) then
    return;
  end if;

  select * into v_group from groups where id = p_group_id;
  select display_name into v_sender from profiles where id = auth.uid();

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
end;
$$;

grant execute on function ping_campfire_member(uuid, uuid) to authenticated;

-- ─────────────────────────── 3 · 'campfire_ping' is a campfire notification ───────────────────────────
--
-- notification_category() maps a type to one of the user's five toggles, and its `else` branch
-- files anything unrecognised under 'friends_social'. A nudge from inside a campfire belongs with
-- the campfire toggle, so someone who has muted campfires is not nudged anyway.
--
-- ⚠ THIS FUNCTION RESTATES ITS WHOLE CASE ON EVERY REDEFINITION, and it has already been broken
-- once exactly that way: 0135's own comment records that a version built from 0112 + 0093 without
-- sight of 0120 dropped 'session_complete' onto the else-branch and filed every session recap
-- under Friends & social. So the body below is the CURRENT PROD prosrc, read out of pg_proc, with
-- 'campfire_ping' added to the campfires arm and nothing else touched. Diff it before pushing.
create or replace function notification_category(p_type text)
returns text
language sql
immutable
set search_path = public
as $$
  select case
    when p_type in ('friend_request', 'friend_accepted', 'friend_ranked_up', 'friend_passed_you',
                    'friend_joined', 'friend_locked_in',
                    -- §8 (NOTIFICATIONS_SPEC "Friends & social").
                    'milestone_cheered', 'milestone_posted',
                    -- The Agora (AGORA_SPEC) — reactions to you, on your own posts.
                    'agora_cheered', 'agora_commented',
                    -- notify_push's own names for the same two things.
                    'check_in', 'reaction') then 'friends_social'
    when p_type in ('challenged', 'challenge_accepted', 'challenge_declined', 'challenge_passed',
                    'challenge_ending_soon', 'challenge_won', 'challenge_lost', 'goal_at_risk',
                    'goal_streak_milestone', 'challenge_cheered',
                    -- notify_push's challenge vocabulary.
                    'challenge_invite', 'challenge_forfeited', 'challenge_change_request',
                    'challenge_change_answered', 'challenge_terms_updated') then 'challenges'
    when p_type in ('campfire_joined', 'campfire_join_request', 'campfire_challenge_started',
                    'campfire_cold', 'campfire_added', 'campfire_settled', 'campfire_message',
                    -- notify_push's campfire vocabulary: joining, chat and admin.
                    'join_request', 'join_request_approved', 'campfire_admin_granted',
                    'chat_batch', 'mention',
                    -- 0152: the + menu's silent nudge. A campfire thing, so the campfire toggle
                    -- governs it.
                    'campfire_ping') then 'campfires'
    when p_type in ('streak_at_risk', 'daily_fire_reminder', 'streak_milestone',
                    -- INTEGRATION: 0120 (a parallel branch when this file was written) added the
                    -- session recap and mapped it here — "nudges about my own consistency" is the
                    -- toggle a user already reads as covering it. This function restates its whole
                    -- CASE on every redefinition, and this one was built from 0112 + 0093 without
                    -- sight of 0120, so restating it dropped the mapping onto the else-branch and
                    -- filed every recap under Friends & social. Exactly the half-copy failure the
                    -- comment above 0120's own version warns about, one migration later.
                    'session_complete',
                    -- All three are nudges about your own consistency, which is what this toggle
                    -- says on the tin.
                    'streak_risk', 'lock_in_nudge', 'lockin_still_here') then 'streak_reminders'
    when p_type in ('season_ending', 'season_settled', 'ranked_up', 'rank_dropped', 'reward_ready')
      then 'season_rank'
    else 'friends_social'
  end;
$$;

-- ─────────────────────────── 4 · verification ───────────────────────────
do $$
declare
  v_trig int;
  v_ping int;
  v_cat text;
begin
  select count(*) into v_trig from pg_trigger where tgname = 'messages_notify_mentions' and not tgisinternal;
  select count(*) into v_ping from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'ping_campfire_member';
  select notification_category('campfire_ping') into v_cat;

  if v_trig = 1 then raise notice '0152 ok — mention trigger installed on messages.';
  else raise notice '0152 WARNING — mention trigger missing.'; end if;

  if v_ping = 1 then raise notice '0152 ok — ping_campfire_member exists.';
  else raise notice '0152 WARNING — ping_campfire_member missing.'; end if;

  if v_cat = 'campfires' then raise notice '0152 ok — campfire_ping files under campfires.';
  else raise notice '0152 WARNING — campfire_ping files under %, expected campfires.', v_cat; end if;

  -- The half-copy check: if any of these fell onto the else-branch, notification_category was
  -- restated from a stale base and this migration is the one that broke it.
  if notification_category('session_complete') <> 'streak_reminders'
     or notification_category('mention') <> 'campfires'
     or notification_category('challenge_invite') <> 'challenges'
     or notification_category('ranked_up') <> 'season_rank' then
    raise notice '0152 WARNING — notification_category lost a mapping; it was restated from a stale base.';
  else
    raise notice '0152 ok — notification_category mappings intact across all five categories.';
  end if;
end;
$$;
