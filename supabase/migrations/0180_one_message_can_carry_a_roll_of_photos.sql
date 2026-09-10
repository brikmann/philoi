-- ONE MESSAGE, SEVERAL PHOTOS (D3)
--
-- ══════════════════════════════════════════════════════════════════════════════════════════════
-- WHAT WAS BROKEN, AND WHY THE CLIENT WAS RIGHT TO REFUSE
--
-- Noah: "can select multiple images but can't send them." The picker already had
-- `allowsMultipleSelection`, so the selecting half worked; what did not exist was anywhere to PUT
-- more than one. 0158's shape constraint pins a photo message to exactly one `attach_path`:
--
--   attach_kind = 'photo' and attach_path is not null and attach_ref_id is null
--
-- so a second photo had no column to land in. The client's workaround was one message per asset,
-- which is a different product — four photos became four bubbles with four timestamps instead of
-- the one post with a grid the brief asks for.
--
-- SHAPE. `messages.attach_paths` is a jsonb ARRAY of storage keys, mirroring what 0140 did for
-- `agora_posts.attachments`, and for the same two reasons:
--
--   (a) it is the source of truth on the read path, and
--   (b) `attach_path` is kept in step with element [0], so a build that predates this migration
--       keeps rendering the FIRST photo of a multi-photo post rather than an empty bubble.
--
-- (b) is a hard requirement here, not a courtesy. runtimeVersion is still 'sdkVersion', so there
-- is no OTA path to the installed builds — every client already on a phone is a pre-0180 client
-- for as long as that binary lives, and it reads `attach_path` and nothing else. A migration that
-- moved the photo out of that column would blank every existing photo message on every build.
--
-- 🔒 Firewall: one column, one constraint, one backfill. Nothing here moves currency.
-- ══════════════════════════════════════════════════════════════════════════════════════════════

alter table messages
  add column if not exists attach_paths jsonb not null default '[]'::jsonb;

do $$
begin
  alter table messages
    add constraint messages_attach_paths_is_array check (jsonb_typeof(attach_paths) = 'array');
exception
  when duplicate_object then null;
end;
$$;

comment on column messages.attach_paths is
  'Ordered storage keys for a photo message, as a jsonb array of text — see 0180. Source of truth; '
  'attach_path mirrors element [0] so pre-0180 builds still render the first photo.';

-- Every photo message written before this migration: fold its single path into the array, so the
-- read path has exactly one shape to think about.
update messages
set attach_paths = jsonb_build_array(attach_path)
where attach_kind = 'photo'
  and attach_path is not null
  and jsonb_array_length(attach_paths) = 0;

-- ─────────────────────────── the shape ───────────────────────────
--
-- Widened, not loosened. The own-prefix rule is the security-relevant half — it is what stops
-- anyone pointing a message at a file in someone else's folder — so it now has to hold for EVERY
-- element of the array, not just for the one that happens to be mirrored into attach_path.
--
-- A CHECK constraint may not contain a subquery, and `jsonb_array_elements_text` in a NOT EXISTS
-- is one. So the per-element test lives in an IMMUTABLE function the constraint can call. That is
-- allowed, and it is the same shape 0140 used for the Agora's array.

create or replace function message_paths_are_own(p_paths jsonb, p_user_id uuid)
returns boolean
language sql
immutable
as $fn$
  -- True when every element is a text key under the author's own folder. An empty array is
  -- vacuously true, which is correct: a non-photo message carries no paths.
  select coalesce(bool_and(
           jsonb_typeof(el) = 'string'
           and el #>> '{}' like p_user_id::text || '/%'
         ), true)
  from jsonb_array_elements(coalesce(p_paths, '[]'::jsonb)) el;
$fn$;

comment on function message_paths_are_own(jsonb, uuid) is
  'Every element of a messages.attach_paths array sits under the author own-id prefix (0180). '
  'Immutable and subquery-free so messages_attachment_shape can call it from a CHECK.';

alter table messages drop constraint if exists messages_attachment_shape;
alter table messages add constraint messages_attachment_shape check (
  (attach_kind is null and attach_path is null and attach_ref_id is null
   and jsonb_array_length(attach_paths) = 0)
  or (
    attach_kind = 'photo'
    and attach_path is not null
    and attach_ref_id is null
    and attach_path like user_id::text || '/%'
    -- The array must be non-empty, must start with the mirrored path, and must be own-prefix
    -- throughout. The first two together are what keep a pre-0180 client honest: element [0] is
    -- exactly the photo it will render.
    and jsonb_array_length(attach_paths) >= 1
    and attach_paths ->> 0 = attach_path
    and message_paths_are_own(attach_paths, user_id)
  )
  or (attach_kind = 'lockin' and attach_ref_id is not null and attach_path is null
      and jsonb_array_length(attach_paths) = 0)
  -- 0162/0163 write 'challenge' and 'system' rows through this table. 0158's constraint never
  -- named either, which means they have only ever passed via the all-null branch above — so they
  -- keep passing it unchanged. This migration is about photos and deliberately widens nothing else.
);

-- ─────────────────────────── verification ───────────────────────────
--
-- These run the BODY, not just the DDL. A begin/rollback dry-run proves a constraint compiles;
-- only an actual insert proves it accepts what it should AND refuses what it must. Each negative
-- below is paired with the positive above it, so a probe that would pass on a database where
-- nothing works is not mistaken for a green light.
do $verify$
declare
  v_group uuid;
  v_user  uuid;
  v_other uuid;
  v_id    uuid;
begin
  select group_id, user_id into v_group, v_user from group_members limit 1;
  if v_group is null then
    raise notice '0180: no group_members row to test against — skipping insert probes';
    return;
  end if;
  select id into v_other from profiles where id <> v_user limit 1;

  -- POSITIVE: a two-photo message under the author's own prefix is accepted.
  insert into messages (group_id, user_id, body, attach_kind, attach_path, attach_paths)
  values (v_group, v_user, null, 'photo',
          v_user::text || '/a.jpg',
          jsonb_build_array(v_user::text || '/a.jpg', v_user::text || '/b.jpg'))
  returning id into v_id;
  delete from messages where id = v_id;

  -- NEGATIVE: element [0] disagreeing with attach_path must be refused, or a pre-0180 client
  -- would render a photo that is not the post's first.
  begin
    insert into messages (group_id, user_id, attach_kind, attach_path, attach_paths)
    values (v_group, v_user, 'photo', v_user::text || '/a.jpg',
            jsonb_build_array(v_user::text || '/b.jpg'));
    raise exception '0180: a mismatched attach_paths[0] was accepted';
  exception
    when check_violation then null;
  end;

  -- NEGATIVE: a second element in SOMEONE ELSE'S folder must be refused. This is the rule that
  -- actually matters, and the one 0158 never had to think about because there was only ever one
  -- path to check.
  if v_other is not null then
    begin
      insert into messages (group_id, user_id, attach_kind, attach_path, attach_paths)
      values (v_group, v_user, 'photo', v_user::text || '/a.jpg',
              jsonb_build_array(v_user::text || '/a.jpg', v_other::text || '/stolen.jpg'));
      raise exception '0180: a foreign-prefix path was accepted in attach_paths';
    exception
      when check_violation then null;
    end;
  end if;

  raise notice '0180: attach_paths accepts a real multi-photo post and refuses both bad shapes';
end
$verify$;
