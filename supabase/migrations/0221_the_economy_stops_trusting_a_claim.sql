-- ══════════════════════════════════════════════════════════════════════════════════════════════
-- 0221 · THE ECONOMY STOPS TRUSTING A CLAIM — vouching ends, grades cap at Epic, idle caps at 10m.
--
-- Spec: CODE_PROMPT_economy_anticheat.md §1–§4, design-mocks/237-economy-grade-cap.html. Builds on
-- 0159/0164/0166 (the verifiability discount + vouch flow), 0167 (the completion receipt),
-- 0210 (grade goals), 0218 (pause-aware lock-in credit). Section 5 (placement cap / 0066) is NOT
-- in this file — that decision is unconfirmed and 0066 is left untouched.
--
-- Principle: the premium boxes (Legendary/Mythic) come only from things genuinely hard to fake —
-- real money, sensor-verified physical, and (v2) video. Everything self-reported is capped, and
-- friend-vouching — the one honour path that could reach the full band without a sensor — is
-- removed.
--
-- ─────────────────────────── §1 · VOUCHING ENDS ───────────────────────────
--
-- goal_paid_band stops treating 'vouched' as a full-band level: only 'auto' (app/sensor-tracked)
-- pays the scoped band. 'vouched' now prices EXACTLY like 'honor' — one band down, capped at
-- notable (Rare). So an honour goal settles directly at the Unvouched tier and there is no way up
-- from it short of the app watching you do it.
--
-- The vouch FLOW is dismantled at its source rather than left to age out:
--   · claim_goal_complete settles at 'honor' immediately, always. No proof→vouched, no roster, no
--     48h window, no vouch_requested push.
--   · submit_vouch is a no-op (kept callable so a stale client gets a graceful nothing, not an
--     error). It grants nothing and fires no vouch_passed push.
--   · settle_expired_vouches still drains any window left open by a pre-0221 client — resolving it
--     at honour — but fires no vouch_settled push.
-- goal_vouches is LEFT IN PLACE (its rows are history; nothing reads them for a reward anymore).
--
-- ─────────────────────────── §2 · GRADE GOALS CAP AT EPIC, 2 BOXES PER SEASON ───────────────────
--
-- grade_band's ceiling drops from 'mythic' to 'epic'. Because that one function is where both the
-- create-time scope clamp (create_scoped_goals) and the earned-tier ladder (grade_effective_tier)
-- read their ceiling, a 90%+ result can no longer scope OR earn above Epic — the box tops out at
-- the Vessel of Hestia.
--
-- And the box is RATIONED: economy_on_challenge_completed mints a box for the first 2 completed
-- grade goals in a season; every grade goal after that pays its embers but its box is stripped.
-- Per-user, per-season (challenges.season_id, stamped at create by 0210), reset each season. The
-- embers/XP still scale with the earned tier — it is only the box that is capped and counted.
--
-- ─────────────────────────── §3 · PHYSICAL / SKILL SELF-REPORT CAPS AT RARE ─────────────────────
--
-- No new mechanism: a typed physical/skill claim is verifiability 'honor' (goal_verifiability_for,
-- 0183), and honour already caps at notable = Rare in goal_paid_band. With 'vouched' no longer an
-- upgrade (§1), that Rare cap is now the true ceiling for any self-reported feat with no sensor.
-- Sensor-tracked physical (steps/Strava/workout volume) is 'auto' and stays uncapped.
--
-- 🔧 TODO (v2 video path — DO NOT BUILD HERE): when video verification lands, a verified physical
-- feat should flip its verifiability to 'auto' (goal_verifiability_for is the hook), at which point
-- goal_paid_band pays the full scoped band and this Rare cap no longer applies to it. Until then a
-- clip is a private file that changes no band.
--
-- ─────────────────────────── §4 · LOCK-IN LIVENESS — 10-MIN CONFIRM, CREDIT TO LAST CONFIRM ─────
--
-- notify_stale_lock_ins (restated from 0218's live body): the "still here?" nudge fires 10 min
-- after the last confirmation (was 1 hour), and the idle auto-abandon fires 2 min after the nudge
-- (was 20 min) — a ~12 min stale-close (10 + grace). The abandon still credits
-- lock_in_credited_seconds(session, last_confirmed_at) — the EXISTING credit cap, banking only time
-- up to the last confirmation, never now(). Pause cap (3h) unchanged.
--
-- stop_lock_in_session (restated from 0218): the normal finish path now CLAMPS its credit to
-- least(now(), last_confirmed_at + 12 min) so a nap-then-finish under the old window can't bank
-- idle time. A present user (who confirms every ~10 min) is never within the clamp; only a session
-- that outran its last confirmation by more than the grace window is trimmed.
-- ══════════════════════════════════════════════════════════════════════════════════════════════

-- ── base check · the bodies restated below are restated from their live (latest-migration) source.
-- Structural pins rather than md5 (this file is authored, not applied, so a live md5 isn't in hand):
-- each raises if the marker that identifies the version we restated from is gone — i.e. prod drifted
-- under us and this file must be rebased before Noah applies it.
do $base$
begin
  if (select prosrc from pg_proc where proname = 'stop_lock_in_session' and pronamespace = 'public'::regnamespace)
     !~ 'lock_in_credited_seconds\(v_session, now\(\)\)' then
    raise exception '0221: stop_lock_in_session is not the 0218 body (credited-time settle marker missing) — rebase.';
  end if;
  if (select prosrc from pg_proc where proname = 'notify_stale_lock_ins' and pronamespace = 'public'::regnamespace)
     !~ 'paused_at < now\(\) - interval ''3 hours''' then
    raise exception '0221: notify_stale_lock_ins is not the 0218 body (pause-cap marker missing) — rebase.';
  end if;
  if (select prosrc from pg_proc where proname = 'economy_on_challenge_completed' and pronamespace = 'public'::regnamespace)
     not like '%into v_receipt%' then
    raise exception '0221: economy_on_challenge_completed is not the 0167 body (receipt capture missing) — rebase.';
  end if;
  if (select prosrc from pg_proc where proname = 'grade_band' and pronamespace = 'public'::regnamespace)
     not like '%mythic%' then
    raise exception '0221: grade_band is not the 0210 body (mythic ceiling missing) — rebase.';
  end if;
end
$base$;

-- ═══════════════════════════ §1 · goal_paid_band: 'vouched' no longer upgrades ═══════════════════
-- Restated from 0164 with ONE change: the full-band arm is 'auto' only. 'vouched' falls through to
-- the honour branch (one band down, capped at notable). The honour branch is byte-identical.
create or replace function goal_paid_band(p_tier text, p_verifiability text)
returns text
language plpgsql
stable
set search_path = public
as $$
declare
  v_cfg jsonb := (select value from economy_config where key = 'tier_payout');
  v_band text;
  v_down text;
begin
  if p_tier is null then
    return null;
  end if;

  v_band := v_cfg -> p_tier ->> 'band';
  if v_band is null then
    return null;
  end if;

  -- 0221 — ONLY 'auto' pays the full scoped band now. Sensor/app-tracked is the single path to the
  -- top boxes. 'vouched' is gone as an upgrade: it drops through to the honour cap below, so a
  -- friend-vouched claim pays exactly what an unvouched one does.
  if p_verifiability = 'auto' then
    return v_band;
  end if;

  v_down := case v_band
    when 'apex'       then 'elite'
    when 'elite'      then 'impressive'
    when 'impressive' then 'notable'
    when 'notable'    then 'casual'
    when 'casual'     then 'completion'
    else 'completion'
  end;

  if reward_band_rank(v_down) > reward_band_rank('notable') then
    return 'notable';
  end if;
  return v_down;
end;
$$;

comment on function goal_paid_band(text, text) is
  '0221 — the verifiability discount, with vouching removed. auto pays the scoped band; honour (and vouched, which no longer upgrades) pays one band down capped at notable. The single place the self-report cap lives.';

revoke all on function goal_paid_band(text, text) from public;
revoke all on function goal_paid_band(text, text) from authenticated;

-- ═══════════════════════════ §1 · claim settles at honour, immediately ═══════════════════════════
-- Restated from 0166 with the vouch flow removed. The ownership / already-done guards and the
-- proof-path prefix check are kept (proof is still STORED for a future v2 video path); everything
-- else — the roster insert, the vouch_requested push, the 48h window — is gone. A claim settles at
-- honour now, always.
create or replace function claim_goal_complete(
  p_goal_id uuid,
  p_proof_path text default null,
  p_voucher_ids uuid[] default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_goal challenges;
begin
  if auth.uid() is null then
    raise exception 'Not signed in.';
  end if;

  select * into v_goal from challenges c where c.id = p_goal_id and c.user_id = auth.uid();
  if v_goal.id is null then
    raise exception 'That goal is not yours.';
  end if;
  if v_goal.completed_at is not null then
    raise exception 'That goal is already finished.';
  end if;
  if v_goal.claimed_at is not null then
    raise exception 'You have already marked that one done.';
  end if;

  if p_proof_path is not null and p_proof_path not like (auth.uid()::text || '/%') then
    raise exception 'That proof does not belong to you.';
  end if;

  -- 0221 — no window. Stamp the claim (and any proof, for the v2 hook), never a deadline, and
  -- settle at honour in the same call. p_voucher_ids is accepted for signature stability and
  -- ignored: there is nobody to ask anymore.
  update challenges
     set claimed_at = now(),
         proof_path = p_proof_path,
         vouch_deadline = null
   where id = p_goal_id;

  perform resolve_goal_claim(p_goal_id, 'honor');
  return jsonb_build_object('state', 'resolved', 'level', 'honor', 'asked', 0,
                            'has_proof', p_proof_path is not null);
end;
$$;

comment on function claim_goal_complete(uuid, text, uuid[]) is
  '0221 — vouching removed. A claim settles at honour immediately: no proof→vouched, no roster, no 48h window, no push. Proof is still stored for a future video path but changes no band. Signature kept so callers (report_goal_grade) need no change.';

revoke all on function claim_goal_complete(uuid, text, uuid[]) from public;
grant execute on function claim_goal_complete(uuid, text, uuid[]) to authenticated;

-- ═══════════════════════════ §1 · submit_vouch is a no-op ═══════════════════════════
-- Kept callable (a stale client that still calls it gets a graceful nothing rather than a
-- permission error), but it records no vouch, resolves nothing, and fires no vouch_passed push.
create or replace function submit_vouch(p_goal_id uuid, p_verdict boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  -- 0221 — vouching is disabled. This function used to record a friend's verdict and, on two
  -- counted vouches, upgrade the goal to 'vouched'. Both are gone. It does nothing and says so.
  return jsonb_build_object('counted', false, 'vouches', 0, 'resolved', false, 'disabled', true);
end;
$$;

comment on function submit_vouch(uuid, boolean) is
  '0221 — DISABLED. Vouching was removed; this is a no-op returning {disabled:true}. Left callable so a not-yet-updated client degrades gracefully instead of erroring.';

revoke all on function submit_vouch(uuid, boolean) from public;
grant execute on function submit_vouch(uuid, boolean) to authenticated;

-- ═══════════════════════════ §1 · the sweep drains open windows silently ═══════════════════════════
-- Restated from 0164 with the vouch_settled push removed. New claims never open a window, but a
-- claim made by a pre-0221 client may still be sitting open; this settles it at honour (its band
-- since it was claimed) with no notification.
create or replace function settle_expired_vouches()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  v_n int := 0;
begin
  for r in
    select id from challenges
     where claimed_at is not null
       and completed_at is null
       and vouch_deadline is not null
       and now() > vouch_deadline
     limit 500
  loop
    -- 0221 — resolve at honour, no vouch_settled push (the vouch flow is gone).
    perform resolve_goal_claim(r.id, 'honor');
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;

revoke all on function settle_expired_vouches() from public;
revoke all on function settle_expired_vouches() from authenticated;

-- ═══════════════════════════ §2 · grade ladder ceiling drops to Epic ═══════════════════════════
-- Restated from 0210 with the ceiling changed from 'mythic' to 'epic'. This one function feeds both
-- the create-time scope clamp and the earned-tier ladder, so a grade goal can neither be scoped nor
-- earn above Epic. Floors and step are unchanged.
create or replace function grade_band(
  p_discipline text,
  out floor_tier text,
  out ceiling_tier text,
  out step numeric
)
language sql
immutable
set search_path = public
as $$
  select
    case p_discipline when 'stem' then 'rare' else 'uncommon' end,
    'epic',
    case p_discipline when 'arts' then 5 else 10 end::numeric;
$$;

comment on function grade_band(text) is
  '0221 — grade-goal reward band, ceiling capped at EPIC (was mythic): a passing grade can no longer reach Legendary/Mythic. stem → (rare, epic, 10); arts → (uncommon, epic, 5); untagged → (uncommon, epic, 10).';

revoke all on function grade_band(text) from public, anon;
grant execute on function grade_band(text) to authenticated;

-- ═══════════════════════════ §2 · the completion grant rations the grade box ═══════════════════════════
-- Restated from 0167 (the receipt-capturing body) with one addition: for a GRADE goal, the box is
-- minted only for the first two completed grade goals in the season; on the third and later the
-- just-minted box is deleted and the receipt records embers-only. Everything 0167 guaranteed — the
-- single grant_reward call at the settled band, the campfire early-return, the receipt on
-- reward_payload, evaluate_pass_achievements — is preserved.
create or replace function economy_on_challenge_completed()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_cfg jsonb := (select value from economy_config where key = 'tier_payout');
  v_sig numeric;
  v_cap text;
  v_receipt jsonb;
  v_season text;
  v_grade_boxes int;
begin
  if new.completed_at is null or old.completed_at is not null then
    return new;
  end if;

  -- 0162 — a goal minted BY a campfire challenge is that challenge's counter, not a second prize.
  if new.challenge_source_id is not null then
    perform evaluate_pass_achievements(new.user_id);
    return new;
  end if;

  v_sig := coalesce((v_cfg -> coalesce(new.difficulty_tier, '') ->> 'significance')::numeric, 1.0);
  v_cap := goal_paid_band(new.difficulty_tier, new.verifiability);

  -- 0167 — the return value is kept. Identical call, identical arguments.
  select grant_reward(
    new.user_id, 'friend_h2h', v_sig,
    case when new.period = 'week' then 7 else 1 end,
    1, 0.0, true, new.id,
    v_cap
  ) into v_receipt;

  -- 0221 — GRADE BOX RATION. The first two completed grade goals in a season keep their box; the
  -- rest keep their embers but lose the box. Season-scoped to challenges.season_id (stamped at
  -- create by 0210) so it resets each season; only prior completions that actually minted a box
  -- consume a slot.
  if new.grade_target is not null then
    v_season := coalesce(new.season_id, (select value ->> 'id' from economy_config where key = 'season'));
    select count(*) into v_grade_boxes
      from challenges c
     where c.user_id = new.user_id
       and c.grade_target is not null
       and c.completed_at is not null
       and c.id <> new.id
       and c.season_id is not distinct from v_season
       and (c.reward_payload ->> 'box') is not null;

    if v_grade_boxes >= 2 and (v_receipt ->> 'box_id') is not null then
      -- Embers stay; the box does not. Delete the row grant_reward just minted and null it in the
      -- receipt so the reveal shows an ember-only payout.
      delete from loot_boxes where id = (v_receipt ->> 'box_id')::uuid and user_id = new.user_id;
      v_receipt := v_receipt || jsonb_build_object('box', null, 'box_id', null, 'box_rationed', true);
    end if;
  end if;

  update challenges
     set reward_payload = coalesce(v_receipt, '{}'::jsonb)
                          || jsonb_build_object(
                               'verifiability', new.verifiability,
                               'tier', new.difficulty_tier,
                               'max_band', v_cap
                             )
   where id = new.id;

  perform evaluate_pass_achievements(new.user_id);
  return new;
end;
$function$;

comment on function economy_on_challenge_completed() is
  '0221 — 0167''s receipt-capturing body plus the grade box ration: a grade goal past the season''s first two completed ones keeps its embers but its box is stripped (per-user, per-season, resets each season). One grant_reward call, at the settled band, unchanged.';

-- ═══════════════════════════ §4 · lock-in stale sweep → 10-minute confirm ═══════════════════════════
-- Restated from 0218 with two threshold edits (1h → 10 min nudge; 20 min → 2 min abandon-after-
-- nudge, i.e. ~12 min stale-close). The idle-abandon still credits to last_confirmed_at — the
-- EXISTING credit cap, banking no time past the last confirmation. Pause cap (3h) unchanged.
create or replace function public.notify_stale_lock_ins()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  r record;
  v_s lock_in_sessions;
  v_check_in check_ins;
begin
  for r in
    select id, user_id from lock_in_sessions
    where status = 'active'
      and not paused
      and reminder_sent_at is null
      -- 0221 — 10 min (was 1 hour). Matches the client's ~10-min "still here?" prompt.
      and last_confirmed_at < now() - interval '10 minutes'
  loop
    perform notify_push(
      array[r.user_id],
      'Still locked in?',
      'Your session''s been going a while — tap to keep it going.',
      jsonb_build_object('type', 'lockin_still_here', 'session_id', r.id),
      'accountability'
    );
    update lock_in_sessions set reminder_sent_at = now() where id = r.id;
  end loop;

  for v_s in
    select * from lock_in_sessions
    where status = 'active'
      and not paused
      and reminder_sent_at is not null
      -- 0221 — 2 min after the nudge (was 20). Total stale-close ~12 min (10 + grace).
      and reminder_sent_at < now() - interval '2 minutes'
  loop
    insert into check_ins (goal_id, goal_type, goal_detail, user_id, photo_url, duration_seconds, status)
    values (
      null, v_s.goal_type, v_s.goal_detail, v_s.user_id, null,
      -- 0218/0221 — the credit CAP: to last confirmation, minus paused time. Never now().
      greatest(lock_in_credited_seconds(v_s, v_s.last_confirmed_at)::integer, 1),
      'on_time'
    )
    returning * into v_check_in;

    update lock_in_sessions
    set status = 'abandoned', ended_check_in_id = v_check_in.id
    where id = v_s.id;
  end loop;

  -- 0218 — THE PAUSE CAP, unchanged. Paused for more than 3 hours = ended as completed on pre-pause
  -- credited time.
  for v_s in
    select * from lock_in_sessions
    where status = 'active'
      and paused
      and paused_at < now() - interval '3 hours'
  loop
    insert into check_ins (goal_id, goal_type, goal_detail, user_id, photo_url, duration_seconds, status)
    values (
      null, v_s.goal_type, v_s.goal_detail, v_s.user_id, null,
      greatest(lock_in_credited_seconds(v_s, v_s.paused_at)::integer, 1),
      'on_time'
    )
    returning * into v_check_in;

    update lock_in_sessions
    set status = 'completed', ended_check_in_id = v_check_in.id,
        accumulated_paused_seconds = accumulated_paused_seconds
          + greatest(round(extract(epoch from (now() - paused_at))), 0)::int,
        paused = false,
        paused_at = null
    where id = v_s.id;
  end loop;
end;
$function$;

comment on function public.notify_stale_lock_ins() is
  '0221 — 0218''s body with the stale-close shortened to ~12 min (10-min nudge + 2-min grace, was 1h + 20m). The idle-abandon still credits only to last_confirmed_at. Pause cap unchanged.';

-- ═══════════════════════════ §4 · lock-in finish path clamp ═══════════════════════════
-- Restated from 0218 with ONE edit: the credited-time settle clamps its upper bound to
-- least(now(), last_confirmed_at + 12 min), so a nap-then-finish cannot bank idle time past the
-- grace window. A present user (confirming every ~10 min) is never inside the clamp.
create or replace function public.stop_lock_in_session(p_session_id uuid, p_photo_urls text[] DEFAULT NULL::text[], p_caption text DEFAULT NULL::text, p_workout_sets jsonb DEFAULT NULL::jsonb)
 RETURNS check_ins
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_session lock_in_sessions;
  v_check_in check_ins;
  v_workout workouts;
  v_first_photo text;
  v_has_pr boolean;
  i int;
begin
  select * into v_session from lock_in_sessions
  where id = p_session_id and user_id = auth.uid() and status = 'active'
  for update;

  if v_session.id is null then
    raise exception 'Session not found or already stopped.';
  end if;

  v_first_photo := case when p_photo_urls is not null and array_length(p_photo_urls, 1) > 0
    then p_photo_urls[1] else null end;

  insert into check_ins (goal_id, goal_type, goal_detail, user_id, photo_url, caption, duration_seconds, status)
  values (
    null, v_session.goal_type, v_session.goal_detail, auth.uid(), v_first_photo, p_caption,
    -- 0218: credited time, not wall-clock (paused time earns nothing).
    -- 0221: AND clamped to the grace window past the last confirmation, so a nap-then-finish
    -- cannot bank the idle stretch. least(now(), last_confirmed_at + 12 min) — a present user
    -- (confirming every ~10 min) is always below this bound and is never trimmed.
    greatest(lock_in_credited_seconds(v_session, least(now(), v_session.last_confirmed_at + interval '12 minutes'))::integer, 1),
    'on_time'
  )
  returning * into v_check_in;

  if p_photo_urls is not null then
    for i in 1 .. array_length(p_photo_urls, 1) loop
      insert into check_in_photos (check_in_id, photo_url, position)
      values (v_check_in.id, p_photo_urls[i], i - 1);
    end loop;
  end if;

  select * into v_workout from workouts
  where lock_in_session_id = v_session.id and user_id = auth.uid() and ended_at is null;

  if v_workout.id is not null then
    select exists (select 1 from workout_sets where workout_id = v_workout.id and is_pr)
    into v_has_pr;

    update workouts
    set check_in_id = v_check_in.id,
        ended_at = now(),
        brag_earned = (v_workout.energy = 'dialed' and v_has_pr)
    where id = v_workout.id;

    insert into check_in_workout_sets (check_in_id, exercise, sets, reps, weight, is_pr, position)
    select
      v_check_in.id,
      we.name,
      count(*)::int,
      (array_agg(ws.reps order by gym_e1rm(ws.weight, ws.reps) desc, ws.reps desc))[1],
      (array_agg(ws.weight order by gym_e1rm(ws.weight, ws.reps) desc, ws.reps desc))[1],
      bool_or(ws.is_pr),
      we.position
    from workout_exercises we
    join workout_sets ws on ws.workout_exercise_id = we.id
    where we.workout_id = v_workout.id
    group by we.id, we.name, we.position;

  elsif p_workout_sets is not null and jsonb_array_length(p_workout_sets) > 0 then
    for i in 0 .. jsonb_array_length(p_workout_sets) - 1 loop
      insert into check_in_workout_sets (check_in_id, exercise, sets, reps, weight, position)
      values (
        v_check_in.id,
        p_workout_sets -> i ->> 'exercise',
        (p_workout_sets -> i ->> 'sets')::int,
        (p_workout_sets -> i ->> 'reps')::int,
        (p_workout_sets -> i ->> 'weight')::numeric,
        i
      );
    end loop;
  end if;

  -- 0218: fold an open pause into the total and clear it.
  update lock_in_sessions
  set status = 'completed', ended_check_in_id = v_check_in.id,
      accumulated_paused_seconds = accumulated_paused_seconds
        + case when paused then greatest(round(extract(epoch from (now() - paused_at))), 0)::int else 0 end,
      paused = false,
      paused_at = null
  where id = v_session.id;

  select * into v_check_in from check_ins where id = v_check_in.id;

  return v_check_in;
end;
$function$;

comment on function public.stop_lock_in_session(uuid, text[], text, jsonb) is
  '0221 — 0218''s pause-aware body with the finish credit clamped to least(now(), last_confirmed_at + 12 min), so idle time past the grace window cannot be banked at Stop.';

-- ─────────────────────────── the anti-cheese, asserted at deploy ───────────────────────────
-- 0159's style: the worked cases, run against the functions this file just created, so it cannot
-- land with a gate open.
do $assert$
declare
  v text;
  v_band record;
begin
  -- §1 · NO VOUCHED TIER. 'vouched' now prices exactly like 'honor' — the gradient is deliberately
  --      flat. (This is the inverse of 0164/0166's "vouched must be worth something" assertion,
  --      which those files are entitled to; this migration removes that worth on purpose.)
  if goal_paid_band('epic', 'vouched') is distinct from goal_paid_band('epic', 'honor') then
    raise exception '0221: vouched must now pay the same as honour (the vouch upgrade is gone).';
  end if;
  if goal_paid_band('legendary', 'vouched') is distinct from 'notable' then
    raise exception '0221: a vouched legendary must cap at notable (Rare) like honour, got %',
      coalesce(goal_paid_band('legendary', 'vouched'), 'null');
  end if;
  if goal_paid_band('mythic', 'vouched') is distinct from 'notable' then
    raise exception '0221: a vouched mythic must cap at notable (Rare).';
  end if;

  -- §3 · PHYSICAL / SKILL SELF-REPORT CAPS AT RARE. Honour is the self-report path, and it caps at
  --      notable = Rare / The Furnace, for every tier at or above it.
  if goal_paid_band('epic', 'honor') is distinct from 'notable' then
    raise exception '0221: honour epic must cap at notable (Rare).';
  end if;
  if goal_paid_band('legendary', 'honor') is distinct from 'notable' then
    raise exception '0221: honour legendary must cap at notable (Rare) — the self-report cap moved.';
  end if;
  if goal_paid_band('mythic', 'honor') is distinct from 'notable' then
    raise exception '0221: honour mythic must cap at notable (Rare).';
  end if;

  -- Sensor/app-tracked ('auto') is STILL uncapped — the only path to the top boxes.
  if goal_paid_band('legendary', 'auto') is distinct from 'elite' then
    raise exception '0221: auto legendary must still pay elite (sensor path uncapped).';
  end if;
  if goal_paid_band('mythic', 'auto') is distinct from 'apex' then
    raise exception '0221: auto mythic must still pay apex (sensor path uncapped).';
  end if;

  -- Unscoped goals keep their exact previous behaviour: no ceiling.
  if goal_paid_band(null, null) is not null then
    raise exception '0221: unscoped goals must pass a null ceiling.';
  end if;

  -- §2 · GRADE GOALS CAP AT EPIC. The ceiling is epic, so a 90%+ result can neither scope nor earn
  --      above Epic. The old ladder reached legendary/mythic here.
  select * into v_band from grade_band('stem');
  if v_band.ceiling_tier is distinct from 'epic' then
    raise exception '0221: the grade ceiling must be epic, got %', v_band.ceiling_tier;
  end if;
  if grade_effective_tier('legendary', 90, 95, 'stem') is distinct from 'epic' then
    raise exception '0221: a 95 on a STEM legendary must now earn epic (was legendary), got %',
      grade_effective_tier('legendary', 90, 95, 'stem');
  end if;
  if grade_effective_tier('mythic', 95, 100, 'stem') is distinct from 'epic' then
    raise exception '0221: a perfect mythic-scoped grade must cap at epic, got %',
      grade_effective_tier('mythic', 95, 100, 'stem');
  end if;
  -- The step-down and floors below the cap are unchanged (0210's ladder, ceiling aside).
  if grade_effective_tier('legendary', 90, 80, 'stem') is distinct from 'epic'
     or grade_effective_tier('legendary', 90, 70, 'stem') is distinct from 'rare' then
    raise exception '0221: the STEM step-down below the cap changed unexpectedly.';
  end if;

  -- §1 · the vouch flow is dismantled: submit_vouch grants nothing.
  if (submit_vouch('00000000-0000-0000-0000-000000000000'::uuid, true) ->> 'disabled') <> 'true' then
    raise exception '0221: submit_vouch is not disabled.';
  end if;

  -- §4 · the lock-in edits landed and the credit cap survived. Structural, against the live bodies.
  if (select prosrc from pg_proc where proname = 'notify_stale_lock_ins' and pronamespace = 'public'::regnamespace)
     !~ 'last_confirmed_at < now\(\) - interval ''10 minutes''' then
    raise exception '0221: notify_stale_lock_ins nudge is not at 10 minutes.';
  end if;
  if (select prosrc from pg_proc where proname = 'notify_stale_lock_ins' and pronamespace = 'public'::regnamespace)
     ~ 'last_confirmed_at < now\(\) - interval ''1 hour''' then
    raise exception '0221: notify_stale_lock_ins still carries the 1-hour threshold.';
  end if;
  -- The credit cap: the abandon still credits to last_confirmed_at, never now().
  if (select prosrc from pg_proc where proname = 'notify_stale_lock_ins' and pronamespace = 'public'::regnamespace)
     !~ 'lock_in_credited_seconds\(v_s, v_s\.last_confirmed_at\)' then
    raise exception '0221: notify_stale_lock_ins lost the last_confirmed_at credit cap.';
  end if;
  if (select prosrc from pg_proc where proname = 'stop_lock_in_session' and pronamespace = 'public'::regnamespace)
     !~ 'least\(now\(\), v_session\.last_confirmed_at \+ interval ''12 minutes''\)' then
    raise exception '0221: stop_lock_in_session is missing the finish-path clamp.';
  end if;

  -- One definition each — no overloads created (MIGRATIONS.md's trap).
  if (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname in
         ('goal_paid_band', 'claim_goal_complete', 'submit_vouch', 'settle_expired_vouches',
          'grade_band', 'economy_on_challenge_completed', 'notify_stale_lock_ins',
          'stop_lock_in_session')) <> 8 then
    raise exception '0221: an overload was created — count pg_proc before pushing.';
  end if;

  raise notice '0221 ok — vouching removed, grades cap at Epic, self-report caps at Rare, lock-in stale-close ~12m with the credit cap intact.';
end
$assert$;
