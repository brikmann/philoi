-- 0286 · A SHARED CLIP CAN BE CHALLENGED (mock 324, design-mocks/CODE_PROMPT cross-post IG).
--
-- After posting to Instagram, Share → Philoi on the same clip opens the import composer
-- (src/app/agora/import.tsx). Two ways out:
--
--   * "Just post it" — an ordinary Agora post (0279 video / photo), tagged as shared.
--   * "Post with ⚔" — the clip becomes a LOGGED SET'S CLIP, and the post carries that set. That is
--     the whole trick: 0282 already turns a post carrying a verified set into a challengeable one,
--     and refuses the badge on a post with its own Agora video (the clip on screen must be the clip
--     that verifies the number). So nothing here is a new challenge type — the shared clip just
--     enters through the front door 0282 already has.
--
-- DECISIONS (Noah, 2026-10-27):
--   * An imported set COUNTS like any logged set: it can set a PR, it ranks on the fitness boards
--     (0265), and it is open to 0266's dispute / pull. It earns NO XP — there is no lock-in and no
--     check-in behind it, and XP is paid by stop_lock_in_session, never by a set.
--   * An imported set may also ANSWER a verified_lift race (challenge_racer_score is untouched).
--     An old clip shared during a race window is caught by disputes, not by the scorer.
--
-- WHAT THIS FILE ADDS
--   1. agora_posts.source — 'native' | 'share_extension'. The "↳ from your story" tag + analytics.
--      Read through agora_shared_posts() below, NOT through the feed RPCs, so no feed function is
--      restated (parallel_agents_clobber_replaced_functions).
--   2. log_shared_lift(exercise, weight, reps) — a finished, sessionless workout holding one set,
--      with log_workout_set's PR rule. The clip is then attached through the EXISTING path
--      (gym-clip-upload-url → attach_workout_set_clip), so the clip quota still applies.
--   3. discard_shared_lift(set) — the undo when the upload or the post fails after step 2, so a
--      clipless set never sits on a board as an unverified PR.
--   4. finish_shared_post(post, set) — stamps the source and, when the post does not already link
--      the set through a 'pr' attachment (0282's trigger), links it directly.
--   5. agora_shared_posts(ids) — which of these posts, visible to the caller, were shared in.
--
-- Additive: one column, five new functions. Nothing restated.
--
-- LEDGER: apply this file alone (after 0285), then `supabase migration repair --status applied 0286`.
-- No edge function ships with it.

begin;

-- ───────────────────────────── 1. where a post came from ─────────────────────────────
alter table agora_posts add column if not exists source text not null default 'native';
alter table agora_posts drop constraint if exists agora_posts_source_check;
alter table agora_posts add constraint agora_posts_source_check check (source in ('native', 'share_extension'));
comment on column agora_posts.source is
  '0286 -- native (composed in Philoi) | share_extension (Share → Philoi from another app, e.g. after an Instagram post).';

-- ───────────────────────────── 2. the set behind a shared clip ─────────────────────────────
/**
 * One finished workout, one exercise, one set — what a clip shared in from another app is a clip OF.
 *
 * Sessionless on purpose: lock_in_session_id and check_in_id stay null, so nothing pays XP, no
 * recap or done screen ever sees it, and workouts_one_active_per_user is untouched (ended_at is set
 * on insert). The PR rule is log_workout_set's (0037), line for line, so a shared 405 is a PR
 * exactly when a logged 405 would have been.
 *
 * Weighted lifts only — the one shape a verified_lift race compares (agora_verified_lifts wants
 * e.unit = 'weight' and weight > 0). Weight is in lb, as every workout_sets row is.
 *
 * Rate-limited to 20 a day: each one also spends a clip from the monthly quota on the free tier,
 * but a paid account has no cap there.
 */
create or replace function log_shared_lift(p_exercise_id uuid, p_weight numeric, p_reps int)
returns workout_sets
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_uid uuid := auth.uid();
  v_ex exercises;
  v_workout_id uuid;
  v_we_id uuid;
  v_set workout_sets;
  v_e1rm numeric;
  v_best personal_records;
  v_is_pr boolean;
begin
  if v_uid is null then
    raise exception 'Sign in to share a lift.';
  end if;

  select e.* into v_ex
    from exercises e
   where e.id = p_exercise_id
     and (e.created_by is null or e.created_by = v_uid);
  if v_ex.id is null then
    raise exception 'Pick an exercise.';
  end if;
  if coalesce(v_ex.unit, 'weight') <> 'weight' then
    raise exception 'Only a weighted lift can be a challenge.';
  end if;
  if p_reps is null or p_reps <= 0 or p_reps > 100 then
    raise exception 'A set needs between 1 and 100 reps.';
  end if;
  if p_weight is null or p_weight <= 0 or p_weight > 2000 then
    raise exception 'Enter the weight you lifted.';
  end if;

  if (select count(*)
        from workouts w
       where w.user_id = v_uid
         and w.routine_name = 'Shared clip'
         and w.lock_in_session_id is null
         and w.created_at > now() - interval '1 day') >= 20 then
    raise exception 'That''s 20 shared lifts today. Try again tomorrow.';
  end if;

  insert into workouts (user_id, routine_name, started_at, ended_at)
  values (v_uid, 'Shared clip', now(), now())
  returning id into v_workout_id;

  insert into workout_exercises (workout_id, exercise_id, name, position)
  values (v_workout_id, v_ex.id, v_ex.name, 0)
  returning id into v_we_id;

  v_e1rm := gym_e1rm(p_weight, p_reps);
  select pr.* into v_best from personal_records pr
   where pr.user_id = v_uid and pr.exercise_id = v_ex.id;

  v_is_pr := v_best.id is null
    or v_e1rm > v_best.e1rm
    or (v_e1rm = v_best.e1rm and p_reps > v_best.reps);

  insert into workout_sets (workout_id, workout_exercise_id, set_index, weight, reps, is_pr)
  values (v_workout_id, v_we_id, 1, p_weight, p_reps, v_is_pr)
  returning * into v_set;

  if v_is_pr then
    insert into personal_records (user_id, exercise_id, weight, reps, e1rm, workout_set_id, achieved_at)
    values (v_uid, v_ex.id, p_weight, p_reps, v_e1rm, v_set.id, now())
    on conflict (user_id, exercise_id) do update
      set weight = excluded.weight,
          reps = excluded.reps,
          e1rm = excluded.e1rm,
          workout_set_id = excluded.workout_set_id,
          achieved_at = excluded.achieved_at;
  end if;

  return v_set;
end;
$fn$;

revoke all on function log_shared_lift(uuid, numeric, int) from public, anon;
grant execute on function log_shared_lift(uuid, numeric, int) to authenticated;

/**
 * The undo for a "Post with ⚔" that failed after log_shared_lift — upload refused (clip quota),
 * network gone, post rejected. Without it the set would stay on the boards as a CLIPLESS 405: an
 * unverified PR nobody can watch or dispute. Only a shared-clip workout of the caller's own that no
 * post carries yet. The delete cascades to the set (workout_sets_purge_clip queues any clip that
 * made it to R2), and the PR it may have taken goes back to the best remaining set — the same
 * hand-back pull_workout_set_pr (0266) does, pulled sets excluded.
 */
create or replace function discard_shared_lift(p_workout_set_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_uid uuid := auth.uid();
  v_workout_id uuid;
  v_exercise uuid;
  v_held boolean;
  v_best record;
begin
  select w.id, we.exercise_id into v_workout_id, v_exercise
    from workout_sets ws
    join workouts w on w.id = ws.workout_id
    join workout_exercises we on we.id = ws.workout_exercise_id
   where ws.id = p_workout_set_id
     and w.user_id = v_uid
     and w.routine_name = 'Shared clip'
     and w.lock_in_session_id is null
     and not exists (select 1 from agora_post_lifts l where l.workout_set_id = ws.id);
  if v_workout_id is null then
    return;
  end if;

  select exists (
    select 1 from personal_records pr
     where pr.user_id = v_uid and pr.exercise_id = v_exercise and pr.workout_set_id = p_workout_set_id
  ) into v_held;

  delete from workouts w where w.id = v_workout_id;

  if v_held then
    select ws.id, coalesce(ws.weight, 0) as weight, ws.reps, gym_e1rm(ws.weight, ws.reps) as e1rm, ws.created_at
      into v_best
      from workout_sets ws
      join workouts w on w.id = ws.workout_id
      join workout_exercises we on we.id = ws.workout_exercise_id
     where w.user_id = v_uid and we.exercise_id = v_exercise and ws.pr_status <> 'pulled'
     order by gym_e1rm(ws.weight, ws.reps) desc, ws.reps desc, ws.created_at
     limit 1;

    if v_best.id is null then
      delete from personal_records pr where pr.user_id = v_uid and pr.exercise_id = v_exercise;
    else
      update personal_records pr
         set weight = v_best.weight, reps = v_best.reps, e1rm = v_best.e1rm,
             workout_set_id = v_best.id, achieved_at = v_best.created_at
       where pr.user_id = v_uid and pr.exercise_id = v_exercise;
    end if;
  end if;
end;
$fn$;

revoke all on function discard_shared_lift(uuid) from public, anon;
grant execute on function discard_shared_lift(uuid) to authenticated;

-- ───────────────────────────── 3. finishing a shared post ─────────────────────────────
/**
 * Called once, right after create_agora_post / create_forest_post / create_campfire_post returns,
 * on the caller's own post from the last ten minutes.
 *
 * With p_workout_set_id: the set must be the caller's, from log_shared_lift, with its clip on file.
 * When the post's 'pr' attachment already linked it (0282's insert trigger) this is a no-op for the
 * link; otherwise — the shared set wasn't a PR — the link is written here, so the post carries the
 * set either way. Whether a badge then SHOWS is still agora_verified_lifts' call alone.
 */
create or replace function finish_shared_post(p_post_id uuid, p_workout_set_id uuid default null)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_uid uuid := auth.uid();
  v_post_id uuid;
  v_set_id uuid;
begin
  select p.id into v_post_id
    from agora_posts p
   where p.id = p_post_id
     and p.user_id = v_uid
     and p.created_at > now() - interval '10 minutes';
  if v_post_id is null then
    raise exception 'Post not found.';
  end if;

  update agora_posts p set source = 'share_extension' where p.id = v_post_id;

  if p_workout_set_id is null then
    return;
  end if;

  select ws.id into v_set_id
    from workout_sets ws
    join workouts w on w.id = ws.workout_id
   where ws.id = p_workout_set_id
     and w.user_id = v_uid
     and w.routine_name = 'Shared clip'
     and w.lock_in_session_id is null
     and ws.video_key is not null;
  if v_set_id is null then
    raise exception 'That clip isn''t ready yet.';
  end if;

  insert into agora_post_lifts (post_id, workout_set_id)
  values (v_post_id, v_set_id)
  on conflict do nothing;
end;
$fn$;

revoke all on function finish_shared_post(uuid, uuid) from public, anon;
grant execute on function finish_shared_post(uuid, uuid) to authenticated;

-- ───────────────────────────── 4. which posts were shared in ─────────────────────────────
/**
 * The subset of p_post_ids that came in through the share sheet AND that the caller may open —
 * visibility defers to get_agora_item, as agora_verified_lifts does. Capped at 30 per call.
 */
create or replace function agora_shared_posts(p_post_ids uuid[])
returns table (post_id uuid)
language sql
stable
security definer
set search_path = public
as $fn$
  select p.id
    from agora_posts p
   where p.id = any (p_post_ids[1:30])
     and auth.uid() is not null
     and p.source = 'share_extension'
     and get_agora_item(p.id, 'post') is not null;
$fn$;

revoke all on function agora_shared_posts(uuid[]) from public, anon;
grant execute on function agora_shared_posts(uuid[]) to authenticated;

commit;
