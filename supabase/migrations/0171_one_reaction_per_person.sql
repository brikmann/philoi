-- MESSAGE REACTIONS — INSTAGRAM-DM SHAPED, NOT DISCORD-SHAPED
-- (CODE_PROMPT wave · D6, design-mocks/178-message-reactions.html)
--
-- "There is no react feature, which is standard to every group chat." True, and the interesting
-- part of this migration is the ONE constraint that decides what kind of feature it is.
--
-- ══════════════════════════════════════════════════════════════════════════════════════════════
-- 🔴 THE UNIQUE KEY IS (message_id, user_id) — NOT (message_id, user_id, emoji)
--
-- That single choice is the whole difference between this and Discord. With the emoji in the key,
-- one person can pile 🔥 💀 😭 onto a message and the UI grows count chips ("🔥 3", "💀 1") — the
-- Discord model. With the key stopping at the person, EACH USER HOLDS AT MOST ONE REACTION: a
-- second emoji REPLACES the first, and the bubble shows a small badge per PERSON rather than a
-- tally per emoji. No counts anywhere, by construction rather than by the client agreeing to
-- behave. A future client that forgets the rule gets a constraint violation, not a count pile.
--
-- It is also why the write is one upsert rather than an insert-or-delete decided client-side: the
-- primary key makes "swap my reaction" a single atomic statement.
--
-- ══════════════════════════════════════════════════════════════════════════════════════════════
-- WHY group_id IS DENORMALISED ONTO THIS TABLE
--
-- Two reasons, both load-bearing, neither of them tidiness:
--
--   1. REALTIME FILTERING. The campfire already subscribes with
--      `postgres_changes … table: 'messages', filter: 'group_id=eq.<id>'`. A reactions table keyed
--      only by message_id has no column to filter on, so every client in the app would receive
--      every reaction in every campfire and discard almost all of them. With group_id here the
--      reaction stream is filtered server-side exactly like the message stream.
--   2. RLS WITHOUT A JOIN. `is_group_member(group_id)` reads a column; the alternative is a
--      subquery back into `messages` on every row of every read.
--
-- The column cannot drift, because the RPC below is the ONLY writer and it copies group_id off the
-- message it is reacting to. There is no client-supplied group_id to get wrong.
--
-- REPLICA IDENTITY FULL is not optional here. Postgres sends only the replica identity (the
-- primary key, by default) in a DELETE's `old` record — so a DELETE would arrive carrying
-- message_id and user_id and NO group_id, and Supabase's server-side `group_id=eq.…` filter would
-- not match it. Removing a reaction would then be invisible to everyone else until reload: the
-- exact half-working realtime that is worse than none. `full` puts every column in the WAL record
-- for this (small, narrow) table so deletes match the filter like inserts do.
-- ══════════════════════════════════════════════════════════════════════════════════════════════

create table if not exists message_reactions (
  message_id uuid not null references messages(id) on delete cascade,
  user_id    uuid not null references profiles(id) on delete cascade,
  group_id   uuid not null references groups(id)   on delete cascade,
  emoji      text not null,
  created_at timestamptz not null default now(),

  -- 🔴 One row per person per message. See the header — this IS the feature.
  primary key (message_id, user_id),

  -- A grid and a picker can only return a glyph, but this column is text and the API is open to
  -- anything that holds a session. A sentence in an emoji column would render as a wall of text
  -- glued to a chat bubble. Emoji are multi-codepoint (ZWJ sequences, skin tones, flags), so an
  -- exact "one emoji" check is not expressible here — this is a sanity bound, not a validator,
  -- and the curated client-side sets are what actually decide the vocabulary.
  constraint message_reactions_emoji_sane check (emoji <> '' and char_length(emoji) <= 16)
);

-- The read path is always "every reaction on the messages I am looking at".
create index if not exists message_reactions_message_idx on message_reactions (message_id);
-- The realtime filter and the RLS predicate both lead with group_id.
create index if not exists message_reactions_group_idx on message_reactions (group_id);

alter table message_reactions enable row level security;
alter table message_reactions replica identity full;

-- ─────────────────────────── RLS mirrors `messages` exactly ───────────────────────────
--
-- Prod's own policy on messages, read out of pg_policies:
--   (is_group_member(group_id) AND (NOT is_blocked_either_way(user_id)))
-- Restated here verbatim so a reaction is visible under precisely the conditions the message it
-- hangs on is visible. Anything looser would leak a blocked user's presence back into a chat that
-- has hidden their messages.
drop policy if exists "message_reactions: read if member" on message_reactions;
create policy "message_reactions: read if member" on message_reactions
  for select using (is_group_member(group_id) and not is_blocked_either_way(user_id));

-- NO INSERT/UPDATE/DELETE POLICY, DELIBERATELY. Every write goes through set_message_reaction
-- below, which is security definer and derives group_id from the message itself. A write policy
-- would mean trusting a client-supplied group_id — the one value that must never be client-supplied
-- here, because it is what both the RLS predicate and the realtime filter are keyed on. With no
-- write policy, RLS denies direct table writes to every client and the RPC is the only door.

