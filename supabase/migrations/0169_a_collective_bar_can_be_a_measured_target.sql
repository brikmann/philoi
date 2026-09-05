-- ══════════════════════════════════════════════════════════════════════════════════════════════
-- A COLLECTIVE GOAL'S BAR CAN BE A MEASURED TARGET — "everyone lifts 10,000 lb"
--
-- Noah: "in collective we need races based on distance, volume, custom, etc, same as placement."
--
-- WHAT WAS ACTUALLY MISSING. The create screen offered a collective goal exactly two bars: a count
-- of lock-ins (race_metric null + target_count) and a grade (race_metric 'grade' + grade_target).
-- A placement race on the same campfire could already be run on volume or distance, because a
-- placement race has no bar at all — it RANKS the field, and ranking needs only a metric. A
-- collective goal is the other shape: its premise is the whole house clearing the SAME bar, so
-- adding volume/distance to it needs the one thing placement never needed — somewhere to put the
-- number everybody has to reach.
--
-- So this is not "teach collective about metrics". challenge_racer_score has scored volume and
-- distance since 0098 and its `else` arm already does the right thing for them
-- (challenge_metric_value, net of the baseline taken at the gun). The gap is one column, and the
-- completion test that reads it.
--
-- WHY NOT REUSE grade_target. It is numeric and unconstrained, so "10000" would physically fit. It
-- is also read by name in the settle path, the card, the share card and the report-your-mark RPC,
-- all of which mean "a mark out of 100" — challenge_participants_reported_range constrains the
-- reported side to 0..100 outright. Overloading it would make every one of those surfaces silently
-- wrong for a volume goal, and whoever debugged it would first have to learn that "grade"
-- sometimes means pounds. A second column is cheaper than that ambiguity.
--
-- ⚠️ WHAT THIS DELIBERATELY DOES NOT TOUCH:
--   · create_placement_challenge — the brief says so and the reasoning holds: placement settles by
--     rank, this changes what "done" means for a bar, and the two share no code here.
--   · the lock-in-count collective path — race_metric stays NULL and target_count stays its bar,
--     byte for byte. Every collective goal live on prod today is that shape, and the completion
--     arm it runs through is untouched below.
--   · challenge_racer_score — no change. Its `else` arm is already correct for volume/distance,
--     and restating it here is exactly the "CREATE OR REPLACE from an older base" that has
--     silently reverted a sibling branch's work in this repo before.
-- ══════════════════════════════════════════════════════════════════════════════════════════════

-- ─────────────────────────── §1 · somewhere to put the number ───────────────────────────

alter table social_challenges
  add column if not exists target_value numeric;

comment on column social_challenges.target_value is
  '0169 — the bar for a COLLECTIVE goal measured in a real metric ("everyone lifts 10,000 lb"), in that metric''s own raw units: pounds for volume, METRES for distance (challenge_metric_value sums check_ins.distance_m). Non-null exactly when the bar is neither a lock-in count nor a grade.';

-- ─────────────────────────── §2 · exactly one bar, now out of three ───────────────────────────
--
-- Restated in full because a CHECK cannot be appended to. The shape is unchanged — "a group
-- challenge has exactly one bar" — it just counts to one across three columns instead of two.
--
-- No existing row can violate it: target_value is null everywhere as of this statement, so every
-- group row still resolves to the single non-null bar it had a moment ago.
do $$
begin
  alter table social_challenges drop constraint if exists social_challenges_mode_target_check;
  alter table social_challenges add constraint social_challenges_mode_target_check check (
    case
      when shape = 'placement' then target_count is null and target_value is null
      when mode = 'group' then
        (target_count is not null)::int
      + (grade_target is not null)::int
      + (target_value is not null)::int = 1
      else target_count is null and target_value is null
    end
  );
end $$;

-- ─────────────────────────── §3 · create_group_challenge learns the third bar ───────────────────────────
--
-- 🔴 DROPPED BY ITS EXACT OLD SIGNATURE FIRST, NOT REPLACED. This is 0146's lesson and the single
-- most expensive mistake available in this file: appending a parameter to a plpgsql function does
-- NOT replace it, it creates a second overload alongside it. PostgREST then resolves a
-- named-argument call against whichever overload matches the keys it was sent — so the old body
-- would keep serving every existing caller and this migration would appear to have done nothing.
--
-- The two new parameters are appended WITH DEFAULTS, so the client's existing named call (which
-- has never sent p_payout_xp either) still resolves against the new function unchanged.
drop function if exists create_group_challenge(
  uuid, int, int, int, text, timestamptz, timestamptz, numeric, text
);

create or replace function create_group_challenge(
  p_circle_id uuid,
  p_target_count int,
  p_window_hours int,
  p_payout_xp int default 300,
  p_public_name text default null,
  p_starts_on timestamptz default null,
  p_ends_on timestamptz default null,
  p_grade_target numeric default null,
  p_course_code text default null,
  p_race_metric text default null,
  p_target_value numeric default null
)
returns social_challenges
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_challenge social_challenges;
  v_metric text;
