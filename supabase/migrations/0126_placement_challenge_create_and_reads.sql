-- 0126 — the third shape finally exists: create a placement race, and read one.
--
-- CODE_PROMPT_challenge_v2 B3, mock 114. `shape` has accepted 'placement' since 0096 and the
-- client has branched on it since 0112 — but NOTHING HAS EVER CREATED ONE, so every branch guarding
-- it is dead code and the column has exactly two values in practice. This file is the create path
-- and the read paths; 0127 is settlement.
--
-- WHAT A PLACEMENT RACE IS (mock 114): a prof/admin in a course campfire sets "Most lock-in time
-- for the semester" and the whole class races. Everyone gets a rank, 1..N. Rewards scale by
-- percentile band, not by winning. The mock's own summary: "Admin-run. The prof/admin sets it and
-- starts it; students auto-enter by being in the course campfire."
--
-- IT RIDES mode = 'group'. Not a third mode. 0096 kept `shape` as a separate column precisely so
-- that "every existing query filtering mode = 'h2h' must keep meaning duel" — and the corollary is
-- that every query filtering mode = 'group' should keep matching a campfire-wide race, which a
-- placement race is. get_group_challenge_watch, the settle sweep's else-arm, the cheer path, the
-- card's member_count: all of them are already reachable. A third mode value would have made every
-- one of them silently stop matching, which is the exact failure 0096's status-vocabulary section
-- was written about.
--
-- ONE DENOMINATOR, AS ALWAYS. The roster below is real challenge_participants rows, so
-- challenge_field returns them with real baselines rather than falling through to its legacy
-- whole-campfire arm with baseline 0. Settlement, the completion test and the standings keep
-- agreeing because they keep asking the same function.

-- ───────────────────── 1 · a placement race has no per-member target ─────────────────────
--
-- 0019: `check ((mode = 'group') = (target_count is not null))`. A collective goal IS a target
-- count, so that constraint is right for it and stays exactly as it was. A placement race has no
-- such thing — the field is ranked on a metric, and there is no number everyone has to reach — so
-- it is exempted rather than handed a meaningless 1.
--
-- Written as a CASE so the legacy arm is byte-for-byte the old predicate: no existing row changes
-- validity, and a collective goal that somehow lost its target still fails as loudly as before.
--
-- FOUND BY DEFINITION, NOT BY NAME. 0019 declared it as a bare table-level `check (...)`, so its
-- name is whatever Postgres generated — social_challenges_check1 on a database that applied 0019's
-- three unnamed checks in order, and something else on one that did not. Guessing that name would
-- either drop the wrong constraint or fail the migration on a differently-shaped database; matching
-- the definition finds the right one on both.
do $$
declare
  v_name text;
begin
  for v_name in
    select con.conname
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace nsp on nsp.oid = rel.relnamespace
    where nsp.nspname = 'public'
      and rel.relname = 'social_challenges'
      and con.contype = 'c'
      and pg_get_constraintdef(con.oid) like '%target_count%'
      and pg_get_constraintdef(con.oid) like '%mode%'
  loop
    execute format('alter table social_challenges drop constraint %I', v_name);
  end loop;
end $$;

alter table social_challenges add constraint social_challenges_mode_target_check check (
  case
    when shape = 'placement' then target_count is null
    else (mode = 'group') = (target_count is not null)
  end
);

-- ───────────────────────────── 2 · create one ─────────────────────────────

drop function if exists create_placement_challenge(uuid, text, int, int, text, timestamptz, timestamptz);

create function create_placement_challenge(
  p_circle_id uuid,
  p_race_metric text,
  p_window_hours int,
  p_payout_xp int default 300,
  p_public_name text default null,
  p_starts_on timestamptz default null,
  p_ends_on timestamptz default null
)
returns social_challenges
language plpgsql
security definer
set search_path = public
as $$
declare
  v_challenge social_challenges;
  v_starts timestamptz;
