-- Lock-in loop + XP (V1_BUILD_SPEC item 2) — this file is a historical, reviewable
-- snapshot; supabase/schema.sql is the real deploy artifact and carries the identical
-- statements. Run the whole of schema.sql, not this file, against a project.
--
-- Core-loop pivot: timed "lock in" sessions (one-tap start/stop, solo or with friends,
-- photo optional) alongside the original photo check-ins, not replacing them. A completed
-- lock-in session becomes an ordinary check_ins row (duration_seconds set instead of/beside
-- a photo) — streak recompute, circle fan-out, one-per-day dedup, feed rendering, and RLS
-- are all inherited from the existing check-in pipeline for free.
--
-- Also redesigns XP from a live recomputation (streak/longest_streak/a rolling 30-day
-- count) into a cumulative ledger (check_ins.xp_earned, summed by domain_score), with
-- rank thresholds moved from an inline CASE into a retunable table with a logarithmic
-- curve (cheap early ranks, steep late ones).

-- ───────────────────────────── check_ins: photo becomes optional ─────────────────────────────
-- photo_url goes nullable because a lock-in session's proof is logged time, not
-- necessarily a photo ("photo optional" per the lock-in spec) — the check constraint below
-- keeps every check-in provable one way or the other.
alter table check_ins alter column photo_url drop not null;
alter table check_ins add column if not exists duration_seconds integer;
alter table check_ins add column if not exists xp_earned numeric not null default 0;
alter table check_ins drop constraint if exists check_ins_photo_or_duration;
alter table check_ins add constraint check_ins_photo_or_duration
  check (photo_url is not null or duration_seconds is not null);

-- ───────────────────────────── XP ledger ─────────────────────────────
-- xp_earned computed once per check-in row, after recompute_goal_streak() has already
-- updated goals.current_streak (needs the POST-check-in streak value for the bonus term).
create or replace function handle_check_in_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_streak integer;
begin
  perform recompute_goal_streak(new.goal_id);

  select current_streak into v_streak from goals where id = new.goal_id;

  update check_ins
  set xp_earned = (
    case
      when new.duration_seconds is not null then round(new.duration_seconds * 250.0 / 3600)  -- 250 XP/hour locked in — placeholder, tune once there's usage data
      else 100  -- flat XP for a photo check-in — keeps photo check-ins meaningfully worth doing, not obsoleted by lock-in
    end
  ) + coalesce(v_streak, 0) * 5  -- keep the old streak-consistency incentive as a bonus, not just raw time/photos
  where id = new.id;

  return new;
end;
$$;

-- domain_score/universal_score: now real sums over check_ins.xp_earned, not a live
-- recomputation from current streak state — deliberately NOT scoped to `archived_at is
-- null` (unlike most other goals-table consumers) so XP earned stays earned even after the
-- goal that earned it is later archived/retired.
create or replace function domain_score(p_user_id uuid, p_type text)
returns numeric
language sql
security definer
set search_path = public
stable
as $$
  select coalesce(sum(ci.xp_earned), 0)
  from check_ins ci
  join goals g on g.id = ci.goal_id
  where g.user_id = p_user_id and g.type = p_type and ci.removed_at is null;
$$;

create or replace function universal_score(p_user_id uuid)
returns numeric
language sql
security definer
set search_path = public
stable
as $$
  select coalesce(sum(domain_score(p_user_id, t.type)), 0)
  from (select distinct type from goals where user_id = p_user_id) t;
$$;

-- ───────────────────────────── logarithmic rank thresholds ─────────────────────────────
-- Table-driven (not inline CASE thresholds like the original version) so retuning the
-- curve later is an UPDATE on this table, not a function edit. Geometric growth
-- (step(i) = round(200 * 1.3^i)) — cheap early ranks, steep late ones (Bronze III->II
-- costs 200 XP; the Gold I->Diamond III span costs ~10,000).
create table if not exists rank_thresholds (
  rank_index int primary key,
  tier text not null,
  division int not null,
  cumulative_xp_required numeric not null
);

