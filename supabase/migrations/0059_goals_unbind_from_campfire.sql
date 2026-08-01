-- Individual goals are no longer bound to a single campfire.
--
-- A goal is just the user's own thing. Sharing is decided PER LOCK-IN on the done screen, where
-- a check-in can already fan out to several circles at once (check_in_circles) — so a goal
-- carrying one circle_id was both weaker (one campfire only) and in the wrong place (chosen once
-- at setup, months before the work).
--
-- Two things hang off that column and both are handled here rather than left to fail at runtime:
-- plpgsql bodies aren't re-parsed when a column is dropped, so a missed reference would compile
-- fine and only blow up the first time someone logged progress.
--
--   1. log_challenge_progress() announced a completed goal into the bound campfire's feed and
--      pushed its members. With no binding there's no campfire to announce into; a lock-in
--      posted to circles is what puts goal work in front of people now.
--   2. get_challenge_leaderboard() ranked one campfire's members by their goals of a given type.
--      Its only entry point in the app was the goal card's campfire link, so unbinding retires
--      the screen with it.

-- ───────────────────────────── 1. log_challenge_progress ─────────────────────────────
-- DROP first, not create-or-replace: circle_id leaves the RETURNS TABLE shape, and Postgres
-- rejects a replace that changes the return type ("cannot change return type of existing
-- function"). Same trap this project has hit before with notify_push.

drop function if exists log_challenge_progress(uuid, numeric, text);

create function log_challenge_progress(p_challenge_id uuid, p_amount numeric, p_note text default null)
returns table (
  id uuid,
  user_id uuid,
  type text,
  label text,
  target numeric,
  unit text,
  period text,
  progress numeric,
  visibility text,
  period_start date,
  completed_at timestamptz,
  created_at timestamptz,
  just_completed boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_challenge challenges;
  v_was_complete boolean;
begin
  select * into v_challenge from challenges where challenges.id = p_challenge_id and challenges.user_id = auth.uid();
  if v_challenge.id is null then
    raise exception 'Challenge not found.';
  end if;

  insert into challenge_logs (challenge_id, user_id, amount, note)
  values (p_challenge_id, auth.uid(), p_amount, p_note);

  v_was_complete := v_challenge.completed_at is not null;

  update challenges
  set progress = challenges.progress + p_amount,
      completed_at = case
        when challenges.completed_at is null and challenges.progress + p_amount >= challenges.target then now()
        else challenges.completed_at
      end
  where challenges.id = p_challenge_id
  returning * into v_challenge;

  return query select
    v_challenge.id, v_challenge.user_id, v_challenge.type, v_challenge.label,
    v_challenge.target, v_challenge.unit, v_challenge.period, v_challenge.progress, v_challenge.visibility,
    v_challenge.period_start, v_challenge.completed_at, v_challenge.created_at,
    (not v_was_complete and v_challenge.completed_at is not null);
end;
$$;

-- ───────────────────────────── 2. retire the per-campfire goal leaderboard ─────────────────────────────

drop function if exists get_challenge_leaderboard(uuid, text);

-- ───────────────────────────── 3. drop the binding ─────────────────────────────

-- These three RLS policies ARE the campfire-visibility mechanism being retired, so they go with
-- the column rather than being rewritten around it: a goal is readable by its owner and nobody
-- else now. ("challenges: read own" / "update own" / "delete own" already cover the owner, and
-- challenge_logs keeps its own read-own policy.) Postgres refuses to drop a column any policy
-- still references, which is what stopped the first run of this migration.
drop policy if exists "challenges: read circle if visible" on challenges;
drop policy if exists "challenge_logs: read circle if visible" on challenge_logs;
drop policy if exists "challenges: insert own" on challenges;
create policy "challenges: insert own" on challenges for insert with check (user_id = auth.uid());

drop index if exists challenges_circle_idx;
alter table challenges drop column if exists circle_id;

-- Nothing left to be "visible to a circle" — the column stays for the historical rows that
-- carry it, but a new goal is private to its owner unless a lock-in posts it somewhere.
alter table challenges alter column visibility set default 'private';

comment on column challenges.visibility is
  'Historical. Goals are personal as of 0059; sharing is per-lock-in (check_in_circles), not a property of the goal.';