begin
  perform assert_challenge_span(p_starts_on, p_ends_on);

  -- ADMIN-GATED, matching start_challenge (0096). This is the one shape that conscripts an entire
  -- campfire without asking anyone, so the authority to call it has to be the campfire's own.
  if not is_campfire_admin(p_circle_id, auth.uid()) then
    raise exception 'Only campfire admins can start a placement race.';
  end if;

  if p_race_metric is null then
    raise exception 'A placement race needs a metric to rank people on.';
  end if;

  -- SCHEDULED OR IMMEDIATE, and the difference is the whole reason this is not one branch.
  --
  -- A semester race is set in August to run from September (mock 114: "Sep 8 -> Dec 12"). Starting
  -- it on creation would take every baseline in August and then credit a month of work nobody did
  -- inside the race — the exact unfairness no-auto-start (0098) and gun-time baselines (0096) were
  -- built to prevent, arriving through a different door.
  --
  -- So a future start stays a DRAFT with its roster already in place, and start_due_challenges()
  -- below fires it at the gun. A start that is null or already past goes live now, which is the
  -- ordinary case and the one mock 114's single "Start placement race" button describes.
  v_starts := coalesce(p_starts_on, now());

  insert into social_challenges (
    circle_id, created_by, mode, shape, race_metric, target_count, window_hours, payout_xp,
    status, starts_at, ends_at, public_name, starts_on, ends_on
  )
  values (
    p_circle_id, auth.uid(), 'group', 'placement', p_race_metric, null, p_window_hours, p_payout_xp,
    case when v_starts <= now() then 'active' else 'draft' end,
    case when v_starts <= now() then now() else null end,
    case when v_starts <= now() then coalesce(p_ends_on, now() + make_interval(hours => p_window_hours)) else null end,
    nullif(btrim(coalesce(p_public_name, '')), ''),
    p_starts_on, p_ends_on
  )
  returning * into v_challenge;

  -- AUTO-ENTRY: the whole campfire, already accepted. There is no invite step to skip here — being
  -- in the course campfire IS the entry (mock 114), and an 'invited' row that nobody answers would
  -- be deleted by start_challenge and quietly shrink the field a student thought they were in.
  --
  -- baseline is set in the same statement when the race is already live, and left at the column
  -- default 0 for a scheduled one — start_due_challenges / start_challenge overwrite it at the gun,
  -- which is the only moment a baseline means anything.
  insert into challenge_participants (challenge_id, user_id, state, responded_at, baseline)
  select v_challenge.id, gm.user_id, 'accepted', now(),
         case when v_challenge.status = 'active'
           then challenge_metric_value(p_race_metric, gm.user_id, now())
           else 0 end
  from group_members gm
  where gm.group_id = p_circle_id
  on conflict (challenge_id, user_id) do nothing;

  -- Told, not asked. Everyone is in it either way, so this is an announcement — and without it a
  -- student's first news of a semester-long race would be its result.
  perform notify_event(
    (select coalesce(array_agg(gm.user_id), '{}') from group_members gm
      where gm.group_id = p_circle_id and gm.user_id <> auth.uid()),
    'campfire_challenge_started',
    'You''re in a placement race',
    coalesce(v_challenge.public_name, 'A ranked race') || ' just started in your campfire.',
    null, p_circle_id,
    '/challenge-info/[challengeId]', jsonb_build_object('challengeId', v_challenge.id::text),
    null, 'rounded',
    jsonb_build_object('challenge_id', v_challenge.id, 'shape', 'placement')
  );

  return v_challenge;
end;
$$;

grant execute on function create_placement_challenge(uuid, text, int, int, text, timestamptz, timestamptz) to authenticated;

-- ───────────────────────── 3 · a scheduled race starts itself ─────────────────────────
--
-- The gun for a placement race whose starts_on is in the future. Rides the existing 10-minute
-- 'philoi-finalize-social-challenges' tick rather than adding a second schedule — a race that
-- begins up to ten minutes late begins ten minutes late for everyone at once, because every
-- baseline in it is taken by this one statement.
--
-- Deliberately narrow: `shape = 'placement'` only. A collective goal's draft is waiting on invites
-- to be ANSWERED, not on a clock, and auto-starting one would run the exact race with no accepted
-- members that 0112 was written to stop.
create or replace function start_due_challenges()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
begin
  for r in
    select * from social_challenges sc
    where sc.shape = 'placement'
      and sc.status = 'draft'
      and sc.starts_on is not null
      and sc.starts_on <= now()
    for update
  loop
    -- Baselines AT THE GUN, not at creation. This is the whole point of scheduling rather than
    -- starting early: what a racer did between August and September is not part of the semester.
    update challenge_participants p
       set baseline = challenge_metric_value(r.race_metric, p.user_id, now())
     where p.challenge_id = r.id;

    update social_challenges
       set status = 'active',
           starts_at = now(),
           ends_at = coalesce(ends_on, now() + make_interval(hours => window_hours))
     where id = r.id;
  end loop;