insert into rank_thresholds (rank_index, tier, division, cumulative_xp_required) values
  (0, 'bronze', 3, 0),
  (1, 'bronze', 2, 200),
  (2, 'bronze', 1, 460),
  (3, 'silver', 3, 798),
  (4, 'silver', 2, 1237),
  (5, 'silver', 1, 1808),
  (6, 'gold', 3, 2551),
  (7, 'gold', 2, 3516),
  (8, 'gold', 1, 4771),
  (9, 'platinum', 3, 6402),
  (10, 'platinum', 2, 8523),
  (11, 'platinum', 1, 11280),
  (12, 'diamond', 3, 14864),
  (13, 'diamond', 2, 19524),
  (14, 'diamond', 1, 25582)
on conflict (rank_index) do update set
  tier = excluded.tier, division = excluded.division, cumulative_xp_required = excluded.cumulative_xp_required;

create or replace function rank_tier_for_score(p_score numeric)
returns table (tier text, division int)
language sql
stable
as $$
  select rt.tier, rt.division
  from rank_thresholds rt
  where rt.cumulative_xp_required <= p_score
  order by rt.cumulative_xp_required desc
  limit 1;
$$;

-- xp_into_tier/xp_for_next_tier let the client always render "current / needed toward
-- next rank" without a second round trip. At max rank (Diamond I, rank_index 14) there's
-- no next row — xp_for_next_tier comes back 0, which the client treats as "maxed out."
-- Return shape gained two columns vs. the 0002 version (scope, goal_type, score, tier,
-- division only) — Postgres can't CREATE OR REPLACE across an OUT-parameter change, so drop first.
drop function if exists get_my_ranks();
create or replace function get_my_ranks()
returns table (
  scope text,
  goal_type text,
  score numeric,
  tier text,
  division int,
  xp_into_tier numeric,
  xp_for_next_tier numeric
)
language sql
security definer
set search_path = public
stable
as $$
  with ranked as (
    select 'universal'::text as scope, null::text as goal_type, s.score
    from (select universal_score(auth.uid()) as score) s
    union all
    select 'domain', g.type, domain_score(auth.uid(), g.type)
    from (select distinct type from goals where user_id = auth.uid()) g
  )
  select
    r.scope,
    r.goal_type,
    r.score,
    t.tier,
    t.division,
    r.score - lo.cumulative_xp_required as xp_into_tier,
    coalesce(hi.cumulative_xp_required, lo.cumulative_xp_required) - lo.cumulative_xp_required as xp_for_next_tier
  from ranked r
  cross join lateral rank_tier_for_score(r.score) t
  join rank_thresholds lo on lo.tier = t.tier and lo.division = t.division
  left join rank_thresholds hi on hi.rank_index = lo.rank_index + 1
  order by r.scope desc, r.goal_type;
$$;

-- ───────────────────────────── lock-in sessions ─────────────────────────────
-- This table only holds the IN-PROGRESS phase — once a session is stopped,
-- stop_lock_in_session() converts it into an ordinary check_ins row.
create table if not exists lock_in_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles (id) on delete cascade,
  goal_id uuid not null references goals (id) on delete cascade,
  started_at timestamptz not null default now(),
  last_confirmed_at timestamptz not null default now(),
  reminder_sent_at timestamptz,
  status text not null default 'active' check (status in ('active', 'completed', 'abandoned')),
  ended_check_in_id uuid references check_ins (id) on delete set null,
  created_at timestamptz not null default now()
);

-- At most one active session per user — start_lock_in_session() relies on this to reject a
-- second concurrent start with a friendly error rather than silently orphaning the first.
create unique index if not exists lock_in_sessions_one_active_per_user
  on lock_in_sessions (user_id) where status = 'active';

create index if not exists lock_in_sessions_active_idx
  on lock_in_sessions (status, last_confirmed_at) where status = 'active';

alter table lock_in_sessions enable row level security;

