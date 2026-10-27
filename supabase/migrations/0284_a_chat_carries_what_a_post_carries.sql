-- 0284 — A chat carries what a post carries.
--
-- ─────────────────────────────── WHY ───────────────────────────────
--
-- Chats (Social → Chats, mock 320) were three surfaces with three different abilities: a DM could
-- only hold text (0206), a campfire could hold photos and a shared session (0158/0180), and a
-- forest had no chat at all — only its Agora channel. Composing to a person should work the way
-- composing to the Agora does: a note, a photo, a file of study notes, a session, a win, an anthem.
--
-- ── Why no chat_threads / chat_members / chat_messages ──
--
-- The brief sketched a fresh three-table model. Building it would have meant a SECOND home for
-- every DM — dm_threads/dm_messages already are the persistent 1:1 store, with friends-only
-- opening, mutual blocking, read state, push and the UGC filter wired to them, and installed
-- builds read them directly. A parallel table would either strand those rows or have to be kept in
-- step with them forever. So this extends what exists:
--
--   · DMs      — dm_messages gains `attachments` (the Agora's 0140 shape) and a 'media' kind.
--   · Forests  — forest_messages, a room chat gated on forest_members (status 'active'). Room
--                membership stays forest_members' truth; nothing is copied into a member table.
--   · Campfire — unchanged here. Its chat stays on `messages`; it only gains read state below.
--   · chat_reads — per-member read pointer + mute for the room kinds that had none (campfire,
--                forest) and mute for DMs. DM read pointers stay on dm_threads, where 0206 put them.
--
-- ── Attachments are the Agora's, frozen the same way ──
--
-- `{kind, ref_id, key, snapshot}`, the 0140 element shape, so the client draws a shared session or
-- reward with the SAME AttachmentRow the feed uses. The share kinds reuse agora_attachment_snapshot
-- (lockin · milestone · rank · streak · pass · cosmetic · pr), which re-reads each fact scoped to
-- the sender and returns null for anything not theirs — every null raises, as in create_agora_post.
-- Two kinds are chat-only: 'image' and 'file', both objects in the new PRIVATE `chat-media` bucket,
-- plus 'anthem' (the sender's saved grind song, frozen from profile_identity).
--
-- 'video' is deliberately NOT accepted yet. The clip path is 0279 + agora-video-upload-url, which
-- is committed-but-unapplied; DM video lands when that does, as one more kind in this function.
--
-- ── Installed builds ──
--
-- OTA is closed, so what a shipped build does with these rows is decided by code already out there:
--   · A media-only DM is kind 'media'. The shipped DM screen renders only 'text' and skips the rest
--     (0206's rule), so it falls silent rather than drawing an empty bubble.
--   · A DM with text AND attachments stays kind 'text': a shipped build shows the words and not the
--     media, which is the better half to lose.
--   · get_my_dm_threads keeps its signature; its preview falls back to "Sent a photo" etc., and a
--     thread whose last message is media-only no longer drops out of the shipped inbox.
--
-- ── Storage ──
--
-- Key shape `<scope>/<room id>/<uploader id>/<uuid>.<ext>`. The bucket's read policy asks the same
-- membership question the row's read policy asks, so a non-member can neither read the row nor
-- sign a URL for its file. Media is HARD-deleted when its message is deleted or cascaded away
-- (#149), with storage.allow_delete_query set exactly as 0278 had to.
--
-- ── Lock-in threads (0270) ──
--
-- The in-session overlay stays as it is — its UX is right for a live session. Chats owns
-- persistence: every lock-in message between friends is mirrored into their DM thread (and the
-- last two days of them backfilled), because lockin_messages is purged after two days and that
-- purge was silently eating conversations. The mirror never pushes (the overlay already did) and
-- can never fail the overlay's send.
--
-- ── Push ──
--
-- DM + forest pushes honour profiles.show_message_previews (the settings toggle that until now only
-- campfire chat honoured — dm_send sent the raw body to everyone) and a per-thread mute. Forest
-- chat is filed under the campfires category with the other room chatter.

do $guard$
begin
  if to_regprocedure('public.agora_attachment_snapshot(uuid,text,uuid,text)') is null then
    raise exception '0284 needs agora_attachment_snapshot/4 — see 0140';
  end if;
  if to_regclass('public.forest_members') is null then
    raise exception '0284 needs forest_members — see 0274';
  end if;
  if to_regclass('public.lockin_messages') is null then
    raise exception '0284 needs lockin_messages — see 0270';
  end if;
  if to_regprocedure('public.ugc_assert_clean(text)') is null then
    raise exception '0284 needs ugc_assert_clean — see 0242';
  end if;
end;
$guard$;

-- ─────────────────────────── 1. room membership, one question ───────────────────────────

create or replace function public.is_forest_chat_member(p_forest_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from forest_members fm
      join forests f on f.id = fm.forest_id
     where fm.forest_id = p_forest_id
       and fm.user_id = auth.uid()
       and fm.status = 'active'
       and f.removed_at is null
  );
$$;

-- The bucket's policies call this with the first two path segments. Text in, so a malformed key
-- reads as DENY instead of raising a cast error out of a storage request.
create or replace function public.chat_can_use_room(p_scope text, p_room text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_room uuid;
begin
  if p_room is null or p_room !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return false;
  end if;
  v_room := p_room::uuid;
  return case p_scope
    when 'dm' then is_dm_member(v_room)
    when 'forest' then is_forest_chat_member(v_room)
    else false
  end;
end;
$$;

-- RLS policy functions run as the querying role, so `authenticated` needs EXECUTE on both.
revoke all on function public.is_forest_chat_member(uuid) from public, anon;
revoke all on function public.chat_can_use_room(text, text) from public, anon;
grant execute on function public.is_forest_chat_member(uuid) to authenticated;
grant execute on function public.chat_can_use_room(text, text) to authenticated;

-- ─────────────────────────── 2. the private bucket ───────────────────────────

do $bucket$
begin
  if to_regclass('storage.buckets') is null then
    raise notice 'storage schema absent — skipping chat-media bucket provisioning';
    return;
  end if;

  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('chat-media', 'chat-media', false, 20971520, array[
    'image/jpeg', 'image/png', 'image/webp', 'image/heic',
    'application/pdf', 'text/plain', 'text/markdown',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ])
  on conflict (id) do update
    set public = false,
        file_size_limit = excluded.file_size_limit,
        allowed_mime_types = excluded.allowed_mime_types;

  execute 'drop policy if exists "chat media: read if room member" on storage.objects';
  execute 'create policy "chat media: read if room member" on storage.objects
    for select to authenticated
    using (bucket_id = ''chat-media''
           and public.chat_can_use_room((storage.foldername(name))[1], (storage.foldername(name))[2]))';

  execute 'drop policy if exists "chat media: insert own into own room" on storage.objects';
  execute 'create policy "chat media: insert own into own room" on storage.objects
    for insert to authenticated
    with check (bucket_id = ''chat-media''
                and (storage.foldername(name))[3] = auth.uid()::text
                and public.chat_can_use_room((storage.foldername(name))[1], (storage.foldername(name))[2]))';

  execute 'drop policy if exists "chat media: delete own" on storage.objects';
  execute 'create policy "chat media: delete own" on storage.objects
    for delete to authenticated
    using (bucket_id = ''chat-media'' and (storage.foldername(name))[3] = auth.uid()::text)';
end;
$bucket$;

-- ─────────────────────────── 3. tables ───────────────────────────

alter table public.dm_messages
  add column if not exists attachments jsonb not null default '[]'::jsonb,
  -- The lock-in message this row mirrors (section 9). Unique, so the mirror and the backfill are
  -- idempotent. No FK: lockin_messages is purged after two days and the DM must outlive it.
  add column if not exists lockin_message_id uuid;

create unique index if not exists dm_messages_lockin_message_idx
  on public.dm_messages (lockin_message_id) where lockin_message_id is not null;

alter table public.dm_messages drop constraint if exists dm_messages_kind_check;
alter table public.dm_messages add constraint dm_messages_kind_check
  check (kind in ('text', 'challenge', 'invite', 'cheer', 'media'));

do $$
begin
  alter table public.dm_messages
    add constraint dm_messages_attachments_is_array check (jsonb_typeof(attachments) = 'array');
exception
  when duplicate_object then null;
end;
$$;

do $$
begin
  alter table public.dm_messages
    add constraint dm_messages_media_has_attachments
    check (kind <> 'media' or jsonb_array_length(attachments) > 0);
exception
  when duplicate_object then null;
end;
$$;

create table if not exists public.forest_messages (
  id          uuid primary key default gen_random_uuid(),
  forest_id   uuid not null references public.forests(id) on delete cascade,
  sender_id   uuid not null references public.profiles(id) on delete cascade,
  body        text check (body is null or char_length(body) <= 2000),
  attachments jsonb not null default '[]'::jsonb check (jsonb_typeof(attachments) = 'array'),
  created_at  timestamptz not null default now(),
  deleted_at  timestamptz,
  constraint forest_messages_says_something
    check (coalesce(btrim(body), '') <> '' or jsonb_array_length(attachments) > 0)
);

create index if not exists forest_messages_forest_idx on public.forest_messages (forest_id, created_at);
create index if not exists forest_messages_sender_idx on public.forest_messages (sender_id, created_at desc);

alter table public.forest_messages enable row level security;

drop policy if exists "forest_messages: read if member" on public.forest_messages;
create policy "forest_messages: read if member" on public.forest_messages for select using (
  is_forest_chat_member(forest_id) and not is_blocked_either_way(sender_id)
);

-- Writes are RPC-only (chat_send), like dm_messages.
revoke all on public.forest_messages from public, anon;
grant select on public.forest_messages to authenticated;

create table if not exists public.chat_reads (
  scope        text not null check (scope in ('dm', 'campfire', 'forest')),
  -- dm_threads.id · groups.id · forests.id. No FK: one column, three parents.
  room_id      uuid not null,
  user_id      uuid not null references public.profiles(id) on delete cascade,
  -- Unused for 'dm' (dm_threads carries it); a null means "since I joined".
  last_read_at timestamptz,
  muted        boolean not null default false,
  primary key (scope, room_id, user_id)
);

create index if not exists chat_reads_user_idx on public.chat_reads (user_id, scope);

alter table public.chat_reads enable row level security;   -- no policies: RPC-only
revoke all on public.chat_reads from public, anon, authenticated;

-- Everyone already in a room starts read-up-to-now. Without this the first open of the new build
-- would light every campfire with a count of everything ever said in it.
insert into public.chat_reads (scope, room_id, user_id, last_read_at)
select 'campfire', gm.group_id, gm.user_id, now() from group_members gm
on conflict do nothing;

insert into public.chat_reads (scope, room_id, user_id, last_read_at)
select 'forest', fm.forest_id, fm.user_id, now() from forest_members fm where fm.status = 'active'
on conflict do nothing;

do $rt$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables
                      where pubname = 'supabase_realtime' and schemaname = 'public'
                        and tablename = 'forest_messages') then
    alter publication supabase_realtime add table public.forest_messages;
  end if;
end;
$rt$;

-- ─────────────────────────── 4. UGC filter on forest chat ───────────────────────────

create or replace function public.ugc_filter_forest_message()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_recent integer;
begin
  perform ugc_assert_clean(new.body);
  if tg_op = 'INSERT' then
    select count(*) into v_recent
    from forest_messages
    where sender_id = new.sender_id and created_at > now() - interval '10 seconds';
    perform ugc_assert_rate(v_recent, 8);
  end if;
  return new;
end;
$$;

drop trigger if exists on_forest_message_ugc_filter on public.forest_messages;
create trigger on_forest_message_ugc_filter
  before insert or update of body on public.forest_messages
  for each row execute function public.ugc_filter_forest_message();

revoke all on function public.ugc_filter_forest_message() from public, anon, authenticated;

-- ─────────────────────────── 5. freezing attachments ───────────────────────────

/**
 * Turn what the composer sent into what the row stores. Raises on anything it cannot vouch for —
 * a composer that showed an attachment and then sent without it is worse than an error.
 *
 *   image / file → `key` must sit under <scope>/<room>/<sender>/ AND exist in chat-media. The
 *                  snapshot's mime + size come from storage's own metadata, never the client.
 *   anthem       → the sender's saved anthem, frozen.
 *   share kinds  → agora_attachment_snapshot, scoped to the sender.
 */
create or replace function public.chat_freeze_attachments(
  p_user uuid,
  p_scope text,
  p_room_id uuid,
  p_input jsonb
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_out jsonb := '[]'::jsonb;
  v_el jsonb;
  v_kind text;
  v_key text;
  v_ref uuid;
  v_snap jsonb;
  v_meta jsonb;
  v_prefix text := p_scope || '/' || p_room_id::text || '/' || p_user::text || '/';
begin
  if p_input is null or jsonb_typeof(p_input) <> 'array' then
    return '[]'::jsonb;
  end if;
  if jsonb_array_length(p_input) > 10 then
    raise exception 'Up to 10 attachments per message.';
  end if;

  for v_el in select value from jsonb_array_elements(p_input) loop
    v_kind := v_el->>'kind';
    v_key := nullif(v_el->>'key', '');
    v_ref := case when coalesce(v_el->>'ref_id', '') ~ '^[0-9a-f-]{36}$' then (v_el->>'ref_id')::uuid end;
    v_snap := null;

    if v_kind in ('image', 'file') then
      if v_key is null
         or left(v_key, length(v_prefix)) <> v_prefix
         or v_key !~ '^[a-z]+/[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|jpeg|png|webp|heic|pdf|txt|md|docx)$' then
        raise exception 'That attachment is not yours to send.';
      end if;
      select o.metadata into v_meta
        from storage.objects o
       where o.bucket_id = 'chat-media' and o.name = v_key;
      if not found then
        raise exception 'That upload did not finish — try attaching it again.';
      end if;
      v_snap := jsonb_strip_nulls(jsonb_build_object(
        'mime', v_meta->>'mimetype',
        'bytes', (v_meta->>'size')::bigint,
        'name', case when v_kind = 'file'
                     then left(btrim(coalesce(v_el->'meta'->>'name', 'File')), 120) end,
        'width', case when v_kind = 'image' and (v_el->'meta'->>'width') ~ '^\d{1,5}$'
                      then (v_el->'meta'->>'width')::int end,
        'height', case when v_kind = 'image' and (v_el->'meta'->>'height') ~ '^\d{1,5}$'
                       then (v_el->'meta'->>'height')::int end
      ));
      if v_kind = 'image' and coalesce(v_snap->>'mime', '') not like 'image/%' then
        raise exception 'That photo is not an image.';
      end if;
      v_out := v_out || jsonb_build_array(jsonb_build_object(
        'kind', v_kind, 'ref_id', null, 'key', v_key, 'snapshot', v_snap));

    elsif v_kind = 'anthem' then
      select jsonb_build_object('title', pi.anthem->>'title', 'artist', pi.anthem->>'artist',
                                'url', pi.anthem->>'url')
        into v_snap
        from profile_identity pi
       where pi.user_id = p_user and nullif(btrim(coalesce(pi.anthem->>'title', '')), '') is not null;
      if v_snap is null then
        raise exception 'Set your anthem on your identity card first.';
      end if;
      v_out := v_out || jsonb_build_array(jsonb_build_object(
        'kind', 'anthem', 'ref_id', null, 'key', null, 'snapshot', jsonb_strip_nulls(v_snap)));

    elsif v_kind in ('lockin', 'milestone', 'rank', 'streak', 'pass', 'cosmetic', 'pr') then
      v_snap := agora_attachment_snapshot(p_user, v_kind, v_ref, v_key);
      if v_snap is null then
        raise exception 'That % is not yours to share.', case when v_kind = 'lockin' then 'session' else 'reward' end;
      end if;
      v_out := v_out || jsonb_build_array(jsonb_build_object(
        'kind', v_kind, 'ref_id', v_ref, 'key', v_key, 'snapshot', v_snap));

    else
      raise exception 'This build can''t send that yet.';
    end if;
  end loop;

  return v_out;
end;
$$;

revoke all on function public.chat_freeze_attachments(uuid, text, uuid, jsonb) from public, anon, authenticated;

/** "Sent a photo" — the line a preview, an inbox row or a generic push says for a media message. */
create or replace function public.chat_attachments_phrase(p_attachments jsonb)
returns text
language sql
immutable
as $$
  select case
    when p_attachments is null or jsonb_typeof(p_attachments) <> 'array'
         or jsonb_array_length(p_attachments) = 0 then null
    when p_attachments->0->>'kind' = 'image' then
      case when jsonb_array_length(p_attachments) > 1 then 'Sent photos' else 'Sent a photo' end
    when p_attachments->0->>'kind' = 'file' then 'Sent a file'
    when p_attachments->0->>'kind' = 'lockin' then 'Shared a session'
    when p_attachments->0->>'kind' = 'anthem' then 'Shared their anthem'
    else 'Shared a win'
  end;
$$;

-- ─────────────────────────── 6. hard-delete media ───────────────────────────

create or replace function public.chat_purge_media(p_attachments jsonb, p_sender uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_key text;
begin
  if to_regclass('storage.objects') is null then return; end if;
  for v_key in
    select a.value->>'key'
      from jsonb_array_elements(coalesce(p_attachments, '[]'::jsonb)) a
     where a.value->>'kind' in ('image', 'file') and a.value->>'key' is not null
  loop
    -- Only ever the sender's own segment: a forged key in the jsonb cannot aim this at anyone else.
    continue when split_part(v_key, '/', 3) <> p_sender::text;
    perform set_config('storage.allow_delete_query', 'true', true);
    execute 'delete from storage.objects where bucket_id = $1 and name = $2' using 'chat-media', v_key;
  end loop;
end;
$$;

create or replace function public.chat_message_media_cleanup()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    perform chat_purge_media(old.attachments, old.sender_id);
    return old;
  end if;
  if old.deleted_at is null and new.deleted_at is not null then
    perform chat_purge_media(old.attachments, old.sender_id);
  end if;
  return new;
end;
$$;

drop trigger if exists dm_messages_media_cleanup on public.dm_messages;
create trigger dm_messages_media_cleanup
  after update of deleted_at or delete on public.dm_messages
  for each row execute function public.chat_message_media_cleanup();

drop trigger if exists forest_messages_media_cleanup on public.forest_messages;
create trigger forest_messages_media_cleanup
  after update of deleted_at or delete on public.forest_messages
  for each row execute function public.chat_message_media_cleanup();

revoke all on function public.chat_purge_media(jsonb, uuid) from public, anon, authenticated;
revoke all on function public.chat_message_media_cleanup() from public, anon, authenticated;

-- ─────────────────────────── 7. push ───────────────────────────

-- Live body (pg_get_functiondef, 2026-10-27) with one addition: forest_message joins room chatter.
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
                    'friend_agora_post',
                    'check_in', 'reaction') then 'friends_social'
    when p_type in ('challenged', 'challenge_accepted', 'challenge_declined', 'challenge_passed',
                    'challenge_ending_soon', 'challenge_won', 'challenge_lost', 'goal_at_risk',
                    'goal_streak_milestone', 'challenge_cheered',
                    'challenge_invite', 'challenge_forfeited', 'challenge_change_request',
                    'challenge_change_answered', 'challenge_terms_updated',
                    'vouch_requested', 'vouch_passed', 'vouch_settled',
                    'goal_complete') then 'challenges'
    when p_type in ('campfire_joined', 'campfire_join_request', 'campfire_challenge_started',
                    'campfire_cold', 'campfire_added', 'campfire_settled', 'campfire_message',
                    'join_request', 'join_request_approved', 'campfire_admin_granted',
                    'chat_batch', 'mention',
                    'campfire_ping',
                    'challenge_hosted',
                    'campfire_post', 'forest_post',
                    -- 0284 · a forest room's chat, with the rest of the room chatter.
                    'forest_message') then 'campfires'
    when p_type in ('streak_at_risk', 'daily_fire_reminder', 'streak_milestone',
                    'session_complete',
                    'streak_risk', 'lock_in_nudge', 'lockin_still_here') then 'streak_reminders'
    when p_type in ('season_ending', 'season_settled', 'ranked_up', 'rank_dropped', 'reward_ready',
                    'pass_unlocked', 'badge_earned',
                    'daily_placement')
      then 'season_rank'
    else 'friends_social'
  end;
$function$;

/**
 * The DM push, shared by dm_send and chat_send. 0206's "one badge until they look" rule, plus:
 *   · a muted thread is never pushed;
 *   · the body is the message only for a recipient who turned previews ON — otherwise a generic
 *     line. (The toggle defaults off, so this is the private default it always claimed to be.)
 */
create or replace function public.dm_notify(p_thread_id uuid, p_sender uuid, p_other uuid, p_preview text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pending int;
  v_sender text;
  v_previews boolean;
begin
  if exists (select 1 from chat_reads cr
              where cr.scope = 'dm' and cr.room_id = p_thread_id and cr.user_id = p_other and cr.muted) then
    return;
  end if;

  select count(*) into v_pending
  from notification_events ne
  where ne.user_id = p_other
    and ne.type = 'dm_received'
    and ne.target_id = p_thread_id
    and ne.created_at > coalesce(
      (select case when t.user_a = p_other then t.a_last_read_at else t.b_last_read_at end
         from dm_threads t where t.id = p_thread_id),
      '-infinity'::timestamptz
    );
  if v_pending > 0 then return; end if;

  select display_name into v_sender from profiles where id = p_sender;
  select coalesce(p.show_message_previews, false) into v_previews from profiles p where p.id = p_other;

  perform notify_event(
    array[p_other],
    'dm_received',
    coalesce(v_sender, 'A friend'),
    case when v_previews then left(p_preview, 140) else 'Sent you a message' end,
    p_sender, p_thread_id,
    '/dm/[friendId]', jsonb_build_object('friendId', p_sender::text),
    null, 'circle',
    jsonb_build_object('thread_id', p_thread_id)
  );
end;
$$;

revoke all on function public.dm_notify(uuid, uuid, uuid, text) from public, anon, authenticated;

-- Live body (pg_get_functiondef, 2026-10-27 — identical to 0206) with its notify block replaced by
-- dm_notify. Same signature, so CREATE OR REPLACE is safe; installed builds keep calling it.
create or replace function public.dm_send(p_thread_id uuid, p_body text)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_me uuid := auth.uid();
  v_other uuid;
  v_body text := btrim(coalesce(p_body, ''));
  v_id uuid;
  v_recent int;
begin
  if v_me is null then raise exception 'Not signed in.'; end if;

  v_other := dm_other_member(p_thread_id);
  if v_other is null then raise exception 'That conversation is not yours.'; end if;

  if v_body = '' then raise exception 'Nothing to send.'; end if;
  if length(v_body) > 2000 then v_body := left(v_body, 2000); end if;

  if is_blocked_either_way(v_other) then
    raise exception 'You can''t message this person.';
  end if;

  if not exists (
    select 1 from friend_requests fr
    where fr.status = 'accepted'
      and ((fr.requester_id = v_me and fr.recipient_id = v_other)
        or (fr.requester_id = v_other and fr.recipient_id = v_me))
  ) then
    raise exception 'You can only message friends.';
  end if;

  if exists (select 1 from profiles p where p.id = v_me and p.is_disabled) then
    raise exception 'Your account is disabled.';
  end if;

  select count(*) into v_recent
  from dm_messages m
  where m.sender_id = v_me and m.created_at > now() - interval '10 seconds';
  if v_recent >= 10 then
    raise exception 'Slow down a moment.';
  end if;

  insert into dm_messages (thread_id, sender_id, body, kind)
  values (p_thread_id, v_me, v_body, 'text')
  returning id into v_id;

  update dm_threads t
     set last_message_at = now(),
         a_last_read_at = case when t.user_a = v_me then now() else t.a_last_read_at end,
         b_last_read_at = case when t.user_b = v_me then now() else t.b_last_read_at end
   where t.id = p_thread_id;

  perform dm_notify(p_thread_id, v_me, v_other, v_body);

  return v_id;
end;
$function$;

/** The forest-room push: one badge per member until they open the room, previews per recipient. */
create or replace function public.forest_chat_notify(p_forest_id uuid, p_sender uuid, p_preview text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_forest text;
  v_sender text;
  v_on uuid[];
  v_off uuid[];
begin
  select f.name into v_forest from forests f where f.id = p_forest_id;
  select p.display_name into v_sender from profiles p where p.id = p_sender;

  with targets as (
    select fm.user_id, coalesce(p.show_message_previews, false) as previews
      from forest_members fm
      join profiles p on p.id = fm.user_id
      left join chat_reads cr
        on cr.scope = 'forest' and cr.room_id = p_forest_id and cr.user_id = fm.user_id
     where fm.forest_id = p_forest_id
       and fm.status = 'active'
       and fm.user_id <> p_sender
       and not coalesce(cr.muted, false)
       -- Called inside chat_send, so auth.uid() is the sender: this is "blocked with the sender".
       and not is_blocked_either_way(fm.user_id)
       and not exists (
         select 1 from notification_events ne
          where ne.user_id = fm.user_id
            and ne.type = 'forest_message'
            and ne.target_id = p_forest_id
            and ne.created_at > coalesce(cr.last_read_at, fm.joined_at)
       )
  )
  select coalesce(array_agg(user_id) filter (where previews), '{}'),
         coalesce(array_agg(user_id) filter (where not previews), '{}')
    into v_on, v_off
    from targets;

  -- '/forest/[id]' rather than the new chat route: an installed build has no chat screen to land
  -- on, and the forest page is the next best place. A new build reads `open=chat` and goes on in.
  if array_length(v_on, 1) is not null then
    perform notify_event(v_on, 'forest_message', coalesce(v_forest, 'Your forest'),
      coalesce(v_sender, 'Someone') || ': ' || left(p_preview, 120),
      p_sender, p_forest_id, '/forest/[id]',
      jsonb_build_object('id', p_forest_id::text, 'open', 'chat'), null, 'circle', '{}'::jsonb);
  end if;
  if array_length(v_off, 1) is not null then
    perform notify_event(v_off, 'forest_message', coalesce(v_forest, 'Your forest'),
      'New message from ' || coalesce(v_sender, 'someone'),
      p_sender, p_forest_id, '/forest/[id]',
      jsonb_build_object('id', p_forest_id::text, 'open', 'chat'), null, 'circle', '{}'::jsonb);
  end if;
end;
$$;

revoke all on function public.forest_chat_notify(uuid, uuid, text) from public, anon, authenticated;

-- ─────────────────────────── 8. the chat RPCs ───────────────────────────

/**
 * Send into a DM ('dm', thread id) or a forest room ('forest', forest id), with any mix of
 * attachments. Every gate dm_send applies to a DM applies here too, restated rather than routed
 * through dm_send because this insert carries attachments dm_send has no parameter for.
 */
create or replace function public.chat_send(
  p_scope text,
  p_room_id uuid,
  p_body text default null,
  p_attachments jsonb default '[]'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_other uuid;
  v_body text := nullif(btrim(coalesce(p_body, '')), '');
  v_att jsonb;
  v_id uuid;
  v_recent int;
begin
  if v_me is null then raise exception 'Not signed in.'; end if;
  if exists (select 1 from profiles p where p.id = v_me and p.is_disabled) then
    raise exception 'Your account is disabled.';
  end if;
  if v_body is not null and length(v_body) > 2000 then v_body := left(v_body, 2000); end if;

  if p_scope = 'dm' then
    v_other := dm_other_member(p_room_id);
    if v_other is null then raise exception 'That conversation is not yours.'; end if;
    if is_blocked_either_way(v_other) then raise exception 'You can''t message this person.'; end if;
    if not exists (
      select 1 from friend_requests fr
      where fr.status = 'accepted'
        and ((fr.requester_id = v_me and fr.recipient_id = v_other)
          or (fr.requester_id = v_other and fr.recipient_id = v_me))
    ) then
      raise exception 'You can only message friends.';
    end if;
    select count(*) into v_recent from dm_messages m
     where m.sender_id = v_me and m.created_at > now() - interval '10 seconds';
  elsif p_scope = 'forest' then
    if not is_forest_chat_member(p_room_id) then
      raise exception 'Join this forest to chat in it.';
    end if;
    select count(*) into v_recent from forest_messages m
     where m.sender_id = v_me and m.created_at > now() - interval '10 seconds';
  else
    raise exception 'Unknown chat.';
  end if;

  if v_recent >= 10 then raise exception 'Slow down a moment.'; end if;

  v_att := chat_freeze_attachments(v_me, p_scope, p_room_id, p_attachments);
  if v_body is null and jsonb_array_length(v_att) = 0 then
    raise exception 'Nothing to send.';
  end if;

  if p_scope = 'dm' then
    insert into dm_messages (thread_id, sender_id, body, kind, attachments)
    values (p_room_id, v_me, v_body, case when v_body is null then 'media' else 'text' end, v_att)
    returning id into v_id;

    update dm_threads t
       set last_message_at = now(),
           a_last_read_at = case when t.user_a = v_me then now() else t.a_last_read_at end,
           b_last_read_at = case when t.user_b = v_me then now() else t.b_last_read_at end
     where t.id = p_room_id;

    perform dm_notify(p_room_id, v_me, v_other, coalesce(v_body, chat_attachments_phrase(v_att)));
  else
    insert into forest_messages (forest_id, sender_id, body, attachments)
    values (p_room_id, v_me, v_body, v_att)
    returning id into v_id;

    -- Sending is reading.
    insert into chat_reads (scope, room_id, user_id, last_read_at)
    values ('forest', p_room_id, v_me, now())
    on conflict (scope, room_id, user_id) do update set last_read_at = excluded.last_read_at;

    perform forest_chat_notify(p_room_id, v_me, coalesce(v_body, chat_attachments_phrase(v_att)));
  end if;

  return v_id;
end;
$$;

create or replace function public.chat_mark_read(p_scope text, p_room_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
begin
  if v_me is null then raise exception 'Not signed in.'; end if;
  if p_scope = 'dm' then
    perform dm_mark_read(p_room_id);
    return;
  end if;
  if p_scope = 'campfire' then
    if not exists (select 1 from group_members gm where gm.group_id = p_room_id and gm.user_id = v_me) then
      return;
    end if;
  elsif p_scope = 'forest' then
    if not is_forest_chat_member(p_room_id) then return; end if;
  else
    return;
  end if;
  insert into chat_reads (scope, room_id, user_id, last_read_at)
  values (p_scope, p_room_id, v_me, now())
  on conflict (scope, room_id, user_id) do update set last_read_at = excluded.last_read_at;
end;
$$;

create or replace function public.chat_set_muted(p_scope text, p_room_id uuid, p_muted boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
begin
  if v_me is null then raise exception 'Not signed in.'; end if;
  if p_scope = 'campfire' then
    -- Campfire mute already exists and the campfire push already reads it — one switch, not two.
    update group_members gm set chat_muted = coalesce(p_muted, false)
     where gm.group_id = p_room_id and gm.user_id = v_me;
    return;
  end if;
  if not chat_can_use_room(p_scope, p_room_id::text) then
    raise exception 'That conversation is not yours.';
  end if;
  insert into chat_reads (scope, room_id, user_id, muted)
  values (p_scope, p_room_id, v_me, coalesce(p_muted, false))
  on conflict (scope, room_id, user_id) do update set muted = excluded.muted;
end;
$$;

create or replace function public.chat_delete_my_message(p_scope text, p_message_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'Not signed in.'; end if;
  -- The media goes with it: chat_message_media_cleanup fires on the deleted_at write.
  if p_scope = 'dm' then
    update dm_messages m set deleted_at = now()
     where m.id = p_message_id and m.sender_id = auth.uid() and m.deleted_at is null;
  elsif p_scope = 'forest' then
    update forest_messages m set deleted_at = now()
     where m.id = p_message_id and m.sender_id = auth.uid() and m.deleted_at is null;
  end if;
end;
$$;

/**
 * Report one chat message. The snapshot is taken HERE, server-side and membership-checked —
 * moderation_reports.reported_message_id points at campfire `messages` only, and a client-built
 * snapshot would be whatever the reporter said it was.
 */
create or replace function public.report_chat_message(p_scope text, p_message_id uuid, p_reason text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_snap jsonb;
  v_sender uuid;
  v_forest uuid;
  v_id uuid;
begin
  if v_me is null then raise exception 'Not signed in.'; end if;
  if p_scope = 'dm' then
    select jsonb_build_object('type', 'dm_message', 'thread_id', m.thread_id, 'body', m.body,
                              'attachments', m.attachments, 'user_id', m.sender_id,
                              'created_at', m.created_at),
           m.sender_id
      into v_snap, v_sender
      from dm_messages m
     where m.id = p_message_id and is_dm_member(m.thread_id);
  elsif p_scope = 'forest' then
    select jsonb_build_object('type', 'forest_message', 'forest_id', m.forest_id, 'body', m.body,
                              'attachments', m.attachments, 'user_id', m.sender_id,
                              'created_at', m.created_at),
           m.sender_id, m.forest_id
      into v_snap, v_sender, v_forest
      from forest_messages m
     where m.id = p_message_id and is_forest_chat_member(m.forest_id);
  end if;
  if v_snap is null then raise exception 'That message is gone.'; end if;

  insert into moderation_reports (reporter_id, reported_user_id, reported_forest_id, reason,
                                  reported_content_snapshot)
  values (v_me, v_sender, v_forest, p_reason, v_snap)
  returning id into v_id;
  return v_id;
end;
$$;

/**
 * Social → Chats: every DM, campfire and forest room you are in, most recently active first.
 * `out_` names throughout — a RETURNS TABLE column named like a table column shadows it in the body.
 */
create or replace function public.get_my_chats()
returns table (
  out_scope text,
  out_room_id uuid,
  out_friend_id uuid,
  out_name text,
  out_avatar_url text,
  out_last_at timestamptz,
  out_last_line text,
  out_last_sender_id uuid,
  out_last_sender_name text,
  out_unread int,
  out_muted boolean
)
language sql
stable
security definer
set search_path = public
as $$
  -- DMs: get_my_dm_threads' rules (blocked pairs and never-spoken threads stay out).
  select 'dm'::text, t.out_thread_id, t.out_friend_id, t.out_display_name, t.out_avatar_url,
         t.out_last_message_at, t.out_last_body, t.out_last_sender_id, null::text, t.out_unread,
         coalesce((select cr.muted from chat_reads cr
                    where cr.scope = 'dm' and cr.room_id = t.out_thread_id and cr.user_id = auth.uid()), false)
    from get_my_dm_threads() t

  union all

  select 'campfire'::text, g.id, null::uuid, g.name, null::text,
         last_msg.created_at,
         coalesce(nullif(btrim(last_msg.body), ''),
                  case last_msg.attach_kind when 'photo' then 'Sent a photo'
                                            when 'lockin' then 'Shared a session'
                                            when 'challenge' then 'Started a challenge' end),
         last_msg.user_id, last_msg.display_name,
         coalesce(unread.n, 0)::int,
         coalesce(gm.chat_muted, false)
    from group_members gm
    join groups g on g.id = gm.group_id
    left join chat_reads cr
      on cr.scope = 'campfire' and cr.room_id = gm.group_id and cr.user_id = gm.user_id
    left join lateral (
      select m.body, m.attach_kind, m.created_at, m.user_id, p.display_name
        from messages m
        left join profiles p on p.id = m.user_id
       where m.group_id = g.id and m.deleted_at is null and m.system_event is null
         and not is_blocked_either_way(m.user_id)
       order by m.created_at desc
       limit 1
    ) last_msg on true
    left join lateral (
      select count(*) as n
        from messages m
       where m.group_id = g.id and m.deleted_at is null and m.system_event is null
         and m.user_id <> auth.uid()
         and m.created_at > coalesce(cr.last_read_at, gm.joined_at)
         and not is_blocked_either_way(m.user_id)
    ) unread on true
   where gm.user_id = auth.uid()

  union all

  select 'forest'::text, f.id, null::uuid, f.name, f.cover_url,
         last_msg.created_at,
         coalesce(nullif(btrim(last_msg.body), ''), chat_attachments_phrase(last_msg.attachments)),
         last_msg.sender_id, last_msg.display_name,
         coalesce(unread.n, 0)::int,
         coalesce(cr.muted, false)
    from forest_members fm
    join forests f on f.id = fm.forest_id and f.removed_at is null
    left join chat_reads cr
      on cr.scope = 'forest' and cr.room_id = fm.forest_id and cr.user_id = fm.user_id
    left join lateral (
      select m.body, m.attachments, m.created_at, m.sender_id, p.display_name
        from forest_messages m
        left join profiles p on p.id = m.sender_id
       where m.forest_id = f.id and m.deleted_at is null and not is_blocked_either_way(m.sender_id)
       order by m.created_at desc
       limit 1
    ) last_msg on true
    left join lateral (
      select count(*) as n
        from forest_messages m
       where m.forest_id = f.id and m.deleted_at is null
         and m.sender_id <> auth.uid()
         and m.created_at > coalesce(cr.last_read_at, fm.joined_at)
         and not is_blocked_either_way(m.sender_id)
    ) unread on true
   where fm.user_id = auth.uid() and fm.status = 'active'

  order by 6 desc nulls last, 4;
$$;

-- Live body (pg_get_functiondef, 2026-10-27) with ONE change: the preview falls back to the
-- attachments phrase, so a media-only last message neither blanks the row nor — through the
-- `last_msg.body is not null` filter — drops the whole thread out of an installed build's inbox.
create or replace function public.get_my_dm_threads()
returns table(out_thread_id uuid, out_friend_id uuid, out_display_name text, out_avatar_url text, out_handle text, out_last_message_at timestamp with time zone, out_last_body text, out_last_sender_id uuid, out_unread integer)
language sql
stable security definer
set search_path to 'public'
as $function$
  select
    t.id,
    other.id,
    other.display_name,
    other.avatar_url,
    other.handle,
    t.last_message_at,
    last_msg.body,
    last_msg.sender_id,
    coalesce(unread.n, 0)::int
  from dm_threads t
  cross join lateral (
    select p.id, p.display_name, p.avatar_url, p.handle from profiles p
    where p.id = case when t.user_a = auth.uid() then t.user_b else t.user_a end
  ) other
  cross join lateral (
    select case when t.user_a = auth.uid() then t.a_last_read_at else t.b_last_read_at end as at
  ) mine
  left join lateral (
    select coalesce(nullif(btrim(m.body), ''), chat_attachments_phrase(m.attachments)) as body, m.sender_id
    from dm_messages m
    where m.thread_id = t.id and m.deleted_at is null
    order by m.created_at desc
    limit 1
  ) last_msg on true
  left join lateral (
    select count(*) as n
    from dm_messages m
    where m.thread_id = t.id
      and m.deleted_at is null
      and m.sender_id <> auth.uid()
      and m.created_at > mine.at
  ) unread on true
  where auth.uid() in (t.user_a, t.user_b)
    and not is_blocked_either_way(other.id)
    and last_msg.body is not null
  order by t.last_message_at desc;
$function$;

revoke all on function public.chat_send(text, uuid, text, jsonb) from public, anon;
revoke all on function public.chat_mark_read(text, uuid) from public, anon;
revoke all on function public.chat_set_muted(text, uuid, boolean) from public, anon;
revoke all on function public.chat_delete_my_message(text, uuid) from public, anon;
revoke all on function public.report_chat_message(text, uuid, text) from public, anon;
revoke all on function public.get_my_chats() from public, anon;
grant execute on function public.chat_send(text, uuid, text, jsonb) to authenticated;
grant execute on function public.chat_mark_read(text, uuid) to authenticated;
grant execute on function public.chat_set_muted(text, uuid, boolean) to authenticated;
grant execute on function public.chat_delete_my_message(text, uuid) to authenticated;
grant execute on function public.report_chat_message(text, uuid, text) to authenticated;
grant execute on function public.get_my_chats() to authenticated;

-- ─────────────────────────── 9. lock-in messages persist in the DM ───────────────────────────

/** Mirror one lock-in message into the pair's DM. Friends only; never raises; never pushes. */
create or replace function public.lockin_message_mirror_one(p_msg lockin_messages)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_thread uuid;
begin
  if not exists (
    select 1 from friend_requests fr
    where fr.status = 'accepted'
      and ((fr.requester_id = p_msg.from_user and fr.recipient_id = p_msg.to_user)
        or (fr.requester_id = p_msg.to_user and fr.recipient_id = p_msg.from_user))
  ) or exists (
    select 1 from blocked_users b
    where (b.blocker_id = p_msg.from_user and b.blocked_id = p_msg.to_user)
       or (b.blocker_id = p_msg.to_user and b.blocked_id = p_msg.from_user)
  ) then
    return;
  end if;

  insert into dm_threads (user_a, user_b)
  values (least(p_msg.from_user, p_msg.to_user), greatest(p_msg.from_user, p_msg.to_user))
  on conflict (user_a, user_b) do update set user_a = excluded.user_a
  returning id into v_thread;

  insert into dm_messages (thread_id, sender_id, body, kind, created_at, lockin_message_id)
  values (v_thread, p_msg.from_user, p_msg.body, 'text', p_msg.created_at, p_msg.id)
  on conflict (lockin_message_id) where lockin_message_id is not null do nothing;

  update dm_threads t
     set last_message_at = greatest(t.last_message_at, p_msg.created_at),
         a_last_read_at = case when t.user_a = p_msg.from_user
                               then greatest(t.a_last_read_at, p_msg.created_at) else t.a_last_read_at end,
         b_last_read_at = case when t.user_b = p_msg.from_user
                               then greatest(t.b_last_read_at, p_msg.created_at) else t.b_last_read_at end
   where t.id = v_thread;
exception
  -- The overlay's send must never fail because its persistent copy could not be written (the UGC
  -- rate trigger on dm_messages, say). The live message still lands; only the archive is missed.
  when others then
    raise warning '0284 lock-in mirror skipped %: %', p_msg.id, sqlerrm;
end;
$$;

create or replace function public.lockin_messages_mirror_to_dm()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    perform lockin_message_mirror_one(new);
  elsif new.read_at is not null and old.read_at is null then
    -- Read in the overlay = read in the DM: advance the recipient's pointer past the mirrored row,
    -- so a conversation they already saw live doesn't come back as an unread badge.
    update dm_threads t
       set a_last_read_at = case when t.user_a = new.to_user
                                 then greatest(t.a_last_read_at, new.created_at) else t.a_last_read_at end,
           b_last_read_at = case when t.user_b = new.to_user
                                 then greatest(t.b_last_read_at, new.created_at) else t.b_last_read_at end
     where t.user_a = least(new.from_user, new.to_user)
       and t.user_b = greatest(new.from_user, new.to_user);
  end if;
  return null;
end;
$$;

drop trigger if exists lockin_messages_mirror_to_dm on public.lockin_messages;
create trigger lockin_messages_mirror_to_dm
  after insert or update of read_at on public.lockin_messages
  for each row execute function public.lockin_messages_mirror_to_dm();

revoke all on function public.lockin_message_mirror_one(lockin_messages) from public, anon, authenticated;
revoke all on function public.lockin_messages_mirror_to_dm() from public, anon, authenticated;

-- Backfill what the two-day purge hasn't taken yet. Already-read rows advance the read pointer.
do $backfill$
declare
  v_msg lockin_messages;
  v_n int := 0;
begin
  for v_msg in select * from lockin_messages order by created_at loop
    perform lockin_message_mirror_one(v_msg);
    v_n := v_n + 1;
  end loop;
  update dm_threads t
     set a_last_read_at = greatest(t.a_last_read_at, r.at)
    from (select least(from_user, to_user) ua, greatest(from_user, to_user) ub, to_user, max(created_at) at
            from lockin_messages where read_at is not null group by 1, 2, 3) r
   where t.user_a = r.ua and t.user_b = r.ub and r.to_user = t.user_a;
  update dm_threads t
     set b_last_read_at = greatest(t.b_last_read_at, r.at)
    from (select least(from_user, to_user) ua, greatest(from_user, to_user) ub, to_user, max(created_at) at
            from lockin_messages where read_at is not null group by 1, 2, 3) r
   where t.user_a = r.ua and t.user_b = r.ub and r.to_user = t.user_b;
  raise notice '0284: considered % lock-in messages for the DM backfill', v_n;
end;
$backfill$;

-- ─────────────────────────── 10. verify ───────────────────────────

do $verify$
begin
  if not exists (select 1 from storage.buckets where id = 'chat-media' and not public) then
    raise exception '0284: chat-media is missing or public';
  end if;
  if chat_attachments_phrase('[{"kind":"image"}]') <> 'Sent a photo'
     or chat_attachments_phrase('[]') is not null then
    raise exception '0284: chat_attachments_phrase is wrong';
  end if;
  if notification_category('forest_message') <> 'campfires'
     or notification_category('dm_received') <> 'friends_social' then
    raise exception '0284: notification_category regressed';
  end if;
  if chat_can_use_room('dm', 'not-a-uuid') or chat_can_use_room('nope', gen_random_uuid()::text) then
    raise exception '0284: chat_can_use_room admitted a malformed room';
  end if;
  raise notice '0284 ok';
end;
$verify$;
