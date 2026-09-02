-- ══════════════════════════════════════════════════════════════════════════════════════════════
-- 0155 · A GOAL YOU FINISH ONCE.
--
-- Noah: "On the goal create screen you can only pick Daily or Weekly — every goal is forced to
-- recur." Which makes "run a half marathon", "read Dune", "1000 push-ups" unexpressible: each of
-- them is a single target you either reach or don't, and both existing cadences reset the counter
-- underneath it — daily at the owner's midnight, weekly at Sunday 00:00 UTC.
--
-- ─────────────────────────── WHAT A 'once' CADENCE IS ───────────────────────────
--
--   · it has ONE window, which opens at creation and never closes;
--   · nothing resets it — not the local-midnight sweep, not the weekly boundary;
--   · when progress reaches the target it completes, and it stays completed.
--
-- The pleasing part is how little has to change for that to be true. roll_over_challenges (0084)
-- is the ONLY thing that resets a goal, and its query already enumerates the two recurring
-- cadences positively:
--
--     where (c.period = 'day'  and c.period_start < <owner's local date>)
--        or (c.period = 'week' and c.period_start < <utc week start>)
--
-- A third value simply never matches either arm, so it never rolls, never archives and never
-- zeroes. The reset logic "skips it" by construction rather than by a new special case — which is
-- the shape a third enum member should have, and the reason this migration is mostly a widened
-- constraint rather than a new branch. The function is left BYTE-UNTOUCHED on purpose: restating a
-- payout-adjacent sweep to add a condition that changes nothing is how a transcription error gets
-- into prod, and this repo has been bitten by exactly that (0127's header, 0145's).
--
-- ─────────────────────────── WHAT ELSE READS `period`, AND WHY EACH IS FINE ───────────────────────────
--
--   economy_on_challenge_completed (0065) and the goal drip (0085, 0116)
--       `v_scale := case when v_goal.period = 'week' then 7 else 1 end` — the duration a reward is
--       rated over. 'once' takes the `else` and rates as one day.
--
--       DELIBERATE, and deliberately the CONSERVATIVE side. A one-time goal has no principled
--       duration at all: "1000 push-ups" might be a week's work or a term's, and the row records
--       no span to read. Rating it as 1 pays it like a daily goal, which is the floor. Rating it
--       as 7 — or worse, as the age of the row — would let someone bank a large one-off payout by
--       setting a goal, waiting, and finishing it. Reward tuning for one-time goals is a decision
--       with an economy behind it, and it is not this migration's to make.
--
--   challenges_block_duplicate_active_goal (0148)
--       keys on (user, source, period), so a 'once' goal clashes only with another 'once' goal on
--       the same source. "1000 push-ups, one-time" alongside "50 push-ups daily" stays legal, and
--       it should: they are different windows on the same work, which is the same reason 0148
--       already allows daily alongside weekly.
--
--   fitness-challenge-sync (client)
--       `periodStartInstant` treats anything that is not 'day' as a bare date, which for a
--       never-rolling goal is its creation day — i.e. the sync window is [created, now], which is
--       exactly the window a one-time goal is measured over.
--
-- 🔒 NO ECONOMY CHANGE, NO BACKFILL. Every existing row keeps the cadence it has; nothing is
-- re-rated, re-paid or re-dated. This widens two constraints and adds nothing that runs.
-- ══════════════════════════════════════════════════════════════════════════════════════════════

-- ─────────────────────────── 1 · challenges.period admits 'once' ───────────────────────────
--
-- `challenges` predates this migration folder, so the constraint that guards `period` was created
-- by the baseline schema and its NAME is not knowable from any file in this repo. Hardcoding a
-- guess and dropping it would either fail loudly (fine) or silently drop the wrong constraint (not
-- fine), so the name is read out of the catalog instead.
--
-- Narrow on purpose: only a CHECK constraint on `challenges` whose expression mentions `period`
-- and does NOT already admit 'once'. A repeat run finds nothing to do and leaves the widened
-- constraint alone, which is what makes this file re-runnable.
do $widen$
declare
  r record;
  v_found boolean := false;
begin
  for r in
    select c.conname, pg_get_constraintdef(c.oid) as def
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public'
      and t.relname = 'challenges'
      and c.contype = 'c'
      and pg_get_constraintdef(c.oid) ilike '%period%'
  loop
    if r.def ilike '%''once''%' then
      raise notice '0155: % already admits ''once'' — leaving it alone.', r.conname;
      v_found := true;
      continue;
    end if;
    -- Only a constraint that is actually an enumeration of the cadence is replaced. Anything else
    -- mentioning `period` (a period_start sanity check, say) is left standing — this must not
    -- become a blanket "drop every check that says period".
    if r.def ilike '%''day''%' and r.def ilike '%''week''%' then
      raise notice '0155: widening % (was %).', r.conname, r.def;
      execute format('alter table challenges drop constraint %I', r.conname);
      v_found := true;
    end if;
  end loop;

  if not v_found then
    raise notice '0155: no cadence CHECK found on challenges — adding one.';
  end if;
end;
$widen$;

-- Re-added under a known name, so the next session that has to widen this does not have to
-- introspect for it. `not valid` is NOT used: every existing row is 'day' or 'week' and therefore
-- already satisfies this, so a full validation scan is free and a validated constraint is the one
-- the planner can actually rely on.
alter table challenges drop constraint if exists challenges_period_check;
alter table challenges add constraint challenges_period_check
  check (period in ('day', 'week', 'once'));

comment on constraint challenges_period_check on challenges is
  '0155 — the three cadences. ''once'' is a single non-recurring target: roll_over_challenges enumerates ''day'' and ''week'' positively, so a ''once'' goal is never rolled, never archived and never zeroed.';

-- ─────────────────────────── 2 · the archive admits it too ───────────────────────────
--
-- A 'once' goal never rolls, so nothing will ever WRITE a challenge_periods row with this cadence
-- — the rollover is the only writer and its query cannot select one. The constraint is widened
-- anyway, for one reason: the day somebody adds a "close out my one-time goals at term end" job,
-- the failure would be a constraint violation deep inside a nightly cron rather than an obvious
-- refusal at the call site. Widening it costs nothing and removes a trap.
alter table challenge_periods drop constraint if exists challenge_periods_period_check;
alter table challenge_periods add constraint challenge_periods_period_check
  check (period in ('day', 'week', 'once'));

-- ─────────────────────────── 3 · self-assertion ───────────────────────────
--
-- Not "the constraint exists" — that is what step 1 just wrote. This proves the value is genuinely
-- accepted END TO END through the real table, with the real triggers attached (0148's duplicate
-- guard among them), and then rolls the probe back so this migration leaves no goal behind.
do $assert$
declare
  v_user uuid;
  v_id uuid;
begin
  select id into v_user from profiles order by created_at limit 1;
  if v_user is null then
    raise notice '0155: no profiles on this database; the round trip was not exercised.';
    return;
  end if;

  begin
    insert into challenges (user_id, type, label, target, unit, period, count_mode)
    values (v_user, 'custom', '0155 probe · one-time', 1, 'probe', 'once', 'manual')
    returning id into v_id;

    if v_id is null then
      raise exception '0155: a one-time goal did not insert.';
    end if;

    -- The rollover must not be able to see it. This is the actual behavioural claim of the file —
    -- "does not reset at midnight/Sunday" — and it is checkable without waiting for a cron.
    if exists (
      select 1 from challenges c
      join profiles p on p.id = c.user_id
      where c.id = v_id
        and ((c.period = 'day'  and c.period_start < user_local_date(coalesce(p.timezone, p.notification_prefs ->> 'timezone')))
          or (c.period = 'week' and c.period_start < (week_start() at time zone 'UTC')::date))
    ) then
      raise exception '0155: a one-time goal matched roll_over_challenges'' selection. It would reset.';
    end if;

    -- Rolled back whatever happened above. The probe is a test, not a goal somebody now owns.
    raise exception 'ok';
  exception
    when others then
      if sqlerrm <> 'ok' then
        raise;
      end if;
  end;
end;
$assert$;
