-- Fixes XP showing as 0 on the lock-in celebrate screen — this file is a historical,
-- reviewable snapshot; supabase/schema.sql is the real deploy artifact and carries the
-- identical statements. Run the whole of schema.sql, not this file, against a project.
--
-- Root cause: handle_check_in_insert() is an AFTER INSERT trigger that computes xp_earned
-- via a separate UPDATE once the streak has been recomputed. Postgres's RETURNING clause on
-- the original INSERT captures the row as it was AT INSERT TIME — before that AFTER trigger's
-- UPDATE runs — so stop_lock_in_session()'s `returning * into v_check_in` was always handing
-- the client the pre-trigger row, where xp_earned is still its `default 0`. Re-selecting the
-- row after the insert (once the AFTER trigger has already fired) picks up the real value.
create or replace function stop_lock_in_session(
  p_session_id uuid,
  p_photo_urls text[] default null,
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

  -- The AFTER INSERT trigger (handle_check_in_insert) has already run its UPDATE by this
  -- point in the function — re-fetch to return the real xp_earned instead of the stale
  -- pre-trigger value RETURNING captured above.
  select * into v_check_in from check_ins where id = v_check_in.id;

  return v_check_in;
end;
$$;