end;
$$;

-- Same tick as the settle sweep, and started BEFORE it in the same statement list so a zero-length
-- race cannot settle in the tick before it starts.
select cron.unschedule('philoi-finalize-social-challenges')
where exists (select 1 from cron.job where jobname = 'philoi-finalize-social-challenges');

select cron.schedule(
  'philoi-finalize-social-challenges',
  '*/10 * * * *',
  $$select start_due_challenges(); select finalize_social_challenges();$$
);

-- ───────────────────── 4 · the watch screen can read a ranked race ─────────────────────
--
-- Body is 0112's. Three changes, and the first is the load-bearing one:
--
--   1. member_progress was ALWAYS a count of qualifying check-ins — the right figure for a
--      collective goal ("2 of 5 lock-ins done") and meaningless for a placement race, which ranks
--      on a metric. A semester lock-in-time race would have drawn everyone's check-in COUNT and
--      then ranked the board on it, so the screen and the settlement would have disagreed about
--      who was winning. It now asks social_challenge_score for a placement race, which is the same
--      function settlement ranks on.
--   2. `shape` and `race_metric` join the RETURNS TABLE, because the client cannot format a value
--      it does not know the units of — the difference between "94h" and "94".
--   3. the mode filter widens to shape-aware, which is a no-op today (placement rows ARE
--      mode = 'group') and stops being one if a later shape is not.
--
-- DROP FIRST: the RETURNS TABLE gains two columns. `create or replace` cannot change a return
-- shape, and adding a name to RETURNS TABLE also changes the BODY's namespace — the trap 0099 was
-- written about, which is why every reference below is qualified.
drop function if exists get_group_challenge_watch(uuid);

create function get_group_challenge_watch(p_challenge_id uuid)
returns table (
  challenge_id uuid,
  target_count int,
  window_hours int,
  starts_at timestamptz,
  ends_at timestamptz,
  status text,
  circle_id uuid,
  circle_name text,
  public_name text,
  shape text,
  race_metric text,
  member_id uuid,
  member_name text,
  member_progress numeric,
  member_live_status text,
  member_cheers int,
  cheered_by_me boolean
)
language plpgsql
security definer
set search_path = public
stable
as $gw$
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
    p.display_name,
    case
      when v_challenge.shape = 'placement' then
        -- Net of the baseline, evaluated at the end of the window once it has passed — the same
        -- expression settlement uses (0127), so the live board and the final board cannot disagree.
        greatest(
          challenge_metric_value(v_challenge.race_metric, f.user_id,
            least(now(), coalesce(v_challenge.ends_at, now()))) - f.baseline,
          0)
      else (
        select count(*) from check_ins ci
        where ci.user_id = f.user_id and ci.removed_at is null
          and ci.created_at >= v_challenge.starts_at and ci.created_at <= coalesce(v_challenge.ends_at, now())
          and check_in_qualifies_for_challenge(ci.id)
      )::numeric
    end,
    live_status(f.user_id),
    (select count(*)::int from challenge_cheers cc
      where cc.challenge_id = p_challenge_id and cc.for_user_id = f.user_id),
    exists (select 1 from challenge_cheers cc
      where cc.challenge_id = p_challenge_id and cc.spectator_id = auth.uid() and cc.for_user_id = f.user_id)
  from challenge_field(p_challenge_id, v_challenge.circle_id) f
  join profiles p on p.id = f.user_id
  join groups g on g.id = v_challenge.circle_id;
end;
$gw$;

grant execute on function get_group_challenge_watch(uuid) to authenticated;

-- ───────────────────── 5 · what is NOT changed here, and why ─────────────────────
--
-- get_my_social_challenges (0112) computes completed_count as "members who hit target_count
-- qualifying lock-ins". For a placement race target_count is null, so that comparison is null for
-- every member and the count comes back 0 — on a race where nobody is behind, because there is
-- nothing to be done, only somewhere to place.
--
-- That is left alone DELIBERATELY. The alternative is restating a 60-line RETURNS TABLE to change
-- one CASE arm, and a transcription slip in an RPC every challenge surface reads is a worse
-- outcome than a field the client already has to branch on: the card and the info screen both need
-- a placement branch regardless (a ranked board is not "N / M done" under any figure), and inside
-- that branch completed_count is simply not read. member_count is already the field and is right.
--
-- The distinction that decides it: an unread column is harmless, a WRONG column is not. This one
-- is about to be unread.
