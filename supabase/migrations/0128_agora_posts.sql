-- The Agora, part 1 of 3 — freeform posts (AGORA_SPEC.md, mocks 160 + 162).
--
-- The Agora is a READ SURFACE over things that already exist. Milestones (0093) already fire on
-- accomplishments and already carry a friends/campus/public audience; the feed just reads them at
-- the scope you picked. This file adds the one thing that genuinely did not exist: the freeform
-- post — "a short note, a photo, or share a milestone with a caption".
--
-- ══════════════════════════════════════════════════════════════════════════════════════════════
-- 🔒 THE FIREWALL HOLDS HERE TOO. Posting to the Agora and being cheered in it grant ZERO XP,
-- ZERO embers, ZERO rank movement. Nothing in this migration or the two that follow calls
-- grant_reward(), economy_award_*(), or writes to ember_wallet / ember_ledger / user_rank_state /
-- forge_pass_state / pass_xp_ledger. The Agora pays in ATTENTION, which is the point of it —
-- 0093's note applies verbatim, and paying out for posts would additionally turn the town square
-- into a farm.
-- ══════════════════════════════════════════════════════════════════════════════════════════════

-- ───────────────────────────── visibility ─────────────────────────────

/**
 * Can p_viewer see something p_owner published at this audience?
 *
 * Deliberately a thin wrapper over 0093's can_see_milestone_for rather than a second copy of the
 * rule. That function never touches the milestones table — it is a pure friends/campus/public
 * predicate that happened to be written for milestones first. Re-deriving it here is how the two
 * surfaces would drift, and a drift in THIS direction leaks a friends-only post to a campus.
 */
create or replace function can_see_agora(p_owner uuid, p_visibility text, p_viewer uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select can_see_milestone_for(p_owner, p_visibility, p_viewer);
$$;

grant execute on function can_see_agora(uuid, text, uuid) to authenticated;

-- ───────────────────────────── the post ─────────────────────────────

create table if not exists agora_posts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles (id) on delete cascade,
  body text check (body is null or char_length(body) <= 1000),
  /** Storage path in the `agora-photos` bucket, never a URL — same convention check_ins uses. */
  photo_path text,
  /**
   * Default 'campus', not 'friends' and not 'public'. Friends-by-default makes the town square
   * empty for exactly the people it is meant to pull in; public-by-default opts everyone into a
   * global firehose they did not ask for. Campus is the audience the spec calls the reach dial
   * that matters ("where reach + a bit of school pride live").
   *
   * A poster with no `profiles.university` set sees nobody at 'campus' — can_see_agora requires a
   * non-null match on BOTH sides. That is deliberately not fixed up server-side: silently
   * promoting someone's post to 'public' because their profile is incomplete is the kind of
   * widening a user would never have chosen. The composer disables Campus and defaults to Global
   * for those accounts instead.
   */
  visibility text not null default 'campus' check (visibility in ('friends', 'campus', 'public')),
  /**
   * The optional attachment — "an achievement you've earned, or a lock-in you've completed"
   * (mock 162 panels 4-5). `attach_ref_id` points at the underlying row where one exists
   * (milestone / check_in / personal_record); `attach_key` carries the catalog key for a cosmetic.
   * Standing-type attachments (rank, streak, pass) have neither — they are read off live state.
   */
  attach_kind text check (attach_kind in ('milestone', 'lockin', 'rank', 'streak', 'pass', 'cosmetic', 'pr')),
  attach_ref_id uuid,
  attach_key text,
  /**
   * The attachment's title/subtitle AS COMPUTED AT POST TIME, and the same frozen-receipt argument
   * 0093 makes about `milestones.effort`: a card that said "Hero II" must not silently become
   * "Hero III" under a caption that was written about the promotion to Hero II. Ranks move,
   * streaks break, seasons end — the post is a claim about a moment.
   *
   * COMPUTED SERVER-SIDE, ALWAYS (create_agora_post below). The client sends WHICH achievement,
   * never what it says. A snapshot the poster could type themselves is worth nothing.
   */
  attach_snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  -- A post with no body, no photo and no attachment is not a post.
  constraint agora_posts_not_empty check (
    coalesce(btrim(body), '') <> '' or photo_path is not null or attach_kind is not null
  )
);

-- The feed's one hot query is "newest first, then page back" across a scoped set of authors, so
-- the cursor columns lead. `id` is in the index because the keyset cursor is (created_at, id) —
-- two posts in the same millisecond otherwise page unstably.
create index if not exists agora_posts_recent_idx on agora_posts (created_at desc, id desc);
create index if not exists agora_posts_user_idx on agora_posts (user_id, created_at desc);

alter table agora_posts enable row level security;

-- Same shape as milestones (0093): no broad select policy, because visibility is a three-way rule
-- that RLS would have to restate in every policy touching the table. get_agora_feed() (0130) is
-- the single place that decides who sees what. The policy here is own-rows-only, so a client that
-- reaches for the table directly gets its own posts and nothing else.
drop policy if exists agora_posts_own on agora_posts;
create policy agora_posts_own on agora_posts
  for select to authenticated using (user_id = auth.uid());

-- Delete yes, update no — for the same reason 0093 refuses milestone edits. The attachment
-- snapshot was frozen against a specific claim; letting the body be rewritten underneath it turns
-- "finally hit Hero II 😤" into a caption for whatever the author wants it to have been.
drop policy if exists agora_posts_delete_own on agora_posts;
create policy agora_posts_delete_own on agora_posts
  for delete to authenticated using (user_id = auth.uid());

