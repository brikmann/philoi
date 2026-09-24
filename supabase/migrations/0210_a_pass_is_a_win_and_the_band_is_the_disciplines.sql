-- ══════════════════════════════════════════════════════════════════════════════════════════════
-- 0210 · A PASS IS A WIN, AND THE BAND IS THE DISCIPLINE'S.
--
-- Spec: CODE_PROMPT grade goals — partial-credit ladder + cap at The Furnace + vouch (Noah,
-- 2026-09-23). Builds on 0209, which routed a passing grade through claim_goal_complete.
--
-- ─────────────────────────── WHAT CHANGES ───────────────────────────
--
-- 1. PARTIAL CREDIT. A grade under the target was a miss and paid nothing. Now only a COURSE FAIL
--    (under `pass_mark`, default 50) is a miss. Any pass completes the goal at a tier stepped down
--    from the scoped one — one tier per `step` points of shortfall — never below the discipline's
--    floor:
--
--        steps     = ceil( greatest(0, target - grade) / step )
--        earned    = clamp(scoped, floor, ceiling) stepped down `steps`, floored at `floor`
--
--    STEM: floor rare, ceiling mythic, step 10.   ARTS: floor uncommon, ceiling mythic, step 5.
--    UNTAGGED: floor uncommon, step 10 — a missing tag must never silently lift a reward.
--    The band lives in ONE function, grade_band(), not as literals in three bodies.
--
-- 2. THE EARNED TIER IS WHAT PAYS. report_goal_grade overwrites difficulty_tier with the earned
--    tier before the claim resolves, so the UNTOUCHED challenges_economy trigger prices the goal at
--    what was earned. The tier Cindy scoped is kept in `scoped_tier`, for "you aimed for LEGENDARY".
--
-- 3. CINDY TAGS THE DISCIPLINE. create_scoped_goals reads `grade_discipline` ('stem'|'arts') and
--    `pass_mark` off each goal and clamps the scoped tier into the band.
--
-- 4. PRIORITY COURSES — the box slots, TWO per season, capped HERE, not in Cindy's prompt. A goal
--    can carry `priority: true` and create_scoped_goals nominates its course in the same
--    transaction; over the cap the goal is still made and the receipt says `priority: 'full'` so
--    Cindy asks which one to swap. One live grade goal per course per season.
--
-- ─────────────────────────── 🔴 WHAT THIS DOES NOT DO, ON PURPOSE ───────────────────────────
--
-- · NON-PRIORITY GOALS STILL MINT A BOX. "Embers only, tier-scaled, no box" cannot be expressed
--   through grant_reward, where the band picks the embers AND the box together, so it needs
--   economy_on_challenge_completed or grant_reward to change. Both prompts hold the trigger
--   byte-untouched. Gating also has to wait for a client that can nominate a course: switching it
--   on first would quietly downgrade every grade goal on prod. Priority is RECORDED here and gates
--   nothing yet.
-- · NO MULTI-MYTHIC `box_count`. That is a grant_reward signature change with three callers — the
--   overload trap MIGRATIONS.md records reaching prod three times. Not quoted, because the reveal
--   cannot mint it.
-- · PROOF ALONE STILL DOES NOT RESOLVE TO 'vouched'. 0165's rule, kept by 0209 calling
--   claim_goal_complete. Two counted vouches are the only way to the full band.
--
-- ─────────────────────────── 🔒 THE HONOUR CAP SITS ON TOP ───────────────────────────
--
-- goal_paid_band is untouched. On honour, an earned LEGENDARY still pays The Furnace, and an earned
-- rare pays one band down (Ignition). A liar gains nothing from the ladder: honour already capped
-- a reported 100 at The Furnace, and the ladder can only step DOWN from the scoped tier.
-- ══════════════════════════════════════════════════════════════════════════════════════════════

-- ─────────────────────────── 1 · columns ───────────────────────────

alter table challenges
  add column if not exists grade_discipline text,
  add column if not exists pass_mark numeric,
  add column if not exists scoped_tier text,
  add column if not exists season_id text;

