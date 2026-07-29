-- Anti-farming + gym proof-of-effort (CODE_BUILD_PROMPTS.md's reward-design rules — not a
-- screen, the rules every reward-bearing feature must obey). A lock-in isn't technically
-- verifiable, so the goal isn't perfect verification (impossible, ruins UX) — it's making
-- cheating pointless, visible, and rare. This migration adds the three concrete, contained
-- pieces of that: a minimum duration to count, a cooldown against rapid stop/start stacking,
-- and a quality floor on what counts toward a CHALLENGE payout (real bonus XP is the highest-
-- stakes reward in the app today, so it's the thing most worth guarding) — plus the gym
-- workout log (sets/reps) that the quality floor's "photo or logged work" gym rule needs to
-- exist at all.

-- ───────────────────────────── gym workout log ─────────────────────────────
-- Same shape/pattern as check_in_photos: entries are captured locally while a gym lock-in is
-- active, then written as a batch when the session stops and attached to the resulting
-- check-in. This is gym's proof-of-effort per the reward rules — a gym lock-in that's meant to
-- count for something (a challenge) needs logged work, not just a running clock.
create table if not exists check_in_workout_sets (
  id uuid primary key default gen_random_uuid(),
  check_in_id uuid not null references check_ins (id) on delete cascade,
  exercise text not null,
  sets int not null check (sets > 0),
  reps int not null check (reps > 0),
  weight numeric check (weight >= 0),
  position int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists check_in_workout_sets_check_in_idx on check_in_workout_sets (check_in_id, position);

alter table check_in_workout_sets enable row level security;

drop policy if exists "check_in_workout_sets: read if circle-mate" on check_in_workout_sets;
create policy "check_in_workout_sets: read if circle-mate" on check_in_workout_sets for select using (
  exists (
    select 1 from check_ins ci
    where ci.id = check_in_workout_sets.check_in_id
      and (ci.user_id = auth.uid() or is_circle_mate_of(ci.user_id) or is_admin())
  )
);
-- No insert/update/delete policy for regular users — written only inside
-- stop_lock_in_session() (security definer), same trusted-write pattern as check_in_photos.

-- ───────────────────────────── quality floor ─────────────────────────────
-- What counts toward a CHALLENGE's score at all — real bonus XP rides on this, so it's where
-- farming would actually pay off if left unguarded. A blanket 20-minute floor (the reward
-- rules' own gym example, generalized — simpler and safer than branching per goal type) plus,
-- specifically for gym, proof of real work (a photo or a logged set) since a running clock
-- alone proves nothing for that goal type. Placeholder threshold — tune once there's usage data.
create or replace function check_in_qualifies_for_challenge(p_check_in_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select
    ci.duration_seconds is not null
    and ci.duration_seconds >= 1200
    and (
      ci.goal_type != 'gym'
      or exists (select 1 from check_in_photos where check_in_id = ci.id)
      or exists (select 1 from check_in_workout_sets where check_in_id = ci.id)
    )
  from check_ins ci
  where ci.id = p_check_in_id;
$$;

-- Body-only changes below (same signatures) — the floor is applied everywhere a challenge
-- scores or completes someone's effort, not just at creation time.

create or replace function social_challenge_score(p_user_id uuid, p_metric text, p_starts_at timestamptz, p_ends_at timestamptz)
returns numeric
language sql
security definer
set search_path = public
stable
as $$
  select coalesce(sum(case when p_metric = 'lockin_time' then ci.duration_seconds else ci.xp_earned end), 0)
  from check_ins ci
  where ci.user_id = p_user_id
    and ci.removed_at is null
    and ci.created_at >= p_starts_at
    and ci.created_at <= p_ends_at
    and check_in_qualifies_for_challenge(ci.id);
$$;

create or replace function finalize_social_challenges()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  v_my numeric;
  v_opp numeric;
  v_member_count int;
  v_completed_count int;
begin
  for r in select * from social_challenges where status = 'active' and ends_at <= now() loop
    if r.mode = 'h2h' then
      v_my := social_challenge_score(r.created_by, r.race_metric, r.starts_at, r.ends_at);
      v_opp := social_challenge_score(r.opponent_id, r.race_metric, r.starts_at, r.ends_at);
      update social_challenges
      set status = 'completed', winner_id = case when v_my > v_opp then r.created_by when v_opp > v_my then r.opponent_id else null end
      where id = r.id;
      if v_my != v_opp then
        insert into bonus_xp_awards (user_id, amount, reason, challenge_id)
        values (case when v_my > v_opp then r.created_by else r.opponent_id end, r.payout_xp, 'challenge_h2h_winner', r.id);
      end if;
    else
      select count(*) into v_member_count from group_members where group_id = r.circle_id;
      select count(*) into v_completed_count
      from group_members gm
      where gm.group_id = r.circle_id
        and (
          select count(*) from check_ins ci
          where ci.user_id = gm.user_id and ci.removed_at is null
            and ci.created_at >= r.starts_at and ci.created_at <= r.ends_at
            and check_in_qualifies_for_challenge(ci.id)
        ) >= r.target_count;

      if v_completed_count >= v_member_count and v_member_count > 0 then
        update social_challenges set status = 'completed' where id = r.id;
        insert into bonus_xp_awards (user_id, amount, reason, challenge_id)
        select user_id, r.payout_xp, 'challenge_group_completion', r.id from group_members where group_id = r.circle_id;
      else
        update social_challenges set status = 'expired' where id = r.id;
      end if;
    end if;
  end loop;
end;
$$;

drop function if exists get_my_social_challenges();

create function get_my_social_challenges()
returns table (
  id uuid,
  circle_id uuid,
  circle_name text,
  circle_emoji text,
  created_by uuid,
  created_by_name text,
  mode text,
  opponent_id uuid,
  opponent_name text,
  race_metric text,
  my_score numeric,
  opponent_score numeric,
  target_count int,
  member_count int,
  completed_count int,
  window_hours int,
  starts_at timestamptz,
  ends_at timestamptz,
  status text,
  winner_id uuid,
  payout_xp int,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public
stable
as $$
begin
  return query
  select
    sc.id,
    sc.circle_id,
    g.name as circle_name,
    g.emoji as circle_emoji,
    sc.created_by,
    creator.display_name as created_by_name,
    sc.mode,
    sc.opponent_id,
    opp.display_name as opponent_name,
    sc.race_metric,
    case when sc.mode = 'h2h' and sc.status != 'pending'
      then social_challenge_score(
        case when auth.uid() = sc.opponent_id then sc.opponent_id else sc.created_by end,
        sc.race_metric, sc.starts_at, sc.ends_at)
      else null end as my_score,
    case when sc.mode = 'h2h' and sc.status != 'pending'
      then social_challenge_score(
        case when auth.uid() = sc.opponent_id then sc.created_by else sc.opponent_id end,
        sc.race_metric, sc.starts_at, sc.ends_at)
      else null end as opponent_score,
    sc.target_count,
    case when sc.mode = 'group' then (select count(*)::int from group_members where group_id = sc.circle_id) else null end as member_count,
    case when sc.mode = 'group' then (
      select count(*)::int from group_members gm
      where gm.group_id = sc.circle_id
        and (
          select count(*) from check_ins ci
          where ci.user_id = gm.user_id and ci.removed_at is null
            and ci.created_at >= sc.starts_at and ci.created_at <= coalesce(sc.ends_at, now())
            and check_in_qualifies_for_challenge(ci.id)
        ) >= sc.target_count
    ) else null end as completed_count,
    sc.window_hours,
    sc.starts_at,
    sc.ends_at,
    sc.status,
    sc.winner_id,
    sc.payout_xp,
    sc.created_at
  from social_challenges sc
  left join groups g on g.id = sc.circle_id
  join profiles creator on creator.id = sc.created_by
  left join profiles opp on opp.id = sc.opponent_id
  where (is_group_member(sc.circle_id) or sc.created_by = auth.uid() or sc.opponent_id = auth.uid())
    and sc.status != 'declined'
  order by
    (sc.status = 'pending' and sc.opponent_id = auth.uid()) desc,
    sc.created_at desc;
end;
$$;

-- ───────────────────────────── minimum duration to count ─────────────────────────────
-- "Kills the 5-second session" — a lock-in under a minute still gets its check-in row (so the
-- flame meter/journal don't lie about what happened), but earns 0 XP and doesn't extend a
-- streak. Placeholder threshold, same as above.
create or replace function handle_check_in_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_streak integer;
begin
  perform recompute_user_streak(new.user_id);

  select current_streak into v_streak from profiles where id = new.user_id;

  update check_ins
  set xp_earned = case
    -- Too short to count for anything (anti-farming floor) — zero, not just a rounding artifact.
    when new.duration_seconds is not null and new.duration_seconds < 60 then 0
    when new.duration_seconds is not null then round(new.duration_seconds * 250.0 / 3600) + coalesce(v_streak, 0) * 5
    else 100 + coalesce(v_streak, 0) * 5  -- flat XP for a photo check-in, plus the same streak bonus
  end
  where id = new.id;

  return new;
end;
$$;

-- A day only "counts" for streak purposes if it has a check-in that either isn't a timed
-- lock-in at all (an old/plain photo check-in) or cleared the same 60s floor above — otherwise
-- a burst of 1-second lock-ins could farm a streak with zero real effort.
create or replace function recompute_user_streak(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_dates date[];
  v_streak integer := 0;
  v_longest integer := 0;
  v_expected date := current_date;
  d date;
begin
  select array_agg(distinct (created_at at time zone 'utc')::date order by (created_at at time zone 'utc')::date desc)
  into v_dates
  from check_ins
  where user_id = p_user_id and removed_at is null
    and (duration_seconds is null or duration_seconds >= 60);

  if v_dates is null then
    update profiles set current_streak = 0 where id = p_user_id;
    return;
  end if;

  if v_dates[1] = current_date or v_dates[1] = current_date - 1 then
    v_expected := v_dates[1];
    foreach d in array v_dates loop
      if d = v_expected then
        v_streak := v_streak + 1;
        v_expected := v_expected - 1;
      else
        exit;
      end if;
    end loop;
  end if;

  v_longest := 1;
  declare
    v_run integer := 1;
    i integer;
  begin
    for i in 2 .. array_length(v_dates, 1) loop
      if v_dates[i - 1] - v_dates[i] = 1 then
        v_run := v_run + 1;
      else
        v_run := 1;
      end if;
      v_longest := greatest(v_longest, v_run);
    end loop;
  end;

  update profiles
  set current_streak = v_streak, longest_streak = greatest(longest_streak, v_longest, v_streak)
  where id = p_user_id;
end;
$$;

-- ───────────────────────────── session cooldown ─────────────────────────────
-- No rapid stop/start stacking — the one-active-session index already blocks a second
-- CONCURRENT session, but nothing stopped starting a fresh one the instant the last one ended.
-- A short cooldown after the most recent timed check-in closes that. Placeholder window.
create or replace function start_lock_in_session(
  p_goal_type text,
  p_goal_detail text default null,
  p_circle_id uuid default null
)
returns lock_in_sessions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session lock_in_sessions;
  v_last_check_in timestamptz;
begin
  if p_circle_id is not null and not is_group_member(p_circle_id) then
    raise exception 'Not a member of that campfire.';
  end if;

  if exists (select 1 from lock_in_sessions where user_id = auth.uid() and status = 'active') then
    raise exception 'You''re already locked in — stop that session first.';
  end if;

  select max(created_at) into v_last_check_in
  from check_ins
  where user_id = auth.uid() and duration_seconds is not null and removed_at is null;

  if v_last_check_in is not null and v_last_check_in > now() - interval '3 minutes' then
    raise exception 'Take a short breather before your next lock-in.';
  end if;

  insert into lock_in_sessions (user_id, goal_type, goal_detail, circle_id)
  values (auth.uid(), p_goal_type, p_goal_detail, p_circle_id)
  returning * into v_session;

  return v_session;
end;
$$;

-- ───────────────────────────── stop_lock_in_session: attach workout sets ─────────────────
-- Signature change (new trailing param) — appending even a defaulted param changes the
-- argument type list, so this needs the same drop-first treatment as any other reshaped RPC
-- this project has hit (CREATE OR REPLACE alone would just create a second overload).
drop function if exists stop_lock_in_session(uuid, text[], text);

create or replace function stop_lock_in_session(
  p_session_id uuid,
  p_photo_urls text[] default null,   -- ordered Storage paths; null/empty = no photos
  p_caption text default null,
  p_workout_sets jsonb default null   -- [{exercise, sets, reps, weight?}], gym lock-ins only
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

  insert into check_ins (goal_id, goal_type, goal_detail, user_id, photo_url, caption, duration_seconds, status)
  values (
    null, v_session.goal_type, v_session.goal_detail, auth.uid(), v_first_photo, p_caption,
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

  if p_workout_sets is not null and jsonb_array_length(p_workout_sets) > 0 then
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

  update lock_in_sessions
  set status = 'completed', ended_check_in_id = v_check_in.id
  where id = v_session.id;

  select * into v_check_in from check_ins where id = v_check_in.id;

  return v_check_in;
end;
$$;
