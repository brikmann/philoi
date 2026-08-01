-- Additive only — does not touch get_workout_recap() (that rollup's shape is core gym V1, owned
-- elsewhere). The done-screen recap only has per-EXERCISE rollups (sets/reps/weight), not
-- individual set ids, so clips (which are per-SET) need their own lookup: every clipped set from
-- a finished workout, keyed by check_in_id (already a prop the done screen has), same access rule
-- as workout_sets' own RLS (owner or circle-mate).
create or replace function get_check_in_clips(p_check_in_id uuid)
returns setof workout_sets
language sql
security definer
set search_path = public
stable
as $$
  select ws.*
  from workout_sets ws
  join workouts w on w.id = ws.workout_id
  where w.check_in_id = p_check_in_id
    and ws.video_key is not null
    and (w.user_id = auth.uid() or is_circle_mate_of(w.user_id) or is_admin())
  order by ws.created_at asc;
$$;