do $$
begin
  alter table challenges drop constraint if exists challenges_grade_discipline_valid;
  alter table challenges add constraint challenges_grade_discipline_valid
    check (grade_discipline is null or grade_discipline in ('stem', 'arts'));
  alter table challenges drop constraint if exists challenges_pass_mark_valid;
  alter table challenges add constraint challenges_pass_mark_valid
    check (pass_mark is null or (pass_mark > 0 and pass_mark <= 100));
  alter table challenges drop constraint if exists challenges_scoped_tier_valid;
  alter table challenges add constraint challenges_scoped_tier_valid
    check (scoped_tier is null or scoped_tier in ('common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic'));
end $$;

comment on column challenges.grade_discipline is
  '0210 — stem | arts, tagged by Cindy at scope. Sets the grade ladder''s floor, ceiling and step (grade_band). Null = untagged: floor uncommon, step 10.';
comment on column challenges.pass_mark is
  '0210 — the course''s pass mark. Under it a reported grade is a MISS; at or over it the goal completes at a laddered tier. Null = 50.';
comment on column challenges.season_id is
  '0210 — the economy season a GRADE goal was set in, stamped at create. "One grade goal per course per season" and "a paid slot stays" compare this id, not dates: the configured season can start in the future (S1 opens 2026-10-01), and a date window then misses everything set before it opens.';
comment on column challenges.scoped_tier is
  '0210 — the tier Cindy scoped, stamped when the grade is reported, just before difficulty_tier is overwritten with the EARNED tier that pays.';

-- ─────────────────────────── 2 · the band, in one place ───────────────────────────

create or replace function grade_band(
  p_discipline text,
  out floor_tier text,
  out ceiling_tier text,
  out step numeric
)
language sql
immutable
set search_path = public
as $$
  select
    case p_discipline when 'stem' then 'rare' else 'uncommon' end,
    'mythic',
    case p_discipline when 'arts' then 5 else 10 end::numeric;
$$;

comment on function grade_band(text) is
  '0210 — THE one place the grade-goal reward band lives. stem → (rare, mythic, 10); arts → (uncommon, mythic, 5); untagged → (uncommon, mythic, 10).';

create or replace function grade_effective_tier(
  p_scoped text,
  p_target numeric,
  p_grade numeric,
  p_discipline text
)
returns text
language plpgsql
immutable
set search_path = public
as $$
declare
  v_ladder constant text[] := array['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic'];
  v_band record;
  v_floor int;
  v_ceiling int;
  v_at int;
  v_steps int;
begin
  select * into v_band from grade_band(p_discipline);
  v_floor := array_position(v_ladder, v_band.floor_tier);
  v_ceiling := array_position(v_ladder, v_band.ceiling_tier);

  -- An unknown scoped tier starts at the floor rather than erroring: pricing a real pass at the
  -- floor beats refusing it.
  v_at := least(greatest(coalesce(array_position(v_ladder, p_scoped), v_floor), v_floor), v_ceiling);
  v_steps := ceil(greatest(0, coalesce(p_target, 0) - coalesce(p_grade, 0)) / v_band.step)::int;

  return v_ladder[greatest(v_at - v_steps, v_floor)];
end;
$$;

comment on function grade_effective_tier(text, numeric, numeric, text) is
  '0210 — the tier a PASSING grade earns: the scoped tier clamped into the discipline band, stepped down one tier per band step of shortfall, never below the floor. Deciding pass vs miss is report_goal_grade''s job, not this function''s.';

revoke all on function grade_band(text) from public, anon;
revoke all on function grade_effective_tier(text, numeric, numeric, text) from public, anon;
grant execute on function grade_band(text) to authenticated;
grant execute on function grade_effective_tier(text, numeric, numeric, text) to authenticated;

-- ─────────────────────────── 3 · priority courses ───────────────────────────

create or replace function current_economy_season(out season_id text, out starts_at timestamptz)
language sql
stable
set search_path = public
as $$
  select value ->> 'id', (value ->> 'starts_at')::timestamptz
    from economy_config where key = 'season';
$$;

revoke all on function current_economy_season() from public, anon;
grant execute on function current_economy_season() to authenticated;

create table if not exists priority_courses (
  user_id    uuid not null references profiles (id) on delete cascade,
  season_id  text not null,
  course_id  uuid not null references user_courses (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, season_id, course_id)
);

comment on table priority_courses is
  '0210 — a member''s declared priority courses, at most TWO per season, the box slots of the grade-goal economy. Written only by the nomination functions below; the cap is enforced there under an advisory lock.';

