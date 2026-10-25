-- 0273 . A SESSION POSTS ITSELF — auto-post a finished lock-in to the Agora
-- (CODE_PROMPT_agora_autopost.md, mock 297).
--
-- A sticky toggle, not a per-session button. profiles.post_to_agora is the set-once default
-- (OFF — privacy); the done screen pre-sets its "Post to the Agora" switch from it and can still
-- override one session either way. With it on, tapping Done posts the session: summary (goal,
-- time, XP — the seal/Heir is drawn by the card from get_identity_badges, as every Agora card
-- already does), the optional caption, and the photos taken during it. Comment-only: the post is
-- an ordinary agora_posts row; no like surface is added anywhere.
--
-- WHY THE CLIENT TRIGGERS IT. The caption is typed on the done screen, AFTER stop_lock_in_session
-- has already returned, so a post fired from the stop path would always land captionless. The done
-- screen calls post_session_to_agora once the user taps Done.
--
-- PHOTOS. Session photos live in the PRIVATE check-in-photos bucket; Agora photos are read from the
-- PUBLIC agora-photos bucket by path. SQL cannot copy storage objects, so the client re-uploads the
-- session's photos it still holds into agora-photos under the caller's prefix (the same
-- uploadAgoraPhoto path the composer uses) and passes the paths. The first rides in photo_path like
-- any post; the rest ride in the lockin attachment's snapshot ('photos'), and 0131's single-path
-- cleanup is extended below so deleting the post hard-deletes ALL of them (#149).
--
-- Additive. No change to create_agora_post — this wraps it, so every ownership / snapshot / UGC /
-- rate-limit rule it applies still applies.

-- ──────────────────── 1. the sticky default ────────────────────
alter table public.profiles add column if not exists post_to_agora boolean not null default false;
comment on column public.profiles.post_to_agora is
  '0273 -- sticky default for the done screen''s "Post to the Agora" toggle. Default off.';

create or replace function public.set_post_to_agora(p_enabled boolean)
returns void
language sql
security definer
set search_path = public
as $$
  update profiles set post_to_agora = coalesce(p_enabled, false) where id = auth.uid();
$$;

-- ──────────────────── 2. post one session ────────────────────
drop function if exists public.post_session_to_agora(uuid, text, text[], text);
create function public.post_session_to_agora(
  p_check_in_id uuid,
  p_caption     text default null,
  p_photo_paths text[] default null,
  p_visibility  text default 'friends'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_ci check_ins;
  v_paths text[] := '{}';
  v_path text;
  v_id uuid;
  v_snap jsonb;
begin
  if v_me is null then raise exception 'Not signed in.'; end if;

  select * into v_ci from check_ins c
   where c.id = p_check_in_id and c.user_id = v_me and c.removed_at is null;
  if v_ci.id is null then raise exception 'That session is not yours to post.'; end if;
  if v_ci.created_at < now() - interval '24 hours' then
    raise exception 'That session is too old to auto-post.';
  end if;

  foreach v_path in array coalesce(p_photo_paths, '{}') loop
    continue when nullif(btrim(v_path), '') is null;
    if split_part(v_path, '/', 1) <> v_me::text then raise exception 'That photo is not yours.'; end if;
    v_paths := v_paths || v_path;
  end loop;
  if cardinality(v_paths) > 4 then raise exception 'Up to 4 photos.'; end if;

  -- Once per session. A second tap (or a retry after a flaky network) returns the first post.
  select ap.id into v_id
    from agora_posts ap
   where ap.user_id = v_me and ap.attach_kind = 'lockin' and ap.attach_ref_id = p_check_in_id
     and coalesce((ap.attach_snapshot->>'auto')::boolean, false)
   limit 1;
  if v_id is not null then return v_id; end if;

  v_id := create_agora_post(
    p_caption,
    v_paths[1],
    case when p_visibility in ('friends', 'campus', 'public') then p_visibility else 'friends' end,
    null, null, null,
    jsonb_build_array(jsonb_build_object('kind', 'lockin', 'ref_id', p_check_in_id))
  );

  -- Mark it auto (the feed's ⚡ tag), carry XP + the extra photos. The snapshot is server-built by
  -- create_agora_post; this only adds keys to it, and mirrors element [0] like 0140 does.
  select ap.attachments->0->'snapshot' into v_snap from agora_posts ap where ap.id = v_id;
  v_snap := coalesce(v_snap, '{}'::jsonb) || jsonb_build_object(
    'auto', true,
    'xp_earned', coalesce(v_ci.xp_earned, 0),
    'photos', to_jsonb(coalesce(v_paths[2:], '{}'::text[]))
  );
  update agora_posts ap
     set attachments = jsonb_set(ap.attachments, '{0,snapshot}', v_snap),
         attach_snapshot = v_snap
   where ap.id = v_id;

  return v_id;
end;
$$;

-- ──────────────────── 3. hard-delete the extra photos with the post (#149) ────────────────────
-- 0131's agora_post_photo_cleanup handles photo_path; this handles the snapshot's 'photos'.
create or replace function public.agora_post_extra_photo_cleanup()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_path text;
begin
  if to_regclass('storage.objects') is null then return old; end if;
  for v_path in
    select value
      from jsonb_array_elements(coalesce(old.attachments, '[]'::jsonb)) a,
           jsonb_array_elements_text(coalesce(a.value->'snapshot'->'photos', '[]'::jsonb))
  loop
    continue when split_part(v_path, '/', 1) <> old.user_id::text;
    execute 'delete from storage.objects where bucket_id = $1 and name = $2' using 'agora-photos', v_path;
    insert into agora_photo_orphans (photo_path) values (v_path) on conflict (photo_path) do nothing;
  end loop;
  return old;
end;
$$;

drop trigger if exists agora_posts_extra_photo_cleanup on public.agora_posts;
create trigger agora_posts_extra_photo_cleanup
  after delete on public.agora_posts
  for each row execute function public.agora_post_extra_photo_cleanup();

-- ──────────────────── 4. grants ────────────────────
revoke all on function public.set_post_to_agora(boolean) from public, anon;
revoke all on function public.post_session_to_agora(uuid, text, text[], text) from public, anon;
revoke all on function public.agora_post_extra_photo_cleanup() from public, anon, authenticated;
grant execute on function public.set_post_to_agora(boolean) to authenticated;
grant execute on function public.post_session_to_agora(uuid, text, text[], text) to authenticated;

-- ──────────────────── assertions ────────────────────
do $assert$
begin
  if (select column_default from information_schema.columns
       where table_schema = 'public' and table_name = 'profiles' and column_name = 'post_to_agora') <> 'false' then
    raise exception '0273: post_to_agora must default off';
  end if;
  if has_function_privilege('anon', 'public.post_session_to_agora(uuid,text,text[],text)', 'execute') then
    raise exception '0273: anon can call post_session_to_agora';
  end if;
end;
$assert$;
