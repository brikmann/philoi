-- ══════════════════════════════════════════════════════════════════════════════════════════════
-- ONE ASK, MANY GOALS — EACH CARRYING ITS PRICE
--
-- Device repro (CODE_PROMPT_cindy_challenge_bulk_edit_reward.md): "scope me a 90% in every class".
-- Four things were wrong and three of them are the same missing function:
--
--   1. Cindy could only create goals ONE AT A TIME. `runCoach` takes at most one tool_use per turn
--      (that ceiling is deliberate — see _shared/coach/index.ts), so N courses meant N turns with a
--      stop between each. The fix is not to lift the ceiling: it is to make ONE action able to
--      carry N goals. `create_scoped_goals` is that action, and it is one transaction.
--
--   2. There was NO EDIT PATH AT ALL. `set_goal_scope` (0160) is deliberately one-shot and refuses a
--      second scope; nothing else could move a target. So a goal was immutable from the moment it
--      existed, and the goal-card kebab had no Edit to offer. `update_goal` is the door, and it is
--      the ONLY thing in the schema allowed to re-price a goal that has already been priced.
--
--   3. NO REWARD WAS EVER SHOWN. This is the one that matters. 0159-0161 built the pricing, 0160
--      built the write path, and the create still went through the un-scoped arm whenever Cindy
--      omitted a tier — which is every grade goal, because the scoping prompt has no anchors for
--      one. A goal with `difficulty_tier` null pays the legacy payout and shows nothing, so the
--      user never saw what they were chasing. Every function below REFUSES to leave a tier null:
--      an unscoped ask lands on 'uncommon' and says so, rather than creating a rewardless goal.
--
--   4. A GRADE GOAL COULD NOT SETTLE. `log_challenge_progress` ADDS to progress, so reporting 85
--      twice on an "85% in KP390" goal stored 170. A grade is not a counter — it is a single
--      absolute number that arrives once, which is the exact distinction 0145 drew for the social
--      side and never brought back to personal goals. `report_goal_grade` SETS it, and settles
--      pass or fail rather than leaving a missed goal open forever.
--
-- ── WHY THE FIREWALL IS UNCHANGED ───────────────────────────────────────────────────────────
--
-- _shared/coach/tools.ts's central decision is that the SERVER NEVER EXECUTES A MODEL ACTION: the
-- model proposes, the client performs, under the user's own JWT. Nothing here changes that. Every
-- function below is `security definer` for the same narrow reason `set_goal_scope` is — it has to
-- re-read ownership and DERIVE verifiability where a client cannot reach — and every one of them
-- starts by checking `auth.uid()` owns the row. "Server-side fan-out" in the prompt means the loop
-- runs in ONE TRANSACTION instead of N round trips; it does not mean a service-role executor, and
-- building one would hand an LLM write access to the economy.
--
-- 🔒 VERIFIABILITY IS STILL DERIVED, NEVER PASSED. Every insert and every re-price below computes
-- it from the goal's own shape with the same three-line rule 0160 uses. A client still cannot claim
-- to be Strava-tracked, so the worst a lying tier does is collect the same Furnace an honest one
-- does (goal_paid_band caps every honour claim at 'notable').
--
-- ── WHY THIS IS ADDITIVE, AND WHAT AN OLD BUILD SEES ────────────────────────────────────────
--
-- OTA is closed while runtimeVersion is sdkVersion, so installed builds only move when their owner
-- installs an APK. Every column below is NULLABLE and every function is NEW — no existing signature
-- changes, so there is no overload trap (MIGRATIONS.md §"Appending a parameter is not a
-- replacement") and nothing an old client reads today changes shape.
--
-- A grade goal deliberately reuses `type = 'custom'` rather than adding a ninth value to
-- challenges_type_check. An old build indexes TYPE_QUICK_ADDS and CHALLENGE_TYPE_GLYPH by
-- `challenge.type` with no fallback, so a type it has never heard of is `undefined.map` on the
-- Challenges tab — a crash, on the one screen that cannot be patched over the air. `grade_target`
-- being non-null is what makes a goal a grade goal; an old build reads it as a one-time custom goal
-- counted to 90 and renders correctly, which is degraded rather than broken.
-- ══════════════════════════════════════════════════════════════════════════════════════════════

-- ─────────────────────────── 1 · the four columns ───────────────────────────

-- Which course this goal belongs to (0182's user_courses). `on delete set null` rather than
-- cascade: archiving a course you finished last term must not silently delete the goal you set for
-- it — the goal, and the reward it paid, outlive the picker entry.
alter table challenges add column if not exists course_id uuid references user_courses (id) on delete set null;

-- The mark being chased. Its presence IS the grade-goal flag (see the header for why it is not a
-- new `type`). Same 0..100 bound social_challenges.grade_target carries, for the same reason.
alter table challenges add column if not exists grade_target numeric;

-- An honest miss. `completed_at` says "you got there"; this says "the number came in and it was
-- under the bar" — a state a counted goal never has (a step target you miss just keeps running)
-- but a grade goal always eventually reaches. Without it a missed grade goal sits open forever and
-- the user never learns the answer, which is the whole point of reporting it.
alter table challenges add column if not exists missed_at timestamptz;

-- The deadline, and the second thing `update_goal` can move. Nullable and unenforced on purpose:
-- nothing sweeps it, nothing settles on it. It is a date the owner set and the card shows, so that
-- "push my KP390 goal to the 20th" is a real edit rather than a sentence Cindy has to decline.
alter table challenges add column if not exists due_at timestamptz;

-- Archive, for the settled goal `delete_goal` refuses to destroy. NOT `retired_at`, which means
-- something else entirely (0156: collapsed as a duplicate, and frozen by a trigger so it can never
-- accrue or complete). Overloading that would freeze a finished goal's history to say "hidden".
alter table challenges add column if not exists hidden_at timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'challenges_grade_target_range') then
    alter table challenges add constraint challenges_grade_target_range
      check (grade_target is null or (grade_target > 0 and grade_target <= 100));
  end if;

  -- The bar and the counter are ONE number on a grade goal. Every existing surface — the card's
  -- "0 / 90 %", the info screen, the progress bar, the completion arithmetic in
  -- log_challenge_progress — reads `target`, so a grade goal whose target disagreed with its
  -- grade_target would render one number and settle on another.
  if not exists (select 1 from pg_constraint where conname = 'challenges_grade_target_is_the_target') then
    alter table challenges add constraint challenges_grade_target_is_the_target
      check (grade_target is null or target = grade_target);
  end if;

  -- A grade does not reset. Rolling one at midnight or on Sunday would wipe a reported mark, and
  -- roll_over_challenges (0072/0084) sweeps exactly the day and week periods.
  if not exists (select 1 from pg_constraint where conname = 'challenges_grade_is_one_time') then
    alter table challenges add constraint challenges_grade_is_one_time
      check (grade_target is null or period = 'once');
  end if;

  -- Passed and missed are exclusive verdicts. Both set would make every reader's pass/fail branch
  -- depend on which one it happened to check first.
  if not exists (select 1 from pg_constraint where conname = 'challenges_not_both_won_and_lost') then
    alter table challenges add constraint challenges_not_both_won_and_lost
      check (completed_at is null or missed_at is null);
  end if;
end $$;

comment on column challenges.grade_target is
  '0183 — the mark this goal is chasing. NON-NULL IS THE FLAG: a goal with a grade_target is a grade goal, settled by report_goal_grade rather than counted by log_challenge_progress. Deliberately not a new challenges.type — see the migration header.';
comment on column challenges.missed_at is
  '0183 — the reported mark came in under the bar. An honest fail state, so a missed goal settles instead of sitting open forever.';
comment on column challenges.due_at is
  '0183 — the deadline the owner set. Advisory: no sweep reads it and nothing settles on it.';

-- ─────────────────────────── 2 · the derivation, in one place ───────────────────────────
--
-- 0160 open-codes this rule inside set_goal_scope. Three more callers land in this migration, and
-- four copies of the one function that decides whether a goal can reach a top box is precisely the
-- drift 0170's `can_see_rank` header warns about. Extracted so there is one body to change.
--
-- 🔒 A GRADE GOAL IS ALWAYS 'honor'. It is somebody's word about a number nothing in the app can
-- observe — the same call 0145 made for a grade race, and the same one 0093 made when it refused to
-- let self-reported grades earn currency at all. goal_paid_band caps it at 'notable' (The Furnace),
-- so a 90% claim cannot mint a Hephaestus' Chest however hard the course was.
create or replace function goal_verifiability_for(p_type text, p_count_mode text, p_grade_target numeric)
returns text
language sql
immutable
set search_path = public
as $$
  select case
    when p_grade_target is not null then 'honor'
    when p_type <> 'custom' then 'auto'
    when p_count_mode = 'lockin_time' then 'auto'
    else 'honor'
  end;
$$;

comment on function goal_verifiability_for(text, text, numeric) is
  '0183 — the one body of 0160''s derivation rule, now that four functions need it. A grade goal is always honour; a built-in metric or a lock-in-time count is observed; a hand-counted custom goal is honour.';

revoke all on function goal_verifiability_for(text, text, numeric) from public;
grant execute on function goal_verifiability_for(text, text, numeric) to authenticated;

-- ─────────────────────────── 2b · a missed goal is over ───────────────────────────
--
-- 0148's duplicate trigger bands on `completed_at is null and retired_at is null`, which was a
-- complete description of "still running" until this migration. It is not any more: a goal that
-- missed its grade has `completed_at` null forever, so without this the trigger would treat a
-- settled miss as a live goal and refuse the user a second attempt at the same course — and,
-- worse, it would refuse it by raising INSIDE a bulk create, taking the other four courses down
-- with it. That is the exact failure `create_scoped_goals` pre-checks to avoid, so the two rules
-- have to agree.
--
-- ⚠️ RESTATED IN FULL, not amended — a trigger function has no addressable interior. The body below
-- is the live prod prosrc (read out of pg_proc before writing, per MIGRATIONS.md and the
-- clobber-a-sibling's-work rule) with `and c.missed_at is null` added to the WHERE and nothing else
-- moved. If you are reading this after a conflict, diff prosrc before replacing it again.
create or replace function challenges_block_duplicate_active_goal()
returns trigger
language plpgsql
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
    -- 0183: a goal whose reported grade came in under the bar is SETTLED, not running. It accrues
    -- nothing and can never complete, so — exactly like a retired one — it cannot be the other half
    -- of a stack, and blocking against it would mean missing a target once forbade you from ever
    -- setting it again.
    and c.missed_at is null
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

-- ─────────────────────────── 3 · bulk create ───────────────────────────
--
-- "90% in every class" — one ask, one turn, one transaction, N goals, each priced.
--
-- ── WHY IT RETURNS A RECEIPT PER GOAL RATHER THAN SUCCEEDING OR FAILING AS A UNIT ──
--
-- A duplicate is not an error. Someone who already has a KP390 goal and asks for "90% in every
-- class" wants the other four made, not the whole thing refused — and 0148's trigger would refuse
-- the insert anyway, taking the other four down with it inside a single transaction. So the
-- duplicate check happens HERE, before each insert, and a clash becomes a row in the receipt
-- ('existed') rather than an exception. That is what lets Cindy say "made four, you already had
-- KP390" instead of "that didn't go through".
--
-- A malformed goal IS an error, and takes the batch with it: a half-written batch is the state
-- nobody can reason about, and the whole reason this is a fan-out rather than N client calls.
create or replace function create_scoped_goals(p_goals jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_goal jsonb;
  v_type text;
  v_label text;
  v_target numeric;
  v_unit text;
  v_period text;
  v_count_mode text;
  v_tier text;
  v_grade numeric;
  v_course uuid;
  v_due timestamptz;
  v_verif text;
  v_existing challenges;
  v_new challenges;
  v_results jsonb := '[]'::jsonb;
begin
  if v_user is null then
    raise exception 'Not signed in.';
  end if;
  if p_goals is null or jsonb_typeof(p_goals) <> 'array' then
    raise exception 'create_scoped_goals expects an array of goals.';
  end if;
  -- A ceiling, not a policy. "Every class" is four or five; anything claiming forty is a loop, and
  -- a loop that inserts is worth stopping at the door rather than at the ember cap.
  if jsonb_array_length(p_goals) = 0 then
    raise exception 'No goals to create.';
  end if;
  if jsonb_array_length(p_goals) > 12 then
    raise exception 'That is more goals than one ask should make — twelve at a time is the ceiling.';
  end if;

  for v_goal in select * from jsonb_array_elements(p_goals)
  loop
    v_type       := coalesce(nullif(v_goal ->> 'type', ''), 'custom');
    v_label      := nullif(btrim(coalesce(v_goal ->> 'label', '')), '');
    v_target     := (v_goal ->> 'target')::numeric;
    v_unit       := coalesce(v_goal ->> 'unit', '');
    v_period     := coalesce(nullif(v_goal ->> 'period', ''), 'once');
    v_count_mode := case when v_goal ->> 'count_mode' = 'lockin_time' then 'lockin_time' else 'manual' end;
    v_tier       := nullif(v_goal ->> 'difficulty_tier', '');
    v_grade      := nullif(v_goal ->> 'grade_target', '')::numeric;
    v_course     := nullif(v_goal ->> 'course_id', '')::uuid;
    v_due        := nullif(v_goal ->> 'due_at', '')::timestamptz;

    -- 🔴 NO REWARDLESS GOALS (§C). An omitted or unrecognised tier does NOT become a null column
    -- the way it did on the old create path — it lands on the floor and the receipt says
    -- 'uncommon' so Cindy can name it. A goal whose price nobody can see is the bug this migration
    -- exists to close, and silently accepting null here would reopen it one field at a time.
    if v_tier is null or v_tier not in ('common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic') then
      v_tier := 'uncommon';
    end if;

    -- A grade goal's bar IS its target, and it is always one-time. Normalised here rather than
    -- trusted from the caller so the three CHECK constraints above can never be the thing that
    -- fails a whole batch over a field the client forgot to mirror.
    if v_grade is not null then
      v_target := v_grade;
      v_period := 'once';
      v_count_mode := 'manual';
      v_type := 'custom';
      if v_unit = '' then v_unit := '%'; end if;
    end if;

    if v_target is null or v_target <= 0 then
      raise exception 'Goal "%" has no usable target.', coalesce(v_label, '(unnamed)');
    end if;
    if v_period not in ('day', 'week', 'once') then
      raise exception 'Goal "%" has an unknown period "%".', coalesce(v_label, '(unnamed)'), v_period;
    end if;

    -- ── the duplicate check, in the same transaction as the insert ──
    -- Mirrors findDuplicateActiveGoal exactly (src/lib/api/challenges.ts): the SOURCE is the key,
    -- which is the type for a built-in metric and the LABEL for a custom goal, because that is what
    -- both feeders match on. Retired rows are excluded — they read no source and pay nothing, so
    -- they cannot be the other half of a stack.
    select * into v_existing
    from challenges c
    where c.user_id = v_user
      and c.period = v_period
      and c.completed_at is null
      and c.missed_at is null
      and c.retired_at is null
      and (
        (v_type <> 'custom' and c.type = v_type)
        or (v_type = 'custom' and v_label is not null and c.type = 'custom' and lower(btrim(c.label)) = lower(v_label))
      )
    limit 1;

    if v_existing.id is not null then
      v_results := v_results || jsonb_build_object(
        'status', 'existed',
        'id', v_existing.id,
        'label', v_existing.label,
        'tier', v_existing.difficulty_tier,
        'reward', case
          when v_existing.difficulty_tier is null then null
          else preview_challenge_reward(
                 v_existing.difficulty_tier,
                 coalesce(v_existing.verifiability, 'honor'),
                 case when v_existing.period = 'week' then 7 else 1 end,
                 1)
        end
      );
      continue;
    end if;

    v_verif := goal_verifiability_for(v_type, v_count_mode, v_grade);

    -- ONE INSERT, TIER INCLUDED. Not an insert followed by set_goal_scope: that function refuses a
    -- goal that already carries a tier, and doing it in two steps inside a fan-out would mean a
    -- failed scope leaves a rewardless goal behind — the exact outcome §C is about.
    insert into challenges (
      user_id, type, label, target, unit, period, count_mode,
      difficulty_tier, verifiability, grade_target, course_id, due_at
    )
    values (
      v_user, v_type, v_label, v_target, v_unit, v_period, v_count_mode,
      v_tier, v_verif, v_grade, v_course, v_due
    )
    returning * into v_new;

    v_results := v_results || jsonb_build_object(
      'status', 'created',
      'id', v_new.id,
      'label', v_new.label,
      'tier', v_new.difficulty_tier,
      'grade_target', v_new.grade_target,
      'course_id', v_new.course_id,
      -- The SERVER's figure, committed in the same transaction as the row it prices. Cindy quotes
      -- this back; she never computes one (CINDY_SPEC's firewall — she proposes a tier and states
      -- no number of her own).
      'reward', preview_challenge_reward(
                  v_new.difficulty_tier,
                  v_new.verifiability,
                  case when v_new.period = 'week' then 7 else 1 end,
                  1)
    );
  end loop;

  return jsonb_build_object('results', v_results);
end;
$$;

comment on function create_scoped_goals(jsonb) is
  '0183 — creates N personal goals from ONE ask, atomically, each with its tier written and its reward priced in the same transaction. Duplicates come back as ''existed'' receipts rather than failing the batch. Never writes a rewardless goal: an absent tier floors to uncommon.';

revoke all on function create_scoped_goals(jsonb) from public;
grant execute on function create_scoped_goals(jsonb) to authenticated;

-- ─────────────────────────── 4 · edit ───────────────────────────
--
-- The one function allowed to re-price a goal that has already been priced, and the reason
-- set_goal_scope can stay one-shot: 0160's header explains that a re-scopable goal is one you can
-- finish cheap and re-price expensive on the way to the reveal, and every guard below exists to
-- keep that true while still letting someone move a target they set badly.
--
-- ── THE LIFECYCLE RULES (§B), ENFORCED HERE RATHER THAN IN THE PROMPT ──
--
--   · settled (completed OR missed) → REFUSED. Offer a new goal instead.
--   · retired (0156's collapsed duplicate) → REFUSED. It is frozen by a trigger anyway.
--   · claimed, awaiting a vouch → REFUSED. The claim named a target; moving it mid-window is
--     asking friends to vouch for a different thing than the one they were shown.
--   · otherwise → target, deadline and tier are all movable, and the reward RE-SCORES.
--
-- ── THE ANTI-CHEESE LEAP GATE (DIFFICULTY_SCOPING.md §4) ──
--
-- The exploit an edit path opens is the mirror of the micro-PR one: set an ambitious goal, get
-- most of the way, then drop the target to where you already are and collect the crate. Two guards,
-- both about the DISTANCE STILL TO GO rather than about the number itself:
--
--   1. A new target at or below current progress is refused outright — that is not an edit, it is a
--      completion typed into the wrong box.
--   2. A goal already 80% of the way there cannot have its target LOWERED at all. Raising it is
--      always fine: more work for the same or a re-scored price is not a cheese.
--
-- Neither guard can be reached by a fresh goal (progress 0), which is the case §B calls "fully
-- editable" — so the common edit stays frictionless and only the suspicious one is stopped.
create or replace function update_goal(
  p_goal_id uuid,
  p_target numeric default null,
  p_due_at timestamptz default null,
  p_clear_due boolean default false,
  p_tier text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_goal challenges;
  v_target numeric;
  v_tier text;
  v_verif text;
  v_changed text[] := '{}';
  v_old_tier text;
begin
  if v_user is null then
    raise exception 'Not signed in.';
  end if;

  -- security definer bypasses RLS, so ownership is checked here or not at all. Same shape as
  -- set_goal_scope's, and the same sentence, so "that goal is not yours" reads identically
  -- whichever door the user came through.
  select * into v_goal from challenges c where c.id = p_goal_id and c.user_id = v_user;
  if v_goal.id is null then
    raise exception 'That goal is not yours.';
  end if;

  if v_goal.completed_at is not null then
    raise exception 'That one is already finished — I can set up a new one instead.';
  end if;
  if v_goal.missed_at is not null then
    raise exception 'That one is already settled — I can set up a new one instead.';
  end if;
  if v_goal.retired_at is not null then
    raise exception 'That goal was collapsed into another one reading the same source.';
  end if;
  if v_goal.claimed_at is not null then
    raise exception 'You have already claimed that one — it is waiting on a vouch, so the target is locked.';
  end if;

  v_old_tier := v_goal.difficulty_tier;
  v_target := coalesce(p_target, v_goal.target);

  if v_target <= 0 then
    raise exception 'A target has to be greater than zero.';
  end if;

  if p_target is not null and p_target <> v_goal.target then
    -- Guard 1 — an edit that lands at or under where they already are is a completion in disguise.
    if v_goal.progress >= p_target then
      raise exception 'You are already at % — moving the target there would just finish it. Pick a number ahead of you.',
        trim(to_char(v_goal.progress, 'FM999999990.99'));
    end if;
    -- Guard 2 — the leap gate. Lowering the bar on a goal that is nearly done is the cheese;
    -- raising it never is.
    if p_target < v_goal.target and v_goal.target > 0 and v_goal.progress / v_goal.target >= 0.8 then
      raise exception 'That goal is % done — I can raise the bar but not lower it this close to the end.',
        to_char(round(100 * v_goal.progress / v_goal.target), 'FM999') || '%';
    end if;
    -- A grade goal's bar and counter are one number (challenges_grade_target_is_the_target).
    if v_goal.grade_target is not null and p_target > 100 then
      raise exception 'A grade is a percentage — 100 is the ceiling.';
    end if;
    v_changed := array_append(v_changed, 'target');
  end if;

  -- ── the re-score ──
  --
  -- 🔒 THE USER DOES NOT PICK THE REWARD (§B). They move the TARGET; Cindy re-scores the difficulty
  -- of the changed feat and passes the tier; this validates it and re-derives verifiability from
  -- the goal's own shape, exactly as the create path does. There is no parameter here that names a
  -- box, a band or an ember figure, and that absence is the design.
  v_tier := coalesce(nullif(p_tier, ''), v_goal.difficulty_tier);
  if v_tier is null or v_tier not in ('common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic') then
    -- Same floor as the create path, same reason: an edit must not be able to strip a goal's price.
    v_tier := 'uncommon';
  end if;
  if v_tier is distinct from v_goal.difficulty_tier then
    v_changed := array_append(v_changed, 'reward');
  end if;

  if p_clear_due or (p_due_at is not null and p_due_at is distinct from v_goal.due_at) then
    v_changed := array_append(v_changed, 'deadline');
  end if;

  v_verif := goal_verifiability_for(v_goal.type, v_goal.count_mode, v_goal.grade_target);

  update challenges
     set target = v_target,
         grade_target = case when v_goal.grade_target is null then null else v_target end,
         due_at = case when p_clear_due then null else coalesce(p_due_at, v_goal.due_at) end,
         difficulty_tier = v_tier,
         verifiability = v_verif
   where id = p_goal_id
  returning * into v_goal;

  return jsonb_build_object(
    'id', v_goal.id,
    'label', v_goal.label,
    'target', v_goal.target,
    'due_at', v_goal.due_at,
    'tier', v_goal.difficulty_tier,
    'previous_tier', v_old_tier,
    'changed', to_jsonb(v_changed),
    'reward', preview_challenge_reward(
                v_goal.difficulty_tier,
                v_goal.verifiability,
                case when v_goal.period = 'week' then 7 else 1 end,
                1)
  );
end;
$$;

comment on function update_goal(uuid, numeric, timestamptz, boolean, text) is
  '0183 — moves a live goal''s target/deadline and RE-SCORES its reward from the tier Cindy re-judged. Owner only, refused once settled/claimed/retired, and gated by the leap rule: a target at or under current progress, or a cut to a goal already 80% done, is refused.';

revoke all on function update_goal(uuid, numeric, timestamptz, boolean, text) from public;
grant execute on function update_goal(uuid, numeric, timestamptz, boolean, text) to authenticated;

-- ─────────────────────────── 5 · a grade settles, pass or fail ───────────────────────────
--
-- The report → settle → reveal path §C asks for, end to end.
--
-- SETS, NEVER ADDS. `log_challenge_progress` increments, which is right for steps and wrong for a
-- mark: reporting 85 twice stored 170 and completed a 90% goal the user missed. This is the same
-- distinction 0145 drew server-side for grade RACES ("a single absolute number that arrives ONCE")
-- and it is the reason a grade goal must not go through the counting door.
--
-- THE REVEAL IS NOT WIRED HERE, AND THAT IS DELIBERATE. Setting completed_at fires the existing
-- `challenges_economy` trigger (economy_on_challenge_completed), which mints the crate and writes
-- reward_payload; get_unseen_goal_rewards then picks the row up on the next foreground and
-- GoalRevealWatcher draws it. A grade goal is `period = 'once'`, which is exactly the arm that
-- function already admits. So a pass reveals through the path every other one-time goal reveals
-- through, rather than through a second copy of it.
--
-- A MISS REVEALS NOWHERE, ON PURPOSE. get_unseen_goal_rewards selects completed goals with a
-- payload, and teaching it to emit payload-less rows would hand every INSTALLED build a reveal it
-- has no branch for — a crate screen with a null crate, un-patchable over the air. The miss is
-- returned HERE instead, to the sheet the user just tapped in, which is the honest moment for it:
-- they asked the question, so the answer belongs in the same breath.
create or replace function report_goal_grade(p_goal_id uuid, p_grade numeric)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_goal challenges;
  v_passed boolean;
begin
  if v_user is null then
    raise exception 'Not signed in.';
  end if;
  if p_grade is null or p_grade < 0 or p_grade > 100 then
    raise exception 'A grade is a percentage between 0 and 100.';
  end if;

  select * into v_goal from challenges c where c.id = p_goal_id and c.user_id = v_user;
  if v_goal.id is null then
    raise exception 'That goal is not yours.';
  end if;
  if v_goal.grade_target is null then
    raise exception 'That goal is not scored on a grade.';
  end if;
  if v_goal.completed_at is not null or v_goal.missed_at is not null then
    raise exception 'You already reported that one.';
  end if;
  if v_goal.retired_at is not null then
    raise exception 'That goal was collapsed into another one.';
  end if;

  v_passed := p_grade >= v_goal.grade_target;

  update challenges
     set progress = p_grade,
         completed_at = case when v_passed then now() else null end,
         missed_at    = case when v_passed then null else now() end
   where id = p_goal_id
  returning * into v_goal;

  -- The receipt the sheet renders. `reward` is what the pass is WORTH and is null on a miss —
  -- quoting a figure beside "you missed it" would read as a payout that never moved.
  return jsonb_build_object(
    'id', v_goal.id,
    'label', v_goal.label,
    'grade', p_grade,
    'grade_target', v_goal.grade_target,
    'passed', v_passed,
    'tier', v_goal.difficulty_tier,
    'reward', case
      when not v_passed or v_goal.difficulty_tier is null then null
      else preview_challenge_reward(v_goal.difficulty_tier, coalesce(v_goal.verifiability, 'honor'), 1, 1)
    end
  );
end;
$$;

comment on function report_goal_grade(uuid, numeric) is
  '0183 — settles a personal grade goal on the mark the owner reports. SETS progress rather than adding to it, and writes completed_at OR missed_at so a missed goal settles honestly instead of staying open. A pass reveals through the existing challenges_economy trigger.';

revoke all on function report_goal_grade(uuid, numeric) from public;
grant execute on function report_goal_grade(uuid, numeric) to authenticated;

-- ─────────────────────────── 6 · delete, and the thing to do instead ───────────────────────────
--
-- `deleteChallenge` is a plain RLS-guarded delete and has been since the tab existed. It is fine
-- for a live goal and wrong for a settled one: the row carries reward_payload — the receipt for
-- embers that actually moved — and challenge_logs and archived periods cascade off it. Deleting it
-- destroys the evidence of a payout the ledger still shows, which is how "no embers already paid
-- are clawed back incorrectly" turns into a reconciliation nobody can do.
--
-- So: a live goal is removed cleanly, and a settled one is HIDDEN instead. The kebab offers the
-- one that applies rather than an error.
create or replace function delete_goal(p_goal_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_goal challenges;
begin
  if v_user is null then
    raise exception 'Not signed in.';
  end if;

  select * into v_goal from challenges c where c.id = p_goal_id and c.user_id = v_user;
  if v_goal.id is null then
    raise exception 'That goal is not yours.';
  end if;

  if v_goal.completed_at is not null or v_goal.missed_at is not null then
    raise exception 'That one is finished — its reward is on the books, so it can be hidden but not deleted.';
  end if;

  delete from challenges where id = p_goal_id;
  return jsonb_build_object('deleted', true, 'id', p_goal_id);
end;
$$;

comment on function delete_goal(uuid) is
  '0183 — deletes a LIVE goal. Refuses a settled one, whose reward_payload is the receipt for embers that already moved; hide_goal is the offer in that case.';

revoke all on function delete_goal(uuid) from public;
grant execute on function delete_goal(uuid) to authenticated;

create or replace function hide_goal(p_goal_id uuid, p_hidden boolean default true)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then
    raise exception 'Not signed in.';
  end if;
  update challenges
     set hidden_at = case when p_hidden then now() else null end
   where id = p_goal_id and user_id = v_user;
  if not found then
    raise exception 'That goal is not yours.';
  end if;
  return jsonb_build_object('id', p_goal_id, 'hidden', p_hidden);
end;
$$;

comment on function hide_goal(uuid, boolean) is
  '0183 — archives a finished goal out of History without destroying its reward receipt. Reversible.';

revoke all on function hide_goal(uuid, boolean) from public;
grant execute on function hide_goal(uuid, boolean) to authenticated;

-- ─────────────────────────── the assertions ───────────────────────────
--
-- Every check below runs against the post-DDL schema and FAILS under the bug it is written to
-- catch (MIGRATIONS.md §"Assertions must be reachable"). The behavioural ones execute the plpgsql
-- BODIES rather than merely proving the functions exist — a dry run's begin/rollback only exercises
-- DDL, so a body that has never been called has never been tested.
--
-- The impersonation is scoped to a sub-transaction for the reason 0161's assertion block records:
-- set_config(..., true) is SET LOCAL and lasts to the end of the TRANSACTION, so setting the role
-- inline leaves every later statement running as `authenticated`.
do $assert$
declare
  v_overloads int;
  v_uid uuid;
  v_out jsonb;
  v_id uuid;
  v_caught text;
begin
  -- ── shape ──
  for v_overloads in
    select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('create_scoped_goals', 'update_goal', 'report_goal_grade', 'delete_goal',
                        'hide_goal', 'goal_verifiability_for')
    group by p.proname
  loop
    if v_overloads <> 1 then
      raise exception 'a function from 0183 has % overloads, expected 1', v_overloads;
    end if;
  end loop;

  -- ── the derivation, at every branch ──
  if goal_verifiability_for('custom', 'manual', 90) <> 'honor' then
    raise exception 'a grade goal must be honour — it is somebody''s word about a number';
  end if;
  if goal_verifiability_for('steps', 'manual', null) <> 'auto' then
    raise exception 'a built-in metric is observed';
  end if;
  if goal_verifiability_for('custom', 'lockin_time', null) <> 'auto' then
    raise exception 'a lock-in-time custom goal is observed';
  end if;
  if goal_verifiability_for('custom', 'manual', null) <> 'honor' then
    raise exception 'a hand-counted custom goal is honour';
  end if;
  -- The cap that makes the whole firewall safe, restated as a positive control: an honour claim
  -- cannot reach a top box however high the tier it names.
  if goal_paid_band('mythic', 'honor') is distinct from 'notable' then
    raise exception 'a hand-logged mythic claim must still cap at notable';
  end if;

  -- ── the bodies, run for real ──
  --
  -- Against a REAL member, inside a sub-transaction that is rolled back, because every function
  -- here is auth.uid()-scoped and there is nothing to test without a uid. Skipped entirely on an
  -- empty database so a fresh `db reset` still applies this file.
  select id into v_uid from profiles order by created_at limit 1;
  if v_uid is null then
    raise notice '0183: no profiles, skipping the behavioural assertions';
    return;
  end if;

  begin
    perform set_config('request.jwt.claims', json_build_object('sub', v_uid, 'role', 'authenticated')::text, true);
    perform set_config('role', 'authenticated', true);

    -- A batch with no tier must still come back priced. This is the §C bug exactly: before this
    -- migration the same input produced difficulty_tier null and no reward at all.
    v_out := create_scoped_goals(jsonb_build_array(
      jsonb_build_object('label', '0183 assertion · grade', 'grade_target', 90, 'difficulty_tier', 'rare'),
      jsonb_build_object('label', '0183 assertion · unscoped', 'target', 5, 'unit', 'reps', 'period', 'once')
    ));

    if jsonb_array_length(v_out -> 'results') <> 2 then
      raise exception 'create_scoped_goals made % goals from a 2-goal ask', jsonb_array_length(v_out -> 'results');
    end if;
    if (v_out -> 'results' -> 1 ->> 'tier') <> 'uncommon' then
      raise exception 'an unscoped goal must floor to uncommon, got %', v_out -> 'results' -> 1 ->> 'tier';
    end if;
    if (v_out -> 'results' -> 0 -> 'reward' ->> 'box') is null then
      raise exception 'a created goal came back with no crate — that is the rewardless bug';
    end if;
    -- Honour, derived, not accepted: a rare grade goal pays The Furnace, not a Vessel.
    if (v_out -> 'results' -> 0 -> 'reward' ->> 'verifiability') <> 'honor' then
      raise exception 'a grade goal was priced as observed';
    end if;

    v_id := (v_out -> 'results' -> 0 ->> 'id')::uuid;

    -- The same ask a second time must not stack. This is the guard that lets a bulk create be safe
    -- to repeat, and it fails loudly if the dedupe key ever stops matching findDuplicateActiveGoal.
    v_out := create_scoped_goals(jsonb_build_array(
      jsonb_build_object('label', '0183 assertion · grade', 'grade_target', 90, 'difficulty_tier', 'rare')
    ));
    if (v_out -> 'results' -> 0 ->> 'status') <> 'existed' then
      raise exception 'a duplicate goal was created instead of reported as existing';
    end if;

    -- An edit re-prices.
    v_out := update_goal(v_id, 85, null, false, 'uncommon');
    if (v_out ->> 'tier') <> 'uncommon' or (v_out ->> 'previous_tier') <> 'rare' then
      raise exception 'update_goal did not re-score the tier';
    end if;
    if (v_out ->> 'target')::numeric <> 85 then
      raise exception 'update_goal did not move the target';
    end if;

    -- The leap gate. A target at or under current progress is refused — and this is a POSITIVE
    -- control, not a green check that would pass under the bug: without the guard the update
    -- succeeds silently and nothing raises.
    perform report_goal_grade(v_id, 84);
    v_caught := null;
    begin
      perform update_goal(v_id, 60, null, false, null);
    exception when others then
      v_caught := SQLERRM;
    end;
    if v_caught is null then
      raise exception 'a settled goal was edited — the lifecycle gate is not holding';
    end if;

    -- The miss settled honestly rather than staying open.
    if not exists (select 1 from challenges where id = v_id and missed_at is not null and completed_at is null) then
      raise exception 'a grade under the bar did not settle as a miss';
    end if;
    if (select progress from challenges where id = v_id) <> 84 then
      raise exception 'report_goal_grade added to progress instead of setting it';
    end if;

    -- A missed goal must not lock the course. This exercises the REPLACED trigger from §2b, and it
    -- is the assertion that fails if a later migration restates that body from an older base: the
    -- insert below raises 23505 out of the trigger and the whole batch dies, which is what the
    -- prod-side symptom would look like.
    v_out := create_scoped_goals(jsonb_build_array(
      jsonb_build_object('label', '0183 assertion · grade', 'grade_target', 90, 'difficulty_tier', 'rare')
    ));
    if (v_out -> 'results' -> 0 ->> 'status') <> 'created' then
      raise exception 'a settled miss is still blocking a fresh attempt at the same goal';
    end if;

    -- Everything above is scratch. Rolled back so the assertion leaves no goals on a real member's
    -- tab — which it would otherwise, since this runs against prod's first profile.
    raise exception 'philoi_0183_rollback';
  exception
    when others then
      if SQLERRM <> 'philoi_0183_rollback' then
        raise;
      end if;
  end;
end
$assert$;
