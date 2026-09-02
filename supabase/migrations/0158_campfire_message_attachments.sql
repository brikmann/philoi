-- 0158 · Campfire messages can carry an attachment (§7a/§7b).
--
-- The + menu's "Post a photo" and "Share a lock-in" both returned a placeholder alert, and the
-- reason was the same one word: `messages` had exactly one content column, `body`. There was
-- nowhere to put an attachment, so neither action could post anything and both were stubbed rather
-- than faked.
--
-- RENUMBERED FROM 0153. Written as 0153 and never pushed; by the time it was ready a parallel
-- session had already created 0153_every_duel_has_a_roster plus 0154–0157 in this same working
-- tree. Two files sharing a leading number is the failure MIGRATIONS.md opens with — the duplicate
-- version silently rolls back and the CLI blames the schema_migrations INSERT rather than the
-- collision. A number is taken the moment the FILE exists, so this one moved rather than theirs.
-- Second time this has happened in this repo; see 0151's own header.
--
-- ══════════════════════════════════════════════════════════════════════════════════════════════
-- MIRRORS THE AGORA MODEL (0128 / 0140), deliberately, but does NOT reuse it.
--
-- The shape is the Agora's: a `kind` discriminator plus the reference that kind needs. What is not
-- reused is the Agora's `agora_attachments` TABLE. That table exists because an Agora post carries
-- up to one of EACH kind — a photo and a lock-in and an achievement, all on one post — so it needs
-- a collection. A chat message carries at most one thing; a whole child table, its RLS, and a join
-- on every message fetch would be a lot of machinery to express "or nothing".
--
-- So: three nullable columns on `messages`, constrained so they can only ever describe one of the
-- two legal shapes. If a chat message ever needs to carry several attachments, THAT is the moment
-- to promote this to a table, and 0140 is the worked example of how.
--
-- ── THE TWO KINDS ────────────────────────────────────────────────────────────────────────────
--   'photo'  → attach_path is a storage key in the campfire-photos bucket. attach_ref_id null.
--   'lockin' → attach_ref_id is a check_ins.id the sender is re-posting. attach_path null.
--
-- ── WHY NO RPC ───────────────────────────────────────────────────────────────────────────────
-- create_agora_post exists partly to re-check that a photo path begins with the uploader's own id,
-- because a client could otherwise point a post at someone else's image. The same risk exists here
-- and is closed differently: the client writes `messages` with a plain PostgREST insert (see
-- lib/api/messages.ts), and routing that through an RPC would ALSO mean the mention trigger from
-- 0152 no longer fires on the natural insert path. A CHECK constraint can compare two columns of
-- the same row, so `attach_path` is required to start with the row's own `user_id` — which is the
-- exact guarantee the RPC was providing, enforced by the table instead of by a function.

alter table messages
  add column if not exists attach_kind text,
  add column if not exists attach_path text,
  add column if not exists attach_ref_id uuid;

-- One constraint for the whole shape rather than three separate ones, so an illegal combination
-- cannot be assembled a column at a time:
--   · no kind  → both refs null (an ordinary message)
--   · 'photo'  → path set, ref null, AND the path is inside the author's own folder
--   · 'lockin' → ref set, path null
alter table messages drop constraint if exists messages_attachment_shape;
alter table messages add constraint messages_attachment_shape check (
  (attach_kind is null and attach_path is null and attach_ref_id is null)
  or (
    attach_kind = 'photo'
    and attach_path is not null
    and attach_ref_id is null
    and attach_path like user_id::text || '/%'
  )
  or (attach_kind = 'lockin' and attach_ref_id is not null and attach_path is null)
);

-- A message with an attachment and no text is legal — posting a photo with no caption is the
-- normal case — so nothing here requires `body`. The old implicit rule that a message always had
-- text was never expressed as a constraint anyway.

comment on column messages.attach_kind is
  'null | photo | lockin. See migration 0158; the shape is enforced by messages_attachment_shape.';

-- ─────────────────────────── the bucket ───────────────────────────
--
-- Its own bucket rather than agora-photos: the two have different retention and different
-- moderation surfaces, and a campfire photo living in a bucket named for the public town square is
-- the kind of thing that reads fine today and is confusing the first time someone audits it.
--
-- Guarded exactly as 0128 guards its own: `supabase db push` runs against a project where the
-- storage schema exists, but a bare `psql` restore into a fresh database has no storage schema at
-- all, and a hard failure here would block every later migration in the chain.
do $bucket$
begin
  if to_regclass('storage.buckets') is null then
    raise notice 'storage schema absent — skipping campfire-photos bucket provisioning';
    return;
  end if;

  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('campfire-photos', 'campfire-photos', true, 8388608, array['image/jpeg', 'image/png', 'image/webp'])
  on conflict (id) do nothing;

  -- Writes are own-prefix-only: the first path segment must be the uploader's own id, so nobody
  -- can drop a file into someone else's folder or overwrite a photo already on a live message.
  -- This is the storage half of the same rule messages_attachment_shape enforces on the row.
  execute 'drop policy if exists "campfire photos: read all" on storage.objects';
  execute 'create policy "campfire photos: read all" on storage.objects
    for select using (bucket_id = ''campfire-photos'')';

  execute 'drop policy if exists "campfire photos: insert own" on storage.objects';
  execute 'create policy "campfire photos: insert own" on storage.objects
    for insert to authenticated
    with check (bucket_id = ''campfire-photos'' and (storage.foldername(name))[1] = auth.uid()::text)';

  execute 'drop policy if exists "campfire photos: delete own" on storage.objects';
  execute 'create policy "campfire photos: delete own" on storage.objects
    for delete to authenticated
    using (bucket_id = ''campfire-photos'' and (storage.foldername(name))[1] = auth.uid()::text)';
end;
$bucket$;

-- ─────────────────────────── verification ───────────────────────────
do $$
declare
  v_cols int;
  v_con int;
begin
  select count(*) into v_cols from information_schema.columns
   where table_schema = 'public' and table_name = 'messages'
     and column_name in ('attach_kind', 'attach_path', 'attach_ref_id');
  select count(*) into v_con from pg_constraint where conname = 'messages_attachment_shape';

  if v_cols = 3 then raise notice '0158 ok — messages carries all three attachment columns.';
  else raise notice '0158 WARNING — expected 3 attachment columns, found %.', v_cols; end if;

  if v_con = 1 then raise notice '0158 ok — messages_attachment_shape constraint in place.';
  else raise notice '0158 WARNING — attachment shape constraint missing.'; end if;

  -- The mention trigger from 0152 must still be on this table: attachments are posted through the
  -- ordinary insert path precisely so that it keeps firing, and if 0152 has not been applied yet
  -- then mentions and pings are still dead regardless of anything here.
  if exists (select 1 from pg_trigger where tgname = 'messages_notify_mentions' and not tgisinternal) then
    raise notice '0158 ok — 0152 mention trigger present on messages.';
  else
    raise notice '0158 WARNING — messages_notify_mentions is absent; 0152 has not been applied.';
  end if;
end;
$$;