-- ───────────────────────────── cheers ─────────────────────────────

/**
 * Posts need their own cheer table: milestone_cheers is FK'd to milestones, and the Agora's feed
 * is a union of two different row types. The feed RPC collapses both into one `cheers`/`cheered`
 * pair so the client never has to know which table a given card's cheer landed in.
 *
 * Same cap and same reasoning as 0081/0093 — one cheer per person, because a cheer is a reaction,
 * not a counter someone can spam upward. And per the spec's "keep it healthy": a cheer is the
 * ONLY quick reaction the Agora has. There is no downvote table here and there is not meant to be.
 */
create table if not exists agora_post_cheers (
  post_id uuid not null references agora_posts (id) on delete cascade,
  user_id uuid not null references profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);

alter table agora_post_cheers enable row level security;

drop policy if exists agora_post_cheers_own on agora_post_cheers;
create policy agora_post_cheers_own on agora_post_cheers
  for select to authenticated using (user_id = auth.uid());

-- ───────────────────────────── the milestone opt-out ─────────────────────────────

/**
 * AGORA_SPEC "Privacy": "any milestone can be opted out of the feed."
 *
 * Distinct from `pinned`, which 0093 defines as "is this on my profile/journal at all". A user can
 * reasonably want a grade on their own Journal and in their friends' bells without it also being
 * carried into a campus-wide town square, and before this column the only way to get that was to
 * unpin — which hides it from the author's own Journal too.
 *
 * Defaults true so every milestone already posted flows into the Agora at the audience its author
 * chose. That is the spec's "auto-populates accomplishments", and it is the reason the feed has
 * anything in it on day one.
 */
alter table milestones add column if not exists in_agora boolean not null default true;

-- The feed's milestone half, ordered the way get_agora_feed reads it. milestones_user_idx (0093)
-- leads on user_id, which answers "one person's milestones" and nothing about "everyone's, newest
-- first" — the Agora's actual query. Matching the post index's shape also lets the planner
-- merge-append the two branches of the union instead of sorting their concatenation.
create index if not exists milestones_agora_idx
  on milestones (created_at desc, id desc) where pinned and in_agora;

/** The author's per-post feed toggle. Own rows only — milestones has no general update policy. */
create or replace function set_milestone_in_agora(p_id uuid, p_in_agora boolean)
returns void
language sql
security definer
set search_path = public
as $$
  update milestones set in_agora = coalesce(p_in_agora, true)
  where id = p_id and user_id = auth.uid();
$$;

grant execute on function set_milestone_in_agora(uuid, boolean) to authenticated;

-- ───────────────────────────── moderation evidence ─────────────────────────────

-- "Comments are moderated with report/hide + block, same as DMs/campfires." moderation_reports
-- could only point at a check-in or a user, so an Agora report would have arrived as a bare
-- "someone reported this person" with the offending content nowhere in the row. This column is
-- what lets a reviewer open the thing that was actually reported. (0129 adds the comment twin.)
alter table moderation_reports
  add column if not exists reported_agora_post_id uuid references agora_posts (id) on delete set null;

-- ───────────────────────────── the photo bucket ─────────────────────────────

/**
 * `agora-photos` is PUBLIC, unlike `check-in-photos`.
 *
 * A check-in photo is shown to one campfire and is read through short-lived signed URLs. An Agora
 * photo sits on a card that up to a whole university — or everyone — is entitled to see, in an
 * infinite-scroll list. Signing every image on every page of that feed is a round trip per render
 * for content whose audience is already "the public", and it is exactly the tradeoff `avatars`
 * (also public, also shown to strangers on every leaderboard) already makes.
 *
 * What a public bucket does NOT do is widen who sees the POST. A path is only ever handed out by
 * get_agora_feed(), which applies the visibility rule first, and an unguessable uuid path is the
 * same protection avatars have had since day one. A friends-only post's photo is not linked from
 * anywhere a non-friend can reach.
 *
 * Guarded because a bare Postgres (CI, a local psql) has no `storage` schema, and a migration that
 * hard-fails there would block every later file in the chain.
 */
do $bucket$
begin
  if to_regclass('storage.buckets') is null then
    raise notice 'storage schema absent — skipping agora-photos bucket provisioning';
    return;
  end if;

  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('agora-photos', 'agora-photos', true, 8388608, array['image/jpeg', 'image/png', 'image/webp'])
  on conflict (id) do nothing;

  -- Writes are own-prefix-only: the first path segment must be the uploader's own id, so nobody
  -- can drop a file into someone else's folder or overwrite a photo already on a live post.
  execute 'drop policy if exists "agora photos: read all" on storage.objects';
  execute 'create policy "agora photos: read all" on storage.objects
    for select using (bucket_id = ''agora-photos'')';

  execute 'drop policy if exists "agora photos: insert own" on storage.objects';
  execute 'create policy "agora photos: insert own" on storage.objects
    for insert to authenticated
    with check (bucket_id = ''agora-photos'' and (storage.foldername(name))[1] = auth.uid()::text)';

  execute 'drop policy if exists "agora photos: delete own" on storage.objects';
  execute 'create policy "agora photos: delete own" on storage.objects
    for delete to authenticated
    using (bucket_id = ''agora-photos'' and (storage.foldername(name))[1] = auth.uid()::text)';
end;
$bucket$;
