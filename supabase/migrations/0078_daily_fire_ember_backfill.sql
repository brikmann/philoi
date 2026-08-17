-- Pay the daily fires that completed before the economy existed (Ember pass §4).
--
-- This is NOT two currencies being merged. `daily_fire` completion has always been meant to pay
-- embers into `ember_wallet` — the `daily_fire_economy` trigger in 0065 does exactly that. The gap
-- is purely chronological: fires completed BEFORE 0065 reached this database never fired that
-- trigger, so the achievement happened and the payout didn't.
--
-- MEASURED, not estimated. At the time of writing, on the live project:
--     9 completed daily_fire rows, 3 flame_meter grants in ember_ledger  →  6 unpaid fires
--     6 × 50 = 300 embers owed, across 2 users
-- (The handoff estimated ~25. That figure looks like it came from `profiles.embers`, which totals
-- 50 — a legacy counter that is not this. See the note on reconciliation below.)
--
-- WHY PER-USER TOTALS RATHER THAN PER-FIRE. The trigger calls economy_move_embers with a NULL
-- ref_id, so the three grants already on file cannot be matched back to the specific fires that
-- earned them — and `daily_fire` has no id column to match on anyway (its key is user_id + day).
-- Paying "every completed fire without a matching grant" would therefore re-pay all three. So this
-- reconciles the TOTAL: what the user should have been paid, minus what they actually were.

-- Idempotency marker. A deterministic per-user uuid means a second run of this migration finds its
-- own ledger row and does nothing — which matters because a backfill that double-pays is
-- indistinguishable from a backfill that worked, right up until someone audits the wallet.
create or replace function daily_fire_backfill_ref(p_user uuid)
returns uuid
language sql
immutable
as $$
  select md5('daily_fire_backfill:' || p_user::text)::uuid;
$$;

do $$
declare
  v_rate int := coalesce(((select value from economy_config where key = 'ember_earn') ->> 'flame_meter')::int, 50);
  r record;
  v_owed int;
  v_paid int := 0;
  v_users int := 0;
begin
  for r in
    select
      df.user_id,
      count(*) filter (where df.completed) as completed_fires,
      coalesce((
        select sum(el.delta) from ember_ledger el
        where el.user_id = df.user_id and el.reason = 'flame_meter'
      ), 0) as already_paid
    from daily_fire df
    where df.completed
    group by df.user_id
  loop
    -- Already backfilled on a previous run → skip entirely.
    if exists (
      select 1 from ember_ledger
      where user_id = r.user_id and ref_id = daily_fire_backfill_ref(r.user_id)
    ) then
      continue;
    end if;

    v_owed := (r.completed_fires * v_rate) - r.already_paid;

    -- Never claw back. If a user somehow received MORE than the flat rate implies (a rate change,
    -- a manual grant), that is not this migration's business to reverse — a backfill that can
    -- subtract is a backfill that can take embers someone already spent.
    if v_owed <= 0 then
      continue;
    end if;

    perform economy_move_embers(r.user_id, v_owed, 'flame_meter', daily_fire_backfill_ref(r.user_id));
    v_paid := v_paid + v_owed;
    v_users := v_users + 1;
  end loop;

  raise notice 'daily-fire backfill: % embers paid to % user(s)', v_paid, v_users;
end $$;


-- ── stop the gap reopening ──
--
-- The trigger was `after update of completed`, which cannot fire for a row INSERTED already
-- complete. get_or_create_daily_fire creates the row incomplete today, so this has never bitten —
-- but it is one refactor away from silently reintroducing exactly the orphans backfilled above.
-- Widening to INSERT OR UPDATE costs nothing: the guard below already refuses anything that isn't
-- a false→true transition, and on INSERT there is no OLD row, so `coalesce(old.completed, false)`
-- reads false and a row born complete pays exactly once.
create or replace function economy_on_flame_meter_complete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not new.completed or coalesce(old.completed, false) then
    return new;
  end if;
  perform economy_move_embers(
    new.user_id,
    ((select value from economy_config where key = 'ember_earn') ->> 'flame_meter')::int,
    'flame_meter',
    null
  );
  return new;
end;
$$;

drop trigger if exists daily_fire_economy on daily_fire;
create trigger daily_fire_economy
  after insert or update of completed on daily_fire
  for each row execute function economy_on_flame_meter_complete();