begin
  perform assert_challenge_span(p_starts_on, p_ends_on);

  if not is_group_member(p_circle_id) then
    raise exception 'Not a member of that campfire.';
  end if;

  -- 0162 — hosting for the whole campfire is an admin act. Checked after membership so a
  -- non-member still gets the more accurate of the two sentences. Carried forward verbatim.
  if not is_campfire_admin(p_circle_id, auth.uid()) then
    raise exception 'You''re not an admin of %, so a challenge can''t be posted there.',
      coalesce((select g.name from groups g where g.id = p_circle_id), 'that campfire');
  end if;

  -- Exactly one bar, matching social_challenges_mode_target_check. Caught here as well as by the
  -- constraint so the caller gets a sentence rather than a constraint name.
  if (p_target_count is not null)::int
   + (p_grade_target is not null)::int
   + (p_target_value is not null)::int <> 1 then
    raise exception 'A collective goal needs exactly one bar: a lock-in count, a grade, or a target value.';
  end if;

  -- 🔒 THE METRIC IS VALIDATED, NOT TRUSTED. p_race_metric is written straight into the column
  -- whose value decides which arm of challenge_racer_score runs, so an unrecognised name would
  -- fall through to the accumulating `else` arm and be scored by challenge_metric_value against a
  -- metric it does not know — silently zero, for everyone, forever.
  --
  -- Only the two AUTO-TRACKED accumulating metrics are legal here. 'grade' has its own column and
  -- its own arm; 'count' is host_campfire_challenge's shape and carries count_unit; 'lockin_time'
  -- as a measured target would be a second, subtly different spelling of the lock-in-count goal
  -- this file is careful not to disturb; 'ai' and 'xp' are not creatable.
  if p_target_value is not null then
    if coalesce(p_race_metric, '') not in ('volume', 'distance') then
      raise exception 'A measured collective target must be on volume or distance.';
    end if;
    if p_target_value <= 0 then
      raise exception 'A collective target has to be more than zero.';
    end if;
  end if;

  v_metric := case
    when p_grade_target is not null then 'grade'
    when p_target_value is not null then p_race_metric
    -- ← THE UNTOUCHED PATH. A lock-in-count collective goal still stores race_metric NULL, which
    --   is what routes it to challenge_racer_score's null arm and its count of qualifying
    --   check-ins. Nothing about that shape changes.
    else null
  end;

  insert into social_challenges (circle_id, created_by, mode, target_count, window_hours, payout_xp, status, starts_at, ends_at, public_name, shape, starts_on, ends_on, race_metric, grade_target, course_code, target_value)
  values (p_circle_id, auth.uid(), 'group', p_target_count, p_window_hours, p_payout_xp, 'draft', null, null, nullif(btrim(coalesce(p_public_name, '')), ''), 'collective', p_starts_on, p_ends_on,
          v_metric,
          p_grade_target, nullif(btrim(coalesce(p_course_code, '')), ''), p_target_value)
  returning * into v_challenge;

  -- ← RESTORED FROM 0112 by 0147. See that file's header; carried forward verbatim.
  insert into challenge_participants (challenge_id, user_id, state, responded_at)
  values (v_challenge.id, auth.uid(), 'accepted', now())
  on conflict (challenge_id, user_id) do nothing;

  return v_challenge;
end;
$function$;

grant execute on function create_group_challenge(
  uuid, int, int, int, text, timestamptz, timestamptz, numeric, text, text, numeric
) to authenticated;

-- ─────────────────────────── §4 · "did this racer clear the bar" gains an arm ───────────────────────────
--
-- 🔴 THIS IS THE ARM THAT MAKES IT CORRECT RATHER THAN INSTANT. Without it a volume goal falls to
-- the else branch below, which reads `coalesce(target_count, 1)` — and target_count is NULL on a
-- measured goal, so the bar would be 1. The first pound anybody lifted would complete the
-- challenge for them, and the sweep would settle the whole campfire the moment one person opened
-- the gym tracker.
--
-- Ordered grade → value → count. Grade keeps its own column and must be tested first; the count
-- arm stays last and untouched, which is what leaves every live collective goal scoring exactly as
-- it does today.
create or replace function challenge_racer_completed(p_challenge_id uuid, p_user uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select case
    when c.race_metric = 'grade' then challenge_racer_score(c.id, p_user) >= c.grade_target
    when c.target_value is not null then challenge_racer_score(c.id, p_user) >= c.target_value
    else challenge_racer_score(c.id, p_user) >= coalesce(c.target_count, 1)
  end
  from social_challenges c
  where c.id = p_challenge_id;
$$;

grant execute on function challenge_racer_completed(uuid, uuid) to authenticated;

-- ─────────────────────────── PROOF, NOT ASSERTION-BY-COMMENT ───────────────────────────
--
-- MIGRATIONS.md asks that a migration ship something a later session can re-run to prove it did
-- what its header claims. Re-runnable, read-only, and each check fails loudly rather than
-- returning a row that a skim would read as success.
do $$
declare
  v_n int;
begin
  -- 1 · exactly ONE create_group_challenge. Two means the drop above missed an overload and the
  --     old body is still serving callers — the failure mode §3 exists to prevent.
  select count(*) into v_n
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'create_group_challenge';
  if v_n <> 1 then
    raise exception '0169: expected exactly 1 create_group_challenge, found %', v_n;
  end if;

  -- 2 · that one function really does carry the two new parameters.
  select count(*) into v_n
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'create_group_challenge'
    and pg_get_function_identity_arguments(p.oid) like '%text, numeric';
  if v_n <> 1 then
    raise exception '0169: create_group_challenge does not carry p_race_metric/p_target_value';
  end if;

  -- 3 · the completion test actually reads the new column. A migration that added the column and
  --     the constraint but lost the arm would settle a volume goal on its first rep.
  select count(*) into v_n
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'challenge_racer_completed'
    and p.prosrc like '%target_value%';
  if v_n <> 1 then
    raise exception '0169: challenge_racer_completed does not test target_value';
  end if;

  -- 4 · no live row was broken by the tightened constraint.
  select count(*) into v_n from social_challenges
  where mode = 'group' and coalesce(shape, '') <> 'placement'
    and ((target_count is not null)::int + (grade_target is not null)::int + (target_value is not null)::int) <> 1;
  if v_n <> 0 then
    raise exception '0169: % group challenges do not carry exactly one bar', v_n;
  end if;
end $$;
