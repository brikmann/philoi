-- 0148 — 🔴 the goal-stacking exploit: N identical goals, one data source, N payouts.
--
-- Noah, on device: "you can set multiple 10,000-step goals for the week which all have the same
-- progress. They'd all give the same reward — stacking." Reproduced on prod before writing this:
--
--   user 0dafcd2b…  steps · week · target 10000  ×2
--   user 0dafcd2b…  steps · day  · target 10000  ×2
--
-- ─────────────────────────── why the existing index does not catch it ───────────────────────────
--
-- The drafted diagnosis pointed at `goals_one_active_per_type_name` (0143). That index is real and
-- it works — it is simply on the WRONG TABLE. A "personal goal" is not a `goals` row. The Personal
-- tab of challenge/create.tsx calls `createChallenge`, which is a plain client insert into
-- **challenges** (src/lib/api/challenges.ts). Nothing in 0143 can see these rows, and no
-- constraint on `challenges` has ever restricted how many a user may hold.
--
-- ─────────────────────────── what "shares a source" actually means ─────────────────────────────
--
-- The exploit is not about the TARGET being equal. It is about two goals being filled by the same
-- number without the user doing the work twice. Every feeder into `challenges` is shared:
--
--   · every BUILT-IN type. getRealFitnessSourceForChallengeType (src/lib/fitness-sync.ts) returns
--     a source for all eight of them — steps/sleep from the health store, run/ride from Strava,
--     workout_minutes/strain from Whoop, and study_hours/gym_visits from the user's own lock-ins.
--     `custom` is the only type it returns null for. So a second identical built-in goal is filled
--     by exactly the same read as the first, and `count_mode` does not record any of this: the
--     client writes 'manual' for every non-custom goal (createChallenge), which is why that column
--     cannot be the test.
--
--   · a CUSTOM goal matched by NAME. credit_lockin_time_goals_for (0116) selects EVERY active goal
--     whose label matches the check-in's goal_detail and loops, crediting each one. Two "Read"
--     goals both get the hour. 0149 extends the same label match to gym sets, so this holds for
--     manual custom goals too from here on.
--
-- Hence the rule: ONE ACTIVE GOAL PER (user, source, cadence) — (user, type, period) for a
-- built-in, (user, lower(label), period) for a custom.
--
-- WHAT STAYS LEGAL, deliberately: 10k steps DAILY alongside 10k steps WEEKLY. Different cadences
-- are different windows and the day's steps genuinely belong to both — that is the ladder working,
-- not a stack. Two 10k WEEKLY step goals are the exploit. So are 8k and 12k weekly: the target is
-- not in the key, because two different targets on one source still fill from one walk.
--
-- ─────────────────────────── a trigger, not a unique index ─────────────────────────────────────
--
-- A partial unique index would be the tidier object, and it is the wrong one here for two reasons:
--
--   1. It cannot be created while prod holds the four duplicate rows above, and the only way to
--      make it creatable is to delete goals that belong to a real user — with real progress and
--      real logs — inside a migration. Those rows are reported to Noah instead. Deleting someone's
--      goal is his call, not a schema change's.
--   2. `raise ... using message` is what puts "You already have this goal running." in front of
--      the user. An index violation surfaces as 23505 plus an index name, and the client would
--      have to reverse-engineer the sentence from it.
--
-- INSERT ONLY, on purpose. The period rollover jobs (0072, 0084) clear `completed_at` to reopen a
-- goal for its next window, and credit_lockin_time_goals_for updates progress on rows that are
-- already active. A trigger that also fired on UPDATE would have to special-case both, and would
-- fail closed on a legitimate rollover of a pair that already exists.
--
-- 🔒 NO ECONOMY CHANGE. Nothing here awards, revokes or re-rates anything. Embers already paid to
-- the stacked goals stay paid — clawing them back is a separate decision with a separate blast
-- radius, and this is the door, not the refund.

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
        case new.period when 'day' then 'day' else 'week' end,
        v_clash.id
      ),
      hint = 'Two goals reading the same source would both fill from one effort. Finish or delete the one you have.';
  end if;

  return new;
end;
$$;

comment on function challenges_block_duplicate_active_goal() is
  '0148 — one active goal per (user, source, cadence). Source is the type for a built-in and the label for a custom, because those are what the two feeders match on. Blocks the stacking exploit: N identical goals filled by one data read, each banking its own drip.';

drop trigger if exists challenges_no_duplicate_active_goal on challenges;
create trigger challenges_no_duplicate_active_goal
before insert on challenges
for each row execute function challenges_block_duplicate_active_goal();
