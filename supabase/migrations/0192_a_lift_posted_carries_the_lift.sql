-- 0192 — A lift posted to the Agora carries the lift.
--
-- CODE_PROMPT_agora_gym_lockin_data.md §1. A gym lock-in shared to the Agora showed up as a bare
-- "38:04": agora_attachment_snapshot's 'lockin' branch froze duration_seconds and distance_m and
-- nothing else, so the sets, the volume, the PRs and the clips filmed during the session never
-- reached the snapshot and no renderer could have shown them.
--
-- ─────────────────────────────── WHAT IS FROZEN ───────────────────────────────
--
-- At post time, for a check-in that has strength data, the snapshot gains:
--
--   sets               [{exercise, sets, reps, weight, is_pr}] — the per-exercise summary
--                      stop_lock_in_session already writes (top set by e1RM for a tracked workout,
--                      the logged row for a manual one), in logged order, capped at 12.
--   exercise_count     how many summary rows exist, so the card can say "+N more" past the cap.
--   total_sets         every set: tracked sets counted one by one, else Σ summary.sets.
--   total_volume       Σ weight × reps over every tracked set; for a manual log with no tracker
--                      rows, Σ sets × reps × weight over the summary. Bodyweight (null) is 0.
--   has_pr             any set, tracked or summarised, flagged is_pr.
--   clips              [{workout_set_id, exercise, set_index, duration_s, has_thumb}], capped at 6,
--                      in exercise then set order.
--   clip_count         every eligible clip, for "+N more".
--
-- FACTS, NOT DISPLAY STRINGS, as 0130 established: numbers and names, no "3×8 · 225".
--
-- ─────────────────────────────── CLIPS ───────────────────────────────
--
-- Only clips the member actually kept: video_key AND uploaded_at both set. A clip is never
-- auto-filmed (0054) and attach_workout_set_clip is its only writer, so an uploaded clip is one the
-- member chose to record and keep; a set whose upload never completed is not frozen.
--
-- The snapshot freezes the workout_set_id — NOT the R2 video/thumb keys. Playback still goes
-- through gym-clip-playback-url, which re-checks owner / circle-mate / friend on every request, so
-- freezing a reference into a public post grants nobody a clip they could not already play.
--
-- ─────────────────────────────── BACKWARD COMPATIBILITY ───────────────────────────────
--
-- The strength facts come from a separate helper that returns NULL when the check-in has no
-- summary rows and no tracked sets, and the 'lockin' branch concatenates coalesce(helper, '{}').
-- So a cardio, study or any other lock-in freezes a snapshot byte-identical to today's; posts
-- already written are frozen jsonb and are not touched at all.
--
-- agora_attachment_snapshot below is restated from the LIVE body; the only change is the
-- `|| coalesce(agora_lockin_strength_snapshot(c.id), '{}'::jsonb)` in the 'lockin' branch.

-- ── base check · restated from the LIVE body ──
do $base$
begin
  if (select md5(p.prosrc) from pg_proc p
      where p.proname = 'agora_attachment_snapshot' and p.pronamespace = 'public'::regnamespace)
     is distinct from '4d0a8f3d2fa85036ee38fd533d334a44' then
    raise exception '0192: live agora_attachment_snapshot changed since this file was drafted — rebase onto it';
  end if;
end;
$base$;

create or replace function agora_lockin_strength_snapshot(p_check_in_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_summary_n int;
  v_tracked_n int;
  v_clip_n int;
  v jsonb;
begin
  select count(*) into v_summary_n from check_in_workout_sets s where s.check_in_id = p_check_in_id;

  select count(*) into v_tracked_n
  from workouts w join workout_sets ws on ws.workout_id = w.id
  where w.check_in_id = p_check_in_id;

  if v_summary_n = 0 and v_tracked_n = 0 then
    return null;
  end if;

  select count(*) into v_clip_n
  from workouts w join workout_sets ws on ws.workout_id = w.id
  where w.check_in_id = p_check_in_id
    and ws.video_key is not null and ws.uploaded_at is not null;

  v := jsonb_build_object(
    'sets', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'exercise', x.exercise, 'sets', x.sets, 'reps', x.reps,
               'weight', x.weight, 'is_pr', x.is_pr
             ) order by x.position, x.created_at), '[]'::jsonb)
      from (
        select s.* from check_in_workout_sets s
        where s.check_in_id = p_check_in_id
        order by s.position, s.created_at
        limit 12
      ) x
    ),
    'exercise_count', v_summary_n,
    'total_sets', case
      when v_tracked_n > 0 then v_tracked_n
      else (select coalesce(sum(s.sets), 0)::int from check_in_workout_sets s where s.check_in_id = p_check_in_id)
    end,
    'total_volume', case
      when v_tracked_n > 0 then (
        select round(coalesce(sum(coalesce(ws.weight, 0) * ws.reps), 0), 1)
        from workouts w join workout_sets ws on ws.workout_id = w.id
        where w.check_in_id = p_check_in_id
      )
      else (
        select round(coalesce(sum(s.sets * s.reps * coalesce(s.weight, 0)), 0), 1)
        from check_in_workout_sets s where s.check_in_id = p_check_in_id
      )
    end,
    'has_pr', coalesce((select bool_or(s.is_pr) from check_in_workout_sets s where s.check_in_id = p_check_in_id), false)
           or coalesce((select bool_or(ws.is_pr) from workouts w join workout_sets ws on ws.workout_id = w.id
                        where w.check_in_id = p_check_in_id), false),
    'clip_count', v_clip_n
  );

  if v_clip_n > 0 then
    v := v || jsonb_build_object('clips', (
      select jsonb_agg(jsonb_build_object(
               'workout_set_id', c.id, 'exercise', c.name, 'set_index', c.set_index,
               'duration_s', c.duration_s, 'has_thumb', c.thumb_key is not null
             ) order by c.position, c.set_index)
      from (
        select ws.id, we.name, ws.set_index, ws.duration_s, ws.thumb_key, we.position
        from workouts w
        join workout_sets ws on ws.workout_id = w.id
        join workout_exercises we on we.id = ws.workout_exercise_id
        where w.check_in_id = p_check_in_id
          and ws.video_key is not null and ws.uploaded_at is not null
        order by we.position, ws.set_index
        limit 6
      ) c
    ));
  end if;

  return v;
