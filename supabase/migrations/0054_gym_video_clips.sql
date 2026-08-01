-- Gym tracker phase-2 — per-set video clips (PHILOI_UI_SPEC.md §23). Bytes live in Cloudflare
-- R2 (see supabase/functions/gym-clip-upload-url, gym-clip-playback-url); Postgres holds only
-- references. All columns nullable — a clip is optional per set, never auto-filmed.
alter table workout_sets add column if not exists video_key text;
alter table workout_sets add column if not exists thumb_key text;
alter table workout_sets add column if not exists duration_s numeric;
alter table workout_sets add column if not exists resolution text;
alter table workout_sets add column if not exists uploaded_at timestamptz;

create index if not exists workout_sets_video_idx on workout_sets (workout_id) where video_key is not null;

-- Monthly quota (§23: "free 10 / paid unlimited... a plan differentiator, not a cost gate") —
-- derived by counting, not a separate running-counter table, so it can never drift from the
-- actual uploaded clips. p_user_id defaults to the caller (client's own "N left this month"
-- read) but accepts an explicit id the same way get_user_rank/get_profile_stats already do
-- elsewhere in this schema — quota counts aren't sensitive, and the Edge Function needs to call
-- this for the calling user via its own auth-scoped client, which already covers that case; the
-- explicit-id form exists for symmetry with those sibling functions, not because it's needed by
-- a different caller today.
create or replace function get_gym_clip_quota(p_user_id uuid default null)
returns table (tier text, used_this_month int, clip_limit int, remaining int)
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_user_id uuid := coalesce(p_user_id, auth.uid());
  v_is_pro boolean;
  v_used int;
begin
  select is_pro into v_is_pro from profiles where id = v_user_id;

  select count(*)::int into v_used
  from workout_sets ws
  join workouts w on w.id = ws.workout_id
  where w.user_id = v_user_id
    and ws.video_key is not null
    and ws.uploaded_at >= date_trunc('month', now());

  if coalesce(v_is_pro, false) then
    return query select 'paid'::text, v_used, null::int, null::int;
  else
    return query select 'free'::text, v_used, 10, greatest(0, 10 - v_used);
  end if;
end;
$$;

-- The ONLY writer of the video columns — never a raw client update, same trusted-write pattern
-- as every other workout_sets mutation in migration 0037. Called after the client has already
-- PUT the compressed clip + thumbnail directly to R2 via the signed URLs from
-- gym-clip-upload-url; this just persists the references and re-validates ownership + quota
-- (the Edge Function checks quota too, before issuing the signed URL, but re-checking here closes
-- the race where two uploads for the same free-tier user are in flight at once).
create or replace function attach_workout_set_clip(
  p_workout_set_id uuid,
  p_video_key text,
  p_thumb_key text,
  p_duration_s numeric,
  p_resolution text
)
returns workout_sets
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner uuid;
  v_quota record;
  v_set workout_sets;
begin
  select w.user_id into v_owner
  from workout_sets ws
  join workouts w on w.id = ws.workout_id
  where ws.id = p_workout_set_id;

  if v_owner is null or v_owner <> auth.uid() then
    raise exception 'Not your set.';
  end if;

  select * into v_quota from get_gym_clip_quota(auth.uid());
  if v_quota.tier = 'free' and v_quota.used_this_month >= v_quota.clip_limit then
    raise exception 'You have used all % free clips this month.', v_quota.clip_limit;
  end if;

  update workout_sets
  set video_key = p_video_key,
      thumb_key = p_thumb_key,
      duration_s = p_duration_s,
      resolution = p_resolution,
      uploaded_at = now()
  where id = p_workout_set_id
  returning * into v_set;

  return v_set;
end;
$$;

-- Re-record / delete a clip — clears the reference only; the bytes in R2 age out via the
-- bucket's own ~90-day retention lifecycle rule (§23), not a synchronous delete call here.
create or replace function remove_workout_set_clip(p_workout_set_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update workout_sets ws
  set video_key = null, thumb_key = null, duration_s = null, resolution = null, uploaded_at = null
  from workouts w
  where ws.id = p_workout_set_id and ws.workout_id = w.id and w.user_id = auth.uid();
end;
$$;