-- Same "own rows + circle-mates' rows" shape as check_ins' "read if circle-mate" policy —
-- this is what powers the ambient "who's locked in right now" presence with zero new
-- authorization logic, just the existing is_circle_mate_of() helper.
drop policy if exists "lock_in_sessions: read if circle-mate" on lock_in_sessions;
create policy "lock_in_sessions: read if circle-mate" on lock_in_sessions for select using (
  user_id = auth.uid() or is_circle_mate_of(user_id)
);

-- No insert/update/delete policy for regular users — every write goes through the
-- security-definer RPCs below, same server-trusted-write pattern as challenge_logs.

create or replace function start_lock_in_session(p_goal_id uuid)
returns lock_in_sessions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session lock_in_sessions;
begin
  if not exists (select 1 from goals where id = p_goal_id and user_id = auth.uid() and archived_at is null) then
    raise exception 'Goal not found.';
  end if;

  if exists (select 1 from lock_in_sessions where user_id = auth.uid() and status = 'active') then
    raise exception 'You''re already locked in — stop that session first.';
  end if;

  insert into lock_in_sessions (user_id, goal_id)
  values (auth.uid(), p_goal_id)
  returning * into v_session;

  return v_session;
end;
$$;

-- Manual-only heartbeat — per spec, there's no auto-confirm on app foreground, the user has
-- to actually tap "still here" in response to notify_stale_lock_ins()'s reminder.
create or replace function confirm_lock_in_session(p_session_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update lock_in_sessions
  set last_confirmed_at = now(), reminder_sent_at = null
  where id = p_session_id and user_id = auth.uid() and status = 'active';
end;
$$;

-- Converts an active session into a check_ins row — this insert fires the existing
-- on_check_in_insert trigger (handle_check_in_insert -> recompute_goal_streak + xp_earned)
-- and on_check_in_insert_snapshot_circles trigger (circle fan-out) automatically.
create or replace function stop_lock_in_session(
  p_session_id uuid,
  p_photo_url text default null,
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
begin
  select * into v_session from lock_in_sessions
  where id = p_session_id and user_id = auth.uid() and status = 'active';

  if v_session.id is null then
    raise exception 'Session not found or already stopped.';
  end if;

  insert into check_ins (goal_id, user_id, photo_url, caption, duration_seconds, status)
  values (
    v_session.goal_id, auth.uid(), p_photo_url, p_caption,
    greatest(extract(epoch from now() - v_session.started_at)::integer, 1),
    'on_time'
  )
  returning * into v_check_in;

  update lock_in_sessions
  set status = 'completed', ended_check_in_id = v_check_in.id
  where id = v_session.id;

  return v_check_in;
end;
$$;

-- Anti-cheese sweep — cron-only (not a trigger), same shape as notify_streaks_at_risk().
-- Two-stage: (1) an active session gone quiet for an hour gets a push asking if the user's
-- still there; (2) if they don't respond within a further grace window, the session
-- auto-finalizes crediting only time up to the LAST CONFIRMATION, not the full elapsed
-- time — this is what actually stops "left the timer running overnight" from farming XP.
create or replace function notify_stale_lock_ins()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  v_check_in check_ins;
begin
  for r in
    select id, user_id from lock_in_sessions
    where status = 'active'
      and reminder_sent_at is null
      and last_confirmed_at < now() - interval '1 hour'
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

  for r in
    select * from lock_in_sessions
    where status = 'active'
      and reminder_sent_at is not null
      and reminder_sent_at < now() - interval '20 minutes'
  loop
    insert into check_ins (goal_id, user_id, photo_url, duration_seconds, status)
    values (
      r.goal_id, r.user_id, null,
      greatest(extract(epoch from r.last_confirmed_at - r.started_at)::integer, 1),
      'on_time'
    )
    returning * into v_check_in;

    update lock_in_sessions
    set status = 'abandoned', ended_check_in_id = v_check_in.id
    where id = r.id;
  end loop;
end;
$$;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'philoi-lockin-liveness-check') then
    perform cron.unschedule('philoi-lockin-liveness-check');
  end if;
end $$;

select cron.schedule(
  'philoi-lockin-liveness-check',
  '*/5 * * * *',
  $$select notify_stale_lock_ins();$$
);
