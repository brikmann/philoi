-- ══════════════════════════════════════════════════════════════════════════════════════════════
-- 0157 · A GOAL IS COUNTED IN ITS OWN UNIT.
--
-- 🔴 Noah's Personal tab: a goal called "Cold plunges" reading **0 / 1 bath**.
--
-- `challenges.unit` is a free text column rendered straight into "<progress> / <target> <unit>",
-- and it has always been whatever the writer said it was. There are two writers:
--
--   · the create form, which picks the unit from PERSONAL_TYPE_OPTIONS. Correct — but only because
--     that table and the metric happen to agree, with nothing enforcing it;
--   · Cindy's `create_challenge` tool, whose schema hands the MODEL a freeform `unit` string
--     ("What the target counts, e.g. hours, sessions, km") and whose executor passed it through
--     with a fallback of 'hours'. Asked for a cold-plunge goal, a model is free to answer "bath",
--     and nothing between it and the row disagreed.
--
-- ─────────────────────────── THE RULE ───────────────────────────
--
-- For a BUILT-IN metric the unit is not a matter of opinion. A steps goal counts steps; a distance
-- goal counts kilometres. That is a property of the metric, so the metric decides it and no writer
-- can drift — including one that never loads the client's own canonicalGoalUnit().
--
-- For a CUSTOM goal the unit stays the user's own word, because nobody is better placed to name
-- what they are counting. Two things are corrected there and nothing else:
--
--   · an EMPTY unit, which renders as a bare "0 / 1". It falls back to the goal's own name, so
--     "Cold plunge" reads "0 / 1 cold plunge" rather than "0 / 1";
--   · a CADENCE used as a unit. Prod holds a "Cold plunge" goal whose unit is literally 'day' —
--     "0 / 1 day" names nothing that is being counted, and `period` already carries the cadence.
--
-- Anything else a person chose is left alone. The 'bath' in the screenshot is not reachable by any
-- rule (see the named repair at the bottom of this file for why), so it is fixed as data.
--
-- BEFORE INSERT OR UPDATE, not a check constraint. A constraint would REFUSE the write, which
-- turns a cosmetic mismatch into a failed goal creation for the user in front of it; and it could
-- not be added at all while prod holds rows that violate it. Normalising is the right severity for
-- "this word is wrong", and it also repairs a row the moment anything touches it.
--
-- 🔒 NOTHING HERE PAYS OR MEASURES ANYTHING. `unit` is a display string: no feeder, no reward and
-- no settlement reads it. The one place a unit has ever had arithmetic behind it is the
-- time-counted custom goal, where the TARGET is in hours (0113/0117) — and that is decided by
-- count_mode, which this file does not touch.
-- ══════════════════════════════════════════════════════════════════════════════════════════════

-- The server-side twin of CHALLENGE_TYPE_UNIT in src/lib/goal-types.ts. Neither derives the other
-- and they are meant to be read together when a metric is added — the same relationship
-- challenge_metric_value and challenge-metric.ts have, and for the same reason: one decides, the
-- other names.
--
-- An UNRECOGNISED type returns null and the row keeps whatever it was given. A metric added to the
-- type constraint but not to this function must not have its unit silently blanked; a wrong-looking
-- word is a much smaller problem than an empty one.
create or replace function canonical_goal_unit(p_type text, p_unit text, p_label text)
returns text
language sql
immutable
as $$
  select coalesce(
    case p_type
      when 'steps'            then 'steps'
      when 'run_distance'     then 'km'
      when 'ride_distance'    then 'km'
      when 'gym_visits'       then 'visits'
      when 'study_hours'      then 'hours'
      when 'workout_minutes'  then 'minutes'
      when 'strain'           then 'strain'
      when 'sleep_hours'      then 'hours'
      -- 'custom' and anything unrecognised: keep the writer's word — nobody is better placed to
      -- name what they are counting — with exactly one exception.
      --
      -- A CADENCE IS NEVER A UNIT. Prod holds a goal called "Cold plunge" whose unit is literally
      -- 'day': the model answering Cindy's tool filled the unit field with the goal's frequency,
      -- and "0 / 1 day" describes nothing that is being counted. This is a category error rather
      -- than a matter of taste — `period` already carries the cadence, and the unit answers a
      -- different question — so it is the one custom value that gets overruled, falling through to
      -- the label below.
      else case
        when lower(btrim(coalesce(p_unit, ''))) in
             ('day', 'days', 'daily', 'week', 'weeks', 'weekly',
              'month', 'months', 'monthly', 'once', 'today', 'period')
          then null
        else nullif(btrim(coalesce(p_unit, '')), '')
      end
    end,
    -- The label, lowercased: it is being used mid-sentence as a noun, not as a title, and
    -- "0 / 1 Cold Plunge" reads like a proper noun.
    nullif(lower(btrim(coalesce(p_label, ''))), ''),
    nullif(btrim(coalesce(p_unit, '')), ''),
    'done');
$$;