end;
$$;

comment on function agora_lockin_strength_snapshot(uuid) is
  'Strength facts frozen into a lockin Agora snapshot (sets, volume, PRs, kept clips by workout_set_id). '
  'NULL for a check-in with no strength data, so non-gym snapshots are unchanged. Internal to '
  'agora_attachment_snapshot. 0192.';

-- Same posture as agora_attachment_snapshot: only callable from inside the SECURITY DEFINER post
-- path, never by a client directly.
revoke all on function public.agora_lockin_strength_snapshot(uuid) from public, anon, authenticated;

create or replace function agora_attachment_snapshot(p_user uuid, p_kind text, p_ref_id uuid, p_key text)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare
  v jsonb;
begin
  if p_kind is null then return null; end if;

  case p_kind

    when 'milestone' then
      -- Someone else's milestone is not yours to re-post as your own achievement. Sharing one
      -- with a caption is the same row appearing in the feed on its own; this branch is the
      -- author quoting their own.
      select jsonb_build_object(
        'milestone_id', m.id, 'kind', m.kind, 'headline', m.headline,
        'note', m.note, 'effort', m.effort
      ) into v
      from milestones m where m.id = p_ref_id and m.user_id = p_user;

    when 'lockin' then
      select jsonb_build_object(
        'check_in_id', c.id, 'goal_type', c.goal_type, 'goal_label', c.goal_label,
        'goal_detail', c.goal_detail, 'duration_seconds', c.duration_seconds,
        'distance_m', c.distance_m, 'completed_at', c.created_at
      ) || coalesce(agora_lockin_strength_snapshot(c.id), '{}'::jsonb) into v
      from check_ins c
      where c.id = p_ref_id and c.user_id = p_user
        and c.duration_seconds is not null and c.removed_at is null;

    when 'rank' then
      -- No ref id: your standing is a single row of live state. tier/division come from
      -- rank_thresholds so the numeral on the card is the server's, not a client guess at the
      -- ladder's shape.
      select jsonb_build_object('rank_index', urs.rank_index, 'tier', rt.tier, 'division', rt.division)
      into v
      from user_rank_state urs
      join rank_thresholds rt on rt.rank_index = urs.rank_index
      where urs.user_id = p_user;

    when 'streak' then
      select jsonb_build_object('days', p.current_streak, 'longest', p.longest_streak) into v
      from profiles p where p.id = p_user and p.current_streak > 0;

    when 'pass' then
      -- pass_xp, not a level: the level curve is client-side (levelFromXp). Same number, one
      -- definition.
      select jsonb_build_object('season_id', fps.season_id, 'pass_xp', fps.pass_xp,
                                'owns_premium', fps.owns_premium)
      into v
      from forge_pass_state fps
      where fps.user_id = p_user
      order by fps.season_id desc
      limit 1;

    when 'cosmetic' then
      select jsonb_build_object(
        'cosmetic_key', co.cosmetic_key, 'slot', co.slot, 'source', co.source,
        'provenance', co.provenance, 'rarity_override', co.rarity_override,
        'season_stamp', co.season_stamp, 'acquired_at', co.acquired_at
      ) into v
      from cosmetics_owned co where co.user_id = p_user and co.cosmetic_key = p_key;

    when 'pr' then
      select jsonb_build_object(
        'exercise', e.name, 'weight', pr.weight, 'reps', pr.reps,
        'e1rm', pr.e1rm, 'achieved_at', pr.achieved_at
      ) into v
      from personal_records pr
      join exercises e on e.id = pr.exercise_id
      where pr.id = p_ref_id and pr.user_id = p_user;

    else
      v := null;
  end case;

  return v;
end;
$function$;

-- create or replace keeps the existing ACL ({postgres, service_role}); restated so a fresh
-- database built from these files matches prod.
revoke all on function public.agora_attachment_snapshot(uuid, text, uuid, text) from public, anon, authenticated;
