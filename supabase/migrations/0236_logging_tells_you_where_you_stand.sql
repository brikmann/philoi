-- 0236 — Logging tells you where you stand.
--
-- ─────────────────────────────── WHY ───────────────────────────────
--
-- Noah: the moment you log something that counts toward a challenge you're in, push your live
-- position — "You're now #R of N" — for ANY board and ANY metric. Every logged effort tells you
-- where you stand. Server-only: notify_event pushes carry `route` + `params`, and the client's tap
-- handler (_layout.tsx) and bell route any type generically, so a new type deep-links on installed
-- builds with no client change and no OTA.
--
-- Nothing here scores anything. The rank is challenge_racer_score (the per-racer score settlement
-- and completion already use) across challenge_field (the roster the board reads), and the send is
-- notify_event, so the category switch, the per-type switch, quiet hours and philoi.suppress_push
-- are all inherited, not reimplemented.
--
-- ── When it fires: all of these hold ──
--
--   · the challenge is live (status 'active'), mode 'group', and not a team match — a placement race
--     or a collective board. A duel has two racers and a personal goal has one, and MIN_FIELD below
--     rules both out on its own.
--   · the user is on the roster (challenge_field — accepted participants, or the whole campfire for
--     a pre-roster challenge) and the roster has >= challenge_standing_min_field() racers (3).
--   · the activity actually moves that challenge's score (see "what counts" below).
--   · no standing push for this (user, challenge) in the last challenge_standing_cooldown() (10 min).
--   · the triggering activity has never been handled for this challenge before (the dedup key).
--
-- ── What counts, per metric — the same rules challenge_racer_score scores by ──
--
--   lockin_time, xp, null (a collective counts qualifying lock-ins)
--       a check-in that passes check_in_qualifies_for_challenge, inside the challenge window.
--   distance   a check-in with distance_m > 0 inside the window (challenge_metric_value applies no
--              qualification gate to distance — a Strava run counts as it is).
--   count      a challenge_logs row with amount > 0 against the racer's mirror goal
--              (campfire_challenge_goals, 0162). That one row is written by BOTH writers of a count:
--              log_challenge_progress (by hand) and credit_count_goals_for_workout_set (gym sets).
--   volume     a workout_sets row inside the window.
--   grade      nothing. A grade is a single self-reported mark, not logged activity.
--
-- ── Why DEFERRED constraint triggers, not plain AFTER INSERT ──
--
-- Each writer inserts first and settles the number after:
--   · log_challenge_progress / the gym-set feeder insert the challenge_logs row and THEN update the
--     goal's progress — an AFTER INSERT on challenge_logs would rank on the old progress.
--   · handle_check_in_insert is itself an AFTER INSERT trigger that stamps xp_earned — order between
--     sibling AFTER triggers is alphabetical, and an xp race must not depend on trigger names.
-- A deferred trigger runs at commit, when every one of those writes has landed.
--
-- And because a deferred trigger fires AT COMMIT, an exception in it would fail the commit and
-- throw away the user's lock-in. Every trigger body here swallows its own errors (warning only),
-- the same rule as the gym-set and lock-in goal feeders: a missing push is a shrug, a lost
-- workout is a support ticket.
--
-- ── Dedup and the gym photo case ──
--
-- A gym check-in does not qualify until it has a photo or a workout set, and those land AFTER the
-- check-in row. So check_in_photos and check_in_workout_sets re-evaluate their parent check-in
-- under the SAME key as the check-in itself ('check_in:<id>:<challenge>'). The ledger records a key
-- only once the activity has counted, so: check-in (doesn't qualify yet, nothing recorded) → photo
-- (qualifies, push, recorded) → six sets (key already there, silent). One check-in, at most one
-- push per board.
--
-- The Strava path needs no edge-function change: upsertStravaLockIn (_shared/strava-activity.ts)
-- inserts a check_ins row with distance_m and duration_seconds already set, so it lands on the
-- check-in trigger like a lock-in does. A webhook + backfill race loses on check_ins' unique
-- constraint, so the losing insert never commits and never fires. An "update" event upserts and
-- never inserts.
--
-- ── Which rank — the one the board shows ──
--
-- The push lands on /challenge-info, whose standings number racers among those the VIEWER can see
-- (can_see_rank): an anonymous racer shows "—" and takes no number. The push ranks the same way,
-- so the number in the notification is the number on the screen it opens. That also stops the gap
-- from leaking a hidden racer's score ("4 km to catch #1" + your own total = theirs). N is the
-- whole field, as the board's row count is.
--
-- ── One board fix, so the push and the board agree ──
--
-- get_group_challenge_watch's non-placement arm counted qualifying lock-ins for EVERY collective,
-- including a count race ("1000 pushups", 0162) and a measured collective (0169). For those the
-- board ranked a quantity the challenge does not measure: a pushup logged by hand never moved it.
-- challenge_racer_score's arms are exactly right for both (0162 and 0169 say so in their headers)
-- and are identical to the old expression when race_metric is null, so the arm now calls it. Every
-- other line of that function is its live body, pinned by md5 below.

-- ─────────────────────────── 0 · preconditions ───────────────────────────
do $guard$
declare
  v_md5 text;
begin
  if to_regprocedure('public.challenge_racer_score(uuid, uuid)') is null then
    raise exception '0236 needs challenge_racer_score(uuid, uuid) — see 0098/0162';
  end if;
  if to_regprocedure('public.challenge_field(uuid, uuid)') is null then
    raise exception '0236 needs challenge_field(uuid, uuid)';
  end if;
  if to_regprocedure('public.can_see_rank(uuid, uuid)') is null then
    raise exception '0236 needs can_see_rank(uuid, uuid) — see 0217';
  end if;
  if to_regprocedure('public.check_in_qualifies_for_challenge(uuid)') is null then
    raise exception '0236 needs check_in_qualifies_for_challenge(uuid) — see 0033';
  end if;
  if to_regprocedure('public.notify_event(uuid[], text, text, text, uuid, uuid, text, jsonb, text, text, jsonb)') is null then
    raise exception '0236 needs the 11-arg notify_event — see 0086';
  end if;

  -- Both restated below from their live bodies. A different body means a sibling changed it after
  -- this was written; restating from the older base would silently revert that work.
  select md5(prosrc) into v_md5 from pg_proc
   where pronamespace = 'public'::regnamespace and proname = 'notification_category';
  if v_md5 is distinct from '6e193c5ab244993a2b1f2b3505c3630e' then
    raise exception '0236: notification_category changed since this was written (md5 %) — rebase §2 on the live body', v_md5;
  end if;
  select md5(prosrc) into v_md5 from pg_proc
   where pronamespace = 'public'::regnamespace and proname = 'get_group_challenge_watch';
  if v_md5 is distinct from 'c718a4348525239d84e96be3bd9763c7' then
    raise exception '0236: get_group_challenge_watch changed since this was written (md5 %) — rebase §6 on the live body', v_md5;
  end if;
end
$guard$;

-- ─────────────────────────── 1 · the tunables ───────────────────────────
-- Functions rather than literals so a retune is a one-line migration and every reader agrees.

create or replace function challenge_standing_min_field()
returns int language sql immutable as $$ select 3 $$;

comment on function challenge_standing_min_field() is
  '0236 — the smallest roster a standing push fires for (you + 2). A standing is only worth a nudge when there is a pack.';

create or replace function challenge_standing_cooldown()
returns interval language sql immutable as $$ select interval '10 minutes' $$;

comment on function challenge_standing_cooldown() is
  '0236 — at most one standing push per (user, challenge) per this window, so a run of sets or laps is one nudge.';

-- ─────────────────────────── 2 · the type, filed under Challenges ───────────────────────────
-- 0205's live body; the only change is 'challenge_standing' in the challenges arm.

create or replace function public.notification_category(p_type text)
 returns text
 language sql
 immutable
 set search_path to 'public'
as $function$
  select case
    when p_type in ('friend_request', 'friend_accepted', 'friend_ranked_up', 'friend_passed_you',
                    'friend_joined', 'friend_locked_in',
                    'milestone_cheered', 'milestone_posted',
                    'agora_cheered', 'agora_commented',
                    -- 0205 · a friend posting to the Agora. Friend chatter, governed by the friend
                    -- switch — and by its own type_ switch under it.
                    'friend_agora_post',
                    'check_in', 'reaction') then 'friends_social'
    when p_type in ('challenged', 'challenge_accepted', 'challenge_declined', 'challenge_passed',
                    'challenge_ending_soon', 'challenge_won', 'challenge_lost', 'goal_at_risk',
                    'goal_streak_milestone', 'challenge_cheered',
                    'challenge_invite', 'challenge_forfeited', 'challenge_change_request',
                    'challenge_change_answered', 'challenge_terms_updated',
                    -- 0164 · the vouch flow. Filed with challenges rather than friends_social even
                    -- though a vouch request comes FROM a friend: what it is about is a goal and
                    -- its reward, and somebody muting friend chatter still wants to be asked.
                    'vouch_requested', 'vouch_passed', 'vouch_settled',
                    -- 0201 · a goal completing. Without this it fell to the else-arm and muting
                    -- friend chatter would have silenced it.
                    'goal_complete',
                    -- 0236 · "You're now #R of N". Without this it would fall to the else-arm and
                    -- the Challenges switch would not silence it.
                    'challenge_standing') then 'challenges'
    when p_type in ('campfire_joined', 'campfire_join_request', 'campfire_challenge_started',
                    'campfire_cold', 'campfire_added', 'campfire_settled', 'campfire_message',
                    'join_request', 'join_request_approved', 'campfire_admin_granted',
                    'chat_batch', 'mention',
                    'campfire_ping',
                    -- 0162 · fires at every member of a campfire, so the campfire toggle governs it.
                    'challenge_hosted') then 'campfires'
    when p_type in ('streak_at_risk', 'daily_fire_reminder', 'streak_milestone',
                    'session_complete',
                    'streak_risk', 'lock_in_nudge', 'lockin_still_here') then 'streak_reminders'
    when p_type in ('season_ending', 'season_settled', 'ranked_up', 'rank_dropped', 'reward_ready',
                    -- 0201 · the pass and badges are rewards, filed with the other rewards.
                    'pass_unlocked', 'badge_earned',
                    -- 0205 · where you stand on the board IS a rank event. Filed here rather than
                    -- left to the else-arm, so "Season & rank: off" actually silences it.
                    'daily_placement')
      then 'season_rank'
    else 'friends_social'
  end;
$function$;

-- ─────────────────────────── 3 · the ledger ───────────────────────────
-- One row per (activity, challenge) that COUNTED. `sent` is false when the cooldown swallowed it —
-- still recorded, so a replay of that same activity later is still a duplicate.

create table if not exists challenge_standing_pushes (
  dedup_key    text primary key,
  user_id      uuid not null references profiles(id) on delete cascade,
  challenge_id uuid not null references social_challenges(id) on delete cascade,
  sent         boolean not null,
  rank         int,
  field_size   int,
  created_at   timestamptz not null default now()
);

create index if not exists challenge_standing_pushes_recent_idx
  on challenge_standing_pushes (user_id, challenge_id, created_at desc) where sent;

-- Server-only. RLS on with no policy, and no table grants: nothing but the definer functions below
-- ever reads or writes it.
alter table challenge_standing_pushes enable row level security;
revoke all on challenge_standing_pushes from public, anon, authenticated;

comment on table challenge_standing_pushes is
  '0236 — dedup + rate-limit ledger for challenge_standing pushes. dedup_key = <source>:<source id>:<challenge id>.';

-- ─────────────────────────── 4 · the push ───────────────────────────

-- A score difference in the challenge's own units, matching the client's formatMetricValue
-- (src/lib/challenge-metric.ts) so the push and the board read the same.
create or replace function challenge_standing_amount(p_c social_challenges, p_v numeric)
returns text
language sql
immutable
set search_path to 'public'
as $$
  select case p_c.race_metric
    when 'distance' then
      case when p_v >= 1000 then to_char(p_v / 1000.0, 'FM999,990.0') || ' km'
           else round(p_v)::text || ' m' end
    when 'lockin_time' then
      case when p_v >= 3600
           then floor(p_v / 3600)::text || 'h ' || round(mod(p_v, 3600) / 60)::text || 'm'
           else greatest(round(p_v / 60), 1)::text || 'm' end
    when 'xp'     then to_char(round(p_v), 'FM999,999,999') || ' XP'
    when 'volume' then to_char(round(p_v), 'FM999,999,999') || ' lb'
    when 'grade'  then to_char(p_v, 'FM990.0') || ' points'
    when 'count'  then to_char(round(p_v), 'FM999,999,999')
                       || coalesce(' ' || nullif(btrim(p_c.count_unit), ''), '')
    else -- null: a collective counts qualifying lock-ins
      round(p_v)::text || case when round(p_v) = 1 then ' lock-in' else ' lock-ins' end
  end;
$$;

-- What to call it — challengeTitle()'s fallbacks, for a board with no public_name.
create or replace function challenge_standing_title(p_c social_challenges)
returns text
language sql
immutable
set search_path to 'public'
as $$
  select coalesce(
    nullif(btrim(p_c.public_name), ''),
    case
      when p_c.race_metric = 'count' then
        to_char(coalesce(p_c.target_count, 0), 'FM999,999,999')
          || coalesce(' ' || nullif(btrim(p_c.count_unit), ''), '')
      when p_c.shape = 'placement' then
        case p_c.race_metric
          when 'lockin_time' then 'Most lock-in time'
          when 'volume'      then 'Most volume lifted'
          when 'distance'    then 'Most distance'
          when 'xp'          then 'Most XP'
          else 'Your challenge'
        end
      when p_c.race_metric is null then 'Everyone locks in ' || coalesce(p_c.target_count, 1)::text || '×'
      else 'Your challenge'
    end);
$$;

create or replace function notify_challenge_standing(p_user uuid, p_challenge_id uuid, p_dedup_key text)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_c social_challenges;
  v_n int;
  v_mine numeric;
  v_rank int;
  v_tied boolean;
  v_leader numeric;
  v_runner_up numeric;
  v_body text;
begin
  if p_user is null or p_challenge_id is null or p_dedup_key is null then
    return false;
  end if;

  select * into v_c from social_challenges sc where sc.id = p_challenge_id;
  if v_c.id is null
     or not challenge_is_live(v_c.status)
     or v_c.mode <> 'group'
     or v_c.shape is not distinct from 'team_match' then
    return false;
  end if;

  -- Serialise per (user, challenge) so two commits landing together cannot both pass the cooldown.
  perform pg_advisory_xact_lock(hashtextextended('challenge_standing:' || p_user::text || ':' || p_challenge_id::text, 0));

  if exists (select 1 from challenge_standing_pushes s where s.dedup_key = p_dedup_key) then
    return false;
  end if;

  -- Every racer scored once. Distinct: challenge_field is a union, and a racer must never be
  -- counted twice. The board's numbering: only racers the viewer can see take a place (header).
  with field as (
    select f.user_id,
           coalesce(challenge_racer_score(v_c.id, f.user_id), 0) as score,
           can_see_rank(p_user, f.user_id) as visible
      from (select distinct cf.user_id from challenge_field(v_c.id, v_c.circle_id) cf) f
  ), me as (
    select fm.score from field fm where fm.user_id = p_user
  )
  select (select count(*) from field),
         me.score,
         1 + count(o.user_id) filter (where o.score > me.score),
         coalesce(bool_or(o.score = me.score), false),
         max(o.score),
         max(o.score) filter (where o.score <= me.score)
    into v_n, v_mine, v_rank, v_tied, v_leader, v_runner_up
    from me
    left join field o on o.user_id <> p_user and o.visible
   group by me.score;

  if v_mine is null or v_n < challenge_standing_min_field() or v_mine <= 0 then
    -- Not on this board, too small a pack, or the activity did not actually put a number on it.
    -- Nothing recorded: the activity did not count here.
    return false;
  end if;

  if exists (
    select 1 from challenge_standing_pushes s
     where s.user_id = p_user and s.challenge_id = p_challenge_id and s.sent
       and s.created_at > now() - challenge_standing_cooldown()
  ) then
    insert into challenge_standing_pushes (dedup_key, user_id, challenge_id, sent, rank, field_size)
    values (p_dedup_key, p_user, p_challenge_id, false, v_rank, v_n);
    return false;
  end if;

  v_body := case
    when v_rank = 1 and v_tied then
      'You''re tied for #1 of ' || v_n || '.'
    when v_rank = 1 and v_runner_up is not null then
      'You''re now #1 of ' || v_n || ' — ' || challenge_standing_amount(v_c, v_mine - v_runner_up) || ' clear of #2.'
    when v_rank = 1 then
      'You''re now #1 of ' || v_n || '.'
    when v_tied then
      'You''re tied for #' || v_rank || ' of ' || v_n || ' — '
        || challenge_standing_amount(v_c, v_leader - v_mine) || ' to catch #1.'
    else
      'You''re now #' || v_rank || ' of ' || v_n || ' — '
        || challenge_standing_amount(v_c, v_leader - v_mine) || ' to catch #1.'
  end;

  perform notify_event(
    array[p_user],
    'challenge_standing',
    challenge_standing_title(v_c),
    v_body,
    null,
    v_c.id,
    '/challenge-info/[challengeId]',
    jsonb_build_object('challengeId', v_c.id::text),
    null,
    null,
    jsonb_build_object('challenge_id', v_c.id, 'rank', v_rank, 'field', v_n,
                       'shape', v_c.shape, 'race_metric', v_c.race_metric)
  );

  insert into challenge_standing_pushes (dedup_key, user_id, challenge_id, sent, rank, field_size)
  values (p_dedup_key, p_user, p_challenge_id, true, v_rank, v_n);
  return true;
end;
$$;

comment on function notify_challenge_standing(uuid, uuid, text) is
  '0236 — "You''re now #R of N" for one board, if every gate in 0236''s header holds. Idempotent on p_dedup_key; rate-limited per (user, challenge) by challenge_standing_cooldown().';

-- ─────────────────────────── 5 · what an activity moves ───────────────────────────
-- Finds the boards one activity actually moves (header, "what counts") and pushes each. Returns
-- how many pushed.

create or replace function challenge_standing_on_activity(p_source text, p_source_id uuid)
returns int
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_ci check_ins;
  v_log challenge_logs;
  v_user uuid;
  v_at timestamptz;
  v_workout uuid;
  v_c record;
  v_sent int := 0;
begin
  if p_source = 'check_in' then
    select * into v_ci from check_ins ci where ci.id = p_source_id and ci.removed_at is null;
    if v_ci.id is null then
      return 0;
    end if;
    for v_c in
      select sc.id
        from social_challenges sc
       where challenge_is_live(sc.status)
         and sc.mode = 'group'
         and sc.shape is distinct from 'team_match'
         and v_ci.created_at >= coalesce(sc.starts_at, '-infinity'::timestamptz)
         and v_ci.created_at <= coalesce(sc.ends_at, 'infinity'::timestamptz)
         and (
           ((sc.race_metric is null or sc.race_metric in ('lockin_time', 'xp'))
              and check_in_qualifies_for_challenge(v_ci.id))
           or (sc.race_metric = 'distance' and coalesce(v_ci.distance_m, 0) > 0)
         )
         and exists (select 1 from challenge_field(sc.id, sc.circle_id) f where f.user_id = v_ci.user_id)
    loop
      if notify_challenge_standing(v_ci.user_id, v_c.id, 'check_in:' || v_ci.id || ':' || v_c.id) then
        v_sent := v_sent + 1;
      end if;
    end loop;

  elsif p_source = 'log' then
    select * into v_log from challenge_logs cl where cl.id = p_source_id;
    if v_log.id is null or coalesce(v_log.amount, 0) <= 0 then
      return 0;
    end if;
    for v_c in
      select sc.id
        from campfire_challenge_goals m
        join social_challenges sc on sc.id = m.challenge_id
       where m.goal_id = v_log.challenge_id
         and m.user_id = v_log.user_id
         and sc.race_metric = 'count'
         and challenge_is_live(sc.status)
         and sc.mode = 'group'
    loop
      if notify_challenge_standing(v_log.user_id, v_c.id, 'log:' || v_log.id || ':' || v_c.id) then
        v_sent := v_sent + 1;
      end if;
    end loop;

  elsif p_source = 'workout_set' then
    select w.user_id, w.id, ws.created_at into v_user, v_workout, v_at
      from workout_sets ws
      join workout_exercises we on we.id = ws.workout_exercise_id
      join workouts w on w.id = we.workout_id
     where ws.id = p_source_id;
    if v_user is null then
      return 0;
    end if;
    for v_c in
      select sc.id
        from social_challenges sc
       where challenge_is_live(sc.status)
         and sc.mode = 'group'
         and sc.race_metric = 'volume'
         and v_at >= coalesce(sc.starts_at, '-infinity'::timestamptz)
         and v_at <= coalesce(sc.ends_at, 'infinity'::timestamptz)
         and exists (select 1 from challenge_field(sc.id, sc.circle_id) f where f.user_id = v_user)
    loop
      -- Keyed on the WORKOUT, not the set: one session is one nudge, however long it runs.
      if notify_challenge_standing(v_user, v_c.id, 'workout:' || v_workout || ':' || v_c.id) then
        v_sent := v_sent + 1;
      end if;
    end loop;
  end if;

  return v_sent;
end;
$$;

revoke execute on function challenge_standing_on_activity(text, uuid) from public, anon, authenticated;
revoke execute on function notify_challenge_standing(uuid, uuid, text) from public, anon, authenticated;
revoke execute on function challenge_standing_amount(social_challenges, numeric) from public, anon, authenticated;
revoke execute on function challenge_standing_title(social_challenges) from public, anon, authenticated;

-- ─────────────────────────── 5b · the triggers ───────────────────────────
-- One trigger function, told its source by TG_TABLE_NAME. Never raises: it runs at COMMIT.

create or replace function challenge_standing_after_activity()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  begin
    case tg_table_name
      when 'check_ins'             then perform challenge_standing_on_activity('check_in', new.id);
      -- A gym check-in qualifies only once it has a photo or a set; re-check the PARENT, under the
      -- check-in's own key, so it pushes at most once however many arrive.
      when 'check_in_photos'       then perform challenge_standing_on_activity('check_in', new.check_in_id);
      when 'check_in_workout_sets' then perform challenge_standing_on_activity('check_in', new.check_in_id);
      when 'challenge_logs'        then perform challenge_standing_on_activity('log', new.id);
      when 'workout_sets'          then perform challenge_standing_on_activity('workout_set', new.id);
      else null;
    end case;
  exception when others then
    raise warning '0236 standing push failed for %.%: %', tg_table_name, new.id, sqlerrm;
  end;
  return null;
end;
$$;

revoke execute on function challenge_standing_after_activity() from public, anon, authenticated;

drop trigger if exists challenge_standing_after_check_in on check_ins;
create constraint trigger challenge_standing_after_check_in
  after insert on check_ins
  deferrable initially deferred
  for each row execute function challenge_standing_after_activity();

drop trigger if exists challenge_standing_after_check_in_photo on check_in_photos;
create constraint trigger challenge_standing_after_check_in_photo
  after insert on check_in_photos
  deferrable initially deferred
  for each row execute function challenge_standing_after_activity();

drop trigger if exists challenge_standing_after_check_in_workout_set on check_in_workout_sets;
create constraint trigger challenge_standing_after_check_in_workout_set
  after insert on check_in_workout_sets
  deferrable initially deferred
  for each row execute function challenge_standing_after_activity();

drop trigger if exists challenge_standing_after_challenge_log on challenge_logs;
create constraint trigger challenge_standing_after_challenge_log
  after insert on challenge_logs
  deferrable initially deferred
  for each row execute function challenge_standing_after_activity();

drop trigger if exists challenge_standing_after_workout_set on workout_sets;
create constraint trigger challenge_standing_after_workout_set
  after insert on workout_sets
  deferrable initially deferred
  for each row execute function challenge_standing_after_activity();

-- ─────────────────────────── 6 · the board ranks what the race measures ───────────────────────────
-- Live body, pinned above. The only change is the non-placement arm (header, "One board fix").

create or replace function public.get_group_challenge_watch(p_challenge_id uuid)
 returns table(challenge_id uuid, target_count integer, window_hours integer, starts_at timestamp with time zone, ends_at timestamp with time zone, status text, circle_id uuid, circle_name text, public_name text, shape text, race_metric text, member_id uuid, member_name text, member_progress numeric, member_live_status text, member_cheers integer, cheered_by_me boolean, is_anonymous boolean)
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare
  v_challenge social_challenges;
begin
  -- sc.status, not status: `status` is an OUT column of this function. Same trap as 0099.
  select * into v_challenge from social_challenges sc
  where sc.id = p_challenge_id
    and sc.mode = 'group'
    and (challenge_is_live(sc.status) or challenge_is_settled(sc.status));
  if v_challenge.id is null then
    raise exception 'Group challenge not found or not active.';
  end if;
  if not is_group_member(v_challenge.circle_id) then
    raise exception 'Not a member of that campfire.';
  end if;

  return query
  select
    v_challenge.id,
    v_challenge.target_count,
    v_challenge.window_hours,
    v_challenge.starts_at,
    v_challenge.ends_at,
    v_challenge.status,
    v_challenge.circle_id,
    g.name,
    v_challenge.public_name,
    v_challenge.shape,
    v_challenge.race_metric,
    f.user_id,
    -- 0170 · name, progress and live status are the three things anonymity hides. Everything else
    -- on the row is about the CHALLENGE, not about who is running it.
    case when vis.ok then p.display_name else 'Anonymous' end,
    case when vis.ok then
      case
        when v_challenge.shape = 'placement' then
          -- Net of the baseline, evaluated at the end of the window once it has passed — the same
          -- expression settlement uses (0127), so the live board and the final board cannot disagree.
          greatest(
            challenge_metric_value(v_challenge.race_metric, f.user_id,
              least(now(), coalesce(v_challenge.ends_at, now()))) - f.baseline,
            0)
        else
          -- 0236 · was a count of qualifying lock-ins for every collective, which is what
          -- challenge_racer_score's null arm returns — so a lock-in-count board reads exactly as
          -- before — but a count race (0162's mirror goal) and a measured collective (0169) were
          -- ranked on lock-ins they do not measure. The racer score is what completion and the
          -- standing push already read.
          challenge_racer_score(v_challenge.id, f.user_id)
      end
    else null end,
    case when vis.ok then live_status(f.user_id) else null end,
    (select count(*)::int from challenge_cheers cc
      where cc.challenge_id = p_challenge_id and cc.for_user_id = f.user_id),
    exists (select 1 from challenge_cheers cc
      where cc.challenge_id = p_challenge_id and cc.spectator_id = auth.uid() and cc.for_user_id = f.user_id),
    not vis.ok
  from challenge_field(p_challenge_id, v_challenge.circle_id) f
  join profiles p on p.id = f.user_id
  join groups g on g.id = v_challenge.circle_id
  cross join lateral (select can_see_rank(auth.uid(), f.user_id) as ok) vis;
end;
$function$;

-- ─────────────────────────── 7 · verify ───────────────────────────
do $verify$
begin
  if notification_category('challenge_standing') <> 'challenges' then
    raise exception '0236: challenge_standing is not filed under challenges';
  end if;
  -- Positive control: an existing type still files where it did.
  if notification_category('goal_complete') <> 'challenges'
     or notification_category('daily_placement') <> 'season_rank' then
    raise exception '0236: notification_category restatement moved an existing type';
  end if;
  if (select count(*) from pg_trigger where tgname like 'challenge_standing_after_%' and tgdeferrable and tginitdeferred) <> 5 then
    raise exception '0236: expected 5 deferred standing triggers';
  end if;
  if has_function_privilege('authenticated', 'notify_challenge_standing(uuid, uuid, text)', 'execute')
     or has_function_privilege('anon', 'notify_challenge_standing(uuid, uuid, text)', 'execute') then
    raise exception '0236: notify_challenge_standing is client-callable';
  end if;
  if (select prosrc from pg_proc where pronamespace = 'public'::regnamespace and proname = 'get_group_challenge_watch')
       !~ 'challenge_racer_score\(v_challenge\.id, f\.user_id\)' then
    raise exception '0236: get_group_challenge_watch did not take the racer-score arm';
  end if;
end
$verify$;