comment on function canonical_goal_unit(text, text, text) is
  '0157 — what a goal is counted in. A built-in metric''s unit is fixed by the metric; a custom goal keeps its owner''s word and falls back to its own name. Server-side twin of canonicalGoalUnit() in src/lib/goal-types.ts.';

create or replace function challenges_normalise_unit()
returns trigger
language plpgsql
as $$
begin
  new.unit := canonical_goal_unit(new.type, new.unit, new.label);
  return new;
end;
$$;

drop trigger if exists challenges_normalise_unit on challenges;
create trigger challenges_normalise_unit
  before insert or update of type, unit, label on challenges
  for each row execute function challenges_normalise_unit();

-- ─────────────────────────── the rows already on the tab ───────────────────────────
--
-- The trigger only fires on a write, and Noah is looking at rows nobody is about to write to. This
-- corrects them once.
--
-- NARROW ON PURPOSE. Only rows whose unit actually disagrees with what the metric counts, so a
-- custom goal somebody named themselves is untouched and this is a no-op on a second run. A
-- built-in goal already reading 'steps' is not rewritten to 'steps'.
--
-- 🔒 A retired goal (0156) is deliberately included: it is frozen against PROGRESS, not against
-- being spelled correctly, and challenges_freeze_retired_goal pins only progress and completed_at.
update challenges c
   set unit = canonical_goal_unit(c.type, c.unit, c.label)
 where c.unit is distinct from canonical_goal_unit(c.type, c.unit, c.label);

-- ─────────────────────────── the one Noah actually reported ───────────────────────────
--
-- A NAMED REPAIR, not a rule, and it is worth being explicit about why it is not a rule.
--
-- The screenshot is "Cold plunges · 0 / 1 bath". The rule above cannot fix that one: 'bath' is a
-- real noun, correctly spelled, and for a CUSTOM goal the unit is the owner's own word — there is
-- no general test that distinguishes "bath is the wrong noun for a cold plunge" from "pages is the
-- right noun for Read Dune". Any heuristic broad enough to catch the first would rewrite the
-- second, which is a worse outcome than the bug.
--
-- So the rule handles the class it genuinely can (a built-in metric's unit is fixed by the metric;
-- a cadence is never a unit), and these rows — reported by a human, looked at, and corrected by
-- hand — are handled as data. On prod today this is 4 rows across 2 labels, all one user's:
--
--   030d6d3d 'Cold plunge' bath  ·  aded114f 'Cold plunge' bath  (both active)
--   e5442e10 'Cold plunge' bath  ·  eea74a9e 'Plunge'      Bath  (both completed, in History)
--
-- Matched on the pair, not on the unit alone: a goal genuinely counting baths ("2 ice baths a
-- week") keeps its word, because its label says bath too.
update challenges c
   set unit = 'plunges'
 where c.label ilike '%plunge%'
   and lower(btrim(coalesce(c.unit, ''))) in ('bath', 'baths');

-- ─────────────────────────── self-assertion ───────────────────────────
--
-- The claim is that the RULE is live on the table, not that a function by that name exists. Both
-- halves are exercised through a real insert and rolled back.
do $assert$
declare
  v_user uuid;
  v_id uuid;
  v_unit text;
  v_stale int;
begin
  -- Every row now agrees with the rule. If this fails, the backfill above did not run or the
  -- function disagrees with itself.
  select count(*) into v_stale
  from challenges c
  where c.unit is distinct from canonical_goal_unit(c.type, c.unit, c.label);

  if v_stale > 0 then
    raise exception '0157: % goal(s) are still counted in a unit their metric does not use.', v_stale;
  end if;

  -- NOT simply the oldest profile. The probe below inserts a weekly STEPS goal, and 0148's
  -- duplicate guard would refuse it for anyone who already has one — which would abort this
  -- migration inside its own assertion, the exact failure mode MIGRATIONS.md's "assertions must be
  -- reachable" section is about. Picking a user with no such goal is what makes the probe run.
  select p.id into v_user
  from profiles p
  where not exists (
    select 1 from challenges c
    where c.user_id = p.id and c.type = 'steps' and c.period = 'week'
      and c.completed_at is null and c.retired_at is null)
  order by p.created_at
  limit 1;

  if v_user is null then
    raise notice '0157: no profile without an active weekly steps goal; the trigger was not exercised by insert (the whole-table check above still passed).';
    return;
  end if;

  begin
    -- The exact shape of the bug: a built-in metric handed somebody else's noun.
    insert into challenges (user_id, type, label, target, unit, period, count_mode)
    values (v_user, 'steps', '0157 probe', 10000, 'bath', 'week', 'manual')
    returning id into v_id;

    select unit into v_unit from challenges where id = v_id;
    if v_unit <> 'steps' then
      raise exception '0157: a steps goal was stored counted in "%". The trigger is not attached.', v_unit;
    end if;

    raise exception 'ok';
  exception
    when others then
      if sqlerrm <> 'ok' then
        raise;
      end if;
  end;
end;
$assert$;