-- ─────────────────────────── the one write ───────────────────────────
--
-- UPSERT-OR-DELETE, decided by comparing against what the caller already holds:
--   · no reaction yet          → insert p_emoji            → returns p_emoji
--   · a different emoji        → replace it                → returns p_emoji
--   · the SAME emoji again     → delete the row            → returns null  ("tap it again to clear")
--
-- That last case is what makes the tray's highlighted glyph a toggle and the bubble badge tappable
-- to remove, which is the prompt's "explicit remove — two affordances". Both affordances are the
-- same call; the client does not decide the verb.
create or replace function set_message_reaction(p_message_id uuid, p_emoji text)
returns text
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_group_id uuid;
  v_author uuid;
  v_existing text;
  v_emoji text := nullif(btrim(coalesce(p_emoji, '')), '');
begin
  if auth.uid() is null then raise exception 'Not signed in.'; end if;
  if v_emoji is null then raise exception 'No emoji given.'; end if;
  if char_length(v_emoji) > 16 then raise exception 'That is not an emoji.'; end if;

  select m.group_id, m.user_id into v_group_id, v_author
  from messages m where m.id = p_message_id;
  if v_group_id is null then raise exception 'That message no longer exists.'; end if;

  -- The same two gates the read policy applies, enforced here because a security definer function
  -- bypasses RLS: you may only react inside a campfire you are actually in, and never to someone
  -- you have blocked or who has blocked you.
  if not is_group_member(v_group_id) then
    raise exception 'You are not in that campfire.';
  end if;
  if is_blocked_either_way(v_author) then
    raise exception 'You cannot react to that message.';
  end if;

  select r.emoji into v_existing
  from message_reactions r
  where r.message_id = p_message_id and r.user_id = auth.uid();

  -- Same emoji again → clear. This is the toggle.
  if v_existing is not distinct from v_emoji then
    delete from message_reactions
    where message_id = p_message_id and user_id = auth.uid();
    return null;
  end if;

  insert into message_reactions (message_id, user_id, group_id, emoji)
  values (p_message_id, auth.uid(), v_group_id, v_emoji)
  on conflict (message_id, user_id)
  do update set emoji = excluded.emoji, created_at = now();

  -- ── the bell row, and pointedly NOT a push (§ "notify, low-key") ─────────────────────────────
  --
  -- A reaction is ambient. Pushing one would mean a phone buzzing every time someone taps 🔥 in a
  -- busy campfire, which is how people turn campfire notifications off entirely.
  --
  -- `philoi.suppress_push` is notify_event's own existing escape hatch (it returns right after
  -- writing the rows when this is 'on'), so this reuses the one notifier rather than hand-rolling
  -- an insert into notification_events and drifting from its category/art/route handling. The
  -- setting is transaction-local (the third argument), so it cannot leak into anything else.
  --
  -- Type 'reaction' is deliberate: notification_category already files it under friends_social and
  -- it already means "someone reacted to your thing". Adding a new type would mean restating
  -- notification_category, which this repo has broken twice by restating it from a stale base.
  if v_existing is null and v_author is not null and v_author <> auth.uid() then
    perform set_config('philoi.suppress_push', 'on', true);
    perform notify_event(
      array[v_author],
      'reaction',
      (select coalesce(p.display_name, 'Someone') from profiles p where p.id = auth.uid())
        || ' reacted ' || v_emoji,
      null,
      auth.uid(), v_group_id,
      '/group/[groupId]', jsonb_build_object('groupId', v_group_id::text),
      null, 'rounded',
      jsonb_build_object('group_id', v_group_id, 'message_id', p_message_id, 'kind', 'message_reaction')
    );
    perform set_config('philoi.suppress_push', 'off', true);
  end if;

  return v_emoji;
end;
$fn$;

revoke all on function set_message_reaction(uuid, text) from public, anon;
grant execute on function set_message_reaction(uuid, text) to authenticated;

comment on function set_message_reaction(uuid, text) is
  'D6: set, swap or clear the caller''s single reaction on a message. Passing the emoji the caller '
  'already holds deletes it. Returns the emoji now held, or null if cleared.';

-- ─────────────────────────── realtime ───────────────────────────
--
-- Added to the same publication `messages` rides, so a reaction reaches every member over the
-- subscription the campfire already holds open. Guarded because a publication membership that is
-- already there is an error, not a no-op.
do $pub$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'message_reactions')
  then
    alter publication supabase_realtime add table message_reactions;
  end if;
end
$pub$;

-- ─────────────────────────── verify, inside the migration ───────────────────────────
do $verify$
declare
  v_n int;
begin
  -- The key must stop at the person. If a later hand ever "fixes" this by adding emoji to the key,
  -- the count-pile UI comes back and the one-reaction-per-person rule silently dies.
  select count(*) into v_n
  from information_schema.key_column_usage k
  join information_schema.table_constraints t
    on t.constraint_name = k.constraint_name and t.constraint_schema = k.constraint_schema
  where t.table_schema = 'public' and t.table_name = 'message_reactions'
    and t.constraint_type = 'PRIMARY KEY';
  if v_n <> 2 then
    raise exception '0171: message_reactions primary key has % columns, expected exactly 2 (message_id, user_id)', v_n;
  end if;

  if (select relreplident from pg_class where oid = 'public.message_reactions'::regclass) <> 'f' then
    raise exception '0171: replica identity is not FULL — reaction removals will not reach other devices';
  end if;

  select count(*) into v_n from pg_policies
  where schemaname = 'public' and tablename = 'message_reactions' and cmd <> 'SELECT';
  if v_n <> 0 then
    raise exception '0171: a write policy exists on message_reactions — the RPC must be the only writer';
  end if;
end
$verify$;