alter table priority_courses enable row level security;

drop policy if exists "own priority courses readable" on priority_courses;
create policy "own priority courses readable" on priority_courses
  for select using (user_id = auth.uid());
-- No insert/update/delete policy: every write goes through a function that holds the cap.

create or replace function priority_course_nominate(p_user uuid, p_course uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_season text := (select season_id from current_economy_season());
begin
  if v_season is null then
    return 'no_season';
  end if;
  if not exists (select 1 from user_courses where id = p_course and user_id = p_user and archived_at is null) then
    raise exception 'That course is not yours.';
  end if;

  -- Serialises nominations per member per season so two concurrent asks cannot both see "one".
  perform pg_advisory_xact_lock(hashtextextended('priority_courses:' || p_user::text || ':' || v_season, 0));

  if exists (select 1 from priority_courses where user_id = p_user and season_id = v_season and course_id = p_course) then
    return 'already';
  end if;
  if (select count(*) from priority_courses where user_id = p_user and season_id = v_season) >= 2 then
    return 'full';
  end if;

  insert into priority_courses (user_id, season_id, course_id) values (p_user, v_season, p_course);
  return 'nominated';
end;
$$;

revoke all on function priority_course_nominate(uuid, uuid) from public, anon, authenticated;

create or replace function nominate_priority_course(p_course_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
begin
  if auth.uid() is null then
    raise exception 'Not signed in.';
  end if;
  v_status := priority_course_nominate(auth.uid(), p_course_id);
  if v_status = 'full' then
    raise exception using
      errcode = 'P0001',
      message = 'You already have two priority courses this season — swap one out first.';
  end if;
  return get_priority_courses() || jsonb_build_object('status', v_status);
end;
$$;

-- Releasing a slot is a swap, and a swap must not be a way to a third box: a course whose grade goal
-- already COMPLETED this season has spent its slot.
create or replace function release_priority_course(p_course_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_season record;
begin
  if auth.uid() is null then
    raise exception 'Not signed in.';
  end if;
  select * into v_season from current_economy_season();

  if exists (
    select 1 from challenges c
     where c.user_id = auth.uid() and c.course_id = p_course_id
       and c.grade_target is not null and c.completed_at is not null
       and c.season_id = v_season.season_id
  ) then
    raise exception 'That course already paid out this season — its slot stays.';
  end if;

  delete from priority_courses
   where user_id = auth.uid() and season_id = v_season.season_id and course_id = p_course_id;
  return get_priority_courses();
end;
$$;

create or replace function get_priority_courses()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'season_id', s.season_id,
    'cap', 2,
    'courses', coalesce((
      select jsonb_agg(jsonb_build_object('course_id', uc.id, 'code', uc.code, 'title', uc.title) order by pc.created_at)
        from priority_courses pc join user_courses uc on uc.id = pc.course_id
       where pc.user_id = auth.uid() and pc.season_id = s.season_id
    ), '[]'::jsonb)
  )
  from current_economy_season() s;
$$;

revoke all on function nominate_priority_course(uuid) from public, anon;
revoke all on function release_priority_course(uuid) from public, anon;
revoke all on function get_priority_courses() from public, anon;
grant execute on function nominate_priority_course(uuid) to authenticated;
grant execute on function release_priority_course(uuid) to authenticated;
grant execute on function get_priority_courses() to authenticated;

-- ─────────────────────────── 4 · create_scoped_goals ───────────────────────────
--
-- ⚠️ RESTATED FROM PROD'S LIVE pg_get_functiondef (0183's body; nothing since has touched it).
-- Added: grade_discipline / pass_mark / priority read off each goal; the band clamp on a grade
-- goal's tier; the one-grade-goal-per-course-per-season check; the nomination. Nothing else moved.
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
  -- 0210
  v_discipline text;
  v_pass_mark numeric;
  v_priority boolean;
  v_priority_status text;
  v_band record;
  v_ladder constant text[] := array['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic'];
  v_season text := (select season_id from current_economy_season());
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
    -- 0210 — an unknown discipline is dropped to untagged (the conservative band), never guessed.
    v_discipline := case when v_goal ->> 'grade_discipline' in ('stem', 'arts') then v_goal ->> 'grade_discipline' end;
    v_pass_mark  := nullif(v_goal ->> 'pass_mark', '')::numeric;
    v_priority   := coalesce((v_goal ->> 'priority')::boolean, false);
    v_priority_status := null;

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

      -- 0210 — the band clamps the scope: a STEM goal is never scoped under rare, an arts goal
      -- never under uncommon, neither over mythic.
      select * into v_band from grade_band(v_discipline);
      v_tier := v_ladder[least(
        greatest(array_position(v_ladder, v_tier), array_position(v_ladder, v_band.floor_tier)),
        array_position(v_ladder, v_band.ceiling_tier))];

      -- A pass mark over the target would make hitting the target a fail; drop it to the default.
      if v_pass_mark is not null and (v_pass_mark <= 0 or v_pass_mark > v_grade) then
        v_pass_mark := null;
      end if;
    else
      v_discipline := null;
      v_pass_mark := null;
      v_priority := false;
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
    --
    -- 0210 — AND the course, for a grade goal: one per course per season, so "90% in KP390" and
    -- "A in KP390" cannot be two box goals on one class. A goal that completed THIS season still
    -- blocks (it has paid); a miss or a retired one does not.
    select * into v_existing
    from challenges c
    where c.user_id = v_user
      and c.retired_at is null
      and c.missed_at is null
      and (
        (
          c.period = v_period
          and c.completed_at is null
          and (
            (v_type <> 'custom' and c.type = v_type)
            or (v_type = 'custom' and v_label is not null and c.type = 'custom' and lower(btrim(c.label)) = lower(v_label))
          )
        )
        or (
          v_grade is not null and v_course is not null
          and c.grade_target is not null and c.course_id = v_course
          and (c.completed_at is null or c.season_id = v_season)
        )
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
      difficulty_tier, verifiability, grade_target, course_id, due_at,
      grade_discipline, pass_mark, season_id
    )
    values (
      v_user, v_type, v_label, v_target, v_unit, v_period, v_count_mode,
      v_tier, v_verif, v_grade, v_course, v_due,
      v_discipline, v_pass_mark, case when v_grade is not null then v_season end
    )
    returning * into v_new;

    -- 0210 — the box slot, in the same transaction. Over the cap the GOAL still stands; the receipt
    -- says 'full' and Cindy asks which course to swap. She never makes a third.
    if v_priority and v_course is not null then
      v_priority_status := priority_course_nominate(v_user, v_course);
    end if;

    v_results := v_results || jsonb_build_object(
      'status', 'created',
      'id', v_new.id,
      'label', v_new.label,
      'tier', v_new.difficulty_tier,
      'grade_target', v_new.grade_target,
      'course_id', v_new.course_id,
      'grade_discipline', v_new.grade_discipline,
      'pass_mark', v_new.pass_mark,
      'priority', v_priority_status,
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

-- ─────────────────────────── 5 · report_goal_grade ───────────────────────────
--
-- ⚠️ RESTATED FROM 0209's live body. Same signature (no overload). Changed: the pass/miss line moves
-- from the target to the pass mark, and a pass stamps scoped_tier and writes the EARNED tier into
-- difficulty_tier before claiming. The claim, the vouch window and the single grant are 0209's.
create or replace function report_goal_grade(
  p_goal_id uuid,
  p_grade numeric,
  p_proof_path text default null,
  p_voucher_ids uuid[] default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_goal challenges;
  v_passed boolean;
  v_claim jsonb;
  v_pass_mark numeric;
  v_scoped text;
  v_earned text;
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
  -- 0209 — claimed_at joins the guard. A pass waiting on vouches is neither completed nor missed,
  -- and without this a second report would be free to overwrite the mark the friends were asked
  -- to confirm.
  if v_goal.completed_at is not null or v_goal.missed_at is not null or v_goal.claimed_at is not null then
    raise exception 'You already reported that one.';
  end if;
  if v_goal.retired_at is not null then
    raise exception 'That goal was collapsed into another one.';
  end if;

  -- 0210 — the line is the COURSE's pass mark, not the target. Never above the target: hitting
  -- what you aimed for is always a pass.
  v_pass_mark := least(coalesce(v_goal.pass_mark, 50), v_goal.grade_target);
  v_passed := p_grade >= v_pass_mark;

  -- ── A COURSE FAIL — the only miss. Settles now; nothing to vouch for.
  if not v_passed then
    update challenges
       set progress = p_grade,
           missed_at = now()
     where id = p_goal_id
    returning * into v_goal;

    return jsonb_build_object(
      'id', v_goal.id,
      'label', v_goal.label,
      'grade', p_grade,
      'grade_target', v_goal.grade_target,
      'pass_mark', v_pass_mark,
      'passed', false,
      'tier', v_goal.difficulty_tier,
      'scoped_tier', v_goal.difficulty_tier,
      'earned_tier', null,
      'state', 'missed',
      'reward', null,
      'reward_vouched', null
    );
  end if;

  -- ── A PASS — a win at the earned tier. difficulty_tier becomes what was EARNED so the untouched
  -- challenges_economy trigger pays that; scoped_tier keeps what was aimed for.
  v_scoped := coalesce(v_goal.scoped_tier, v_goal.difficulty_tier, 'uncommon');
  v_earned := grade_effective_tier(v_scoped, v_goal.grade_target, p_grade, v_goal.grade_discipline);

  update challenges
     set progress = p_grade,
         scoped_tier = v_scoped,
         difficulty_tier = v_earned
   where id = p_goal_id;

  -- claim_goal_complete owns every branch from here: the proof-path ownership check, the roster,
  -- the window, the push, and the honour settle when nobody was asked. Nothing here decides a level.
  v_claim := claim_goal_complete(p_goal_id, p_proof_path, p_voucher_ids);

  select * into v_goal from challenges where id = p_goal_id;

  -- `reward` is what the EARNED tier pays at the level it stands at now (honour, settled or
  -- pending); `reward_vouched` is what two friends lift it to. Both from preview_challenge_reward,
  -- the function grant_reward reads.
  return jsonb_build_object(
    'id', v_goal.id,
    'label', v_goal.label,
    'grade', p_grade,
    'grade_target', v_goal.grade_target,
    'pass_mark', v_pass_mark,
    'passed', true,
    'tier', v_earned,
    'scoped_tier', v_scoped,
    'earned_tier', v_earned,
    'state', v_claim ->> 'state',
    'level', coalesce(v_goal.verifiability, 'honor'),
    'asked', coalesce((v_claim ->> 'asked')::int, 0),
    'deadline', v_goal.vouch_deadline,
    'has_proof', v_goal.proof_path is not null,
    'reward', preview_challenge_reward(v_earned, coalesce(v_goal.verifiability, 'honor'), 1, 1),
    'reward_vouched', preview_challenge_reward(v_earned, 'vouched', 1, 1)
  );
end;
$$;

comment on function report_goal_grade(uuid, numeric, text, uuid[]) is
  '0210 — under the pass mark (default 50) is a miss. A pass completes at grade_effective_tier (the discipline ladder), written into difficulty_tier so the untouched economy trigger pays it, via claim_goal_complete (0209): vouchers → 48h window, nobody → honour now.';

-- ─────────────────────────── 6 · the preview the sheet reads before settling ───────────────────
--
-- Read-only. The grade sheet shows "earns X now · 2 friends vouch → Y" BEFORE the one-way report,
-- and the ladder must not be re-implemented on the client to do it.
create or replace function preview_grade_reward(p_goal_id uuid, p_grade numeric)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_goal challenges;
  v_pass_mark numeric;
  v_earned text;
begin
  select * into v_goal from challenges c where c.id = p_goal_id and c.user_id = auth.uid();
  if v_goal.id is null or v_goal.grade_target is null then
    raise exception 'That goal is not yours.';
  end if;
  if p_grade is null or p_grade < 0 or p_grade > 100 then
    raise exception 'A grade is a percentage between 0 and 100.';
  end if;

  v_pass_mark := least(coalesce(v_goal.pass_mark, 50), v_goal.grade_target);
  if p_grade < v_pass_mark then
    return jsonb_build_object('passed', false, 'pass_mark', v_pass_mark, 'earned_tier', null,
                              'reward', null, 'reward_vouched', null);
  end if;

  v_earned := grade_effective_tier(coalesce(v_goal.scoped_tier, v_goal.difficulty_tier, 'uncommon'),
                                   v_goal.grade_target, p_grade, v_goal.grade_discipline);
  return jsonb_build_object(
    'passed', true,
    'pass_mark', v_pass_mark,
    'scoped_tier', coalesce(v_goal.scoped_tier, v_goal.difficulty_tier),
    'earned_tier', v_earned,
    'reward', preview_challenge_reward(v_earned, 'honor', 1, 1),
    'reward_vouched', preview_challenge_reward(v_earned, 'vouched', 1, 1)
  );
end;
$$;

revoke all on function preview_grade_reward(uuid, numeric) from public, anon;
grant execute on function preview_grade_reward(uuid, numeric) to authenticated;

-- ─────────────────────────── assertions ───────────────────────────
do $assert$
declare
  v_fn text;
  v_n int;
  v_uid uuid;
  v_vouchers uuid[];
  v_out jsonb;
  v_id uuid;
  v_row challenges;
  v_c1 uuid;
  v_c2 uuid;
  v_c3 uuid;
  v_caught text;
  v_rare_honor text := goal_paid_band('rare', 'honor');
begin
  -- ── one function per name, and the neighbours untouched ──
  foreach v_fn in array array['report_goal_grade', 'create_scoped_goals', 'grade_band', 'grade_effective_tier',
                              'preview_grade_reward', 'nominate_priority_course', 'release_priority_course',
                              'get_priority_courses', 'priority_course_nominate', 'current_economy_season']
  loop
    select count(*) into v_n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = v_fn;
    if v_n <> 1 then
      raise exception '0210: % has % definitions, expected 1', v_fn, v_n;
    end if;
  end loop;

  if (select md5(prosrc) from pg_proc where oid = 'economy_on_challenge_completed()'::regprocedure) <> 'd40f622b7dbed4eaaff658205ab03a1c'
     or (select md5(prosrc) from pg_proc where oid = 'log_challenge_progress(uuid, numeric, text)'::regprocedure) <> '8147740abe646b2526df832a3fb0c916'
     or (select md5(prosrc) from pg_proc where oid = 'claim_goal_complete(uuid, text, uuid[])'::regprocedure) <> '00560c89691a05eacff1369965efdc3e'
     or (select md5(prosrc) from pg_proc where oid = 'submit_vouch(uuid, boolean)'::regprocedure) <> '1b72655b96e7641d7f76b8d291fd0c64'
     or (select md5(prosrc) from pg_proc where proname = 'goal_paid_band') <> 'a5e926a81aaa52258215dc56faf360e4' then
    raise exception '0210: a function this migration builds on has changed underneath it';
  end if;

  if has_function_privilege('anon', 'nominate_priority_course(uuid)', 'execute')
     or has_function_privilege('authenticated', 'priority_course_nominate(uuid, uuid)', 'execute') then
    raise exception '0210: a priority function is reachable by the wrong role';
  end if;

  -- ── the ladder, at every rung the spec names ──
  -- STEM, legendary, target 90, step 10, floor rare.
  if grade_effective_tier('legendary', 90, 95, 'stem') <> 'legendary'
     or grade_effective_tier('legendary', 90, 90, 'stem') <> 'legendary'
     or grade_effective_tier('legendary', 90, 80, 'stem') <> 'epic'
     or grade_effective_tier('legendary', 90, 70, 'stem') <> 'rare'
     or grade_effective_tier('legendary', 90, 65, 'stem') <> 'rare'
     or grade_effective_tier('legendary', 90, 60, 'stem') <> 'rare' then
    raise exception '0210: the STEM ladder is wrong';
  end if;
  -- The floor lift discriminates: the same 60 UNTAGGED falls to uncommon, not rare.
  if grade_effective_tier('legendary', 90, 60, null) <> 'uncommon' then
    raise exception '0210: an untagged goal was floor-lifted (got %)', grade_effective_tier('legendary', 90, 60, null);
  end if;
  -- Arts, step 5, floor uncommon.
  if grade_effective_tier('legendary', 90, 85, 'arts') <> 'epic'
     or grade_effective_tier('legendary', 90, 80, 'arts') <> 'rare'
     or grade_effective_tier('legendary', 90, 75, 'arts') <> 'uncommon'
     or grade_effective_tier('legendary', 90, 70, 'arts') <> 'uncommon' then
    raise exception '0210: the arts ladder is wrong';
  end if;
  -- The band clamps the scope, both ends.
  if grade_effective_tier('common', 90, 95, 'stem') <> 'rare'
     or grade_effective_tier('mythic', 95, 100, 'stem') <> 'mythic' then
    raise exception '0210: the band does not clamp the scoped tier';
  end if;

  -- ── the bodies, run for real, rolled back ──
  select id into v_uid from profiles order by created_at limit 1;
  select array_agg(id) into v_vouchers from (
    select p.id from profiles p
     where p.id <> v_uid
       and not exists (select 1 from goal_vouches gv
                        where gv.voucher_id = p.id and gv.counted
                          and gv.created_at > now() - interval '30 days')
     order by p.created_at
     limit 2
  ) q;
  if v_uid is null or coalesce(array_length(v_vouchers, 1), 0) < 2 then
    raise notice '0210: fewer than three profiles, skipping the behavioural assertions';
    return;
  end if;

  begin
    -- Three scratch courses, written as the table owner before impersonating.
    insert into user_courses (user_id, code, title) values (v_uid, 'Z0210A', '0210 assertion A') returning id into v_c1;
    insert into user_courses (user_id, code, title) values (v_uid, 'Z0210B', '0210 assertion B') returning id into v_c2;
    insert into user_courses (user_id, code, title) values (v_uid, 'Z0210C', '0210 assertion C') returning id into v_c3;
    -- The member may already hold slots this season; clear them inside the rollback so the cap
    -- arithmetic below is about THIS test, not their real history.
    delete from priority_courses where user_id = v_uid;

    perform set_config('philoi.suppress_push', 'on', true);
    perform set_config('request.jwt.claims', json_build_object('sub', v_uid, 'role', 'authenticated')::text, true);
    perform set_config('role', 'authenticated', true);

    -- ── create: the band clamps a STEM scope up to rare, the discipline persists, priority nominates ──
    v_out := create_scoped_goals(jsonb_build_array(
      jsonb_build_object('label', '0210 · stem', 'grade_target', 90, 'difficulty_tier', 'common',
                         'grade_discipline', 'stem', 'course_id', v_c1, 'priority', true)));
    v_id := (v_out -> 'results' -> 0 ->> 'id')::uuid;
    select * into v_row from challenges where id = v_id;
    if v_row.difficulty_tier <> 'rare' or v_row.grade_discipline <> 'stem' then
      raise exception '0210: a STEM goal was not clamped/tagged (tier %, discipline %)', v_row.difficulty_tier, v_row.grade_discipline;
    end if;
    if v_out -> 'results' -> 0 ->> 'priority' <> 'nominated' then
      raise exception '0210: priority did not nominate (%)', v_out -> 'results' -> 0 ->> 'priority';
    end if;

    -- ── one grade goal per course: a second on v_c1 exists, one on v_c2 is made (the control) ──
    v_out := create_scoped_goals(jsonb_build_array(
      jsonb_build_object('label', '0210 · stem again', 'grade_target', 85, 'difficulty_tier', 'epic',
                         'grade_discipline', 'stem', 'course_id', v_c1),
      jsonb_build_object('label', '0210 · legendary', 'grade_target', 90, 'difficulty_tier', 'legendary',
                         'grade_discipline', 'stem', 'course_id', v_c2, 'priority', true)));
    if v_out -> 'results' -> 0 ->> 'status' <> 'existed' or v_out -> 'results' -> 1 ->> 'status' <> 'created' then
      raise exception '0210: the per-course check is wrong (% / %)',
        v_out -> 'results' -> 0 ->> 'status', v_out -> 'results' -> 1 ->> 'status';
    end if;

    -- ── the cap: a third priority is 'full', and the goal still stands ──
    v_out := create_scoped_goals(jsonb_build_array(
      jsonb_build_object('label', '0210 · third', 'grade_target', 90, 'difficulty_tier', 'epic',
                         'grade_discipline', 'arts', 'course_id', v_c3, 'priority', true)));
    if v_out -> 'results' -> 0 ->> 'priority' <> 'full' or v_out -> 'results' -> 0 ->> 'status' <> 'created' then
      raise exception '0210: a third priority course was not refused (%)', v_out -> 'results' -> 0;
    end if;
    v_caught := null;
    begin
      perform nominate_priority_course(v_c3);
    exception when others then
      v_caught := SQLERRM;
    end;
    if v_caught is null then
      raise exception '0210: nominate_priority_course let a third slot through';
    end if;
    if jsonb_array_length(get_priority_courses() -> 'courses') <> 2 then
      raise exception '0210: expected exactly two priority courses';
    end if;

    -- ── report: a shortfall is a WIN at the laddered tier, not a miss ──
    v_id := (select id from challenges where user_id = v_uid and course_id = v_c2 and label = '0210 · legendary');
    v_out := preview_grade_reward(v_id, 70);
    if v_out ->> 'earned_tier' <> 'rare' then
      raise exception '0210: preview disagrees with the ladder (%)', v_out ->> 'earned_tier';
    end if;
    v_out := report_goal_grade(v_id, 70);
    select * into v_row from challenges where id = v_id;
    if not (v_out ->> 'passed')::boolean or v_row.completed_at is null or v_row.missed_at is not null
       or v_row.difficulty_tier <> 'rare' or v_row.scoped_tier <> 'legendary' then
      raise exception '0210: a 70 on a STEM legendary 90 did not complete as rare (tier %, scoped %)', v_row.difficulty_tier, v_row.scoped_tier;
    end if;
    if v_row.reward_payload ->> 'max_band' is distinct from v_rare_honor then
      raise exception '0210: the earned tier did not reach the payout (%)', v_row.reward_payload ->> 'max_band';
    end if;

    -- A slot that paid out cannot be released to make room for a third box.
    v_caught := null;
    begin
      perform release_priority_course(v_c2);
    exception when others then
      v_caught := SQLERRM;
    end;
    if v_caught is null then
      raise exception '0210: a paid-out priority course was released';
    end if;

    -- ── a course fail is the only miss ──
    v_id := (select id from challenges where user_id = v_uid and course_id = v_c1 and label = '0210 · stem');
    v_out := report_goal_grade(v_id, 45);
    select * into v_row from challenges where id = v_id;
    if (v_out ->> 'passed')::boolean or v_row.missed_at is null or v_row.completed_at is not null then
      raise exception '0210: a 45 was not a miss';
    end if;
    -- Control: the released-slot refusal above was about PAYING, not about releasing at all.
    v_out := release_priority_course(v_c1);
    if jsonb_array_length(v_out -> 'courses') <> 1 then
      raise exception '0210: an unpaid priority course could not be released';
    end if;

    -- ── mythic STEM: two vouches → apex; the same on honour → notable ──
    v_out := create_scoped_goals(jsonb_build_array(
      jsonb_build_object('label', '0210 · mythic vouched', 'grade_target', 95, 'difficulty_tier', 'mythic', 'grade_discipline', 'stem'),
      jsonb_build_object('label', '0210 · mythic honour', 'grade_target', 95, 'difficulty_tier', 'mythic', 'grade_discipline', 'stem')));
    v_id := (v_out -> 'results' -> 1 ->> 'id')::uuid;
    perform report_goal_grade(v_id, 97);
    if (select reward_payload ->> 'max_band' from challenges where id = v_id) is distinct from 'notable' then
      raise exception '0210: an honour mythic grade was not capped at The Furnace';
    end if;

    v_id := (v_out -> 'results' -> 0 ->> 'id')::uuid;
    v_out := report_goal_grade(v_id, 97, null, v_vouchers);
    if v_out ->> 'state' <> 'pending_vouch' or (v_out -> 'reward_vouched' ->> 'paid_band') <> 'apex' then
      raise exception '0210: a mythic grade did not wait for vouches quoting apex (%)', v_out;
    end if;
    perform set_config('request.jwt.claims', json_build_object('sub', v_vouchers[1], 'role', 'authenticated')::text, true);
    perform submit_vouch(v_id, true);
    perform set_config('request.jwt.claims', json_build_object('sub', v_vouchers[2], 'role', 'authenticated')::text, true);
    perform submit_vouch(v_id, true);
    perform set_config('request.jwt.claims', json_build_object('sub', v_uid, 'role', 'authenticated')::text, true);
    select * into v_row from challenges where id = v_id;
    if v_row.verifiability <> 'vouched' or v_row.reward_payload ->> 'max_band' is distinct from 'apex' then
      raise exception '0210: a vouched mythic grade paid % at %', v_row.reward_payload ->> 'max_band', v_row.verifiability;
    end if;

    raise exception 'philoi_0210_rollback';
  exception
    when others then
      if SQLERRM <> 'philoi_0210_rollback' then
        raise;
      end if;
  end;
end
$assert$;
