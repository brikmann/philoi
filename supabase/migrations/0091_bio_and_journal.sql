-- §3 (bio) + §5 (Journal).
--
-- THE JOURNAL IS DERIVED, NOT DUPLICATED. Every achievement the spec lists — rank-up, streak
-- milestone, challenge win, season placement — is already recorded in notification_events by the
-- §F pipeline, already carrying its leading art and its route. The spec even says the journal
-- should use "the same art resolver as notifications".
--
-- So rather than adding a second emitter (and a second set of trigger edits, on the same
-- payout-carrying functions §D already had to rewrite), the journal READS those rows and filters
-- them to the achievement types. What is genuinely new is the human layer on top: a note, and a
-- per-entry hide.
--
-- The trade: a journal entry cannot exist for an achievement that never emitted a notification.
-- That is the correct coupling — if something is worth journalling it is worth telling you about,
-- and the alternative is two lists of "notable achievements" that drift apart.

-- ───────────────────────────── §3 · bio ─────────────────────────────

alter table profiles add column if not exists bio text;

comment on column profiles.bio is
  'One-line self-description under the identity block. Owner-editable, publicly visible.';

-- Length is capped in the DB rather than only in the input: the column is readable by every
-- profile viewer, and a client is not the right place to enforce what other people have to render.
alter table profiles drop constraint if exists profiles_bio_length;
alter table profiles add constraint profiles_bio_length check (bio is null or char_length(bio) <= 160);

/** Set your own bio. Trims, and stores NULL rather than an empty string so "no bio" is one value. */
create or replace function set_my_bio(p_bio text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_clean text := nullif(btrim(coalesce(p_bio, '')), '');
begin
  if auth.uid() is null then raise exception 'Not signed in.'; end if;
  if char_length(coalesce(v_clean, '')) > 160 then
    raise exception 'Bio is too long (160 characters max).';
  end if;
  update profiles set bio = v_clean where id = auth.uid();
  return v_clean;
end;
$$;

grant execute on function set_my_bio(text) to authenticated;

-- ───────────────────────────── §5 · journal ─────────────────────────────

/**
 * The human layer over a derived entry: a comment, and/or a hide.
 *
 * A row exists only when the user has actually annotated or hidden something — the journal itself
 * needs no row per achievement, because the achievement is already in notification_events. That
 * keeps this table proportional to how much people write rather than to how much they do.
 */
create table if not exists journal_notes (
  user_id uuid not null references profiles (id) on delete cascade,
  -- The notification_events row this annotates. Not a FK: §8's milestones will key into the same
  -- table with their own ids, and a constraint pointing at one source would block the second.
  entry_key uuid not null,
  note text,
  hidden boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, entry_key)
);

alter table journal_notes enable row level security;

-- Own rows only, directly. Everyone else reads through get_journal below, which applies the hide.
drop policy if exists journal_notes_own on journal_notes;
create policy journal_notes_own on journal_notes
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

alter table journal_notes drop constraint if exists journal_notes_length;
alter table journal_notes add constraint journal_notes_length
  check (note is null or char_length(note) <= 280);

/** The achievement types that become journal entries. Everything else notification_events carries
 * — friend requests, messages, join requests — is activity, not achievement, and would turn a
 * progress log into a second inbox. */
create or replace function journal_achievement_types()
returns text[]
language sql
immutable
as $$
  select array[
    'ranked_up',
    'streak_milestone',
    'goal_streak_milestone',
    'challenge_won',
    'campfire_settled',
    'season_settled',
    'reward_ready'
  ];
$$;

/**
 * One person's journal, newest first.
 *
 * SECURITY DEFINER on purpose: notification_events is RLS'd to its own recipient, which is right
 * for a bell feed and wrong for a public profile. This function is the single place that decides
 * what a visitor may see, and it applies the hide — so a hidden entry is invisible to everyone but
 * the owner rather than merely un-rendered by a client that could choose otherwise.
 */
create or replace function get_journal(p_user uuid, p_limit int default 50)
returns table (
  entry_key uuid,
  type text,
  title text,
  body text,
  image_url text,
  image_shape text,
  note text,
  hidden boolean,
  created_at timestamptz
)
language sql
security definer
set search_path = public
stable
as $$
  select
    e.id,
    e.type,
    e.title,
    e.body,
    e.image_url,
    e.image_shape,
    n.note,
    coalesce(n.hidden, false),
    e.created_at
  from notification_events e
  left join journal_notes n on n.user_id = e.user_id and n.entry_key = e.id
  where e.user_id = p_user
    and e.type = any(journal_achievement_types())
    -- A hidden entry stays visible to its owner (the spec's "hidden items still show in the
    -- owner's own hall") and disappears for everyone else.
    and (p_user = auth.uid() or not coalesce(n.hidden, false))
  order by e.created_at desc
  limit least(greatest(p_limit, 1), 200);
$$;

grant execute on function get_journal(uuid, int) to authenticated;

/**
 * Attach, edit or clear a note on one entry — the spec's "＋ add a note".
 *
 * Verifies the entry actually belongs to the caller before writing. Without that check the primary
 * key would happily accept a note keyed to a stranger's entry id: harmless today, since get_journal
 * only joins notes for the entry's own owner, but it would be a row of someone else's text sitting
 * in the table waiting for a future query to surface it.
 */
create or replace function set_journal_note(p_entry_key uuid, p_note text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_clean text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if auth.uid() is null then raise exception 'Not signed in.'; end if;
  if not exists (
    select 1 from notification_events e where e.id = p_entry_key and e.user_id = auth.uid()
  ) then
    raise exception 'That entry is not yours.';
  end if;

  insert into journal_notes (user_id, entry_key, note)
  values (auth.uid(), p_entry_key, v_clean)
  on conflict (user_id, entry_key) do update set note = excluded.note, updated_at = now();
end;
$$;

grant execute on function set_journal_note(uuid, text) to authenticated;

/** Hide or unhide one entry from visitors. Same ownership check, same reasoning. */
create or replace function set_journal_hidden(p_entry_key uuid, p_hidden boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'Not signed in.'; end if;
  if not exists (
    select 1 from notification_events e where e.id = p_entry_key and e.user_id = auth.uid()
  ) then
    raise exception 'That entry is not yours.';
  end if;

  insert into journal_notes (user_id, entry_key, hidden)
  values (auth.uid(), p_entry_key, coalesce(p_hidden, false))
  on conflict (user_id, entry_key) do update set hidden = excluded.hidden, updated_at = now();
end;
$$;

grant execute on function set_journal_hidden(uuid, boolean) to authenticated;
