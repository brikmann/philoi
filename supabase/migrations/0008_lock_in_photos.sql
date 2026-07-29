-- Photos during lock-in sessions — this file is a historical, reviewable snapshot;
-- supabase/schema.sql is the real deploy artifact and carries the identical statements.
-- Run the whole of schema.sql, not this file, against a project.
--
-- A lock-in session can now carry several photos captured mid-session (bounced around on
-- the client while active, purely local — never synced to other users), uploaded as a batch
-- and attached to the resulting check_ins row only when the session is stopped. One session
-- still equals exactly one feed post — check_in_circles' fan-out is untouched — it just
-- carries a gallery instead of a single photo.

create table if not exists check_in_photos (
  id uuid primary key default gen_random_uuid(),
  check_in_id uuid not null references check_ins (id) on delete cascade,
  photo_url text not null,
  position int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists check_in_photos_check_in_idx on check_in_photos (check_in_id, position);

alter table check_in_photos enable row level security;

-- Same "own rows + circle-mates' rows" shape as check_ins itself — joins back to check_ins
-- to reuse is_circle_mate_of() rather than duplicating visibility logic on a table that has
-- no user_id of its own.
drop policy if exists "check_in_photos: read if circle-mate" on check_in_photos;
create policy "check_in_photos: read if circle-mate" on check_in_photos for select using (
  exists (
    select 1 from check_ins ci
    where ci.id = check_in_photos.check_in_id
      and (ci.user_id = auth.uid() or is_circle_mate_of(ci.user_id) or is_admin())
  )
);

-- No insert/update/delete policy for regular users — rows are only ever written inside
-- stop_lock_in_session() (security definer), same trusted-write pattern as check_ins/
-- lock_in_sessions/check_in_circles themselves. No Storage-bucket policy change is needed
-- either: check-in-photos' existing upload/read policies and delete_my_account()'s cleanup
-- query all key off (storage.foldername(name))[1] = auth.uid(), so the deeper per-photo path
-- (userId/checkInId/index.jpg) used here is already covered.

-- stop_lock_in_session's parameter list is changing (one photo -> an ordered array of
-- photos). DROP + recreate rather than a bare CREATE OR REPLACE — this migration set already
-- hit Postgres 42P13 ("cannot change return type") from an incompatible CREATE OR REPLACE on
-- get_my_ranks() earlier, so signature changes get the defensive drop-first treatment here too.
drop function if exists stop_lock_in_session(uuid, text, text);

create or replace function stop_lock_in_session(
  p_session_id uuid,
  p_photo_urls text[] default null,   -- ordered Storage paths; null/empty = no photos
  p_caption text default null
)
returns check_ins
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session lock_in_sessions;
  v_check_in check_ins;
  v_first_photo text;
  i int;
begin
  select * into v_session from lock_in_sessions
  where id = p_session_id and user_id = auth.uid() and status = 'active';

  if v_session.id is null then
    raise exception 'Session not found or already stopped.';
  end if;

  -- check_ins.photo_url keeps the FIRST photo for back-compat with anything still reading
  -- it directly (e.g. admin/moderation photo previews) — the full ordered set always also
  -- lands in check_in_photos below, which is the single source of truth for the feed gallery.
  v_first_photo := case when p_photo_urls is not null and array_length(p_photo_urls, 1) > 0
    then p_photo_urls[1] else null end;

  insert into check_ins (goal_id, user_id, photo_url, caption, duration_seconds, status)
  values (
    v_session.goal_id, auth.uid(), v_first_photo, p_caption,
    greatest(extract(epoch from now() - v_session.started_at)::integer, 1),
    'on_time'
  )
  returning * into v_check_in;

  if p_photo_urls is not null then
    for i in 1 .. array_length(p_photo_urls, 1) loop
      insert into check_in_photos (check_in_id, photo_url, position)
      values (v_check_in.id, p_photo_urls[i], i - 1);
    end loop;
  end if;

  update lock_in_sessions
  set status = 'completed', ended_check_in_id = v_check_in.id
  where id = v_session.id;

  return v_check_in;
end;
$$;
