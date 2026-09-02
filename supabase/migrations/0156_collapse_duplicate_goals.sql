-- ══════════════════════════════════════════════════════════════════════════════════════════════
-- 0156 · THE DUPLICATE DAILIES ALREADY ON PROD GET COLLAPSED.
--
-- Noah's Personal tab, on device: a pile of near-identical daily goals. 0148 closed the door —
-- `challenges_block_duplicate_active_goal` refuses a NEW goal that would share a source with one
-- already running — but it is an INSERT trigger, and it deliberately left the rows that were
-- already there alone. Its own header says why:
--
--     "It cannot be created while prod holds the four duplicate rows above, and the only way to
--      make it creatable is to delete goals that belong to a real user — with real progress and
--      real logs — inside a migration. Those rows are reported to Noah instead. Deleting someone's
--      goal is his call, not a schema change's."
--
-- That call has now been made (CODE_PROMPT_challenge_v4 §4b: "collapse/block the duplicates").
-- This is the collapse.
--
-- ─────────────────────────── COLLAPSE, NOT DELETE ───────────────────────────
--
-- The obvious implementation is `delete from challenges where ...`, and it is the wrong one. It is
-- irreversible; `challenge_periods` cascades on delete so the goal's whole archived history goes
-- with it; and if the wrong row is picked as the loser, the user's actual progress is gone with no
-- way to tell what was there. A migration that destroys user rows to satisfy a display complaint
-- is a bad trade even when the rows are redundant.
--
-- So a duplicate is RETIRED: a new `retired_at` stamp, set on the losers. Retirement means "this
-- goal is over and no longer counts" — it is dropped from the tab, it is invisible to 0148's
-- clash check (so the user can freely create the goal again), and — the part that actually matters
-- — it can no longer accrue progress or complete, so it cannot pay. That last property is what
-- makes this a real fix for the stacking exploit's residue rather than a cosmetic hide.
--
-- ─────────────────────────── HOW THE LOSERS ARE CHOSEN ───────────────────────────
--
-- Same key 0148 enforces, so the after-state is exactly what the trigger would have permitted:
-- one active goal per (user, source, cadence), source being the TYPE for a built-in and the
-- lower(label) for a custom.
--
-- The KEEPER is the row with the most progress, ties broken by the oldest created_at. Most
-- progress, because these goals read one shared source and the highest figure is the one that
-- actually tracked it — keeping the newest would throw away a week of a user's steps in favour of
-- an empty duplicate they made yesterday. Oldest as the tiebreak, because among equals the
-- original is the one whose id is in their history.
--
-- Because the keeper holds the group's MAXIMUM progress, every row retired is one whose figure the
-- keeper already equals or exceeds — which is what "these are fed by one shared source" means in
-- practice. No progress is stranded by the collapse, and no branch has to choose between saving a
-- number and folding a row.
--
-- A COMPLETED goal is out of scope entirely, matching 0148's own predicate: `completed_at is not
-- null` is a result that has been paid, and it is not racing anything.
--
-- 🔒 NO ECONOMY CHANGE. Embers already paid to stacked goals stay paid (0148's rule, unchanged).
-- Nothing here awards, revokes or re-rates anything.
--
-- DEPENDS ON 0155 for the 'once' cadence, which the restated trigger below now names in its
-- message.
-- ══════════════════════════════════════════════════════════════════════════════════════════════

-- ─────────────────────────── 1 · somewhere for a retirement to live ───────────────────────────

alter table challenges add column if not exists retired_at timestamptz;

comment on column challenges.retired_at is
  '0156 — set when a goal is collapsed as a duplicate of another reading the same source. A retired goal is hidden from the tab, ignored by the duplicate guard, and frozen: challenges_freeze_retired_goal refuses any further progress or completion on it, so it cannot pay.';

create index if not exists challenges_active_idx
  on challenges (user_id)
  where retired_at is null;

-- ─────────────────────────── 2 · a retired goal is frozen ───────────────────────────
--
-- THE ALTERNATIVE WAS EDITING FIVE FEEDERS, AND THIS IS BETTER. Progress lands on `challenges`
-- from credit_lockin_time_goals_for (0116), the gym-set feeder (0149), the lock-in-time repair
-- path (0113), logChallengeProgress (0003/0059) and the client's device sync. Teaching each of
-- them about retirement means five `create or replace` restatements of functions that sit next to
-- the payout path — five chances to silently revert a sibling branch's amendment, which is a
-- failure this repo has had twice (0127's header, 0145's).
--
-- One BEFORE UPDATE trigger neutralises all five without touching any of them, and it cannot be
-- bypassed by a feeder nobody has written yet. A retired goal's progress and completion are
-- pinned to what they were: writes are silently held rather than raised, because a feeder looping
-- over a user's goals must not abort the whole loop — and crediting the other goals in that loop
-- is correct behaviour, not an error to report.
--
-- `completed_at` is pinned in BOTH directions. Pinning only "cannot complete" would still let the
-- rollover clear a completed retired goal back to null, which is a state change on a row that is
-- supposed to be frozen.
--
-- Un-retiring is the one thing that still gets through: a row whose retired_at is being set to
-- null in this same statement is being brought back deliberately, and freezing that would make
-- retirement one-way.

create or replace function challenges_freeze_retired_goal()
returns trigger
language plpgsql
as $$
begin
  if old.retired_at is null then
    return new;
  end if;
  if new.retired_at is null then
    -- Deliberate revival. Let it through whole.
    return new;
  end if;

  new.progress := old.progress;
  new.completed_at := old.completed_at;
  return new;
end;
$$;

comment on function challenges_freeze_retired_goal() is
  '0156 — a retired goal accrues nothing and completes never. Holds progress/completed_at at their retired values so every feeder is neutralised in one place rather than five, and so a collapsed duplicate cannot pay a second drip off the shared source it was collapsed for.';

drop trigger if exists challenges_freeze_retired on challenges;
create trigger challenges_freeze_retired
  before update on challenges
  for each row execute function challenges_freeze_retired_goal();

-- ─────────────────────────── 3 · the duplicate guard ignores retired rows ───────────────────────────
--
-- ⚠️ RESTATED FROM 0148'S BODY, which is prod's current source (nothing since has touched it).
-- Two changes, both small and both stated here so a diff of prosrc is readable:
--
--   1. `and c.retired_at is null` in the clash lookup. Without it, retiring a duplicate would lock
--      the user out of ever creating that goal again — the collapse would read as a permanent ban
--      on their own goal, which is the opposite of what it is for.
--   2. the cadence word in `detail` learns 'once' (0155). It said `when 'day' then 'day' else
--      'week' end`, which would describe a one-time goal as weekly.
--
-- The rule itself is unchanged: one ACTIVE goal per (user, source, cadence), insert-only.

create or replace function challenges_block_duplicate_active_goal()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_label text := lower(trim(coalesce(new.label, '')));
  v_clash challenges;
begin
  -- A row inserted already-complete is history (a backfill, an import); it races nothing.
  if new.completed_at is not null then
    return new;
  end if;

  select c.* into v_clash
  from challenges c
  where c.user_id = new.user_id
    and c.completed_at is null
    -- 0156: a retired goal is over. It reads no source and pays nothing, so it cannot be the
    -- other half of a stack — and blocking against it would mean collapsing a duplicate silently
    -- forbade the user from making that goal again.
    and c.retired_at is null
    and c.period = new.period
    and c.id is distinct from new.id
    and (
      -- Built-in: the type IS the source.
      (new.type <> 'custom' and c.type = new.type)
      -- Custom: the NAME is the source, because that is what both feeders match on. An unnamed
      -- custom goal clashes with nothing — it cannot be fed by label either.
      or (
        new.type = 'custom'
        and c.type = 'custom'
        and v_label <> ''
        and lower(trim(coalesce(c.label, ''))) = v_label
      )
    )
  limit 1;

  if v_clash.id is not null then
    -- 23505 so a client that only reads `error.code` still classifies it as "already exists"
    -- rather than as a server fault. The sentence is the part the user sees.
    raise exception using
      errcode = '23505',
      message = 'You already have this goal running.',
      detail = format(
        'An active %s goal for this %s already exists (%s).',
        case when new.type = 'custom' then coalesce(nullif(trim(new.label), ''), 'custom') else new.type end,
        case new.period when 'day' then 'day' when 'once' then 'one-time goal' else 'week' end,
        v_clash.id
      ),
      hint = 'Two goals reading the same source would both fill from one effort. Finish or delete the one you have.';
  end if;

  return new;
end;
$$;

-- ─────────────────────────── 4 · collapse what is already there ───────────────────────────
--
-- One statement, and it is written so that re-running the file collapses nothing further: every
-- row it retires immediately fails its own `retired_at is null` predicate.
--
-- The NOTICE at the end is the report §4b asks for — which rows were true duplicates and which
-- were left standing — emitted at push time where the numbers are real, rather than guessed here.

-- ─────────────────────────── THE REPORT §4b ASKS FOR ───────────────────────────
--
-- "Report which were true duplicates vs distinct." That question can only be answered against real
-- rows, so it is answered HERE, at push time, in NOTICEs — one line naming every goal retired and
-- the goal it was folded into, then a tally. Guessing at it in a comment would be worse than not
-- answering.
--
-- NOTE THAT NOTHING IS EVER LOST. The keeper is the row with the MOST progress in its group, so
-- every retired row is by construction one whose figure the keeper already equals or exceeds —
-- which is exactly what these goals being fed by one shared source means. There is no branch here
-- that has to weigh keeping a number against collapsing a row, because the ordering makes that
-- conflict impossible.

do $collapse$
declare
  v_retired int := 0;
  v_groups int := 0;
  r record;
begin
  -- 4a · report first, so the NOTICEs describe the state that is about to change.
  for r in
    with ranked as (
      select c.id, c.user_id, c.type, c.label, c.period, c.progress, c.target, c.unit,
             -- 0148's key, spelled the same way: the type is the source for a built-in, the label
             -- for a custom. An unnamed custom goal is fed by nothing and stacks with nothing, so
             -- it gets a key of its own id and can never be somebody else's duplicate.
             first_value(c.id) over w as keeper_id,
             first_value(c.progress) over w as keeper_progress,
             count(*) over w as group_size
      from challenges c
      where c.completed_at is null and c.retired_at is null
      window w as (
        partition by c.user_id, c.period,
          case when c.type = 'custom'
               then 'custom:' || coalesce(nullif(lower(trim(coalesce(c.label, ''))), ''), c.id::text)
               else 'type:' || c.type end
        -- THE KEEPER: most progress, oldest as the tiebreak. See this file's header for why it is
        -- not simply the oldest row.
        order by c.progress desc, c.created_at asc
        -- The frame has to cover the WHOLE partition for count(*) and first_value to describe the
        -- group rather than the rows up to the current one — the default frame under an ORDER BY
        -- is RANGE UNBOUNDED PRECEDING, which would make group_size a running count.
        rows between unbounded preceding and unbounded following
      )
    )
    select * from ranked where id <> keeper_id order by user_id, type, label, period
  loop
    raise notice '0156: DUPLICATE — user %: % "%" · % · %/% % → folding into % (which holds %).',
      r.user_id, r.type, coalesce(r.label, ''), r.period, r.progress, r.target, r.unit,
      r.keeper_id, r.keeper_progress;
  end loop;

  -- 4b · collapse.
  with ranked as (
    select c.id,
           first_value(c.id) over w as keeper_id
    from challenges c
    where c.completed_at is null
      and c.retired_at is null
    window w as (
      partition by c.user_id, c.period,
        case when c.type = 'custom'
             then 'custom:' || coalesce(nullif(lower(trim(coalesce(c.label, ''))), ''), c.id::text)
             else 'type:' || c.type end
      order by c.progress desc, c.created_at asc
      rows between unbounded preceding and unbounded following
    )
  )
  update challenges c
     set retired_at = now()
    from ranked
   where c.id = ranked.id
     and ranked.id <> ranked.keeper_id;

  get diagnostics v_retired = row_count;

  select count(*) into v_groups
  from (
    select 1
    from challenges c
    where c.completed_at is null and c.retired_at is null
    group by c.user_id, c.period,
      case when c.type = 'custom'
           then 'custom:' || coalesce(nullif(lower(trim(coalesce(c.label, ''))), ''), c.id::text)
           else 'type:' || c.type end
    having count(*) > 1
  ) s;

  raise notice '0156: retired % duplicate goal(s). % (user, source, cadence) group(s) still hold more than one active goal — expected 0.',
    v_retired, v_groups;
end;
$collapse$;

-- ─────────────────────────── 5 · self-assertion ───────────────────────────
--
-- The claim is behavioural, not structural: after this file no user holds two ACTIVE goals on one
-- source and cadence, and a retired goal genuinely cannot accrue.
do $assert$
declare
  v_stacks int;
  v_user uuid;
  v_id uuid;
  v_progress numeric;
begin
  select count(*) into v_stacks
  from (
    select 1
    from challenges c
    where c.completed_at is null and c.retired_at is null
    group by c.user_id, c.period,
      case when c.type = 'custom'
           then 'custom:' || coalesce(nullif(lower(trim(coalesce(c.label, ''))), ''), c.id::text)
           else 'type:' || c.type end
    having count(*) > 1
  ) s;

  if v_stacks > 0 then
    raise exception '0156: % (user, source, cadence) group(s) still hold stacked active goals. The collapse did not take.', v_stacks;
  end if;

  -- The freeze, exercised for real and rolled back. A retired goal that still accrues is the one
  -- way this migration could look like it worked while leaving the exploit open.
  select id into v_user from profiles order by created_at limit 1;
  if v_user is null then
    raise notice '0156: no profiles on this database; the freeze was not exercised.';
    return;
  end if;

  begin
    insert into challenges (user_id, type, label, target, unit, period, count_mode)
    values (v_user, 'custom', '0156 probe · retired', 100, 'probe', 'week', 'manual')
    returning id into v_id;

    update challenges set retired_at = now() where id = v_id;
    update challenges set progress = 99, completed_at = now() where id = v_id;

    select progress into v_progress from challenges where id = v_id;
    if v_progress <> 0 then
      raise exception '0156: a retired goal accepted progress (now %). It could still be fed, and still pay.', v_progress;
    end if;
    if (select completed_at from challenges where id = v_id) is not null then
      raise exception '0156: a retired goal was allowed to complete. It would pay a drip off a source it was collapsed for.';
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
