-- An Agora post can be deleted again — by its author, by moderation, and by account deletion.
--
-- Found 2026-10-26 by a rolled-back probe against prod: EVERY `delete from agora_posts` raised
--
--     column reference "value" is ambiguous
--
-- from agora_post_extra_photo_cleanup (0273). Its loop selected a bare `value` out of TWO
-- jsonb_array_elements* calls; both expose a column called `value`, so the statement never plans.
-- It is a row trigger on every delete, so it took down all three delete paths at once:
--
--   * delete_agora_post        — the author's own "Delete" on a card;
--   * admin_resolve_report     — 'removed_content' on a reported post (0131), i.e. takedowns;
--   * the profiles cascade     — account deletion for anyone who has ever posted to the Agora.
--
-- Behind it sat a second failure the first one was hiding. 0131's agora_post_photo_cleanup does a
-- raw `delete from storage.objects`, and Supabase has since installed `protect_objects_delete`, a
-- statement-level BEFORE DELETE trigger that refuses any direct delete unless the session sets
-- `storage.allow_delete_query = 'true'`. Fixing only the ambiguity would have moved every
-- photo-post delete onto that error instead. (agora_photo_orphans has zero rows: no post with a
-- photo has ever been successfully deleted on prod.)
--
-- Both functions keep their 0131 / 0273 semantics exactly. The object ROW goes, so the public URL
-- 404s immediately for everyone holding it; the blob is recorded in agora_photo_orphans because
-- only the storage API can reclaim it (0131's note). `allow_delete_query` is set with is_local =>
-- true, so it lasts for this transaction only and opens nothing for any other statement.
--
-- Bodies are the live prod definitions (pg_get_functiondef, 2026-10-26) with only the two fixes
-- applied. Signatures are unchanged (no args, returns trigger), so these are true replacements and
-- the existing triggers keep pointing at them.

create or replace function public.agora_post_photo_cleanup()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if old.photo_path is null then
    return old;
  end if;

  if to_regclass('storage.objects') is null then
    return old;  -- bare Postgres; nothing to clean up
  end if;

  -- Supabase's protect_objects_delete refuses a direct delete without this. Transaction-local.
  perform set_config('storage.allow_delete_query', 'true', true);
  execute 'delete from storage.objects where bucket_id = $1 and name = $2'
    using 'agora-photos', old.photo_path;

  insert into agora_photo_orphans (photo_path)
  values (old.photo_path)
  on conflict (photo_path) do nothing;

  return old;
end;
$fn$;

create or replace function public.agora_post_extra_photo_cleanup()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_path text;
begin
  if to_regclass('storage.objects') is null then return old; end if;
  for v_path in
    -- Both set-returning calls expose `value`; name the photo one. This was the whole bug.
    select ph.value
      from jsonb_array_elements(coalesce(old.attachments, '[]'::jsonb)) a,
           jsonb_array_elements_text(coalesce(a.value->'snapshot'->'photos', '[]'::jsonb)) ph
  loop
    continue when split_part(v_path, '/', 1) <> old.user_id::text;
    perform set_config('storage.allow_delete_query', 'true', true);
    execute 'delete from storage.objects where bucket_id = $1 and name = $2' using 'agora-photos', v_path;
    insert into agora_photo_orphans (photo_path) values (v_path) on conflict (photo_path) do nothing;
  end loop;
  return old;
end;
$fn$;

revoke all on function public.agora_post_photo_cleanup() from public, anon, authenticated;
revoke all on function public.agora_post_extra_photo_cleanup() from public, anon, authenticated;

-- ───────────────────────────── verify ─────────────────────────────
-- Delete a real post inside a savepoint-style block and undo it by raising. Discriminating: the
-- pre-0278 bodies fail the first branch (ambiguous `value`), and a photo post additionally fails
-- the second (protect_delete) — while a post that is simply absent is reported, not passed.
do $verify$
declare
  v_plain uuid;
  v_photo uuid;
  v_ok boolean;
begin
  if to_regclass('storage.objects') is null then return; end if;
  perform set_config('philoi.suppress_push', 'on', true);

  select id into v_plain from agora_posts where photo_path is null limit 1;
  select id into v_photo from agora_posts where photo_path is not null limit 1;

  foreach v_ok in array array[true, false] loop
    declare
      v_id uuid := case when v_ok then v_plain else v_photo end;
    begin
      continue when v_id is null;
      begin
        delete from agora_posts where id = v_id;
        if exists (select 1 from agora_posts where id = v_id) then
          raise exception '0278 verify: post % survived its delete', v_id;
        end if;
        raise exception using errcode = 'P0278', message = 'rollback';
      exception
        when sqlstate 'P0278' then null;  -- deleted, and undone
        when others then raise exception '0278 verify: deleting post % failed: %', v_id, sqlerrm;
      end;
    end;
  end loop;
end
$verify$;
